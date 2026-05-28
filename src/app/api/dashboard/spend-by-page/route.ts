import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { getFbToken } from "@/lib/token-store"
import { fbGet } from "@/lib/fb-fetch"
import { COMMISSION_NET_FACTOR, ADS_COST_FACTOR } from "@/lib/constants-server"

// In-memory cache 5 phút theo (userId, from, to) — tránh fetch FB Insights mỗi F5.
// PERF (R2.C2): hard cap 200 entries + FIFO evict tránh memory leak.
type CachedResp = { data: any; cachedAt: number }
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 200
const cache = new Map<string, CachedResp>()
function setCache(key: string, val: CachedResp) {
  // FIFO evict khi vượt cap (Map duy trì insertion order).
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
  cache.delete(key) // ensure re-insert at end (move to MRU)
  cache.set(key, val)
}

// GET /api/dashboard/spend-by-page?from=YYYY-MM-DD&to=YYYY-MM-DD
// Fetch FB Insights real-time per TKQC → spend per campaign trong date range.
// Match Campaign.campId → pageId qua Post relation → group by page.
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from") || ""
    const to = searchParams.get("to") || ""
    const noCache = searchParams.get("nocache") === "1"
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: "Thiếu from/to (YYYY-MM-DD)" }, { status: 400 })
    }

    // Check cache
    const cacheKey = `${user.userId}|${from}|${to}`
    if (!noCache) {
      const cached = cache.get(cacheKey)
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return NextResponse.json({ ...cached.data, cached: true, cachedAt: cached.cachedAt })
      }
    }

    const tokenRec = await getFbToken(user.userId)
    if (!tokenRec) return NextResponse.json({ error: "Chưa có FB token" }, { status: 400 })
    const token = tokenRec.longToken

    // Lấy TẤT CẢ AdAccount của user (kể cả OFF) để không miss spend
    const accounts = await prisma.adAccount.findMany({
      where: { userId: user.userId },
      select: { id: true, actId: true, name: true },
    })

    // Fetch spend per camp từ FB Insights (parallel)
    const spendByCampFbId = new Map<string, number>()
    const fbErrors: string[] = []
    await Promise.all(accounts.map(async (acc) => {
      const actPath = acc.actId.startsWith("act_") ? acc.actId : `act_${acc.actId}`
      const trEncoded = encodeURIComponent(JSON.stringify({ since: from, until: to }))
      let nextUrl: string | null = `https://graph.facebook.com/v19.0/${actPath}/insights?fields=campaign_id,spend&level=campaign&time_range=${trEncoded}&limit=1000`
      let pages = 0
      try {
        while (nextUrl && pages < 10) {
          const r: any = await fbGet(nextUrl, token)
          const d: any = await r.json()
          if (d.error) { fbErrors.push(`${acc.name}: ${d.error.message}`); break }
          for (const ins of (d.data || [])) {
            if (!ins.campaign_id) continue
            const spend = Math.round(parseFloat(ins.spend || "0"))
            spendByCampFbId.set(ins.campaign_id, (spendByCampFbId.get(ins.campaign_id) || 0) + spend)
          }
          nextUrl = d.paging?.next || null
          pages++
        }
      } catch (e: any) { fbErrors.push(`${acc.name}: ${e?.message}`) }
    }))

    // PERFORMANCE FIX: Tránh N+1 — thay vì Campaign include posts (N camps × 1 post query),
    // query Campaign + Post riêng, distinct campaignId trong code.
    const camps = await prisma.campaign.findMany({
      where: { userId: user.userId, campId: { not: "" } },
      select: { id: true, name: true, campId: true },
    })
    const campIds = camps.map((c) => c.id)
    // 1 query duy nhất lấy 1 post per campaign (distinct campaignId)
    const posts = campIds.length === 0 ? [] : await prisma.post.findMany({
      where: { campaignId: { in: campIds }, userId: user.userId, pageId: { not: null } },
      distinct: ["campaignId"],
      select: {
        campaignId: true, pageId: true,
        page: { select: { id: true, name: true, pageId: true } },
      },
    })
    // Build map campaignId → page info
    const pageByCampaignId = new Map<string, { pageId: string; pageName: string; pageFbId: string | null }>()
    for (const p of posts) {
      if (!p.campaignId || !p.pageId) continue
      pageByCampaignId.set(p.campaignId, {
        pageId: p.pageId,
        pageName: p.page?.name || "(?)",
        pageFbId: p.page?.pageId || null,
      })
    }

    // Commission từ OrderCommission
    const sinceDate = new Date(from + "T00:00:00Z")
    const untilExclusive = new Date(to + "T00:00:00Z")
    untilExclusive.setUTCDate(untilExclusive.getUTCDate() + 1)
    const campNames = Array.from(new Set(camps.map((c) => c.name).filter(Boolean)))
    const commGrouped = campNames.length > 0 ? await prisma.orderCommission.groupBy({
      by: ["subId2"],
      where: {
        userId: user.userId,
        subId2: { in: campNames },
        clickDate: { gte: sinceDate, lt: untilExclusive },
        status: { not: "cancelled" },
      },
      _sum: { commission: true },
    }) : []
    const commByCampName = new Map<string, number>()
    for (const g of commGrouped) {
      if (g.subId2) commByCampName.set(g.subId2, Number(g._sum.commission || 0))
    }

    // Group by pageId
    const byPage = new Map<string, {
      pageId: string; pageName: string; pageFbId: string | null
      campIds: Set<string>; spend: number; commission: number
    }>()

    for (const c of camps) {
      const pageInfo = pageByCampaignId.get(c.id)
      if (!pageInfo) continue
      const entry = byPage.get(pageInfo.pageId) || {
        pageId: pageInfo.pageId,
        pageName: pageInfo.pageName,
        pageFbId: pageInfo.pageFbId,
        campIds: new Set<string>(),
        spend: 0,
        commission: 0,
      }
      entry.campIds.add(c.id)
      entry.spend += spendByCampFbId.get(c.campId) || 0
      entry.commission += commByCampName.get(c.name) || 0
      byPage.set(pageInfo.pageId, entry)
    }

    const items = Array.from(byPage.values())
      .map((e) => ({
        pageId: e.pageId,
        pageName: e.pageName,
        pageFbId: e.pageFbId,
        campCount: e.campIds.size,
        spend: e.spend,
        commission: e.commission,
        profit: Math.round(e.commission * COMMISSION_NET_FACTOR - e.spend * ADS_COST_FACTOR),
      }))
      .filter((e) => e.spend > 0 || e.commission > 0)
    items.sort((a, b) => b.spend - a.spend)

    const totalFbSpend = Array.from(spendByCampFbId.values()).reduce((s, v) => s + v, 0)
    const matchedSpend = items.reduce((s, e) => s + e.spend, 0)
    const orphanSpend = totalFbSpend - matchedSpend

    const dbCampFbIds = new Set(camps.map((c) => c.campId).filter(Boolean))
    const orphanList = Array.from(spendByCampFbId.entries())
      .filter(([id]) => !dbCampFbIds.has(id))
      .map(([id, spend]) => ({ fbCampId: id, spend }))
      .sort((a, b) => b.spend - a.spend)
    const orphanCampCount = orphanList.length

    if (orphanSpend > 100) {
      items.push({
        pageId: "__orphan__",
        pageName: `Khác (${orphanCampCount} camp ngoài tool / page không match)`,
        pageFbId: null,
        campCount: orphanCampCount,
        spend: orphanSpend,
        commission: 0,
        profit: Math.round(0 - orphanSpend * ADS_COST_FACTOR),
      })
    }

    const totals = items.reduce((t, e) => ({
      campCount: t.campCount + e.campCount,
      spend: t.spend + e.spend,
      commission: t.commission + e.commission,
      profit: t.profit + e.profit,
    }), { campCount: 0, spend: 0, commission: 0, profit: 0 })

    const data = {
      items, totals, count: items.length, fbErrors,
      totalFbSpend, matchedSpend, orphanSpend, orphanCampCount,
      orphanList: orphanList.slice(0, 50),
    }

    // Save cache (kèm cleanup map nếu quá lớn)
    if (cache.size > 100) {
      const oldKeys = Array.from(cache.entries())
        .filter(([_, v]) => Date.now() - v.cachedAt > CACHE_TTL_MS)
        .map(([k]) => k)
      for (const k of oldKeys) cache.delete(k)
    }
    setCache(cacheKey, { data, cachedAt: Date.now() })

    return NextResponse.json({ ...data, cached: false, cachedAt: Date.now() })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
    console.error("[spend-by-page]", e)
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Error") }, { status: 500 })
  }
}
