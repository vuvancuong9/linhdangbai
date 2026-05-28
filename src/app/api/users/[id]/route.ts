import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin, invalidateSessionCache } from "@/lib/auth"
import { MENU_KEYS } from "@/lib/permissions"
import { safeError } from "@/lib/api"

// Helper: check user hiện tại có quyền thao tác (sửa/xoá) target user không.
// - SUPER_ADMIN: thao tác mọi user (trừ chính nó).
// - ADMIN: chỉ thao tác user con (parentId = self.id).
// - USER: không có quyền.
async function canManageTarget(meUserId: string, meRole: string, targetId: string): Promise<{ ok: boolean; targetRole?: string; reason?: string }> {
  if (meUserId === targetId) return { ok: false, reason: "Không thể tự thay đổi tài khoản của mình" }
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, parentId: true } as any })
  if (!target) return { ok: false, reason: "User không tồn tại" }
  if (meRole === "SUPER_ADMIN") return { ok: true, targetRole: (target as any).role }
  if (meRole === "ADMIN") {
    if ((target as any).parentId !== meUserId) return { ok: false, reason: "ADMIN chỉ thao tác được user con của mình" }
    return { ok: true, targetRole: (target as any).role }
  }
  return { ok: false, reason: "Không có quyền" }
}

// PATCH/PUT: cập nhật role / status / userType.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const me = await requireAdmin()
    const check = await canManageTarget(me.userId, me.role, params.id)
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === "User không tồn tại" ? 404 : 403 })

    const body = await req.json()
    const validRoles = ["SUPER_ADMIN", "ADMIN", "USER"]
    const validStatus = ["ACTIVE", "LOCKED"]
    const validUserTypes = ["accountant", "product_finder"]
    const data: any = {}

    if (body.role !== undefined) {
      if (!validRoles.includes(body.role)) return NextResponse.json({ error: "Role không hợp lệ" }, { status: 400 })
      // CHỈ SUPER_ADMIN mới được đổi role. ADMIN không được đổi role user con.
      if (me.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Chỉ SUPER_ADMIN được đổi role" }, { status: 403 })
      data.role = body.role
      // Nếu đổi sang non-USER → clear userType.
      if (body.role !== "USER") data.userType = null
    }
    if (body.status !== undefined) {
      if (!validStatus.includes(body.status)) return NextResponse.json({ error: "Status không hợp lệ" }, { status: 400 })
      data.status = body.status
    }
    if (body.userType !== undefined) {
      if (body.userType !== null && !validUserTypes.includes(body.userType)) {
        return NextResponse.json({ error: "userType không hợp lệ" }, { status: 400 })
      }
      data.userType = body.userType
    }
    if (body.permissions !== undefined) {
      if (body.permissions === null) {
        // CHI SUPER_ADMIN duoc set permissions=null (full access)
        if (me.role !== "SUPER_ADMIN") {
          return NextResponse.json({ error: "Chỉ SUPER_ADMIN được gán full access (permissions=null)" }, { status: 403 })
        }
        data.permissions = null
      } else if (Array.isArray(body.permissions)) {
        let filtered = body.permissions.filter((k: any) => typeof k === "string" && MENU_KEYS.includes(k))

        // ENFORCE: ADMIN chi grant duoc quyen MINH co
        if (me.role === "ADMIN") {
          const meUser = await prisma.user.findUnique({
            where: { id: me.userId },
            select: { permissions: true },
          })
          let mePerms: string[] | null = null
          if (meUser?.permissions) {
            try {
              const p = JSON.parse(meUser.permissions)
              if (Array.isArray(p)) mePerms = p
            } catch {}
          }
          if (mePerms !== null) {
            const beforeLen = filtered.length
            filtered = filtered.filter((k: string) => mePerms!.includes(k))
            if (filtered.length < beforeLen) {
              return NextResponse.json({ error: `ADMIN chỉ được gán quyền ADMIN đang có. Bỏ ${beforeLen - filtered.length} quyền không hợp lệ.` }, { status: 403 })
            }
          }
        }

        if (filtered.length === 0) {
          return NextResponse.json({ error: "Phải tích chọn ít nhất 1 quyền truy cập" }, { status: 400 })
        }
        data.permissions = JSON.stringify(filtered)
      } else {
        return NextResponse.json({ error: "permissions phải là array" }, { status: 400 })
      }
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Không có thay đổi" }, { status: 400 })
    await prisma.user.update({ where: { id: params.id }, data })

    // Auto force logout: nếu sửa role / permissions / userType / status (LOCKED) → revoke
    // tất cả LoginSession của user đó để JWT cũ bị invalidate ngay (cache TTL 60s).
    const shouldRevoke =
      data.role !== undefined ||
      data.permissions !== undefined ||
      data.userType !== undefined ||
      data.status === "LOCKED"
    if (shouldRevoke) {
      const now = new Date()
      const sessions = await prisma.loginSession.findMany({
        where: { userId: params.id, revokedAt: null },
        select: { id: true },
      })
      if (sessions.length > 0) {
        await prisma.loginSession.updateMany({
          where: { userId: params.id, revokedAt: null },
          data: { revokedAt: now },
        })
        // Invalidate session cache để effect ngay (không phải đợi 60s TTL).
        for (const s of sessions) invalidateSessionCache(s.id)
      }
    }

    return NextResponse.json({ ok: true, sessionsRevoked: shouldRevoke })
  } catch (e: any) {
    return safeError(e, "users/[id]")
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const me = await requireAdmin()
    const check = await canManageTarget(me.userId, me.role, params.id)
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === "User không tồn tại" ? 404 : 403 })
    await prisma.user.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return safeError(e, "users/[id]")
  }
}
