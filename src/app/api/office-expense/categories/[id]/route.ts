import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// PUT /api/office-expense/categories/[id]
// Body: { name?, color? }
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const owned = await prisma.officeExpenseCategory.findFirst({ where: { id: params.id, userId: user.userId } })
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const body = await req.json()
    const data: any = {}
    if (typeof body.name === "string") {
      const n = body.name.trim()
      if (!n) return NextResponse.json({ error: "Tên không được rỗng" }, { status: 400 })
      data.name = n
    }
    if ("color" in body) data.color = body.color ? String(body.color).trim() : null
    try {
      const updated = await prisma.officeExpenseCategory.update({ where: { id: params.id }, data })
      return NextResponse.json({ ok: true, item: updated })
    } catch (e: any) {
      if (e?.code === "P2002") return NextResponse.json({ error: "Tên danh mục đã tồn tại" }, { status: 400 })
      throw e
    }
  } catch (e: any) {
  return safeError(e, "office-expense/categories/[id]")
}
}

// DELETE /api/office-expense/categories/[id]
// Khoản chi đang thuộc category này → categoryId chuyển null (giữ amount).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const owned = await prisma.officeExpenseCategory.findFirst({ where: { id: params.id, userId: user.userId } })
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })
    await prisma.officeExpenseCategory.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "office-expense/categories/[id]")
}
}
