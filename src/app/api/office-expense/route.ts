import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// GET /api/office-expense?from=&to=&categoryId=&q=&page=1&pageSize=10
// Trả list expense + stats (tổng, count, by category, by month).
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from") || ""
    const to = searchParams.get("to") || ""
    const categoryId = searchParams.get("categoryId") || ""
    const q = (searchParams.get("q") || "").trim()
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
    const pageSize = Math.min(100, Math.max(5, parseInt(searchParams.get("pageSize") || "10")))

    const where: any = { userId: user.userId }
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      const fromD = new Date(from + "T00:00:00Z")
      const toD = new Date(to + "T00:00:00Z")
      toD.setUTCDate(toD.getUTCDate() + 1) // exclusive
      where.date = { gte: fromD, lt: toD }
    }
    if (categoryId) where.categoryId = categoryId
    if (q) {
      where.OR = [
        { content: { contains: q, mode: "insensitive" } },
        { supplier: { contains: q, mode: "insensitive" } },
        { note: { contains: q, mode: "insensitive" } },
      ]
    }

    // Filter cho stats by-month: 6 tháng gần nhất (không phụ thuộc date filter)
    const today = new Date()
    const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1)

    const [items, total, byCategory, byMonthRaw, totalCount] = await Promise.all([
      prisma.officeExpense.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: { select: { id: true, name: true, color: true } } },
      }),
      prisma.officeExpense.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
      }),
      prisma.officeExpense.groupBy({
        by: ["categoryId"],
        where,
        _sum: { amount: true },
      }),
      prisma.$queryRaw<Array<{ month: string; total: number }>>`
        SELECT to_char("date", 'YYYY-MM') AS month, SUM("amount")::float AS total
        FROM office_expenses
        WHERE "userId" = ${user.userId} AND "date" >= ${sixMonthsAgo}
        GROUP BY 1 ORDER BY 1 ASC
      `,
      prisma.officeExpense.count({ where }),
    ])

    // Lấy tên + màu category cho byCategory chart
    const catIds = byCategory.map((b) => b.categoryId).filter(Boolean) as string[]
    const cats =
      catIds.length > 0
        ? await prisma.officeExpenseCategory.findMany({
            where: { userId: user.userId, id: { in: catIds } },
            select: { id: true, name: true, color: true },
          })
        : []
    const catMap = new Map(cats.map((c) => [c.id, c]))

    return NextResponse.json({
      items,
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      stats: {
        totalAmount: Math.round(total._sum.amount || 0),
        count: total._count || 0,
        byCategory: byCategory.map((b) => ({
          categoryId: b.categoryId,
          name: b.categoryId ? catMap.get(b.categoryId)?.name || "(Đã xoá)" : "Khác",
          color: b.categoryId ? catMap.get(b.categoryId)?.color || null : null,
          amount: Math.round(b._sum.amount || 0),
        })),
        byMonth: byMonthRaw.map((r) => ({ month: r.month, total: Math.round(r.total) })),
      },
    })
  } catch (e: any) {
  return safeError(e, "office-expense")
}
}

// POST /api/office-expense
// Body: { date: 'YYYY-MM-DD', content, categoryId?, supplier?, amount, note? }
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const date = String(body?.date || "").trim()
    const content = String(body?.content || "").trim()
    const categoryId = body?.categoryId ? String(body.categoryId) : null
    const supplier = body?.supplier ? String(body.supplier).trim() : null
    const amount = Number(body?.amount)
    const note = body?.note ? String(body.note).trim() : null

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Date format YYYY-MM-DD" }, { status: 400 })
    if (!content) return NextResponse.json({ error: "Thiếu nội dung" }, { status: 400 })
    if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: "Số tiền không hợp lệ" }, { status: 400 })

    if (categoryId) {
      const cat = await prisma.officeExpenseCategory.findFirst({ where: { id: categoryId, userId: user.userId } })
      if (!cat) return NextResponse.json({ error: "Danh mục không hợp lệ" }, { status: 400 })
    }

    const created = await prisma.officeExpense.create({
      data: {
        userId: user.userId,
        date: new Date(date + "T00:00:00Z"),
        content,
        categoryId,
        supplier,
        amount,
        note,
      },
      include: { category: { select: { id: true, name: true, color: true } } },
    })
    return NextResponse.json({ ok: true, item: created })
  } catch (e: any) {
  return safeError(e, "office-expense")
}
}
