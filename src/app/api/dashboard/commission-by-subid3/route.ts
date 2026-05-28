import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// GET /api/dashboard/commission-by-subid3?from=YYYY-MM-DD&to=YYYY-MM-DD
// Trả về list sub_id3 kèm tổng hoa hồng + số đơn (chỉ tính đơn status != "cancelled").
// Sub_id3 thường là tên creator/nhân viên trong utm_content (vd "NgocHaLe").
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from") || ""
    const to = searchParams.get("to") || ""

    const where: any = {
      userId: user.userId,
      status: { not: "cancelled" },
      subId3: { not: null },
    }
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      where.clickDate = { ...(where.clickDate || {}), gte: new Date(from + "T00:00:00Z") }
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      where.clickDate = { ...(where.clickDate || {}), lte: new Date(to + "T23:59:59.999Z") }
    }

    const grouped = await prisma.orderCommission.groupBy({
      by: ["subId3"],
      where,
      _sum: { commission: true, orderValue: true },
      _count: { _all: true },
    })

    const items = grouped
      .filter((g) => g.subId3 && g.subId3.trim() !== "")
      .map((g) => ({
        subId3: g.subId3,
        orderCount: g._count._all,
        commission: Number(g._sum.commission || 0),
        orderValue: Number(g._sum.orderValue || 0),
        // Avg commission per order
        avgPerOrder: g._count._all > 0 ? Math.round(Number(g._sum.commission || 0) / g._count._all) : 0,
      }))
    items.sort((a, b) => b.commission - a.commission)

    const totals = items.reduce((t, e) => ({
      orderCount: t.orderCount + e.orderCount,
      commission: t.commission + e.commission,
      orderValue: t.orderValue + e.orderValue,
    }), { orderCount: 0, commission: 0, orderValue: 0 })

    return NextResponse.json({ items, totals, count: items.length })
  } catch (e: any) {
  return safeError(e, "dashboard/commission-by-subid3")
}
}
