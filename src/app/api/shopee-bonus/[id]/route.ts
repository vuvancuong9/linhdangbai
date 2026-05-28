import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

async function findOwned(id: string, userId: string) {
  return prisma.shopeeBonus.findFirst({ where: { id, userId } })
}

// PUT /api/shopee-bonus/[id]
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const owned = await findOwned(params.id, user.userId)
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const body = await req.json()
    const data: any = {}
    if (typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month)) {
      data.date = new Date(body.month + "-01T00:00:00Z")
    }
    if (typeof body.programName === "string") {
      const n = body.programName.trim()
      if (!n) return NextResponse.json({ error: "Thiếu tên chương trình" }, { status: 400 })
      data.programName = n
    }
    if (body.amount !== undefined) {
      const n = Number(body.amount)
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: "Số tiền không hợp lệ" }, { status: 400 })
      data.amount = n
    }
    if ("note" in body) data.note = body.note ? String(body.note).trim() : null

    const updated = await prisma.shopeeBonus.update({ where: { id: params.id }, data })
    return NextResponse.json({
      ok: true,
      item: {
        id: updated.id,
        programName: updated.programName,
        amount: updated.amount,
        month: `${updated.date.getUTCFullYear()}-${String(updated.date.getUTCMonth() + 1).padStart(2, "0")}`,
        note: updated.note,
      },
    })
  } catch (e: any) {
  return safeError(e, "shopee-bonus/[id]")
}
}

// DELETE /api/shopee-bonus/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const owned = await findOwned(params.id, user.userId)
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })
    await prisma.shopeeBonus.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "shopee-bonus/[id]")
}
}
