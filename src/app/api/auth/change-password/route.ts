import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth, comparePassword, hashPassword } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { validatePassword } from "@/lib/password-policy"

export async function POST(req: NextRequest) {
  try {
    const me = await requireAuth()
    const { currentPassword, newPassword } = await req.json()

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Thiếu mật khẩu cũ hoặc mới" }, { status: 400 })
    }
    const v = validatePassword(String(newPassword))
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 })
    }

    const u = await prisma.user.findUnique({ where: { id: me.userId } })
    if (!u) return NextResponse.json({ error: "Không tìm thấy user" }, { status: 404 })

    const ok = await comparePassword(String(currentPassword), u.password)
    if (!ok) return NextResponse.json({ error: "Mật khẩu cũ không đúng" }, { status: 400 })

    const hashed = await hashPassword(String(newPassword))
    await prisma.user.update({ where: { id: u.id }, data: { password: hashed } })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "auth/change-password")
}
}
