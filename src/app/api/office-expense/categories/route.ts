import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// Bảng màu mặc định khi user thêm category mà không chọn màu.
const DEFAULT_COLORS = ["#4F7EF8", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444", "#06B6D4", "#EC4899", "#84CC16"]

// GET /api/office-expense/categories
export async function GET() {
  try {
    const user = await requireAuth()
    const items = await prisma.officeExpenseCategory.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { expenses: true } } },
    })
    return NextResponse.json({
      items: items.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        expenseCount: c._count.expenses,
        createdAt: c.createdAt,
      })),
    })
  } catch (e: any) {
  return safeError(e, "office-expense/categories")
}
}

// POST /api/office-expense/categories
// Body: { name, color? }
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const name = String(body?.name || "").trim()
    let color = body?.color ? String(body.color).trim() : null
    if (!name) return NextResponse.json({ error: "Thiếu tên danh mục" }, { status: 400 })
    if (name.length > 60) return NextResponse.json({ error: "Tên danh mục quá dài" }, { status: 400 })

    // Nếu user không chọn màu → auto pick từ DEFAULT_COLORS theo thứ tự
    if (!color) {
      const count = await prisma.officeExpenseCategory.count({ where: { userId: user.userId } })
      color = DEFAULT_COLORS[count % DEFAULT_COLORS.length]
    }

    try {
      const created = await prisma.officeExpenseCategory.create({
        data: { userId: user.userId, name, color },
      })
      return NextResponse.json({ ok: true, item: created })
    } catch (e: any) {
      if (e?.code === "P2002") return NextResponse.json({ error: "Tên danh mục đã tồn tại" }, { status: 400 })
      throw e
    }
  } catch (e: any) {
  return safeError(e, "office-expense/categories")
}
}
