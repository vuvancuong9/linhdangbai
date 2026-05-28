import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin, hashPassword } from "@/lib/auth"
import { MENU_KEYS } from "@/lib/permissions"
import { safeError } from "@/lib/api"

export async function GET() {
  try {
    const me = await requireAdmin()
    // SUPER_ADMIN: thấy mọi user. ADMIN con: chỉ thấy SELF + users mình tạo (parentId = me.userId).
    // Tránh ADMIN con liệt kê email/role của TẤT CẢ user khác team (IDOR fix).
    const where: any = me.role === "SUPER_ADMIN"
      ? {}
      : { OR: [{ id: me.userId }, { parentId: me.userId }] }
    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, userType: true, permissions: true } as any,
    })
    return NextResponse.json(users)
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
}

// POST: tạo user mới.
// - SUPER_ADMIN: tạo được USER hoặc ADMIN. parentId tuỳ chọn (mặc định = self).
// - ADMIN: CHỈ tạo được USER. parentId tự động = self (ADMIN sở hữu USER mình tạo).
// - USER: không được tạo.
export async function POST(req: NextRequest) {
  try {
    const me = await requireAdmin() // SUPER_ADMIN hoặc ADMIN
    const { name, email, password, role, userType, permissions } = await req.json()
    if (!name || !email || !password) return NextResponse.json({ error: "Thieu thong tin" }, { status: 400 })
    const { validatePassword } = await import("@/lib/password-policy")
    const v = validatePassword(String(password))
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

    // Whitelist role.
    const validRoles = ["SUPER_ADMIN", "ADMIN", "USER"]
    let finalRole = validRoles.includes(role) ? role : "USER"

    // ADMIN chỉ được tạo USER (không tạo cùng cấp ADMIN, không tạo SUPER_ADMIN).
    if (me.role === "ADMIN" && finalRole !== "USER") {
      return NextResponse.json({ error: "ADMIN chỉ được tạo tài khoản USER" }, { status: 403 })
    }
    // SUPER_ADMIN không tạo SUPER_ADMIN khác (an toàn — phải set thủ công nếu cần).
    if (me.role === "SUPER_ADMIN" && finalRole === "SUPER_ADMIN") {
      return NextResponse.json({ error: "Không thể tạo SUPER_ADMIN qua API" }, { status: 403 })
    }

    // Validate userType (legacy, chỉ áp dụng cho USER).
    let finalUserType: string | null = null
    if (finalRole === "USER") {
      if (userType && !["accountant", "product_finder"].includes(userType)) {
        return NextResponse.json({ error: "userType không hợp lệ (accountant hoặc product_finder)" }, { status: 400 })
      }
      finalUserType = userType || null
    }

    // Validate permissions (mảng các menu key). Áp dụng cho cả USER và ADMIN.
    // SUPER_ADMIN không cần permissions (full quyền).
    let finalPermissions: string | null = null
    if (finalRole !== "SUPER_ADMIN") {
      if (!Array.isArray(permissions)) {
        return NextResponse.json({ error: "Thiếu quyền truy cập (permissions array)" }, { status: 400 })
      }
      let filtered = permissions.filter((k: any) => typeof k === "string" && MENU_KEYS.includes(k))

      // ENFORCE: ADMIN chi grant duoc quyen MINH co. SUPER_ADMIN full quyen.
      if (me.role === "ADMIN") {
        // Fetch perms cua ADMIN hien tai
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
        // Neu ADMIN limited (mePerms != null) → loc filtered chi giu cac key co trong mePerms
        if (mePerms !== null) {
          const beforeLen = filtered.length
          filtered = filtered.filter((k: string) => mePerms!.includes(k))
          if (filtered.length < beforeLen) {
            return NextResponse.json({ error: `ADMIN chỉ được gán quyền ADMIN đang có. Bỏ ${beforeLen - filtered.length} quyền không hợp lệ.` }, { status: 403 })
          }
        }
        // mePerms === null → ADMIN legacy full → cho phep tat ca
      }

      if (filtered.length === 0) {
        return NextResponse.json({ error: "Phải tích chọn ít nhất 1 quyền truy cập" }, { status: 400 })
      }
      finalPermissions = JSON.stringify(filtered)
    }

    // parentId: ADMIN tạo USER → parentId = ADMIN.id. SUPER_ADMIN tạo USER/ADMIN → parentId = SUPER_ADMIN.id.
    const parentId = me.userId

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return NextResponse.json({ error: "Email da ton tai" }, { status: 400 })

    const hashed = await hashPassword(password)
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashed,
        role: finalRole,
        parentId,
        userType: finalUserType,
        permissions: finalPermissions,
      } as any, // userType + parentId + permissions chưa có trong type Prisma generated cho tới khi `prisma generate` chạy
    })
    return NextResponse.json({ ok: true, id: user.id })
  } catch (e: any) {
    return safeError(e, "users")
  }
}
