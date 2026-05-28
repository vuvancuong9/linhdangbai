import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// GET /api/campaigns/orphan?from=YYYY-MM-DD&to=YYYY-MM-DD
// Trả HH các subId2 KHÔNG match camp visible (camp có adAccountId != null).
// Mục đích: explain discrepancy giữa Dashboard (group theo shopeeAccountId — tổng all)
// và Quản lý Campaign (group theo subId2 — chỉ camp visible).
//
// Response:
//   total: tổng HH orphan
//   orderCount: số order orphan
//   items: [{ subId2, commission, orderCount, legacyCamp: { id, name, campId } | null }]
//   legacyCamp != null nghĩa là có camp adAccountId=null cùng tên → user có thể restore/xoá.
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const fromStr = searchParams.get("from") || ""
    const toStr = searchParams.get("to") || ""

    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRe.test(fromStr) || !dateRe.test(toStr)) {
      return NextResponse.json({ error: "Thiếu hoặc sai định dạng from/to (YYYY-MM-DD)" }, { status: 400 })
    }
    const from = new Date(fromStr + "T00:00:00Z")
    const to = new Date(toStr + "T00:00:00Z")
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
      return NextResponse.json({ error: "Date range không hợp lệ" }, { status: 400 })
    }
    const toExclusive = new Date(to)
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1)

    // 1. Tên camp VISIBLE (adAccountId != null) — các tên này được Quản lý Campaign tính.
    const visibleCamps = await prisma.campaign.findMany({
      where: { userId: user.userId, adAccountId: { not: null } },
      select: { name: true },
    })
    const visibleSet = new Set(visibleCamps.map((c) => c.name).filter(Boolean) as string[])

    // 2. Toàn bộ HH theo subId2 trong date range (bỏ cancelled).
    const allBySubId = await prisma.orderCommission.groupBy({
      by: ["subId2"],
      where: {
        userId: user.userId,
        clickDate: { gte: from, lt: toExclusive },
        status: { not: "cancelled" },
        subId2: { not: null },
      },
      _sum: { commission: true },
      _count: { _all: true },
    })

    // 3. Filter: subId2 KHÔNG nằm trong visibleSet.
    const orphanSubIds = (allBySubId as any[]).filter((g) => g.subId2 && !visibleSet.has(g.subId2))
    if (orphanSubIds.length === 0) {
      return NextResponse.json({ total: 0, orderCount: 0, items: [] })
    }

    // 4. Tìm camp legacy (adAccountId=null) trùng tên với orphan subId2.
    const orphanNames = orphanSubIds.map((g) => g.subId2 as string)
    const legacyCamps = await prisma.campaign.findMany({
      where: { userId: user.userId, adAccountId: null, name: { in: orphanNames } },
      select: { id: true, name: true, campId: true },
    })
    const legacyByName = new Map<string, { id: string; name: string; campId: string }>()
    for (const lc of legacyCamps) legacyByName.set(lc.name, lc)

    // 5. Build response, sort by commission desc.
    const items = orphanSubIds
      .map((g: any) => ({
        subId2: g.subId2 as string,
        commission: Math.round(g._sum?.commission ?? 0),
        orderCount: g._count?._all ?? 0,
        legacyCamp: legacyByName.get(g.subId2) || null,
      }))
      .filter((x) => x.commission > 0)
      .sort((a, b) => b.commission - a.commission)

    const total = items.reduce((s, x) => s + x.commission, 0)
    const orderCount = items.reduce((s, x) => s + x.orderCount, 0)

    return NextResponse.json({ total, orderCount, items })
  } catch (e: any) {
  return safeError(e, "campaigns/orphan")
}
}
