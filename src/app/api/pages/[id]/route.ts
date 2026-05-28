import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const r = await prisma.fanPage.deleteMany({ where: { id: params.id, userId: user.userId } })
    if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "pages/[id]")
}
}

// PATCH /api/pages/[id]
// Body: { accountId: string | null }
// Gan FanPage voi 1 AdAccount (null = unassign).
// Khi assign, validate AdAccount cung user va status ON.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const accountId: string | null = body?.accountId === null || body?.accountId === ""
      ? null
      : String(body?.accountId)

    if (accountId) {
      const acc = await prisma.adAccount.findFirst({ where: { id: accountId, userId: user.userId } })
      if (!acc) return NextResponse.json({ error: "Tài khoản ads không hợp lệ" }, { status: 400 })
    }

    const r = await prisma.fanPage.updateMany({
      where: { id: params.id, userId: user.userId },
      data: { accountId },
    })
    if (r.count === 0) return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 })
    return NextResponse.json({ ok: true, accountId })
  } catch (e: any) {
  return safeError(e, "pages/[id]")
}
}
