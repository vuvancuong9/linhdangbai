import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// PATCH /api/user-cards/[id] - sua the
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const card = await prisma.userCard.findUnique({ where: { id: params.id } })
    if (!card || card.userId !== user.userId) {
      return NextResponse.json({ error: "Khong tim thay" }, { status: 404 })
    }

    const body = await req.json()
    const data: any = {}
    if (body.bankName !== undefined) data.bankName = String(body.bankName).trim().slice(0, 100)
    if (body.cardOwnerName !== undefined) data.cardOwnerName = String(body.cardOwnerName).trim().slice(0, 100)
    if (body.cardLast4 !== undefined) {
      const v = String(body.cardLast4 || "").replace(/\D/g, "").slice(0, 4)
      if (v.length !== 4) return NextResponse.json({ error: "cardLast4 phai dung 4 chu so" }, { status: 400 })
      data.cardLast4 = v
    }
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim().slice(0, 500) : null

    try {
      const updated = await prisma.userCard.update({ where: { id: params.id }, data })
      return NextResponse.json({ ok: true, card: updated })
    } catch (e: any) {
      if (e?.code === "P2002") {
        return NextResponse.json({ error: `Thẻ với 4 số cuối ${data.cardLast4} đã tồn tại` }, { status: 409 })
      }
      throw e
    }
  } catch (e: any) {
  return safeError(e, "user-cards/[id]")
}
}

// DELETE /api/user-cards/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const card = await prisma.userCard.findUnique({ where: { id: params.id } })
    if (!card || card.userId !== user.userId) {
      return NextResponse.json({ error: "Khong tim thay" }, { status: 404 })
    }
    await prisma.userCard.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "user-cards/[id]")
}
}
