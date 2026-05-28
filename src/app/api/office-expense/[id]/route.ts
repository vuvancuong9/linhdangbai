import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

async function findOwned(id: string, userId: string) {
  return prisma.officeExpense.findFirst({ where: { id, userId } })
}

// PUT /api/office-expense/[id]
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const owned = await findOwned(params.id, user.userId)
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const body = await req.json()
    const data: any = {}
    if (typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) data.date = new Date(body.date + "T00:00:00Z")
    if (typeof body.content === "string") data.content = body.content.trim()
    if ("supplier" in body) data.supplier = body.supplier ? String(body.supplier).trim() : null
    if ("note" in body) data.note = body.note ? String(body.note).trim() : null
    if (typeof body.amount === "number" || (typeof body.amount === "string" && body.amount !== "")) {
      const n = Number(body.amount)
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: "Số tiền không hợp lệ" }, { status: 400 })
      data.amount = n
    }
    if ("categoryId" in body) {
      const cid = body.categoryId ? String(body.categoryId) : null
      if (cid) {
        const cat = await prisma.officeExpenseCategory.findFirst({ where: { id: cid, userId: user.userId } })
        if (!cat) return NextResponse.json({ error: "Danh mục không hợp lệ" }, { status: 400 })
      }
      data.categoryId = cid
    }

    const updated = await prisma.officeExpense.update({
      where: { id: params.id },
      data,
      include: { category: { select: { id: true, name: true, color: true } } },
    })
    return NextResponse.json({ ok: true, item: updated })
  } catch (e: any) {
  return safeError(e, "office-expense/[id]")
}
}

// DELETE /api/office-expense/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const owned = await findOwned(params.id, user.userId)
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })
    await prisma.officeExpense.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "office-expense/[id]")
}
}
