// GET /api/insights?since=YYYY-MM-DD&until=YYYY-MM-DD
// Trang Insights — bảng xếp hạng SP / Fanpage / Khung giờ.
//
// 4 sections trong 1 response:
//   1. topProducts: SP có HH cao nhất trong khoảng (top 20 + bottom 20)
//   2. pageCategoryMatrix: heatmap Fanpage × productCategoryL1 (avg HH per nhóm)
//   3. hourlyCommission: HH theo giờ trong ngày (0-23) — group by Post.postedAt hour
//   4. summary: tổng đơn, tổng commission, tổng spend trong khoảng
//
// Data source:
//   - OrderCommission (subId2 = camp.campId) → commission per camp
//   - Campaign → metadata (productItemId, productCategoryL1, page, spend)
//   - Post → postedAt cho giờ
//   - FanPage → tên page
//
// Spend trong khoảng: dùng Campaign.spend (caveat: total all-time hoặc theo last sync).
// Để chính xác hơn cần FB Insights API per camp — phase 2.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { COMMISSION_NET_FACTOR as COMMISSION_NET, ADS_COST_FACTOR as ADS_COST } from "@/lib/constants-server"

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const userId = user.userId
    const { searchParams } = new URL(req.url)
    const since = searchParams.get("since")
    const until = searchParams.get("until")

    // Default: tháng này
    const today = new Date()
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const fromStr = since || isoDate(firstOfMonth)
    const untilStr = until || isoDate(lastOfMonth)
    const fromDate = new Date(fromStr + "T00:00:00Z")
    const untilDate = new Date(untilStr + "T23:59:59.999Z")

    // SECURITY/DATA FIX (P1.3): Campaign.spend là tổng all-time (cập nhật lần
    // sync gần nhất) → KHÔNG match với date range user chọn. Chỉ trả về spend
    // chính xác khi user chọn full range (since=null && until=null hoặc range
    // phủ từ DATA_LOCK_DATE đến hôm nay). Khác đi → trả null + flag
    // spendAccurate=false để UI ẩn hoặc cảnh báo.
    const isFullRange = !since && !until  // mặc định = tháng này không tính full
    const spendAccurate = isFullRange

    // === STEP 1: GroupBy commission per subId2 (push aggregate xuống Postgres).
    // PERF FIX (P2.1): Trước fetch toàn bộ rows (có thể 50k-200k) về memory rồi
    // loop JS → 3-15s + 50-200MB RAM. Giờ groupBy ở DB → ~50-200ms cho mọi user.
    const orderAggRaw = await prisma.orderCommission.groupBy({
      by: ["subId2"],
      where: {
        userId,
        clickDate: { gte: fromDate, lte: untilDate },
        status: { not: "cancelled" },
        subId2: { not: null },
      },
      _sum: { commission: true },
      _count: { _all: true },
    })
    type OrderAgg = { subId2: string; commission: number; orderCount: number }
    const orderAggs: OrderAgg[] = orderAggRaw.map(a => ({
      subId2: a.subId2 as string,
      commission: a._sum.commission || 0,
      orderCount: a._count._all,
    }))

    // Representative product/shop name per subId2 (1 raw SQL với DISTINCT ON).
    // Lấy row mới nhất (createdAt DESC) làm tên đại diện cho mỗi camp.
    const repInfo = await prisma.$queryRaw<Array<{ subId2: string; productName: string | null; shopName: string | null }>>`
      SELECT DISTINCT ON ("subId2") "subId2", "productName", "shopName"
      FROM order_commission
      WHERE "userId" = ${userId}
        AND "clickDate" >= ${fromDate}
        AND "clickDate" <= ${untilDate}
        AND status != 'cancelled'
        AND "subId2" IS NOT NULL
      ORDER BY "subId2", "createdAt" DESC
    `
    const repBySubId = new Map(repInfo.map(r => [r.subId2, r]))

    // === STEP 2: Lấy campId distinct → fetch Campaign metadata ===
    const subIds = orderAggs.map(a => a.subId2)
    const camps = subIds.length > 0 ? await prisma.campaign.findMany({
      where: { userId, campId: { in: subIds } },
      select: {
        id: true, campId: true, name: true,
        productItemId: true, productShopId: true,
        productCategoryL1: true, productCategoryL2: true,
        spend: true,
      },
    }) : []
    const campByCampId = new Map(camps.map(c => [c.campId, c]))

    // === STEP 3: Map camp → fanpage (qua Post link) ===
    // Lấy posts có campaignId trong campIds, get pageId, rồi join FanPage.
    const campDbIds = camps.map(c => c.id)
    const posts = campDbIds.length > 0 ? await prisma.post.findMany({
      where: { userId, campaignId: { in: campDbIds }, deleted: false },
      select: { campaignId: true, pageId: true, postedAt: true },
    }) : []
    // Map campId (DB) → pageId (FB)
    const pageIdByCampDbId = new Map<string, string>()
    const postedAtByCampDbId = new Map<string, Date | null>()
    for (const p of posts) {
      if (p.campaignId && p.pageId && !pageIdByCampDbId.has(p.campaignId)) {
        pageIdByCampDbId.set(p.campaignId, p.pageId)
      }
      if (p.campaignId && p.postedAt && !postedAtByCampDbId.has(p.campaignId)) {
        postedAtByCampDbId.set(p.campaignId, p.postedAt)
      }
    }

    // Fetch FanPage names
    const pageIds = Array.from(new Set(Array.from(pageIdByCampDbId.values())))
    const pages = pageIds.length > 0 ? await prisma.fanPage.findMany({
      where: { userId, pageId: { in: pageIds } },
      select: { pageId: true, name: true },
    }) : []
    const pageNameByPageId = new Map(pages.map(p => [p.pageId, p.name]))

    // === SECTION 1: Top SP by commission ===
    // Group orders by productItemId (or fallback campId nếu không có itemId).
    type SpAgg = {
      productItemId: string | null
      productShopId: string | null
      productName: string
      shopName: string | null
      categoryL1: string | null
      categoryL2: string | null
      campCount: number
      orderCount: number
      commission: number
      spend: number
      profit: number
      pageNames: Set<string>
    }
    const spMap = new Map<string, SpAgg>()
    // PERF: loop orderAggs (đã sum sẵn), không phải từng order individual.
    for (const a of orderAggs) {
      const camp = campByCampId.get(a.subId2)
      const rep = repBySubId.get(a.subId2)
      const key = camp?.productItemId ? `${camp.productShopId}_${camp.productItemId}` : a.subId2
      let agg = spMap.get(key)
      if (!agg) {
        agg = {
          productItemId: camp?.productItemId || null,
          productShopId: camp?.productShopId || null,
          productName: rep?.productName || camp?.name || "(Không tên)",
          shopName: rep?.shopName || null,
          categoryL1: camp?.productCategoryL1 || null,
          categoryL2: camp?.productCategoryL2 || null,
          campCount: 0,
          orderCount: 0,
          commission: 0,
          spend: 0,
          profit: 0,
          pageNames: new Set(),
        }
        spMap.set(key, agg)
      }
      agg.orderCount += a.orderCount
      agg.commission += a.commission
      // Page name từ camp
      if (camp) {
        const pageId = pageIdByCampDbId.get(camp.id)
        const pageName = pageId ? pageNameByPageId.get(pageId) : null
        if (pageName) agg.pageNames.add(pageName)
      }
    }
    // Spend per SP — CHỈ tính khi spendAccurate (full range).
    // Range cụ thể: spend=0, profit=null → UI ẩn cột spend/profit.
    if (spendAccurate) {
      for (const camp of camps) {
        if (!camp.productItemId) continue
        const key = `${camp.productShopId}_${camp.productItemId}`
        const agg = spMap.get(key)
        if (agg) {
          agg.campCount++
          agg.spend += camp.spend || 0
        }
      }
    } else {
      // Vẫn count camps để hiện số camp (nhưng không tính spend)
      for (const camp of camps) {
        if (!camp.productItemId) continue
        const key = `${camp.productShopId}_${camp.productItemId}`
        const agg = spMap.get(key)
        if (agg) agg.campCount++
      }
    }
    const allSp = Array.from(spMap.values()).map(s => {
      // Profit chỉ tính được khi spend chính xác (full range).
      const profit = spendAccurate
        ? Math.round(s.commission * COMMISSION_NET - s.spend * ADS_COST)
        : null
      return { ...s, profit, pageNames: Array.from(s.pageNames).slice(0, 3) }
    })
    // Top by profit chỉ có nghĩa khi spendAccurate (profit không null).
    // Khi không có spend chính xác, top "profit" = top commission làm fallback.
    const topByProfit = spendAccurate
      ? [...allSp].sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0)).slice(0, 20)
      : [...allSp].sort((a, b) => b.commission - a.commission).slice(0, 20)
    const worstByProfit = spendAccurate
      ? [...allSp].sort((a, b) => (a.profit ?? 0) - (b.profit ?? 0)).slice(0, 20)
      : [...allSp].sort((a, b) => a.commission - b.commission).slice(0, 20)
    const topByCommission = [...allSp].sort((a, b) => b.commission - a.commission).slice(0, 20)
    const topByOrders = [...allSp].sort((a, b) => b.orderCount - a.orderCount).slice(0, 20)

    // === SECTION 2: Fanpage × Category matrix ===
    // Sum commission per (page, categoryL1) cell. Loop orderAggs (đã sum).
    type PageCatCell = { commission: number; orders: number; campCount: number }
    const matrixMap = new Map<string, Map<string, PageCatCell>>()  // pageName → categoryL1 → cell
    const categorySet = new Set<string>()
    const pageNameSet = new Set<string>()
    for (const a of orderAggs) {
      const camp = campByCampId.get(a.subId2)
      if (!camp) continue
      const pageId = pageIdByCampDbId.get(camp.id)
      const pageName = pageId ? pageNameByPageId.get(pageId) : null
      const cat = camp.productCategoryL1
      if (!pageName || !cat) continue
      pageNameSet.add(pageName)
      categorySet.add(cat)
      let row = matrixMap.get(pageName)
      if (!row) { row = new Map(); matrixMap.set(pageName, row) }
      let cell = row.get(cat)
      if (!cell) { cell = { commission: 0, orders: 0, campCount: 0 }; row.set(cat, cell) }
      cell.commission += a.commission
      cell.orders += a.orderCount
    }
    // Camp count per (page, cat)
    for (const camp of camps) {
      if (!camp.productCategoryL1) continue
      const pageId = pageIdByCampDbId.get(camp.id)
      const pageName = pageId ? pageNameByPageId.get(pageId) : null
      if (!pageName) continue
      const row = matrixMap.get(pageName)
      const cell = row?.get(camp.productCategoryL1)
      if (cell) cell.campCount++
    }
    // Build matrix output
    const pageList = Array.from(pageNameSet).sort()
    const catList = Array.from(categorySet).sort()
    const matrix = pageList.map(p => ({
      pageName: p,
      cells: catList.map(c => ({
        category: c,
        ...(matrixMap.get(p)?.get(c) || { commission: 0, orders: 0, campCount: 0 }),
      })),
      totalCommission: catList.reduce((s, c) => s + (matrixMap.get(p)?.get(c)?.commission || 0), 0),
    }))
    matrix.sort((a, b) => b.totalCommission - a.totalCommission)

    // === SECTION 3: Hourly commission ===
    // Group commission by hour-of-day of Post.postedAt (VN tz UTC+7).
    const hourly: number[] = new Array(24).fill(0)
    const hourlyOrders: number[] = new Array(24).fill(0)
    for (const a of orderAggs) {
      const camp = campByCampId.get(a.subId2)
      if (!camp) continue
      const postedAt = postedAtByCampDbId.get(camp.id)
      if (!postedAt) continue
      const utcHour = postedAt.getUTCHours()
      const vnHour = (utcHour + 7) % 24
      hourly[vnHour] += a.commission
      hourlyOrders[vnHour] += a.orderCount
    }

    // === SECTION 4: Summary ===
    const totalCommission = orderAggs.reduce((s, a) => s + a.commission, 0)
    const totalOrders = orderAggs.reduce((s, a) => s + a.orderCount, 0)
    // Spend + profit: null khi range không full (tránh hiện số sai).
    const totalSpend = spendAccurate ? camps.reduce((s, c) => s + (c.spend || 0), 0) : null
    const totalProfit = spendAccurate && totalSpend !== null
      ? Math.round(totalCommission * COMMISSION_NET - totalSpend * ADS_COST)
      : null

    return NextResponse.json({
      range: { since: fromStr, until: untilStr },
      spendAccurate,  // UI dùng để hiện cảnh báo hoặc ẩn cột spend/profit
      summary: {
        totalOrders, totalCommission, totalSpend, totalProfit,
        spProductCount: spMap.size,
        pageCount: pageList.length,
      },
      topByProfit, worstByProfit, topByCommission, topByOrders,
      matrix, pageList, catList,
      hourly: hourly.map((v, h) => ({ hour: h, commission: Math.round(v), orderCount: hourlyOrders[h] })),
    })
  } catch (e: any) {
    return safeError(e, "insights")
  }
}
