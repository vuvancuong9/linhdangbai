import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { getFbToken } from "@/lib/token-store"
import { COMMISSION_NET_FACTOR, ADS_COST_FACTOR } from "@/lib/constants-server"
import { fixFanpageForUser } from "@/lib/fix-fanpage"

export const runtime = "nodejs"
export const maxDuration = 60

// GET /api/campaigns/profit-loss?days=6
// Tra ve top 100 camp lai nhat + 100 camp lo nhat trong N ngay gan day (default 6).
//
// Cho moi camp tra ve:
//  - daily[]: { date, commission, spend, pl } cho D0..D(N-1)
//  - totalPL: sum cua daily.pl
//
// Data:
//  - Spend: FB Insights API time_increment=1 (per-day breakdown) cho moi AdAccount
//  - Commission: OrderCommission groupBy subId2 + clickDate, status != cancelled
//  - PL = commission * 0.99 - spend * 1.11 (constants)
//
// Cache: 60s in-memory de tranh user F5 lien tuc goi FB API.

const cache = new Map<string, { at: number; data: any }>()
const CACHE_MS = 60_000

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const days = Math.max(1, Math.min(14, Number(searchParams.get("days") || 6)))
  // maxSpend: filter totalSpend < N (cho trang Camp khong can tien)
  // Neu KHONG truyen -> default behavior: filter totalSpend > 100k (lai-lo-camp)
  const maxSpendParam = searchParams.get("maxSpend")
  const maxSpend = maxSpendParam != null ? Math.max(0, Number(maxSpendParam) || 0) : null

  const cacheKey = `${user.userId}:${days}:${maxSpend ?? "default"}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json(hit.data)
  }

  // Chạy fix-fanpage ngầm trước khi query → đảm bảo Post.pageId đầy đủ,
  // cột Fanpage trong UI không bị "—". Query đã optimize WHERE filter → 99%
  // PERF FIX (P2.6): fire-and-forget — không await. Trước: await block load
  // thêm 0.5-3s mỗi cache miss. Cron sync-posts đã chạy fixFanpage 10p/lần
  // rồi, lần load này skip không sao.
  // Nếu fix > 0 → invalidate cache để lần SAU thấy data mới.
  fixFanpageForUser(user.userId).then(fixR => {
    if (fixR.fixed > 0) {
      console.log(`[profit-loss] auto-fixed ${fixR.fixed} posts pageId`)
      for (const k of Array.from(cache.keys())) {
        if (k.startsWith(user.userId + ":")) cache.delete(k)
      }
    }
  }).catch(e => {
    console.warn(`[profit-loss] fix-fanpage fail (background) - ${e?.message?.slice(0, 100)}`)
  })

  // Tinh range D0..D(N-1). D0 = hom QUA (today-1), D1 = today-2, D2 = today-3...
  // Ly do: data hom nay con dang chay (cookie 7 ngay con dai), khong fair de judge.
  // FB Insights time_range can YYYY-MM-DD format (timezone account).
  const baseDate = new Date()
  baseDate.setHours(0, 0, 0, 0)
  baseDate.setDate(baseDate.getDate() - 1) // D0 = hom qua
  const dates: string[] = [] // dates[0] = D0 (hom qua), dates[1] = D1 (today-2)...
  for (let i = 0; i < days; i++) {
    const d = new Date(baseDate)
    d.setDate(d.getDate() - i)
    dates.push(dateKey(d))
  }
  const since = dates[dates.length - 1] // oldest
  const until = dates[0]                 // today

  const tokenRec = await getFbToken(user.userId)
  if (!tokenRec) return NextResponse.json({ error: "Chua co FB token" }, { status: 400 })
  const token = tokenRec.longToken

  const accounts = await prisma.adAccount.findMany({
    where: { userId: user.userId, status: "ON" },
    select: { id: true, actId: true, name: true },
  })

  // Fetch spend per-day per-camp tu FB Insights, parallel cho cac account.
  // Tra ve Map<fbCampId, Map<date, spend>>.
  const spendByCamp = new Map<string, Map<string, number>>()
  const fbErrors: string[] = []

  await Promise.all(accounts.map(async (acc) => {
    const actPath = acc.actId.startsWith("act_") ? acc.actId : `act_${acc.actId}`
    const fields = "campaign_id,spend,date_start"
    const trEncoded = encodeURIComponent(JSON.stringify({ since, until }))
    let nextUrl: string | null = `https://graph.facebook.com/v19.0/${actPath}/insights?fields=${fields}&level=campaign&time_increment=1&time_range=${trEncoded}&limit=1000&access_token=${token}`
    let pages = 0
    try {
      while (nextUrl && pages < 10) {
        const r: any = await fetch(nextUrl)
        const d: any = await r.json()
        if (d.error) {
          fbErrors.push(`${acc.name}: ${d.error.message}`)
          break
        }
        for (const ins of (d.data || [])) {
          if (!ins.campaign_id || !ins.date_start) continue
          let m = spendByCamp.get(ins.campaign_id)
          if (!m) { m = new Map(); spendByCamp.set(ins.campaign_id, m) }
          m.set(ins.date_start, Math.round(parseFloat(ins.spend || "0")))
        }
        nextUrl = d.paging?.next || null
        pages++
      }
    } catch (e: any) {
      fbErrors.push(`${acc.name}: ${e?.message}`)
    }
  }))

  // Lay tat ca camps cua user (DB), match voi spendByCamp qua campId.
  // FILTER adAccountId NOT NULL: camp legacy (truoc khi feature track adAccountId
  // duoc them) hoac camp da bi delete tren FB nhung orphan cleanup ko xoa duoc
  // (vi adAccountId=null khong match where) — luon hien spend=0 → noise UI.
  // Match pattern cua /quan-ly-campaign (FE filter legacy line 1140).
  const camps = await prisma.campaign.findMany({
    where: { userId: user.userId, adAccountId: { not: null } },
    select: {
      id: true, name: true, campId: true, status: true, budget: true, adAccountId: true, createdAt: true, fbCreatedTime: true,
    },
  })

  // Commission per-day per-camp tu OrderCommission (subId2 = Campaign.name).
  // status != cancelled, clickDate in range.
  const sinceDate = new Date(since + "T00:00:00Z")
  const untilExclusive = new Date(until + "T00:00:00Z")
  untilExclusive.setUTCDate(untilExclusive.getUTCDate() + 1)

  const subIds = Array.from(new Set(camps.map(c => c.name).filter(Boolean)))
  const commGrouped = subIds.length > 0 ? await prisma.orderCommission.groupBy({
    by: ["subId2", "clickDate"],
    where: {
      userId: user.userId,
      subId2: { in: subIds },
      clickDate: { gte: sinceDate, lt: untilExclusive },
      status: { not: "cancelled" },
    },
    _sum: { commission: true },
  }) : []

  // Map<subId2, Map<date, commission>>
  const commByCamp = new Map<string, Map<string, number>>()
  for (const g of commGrouped) {
    if (!g.subId2 || !g.clickDate) continue
    const dk = dateKey(g.clickDate as Date)
    let m = commByCamp.get(g.subId2)
    if (!m) { m = new Map(); commByCamp.set(g.subId2, m) }
    m.set(dk, g._sum.commission ?? 0)
  }

  // Build result per camp.
  type Row = {
    id: string
    name: string
    campId: string
    status: string
    budget: number
    adAccountId: string | null
    pageName: string
    daily: Array<{ date: string; dayOffset: number; commission: number; spend: number; pl: number }>
    totalPL: number
    hasAnyData: boolean
    createdAt: Date
  }
  const rows: Row[] = []
  for (const c of camps) {
    const spendMap = c.campId ? spendByCamp.get(c.campId) : null
    const commMap = commByCamp.get(c.name) || null
    const daily = dates.map((d, idx) => {
      const spend = spendMap?.get(d) ?? 0
      const commission = commMap?.get(d) ?? 0
      const pl = Math.round(commission * COMMISSION_NET_FACTOR - spend * ADS_COST_FACTOR)
      return { date: d, dayOffset: idx, commission: Math.round(commission), spend, pl }
    })
    const totalPL = daily.reduce((s, x) => s + x.pl, 0)
    const hasAnyData = daily.some(d => d.spend > 0 || d.commission > 0)
    rows.push({
      id: c.id, name: c.name, campId: c.campId, status: c.status,
      budget: c.budget, adAccountId: c.adAccountId, pageName: "",
      daily, totalPL, hasAnyData, createdAt: c.fbCreatedTime || c.createdAt,
    })
  }

  // Cutoff: camp phai tao truoc ngay nay moi xet rule maxSpend
  // (loai camp moi tao trong N ngay - chua kip phan phoi het).
  const cutoffDate = new Date(dates[dates.length - 1] + "T00:00:00Z")

  // Filter:
  // - Co maxSpend param -> camp totalSpend < maxSpend AND camp createdAt < D(N-1)
  //   (Camp khong can tien - loai camp moi tao trong N ngay)
  // - Default -> camp totalSpend > 100k (lai-lo-camp)
  const MIN_TOTAL_SPEND = 100_000
  const filtered = rows.filter(r => {
    const totalSpend = r.daily.reduce((s, d) => s + (d.spend || 0), 0)
    if (maxSpend != null) {
      // Loai camp moi tao (chua du N ngay du lieu)
      if (r.createdAt >= cutoffDate) return false
      return totalSpend < maxSpend
    }
    return totalSpend > MIN_TOTAL_SPEND
  })

  // Sort theo totalPL desc (lai nhat o dau, lo nhat o cuoi).
  const combined = filtered.sort((a, b) => b.totalPL - a.totalPL)

  // Lay fanpage cho moi camp trong combined.
  // KHONG filter deleted: false hoac pageId: not null -> catch ca Post da xoa
  // (soft delete) hoac pageId null nhung fbId trace duoc. Sort theo createdAt asc.
  if (combined.length > 0) {
    const campIds = combined.map(r => r.id)
    const posts = await prisma.post.findMany({
      where: {
        userId: user.userId,
        campaignId: { in: campIds },
      },
      select: { campaignId: true, fbId: true, pageId: true, page: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    })

    // Build map pageId (FB) -> page.name (DB FanPage) cho fallback trace tu fbId.
    const allPages = await prisma.fanPage.findMany({
      where: { userId: user.userId },
      select: { pageId: true, name: true },
    })
    const fbPageIdToName = new Map<string, string>()
    for (const fp of allPages) fbPageIdToName.set(fp.pageId, fp.name)

    const pageNameByCampId = new Map<string, string>()
    for (const p of posts) {
      if (!p.campaignId || pageNameByCampId.has(p.campaignId)) continue
      // 1. Uu tien: Post.page co name
      if (p.page?.name) {
        pageNameByCampId.set(p.campaignId, p.page.name)
        continue
      }
      // 2. Fallback: extract fbPageId tu Post.fbId = "{fbPageId}_{fbPostId}"
      if (p.fbId) {
        const parts = p.fbId.split("_")
        if (parts.length >= 2) {
          const fbPageId = parts[0]
          const name = fbPageIdToName.get(fbPageId)
          if (name) {
            pageNameByCampId.set(p.campaignId, name)
            continue
          }
        }
      }
    }
    for (const r of combined) r.pageName = pageNameByCampId.get(r.id) || ""
  }

  const result = {
    days,
    dates, // dates[0] = D0
    totalCamps: camps.length,
    activeCamps: combined.length,
    rows: combined,
    fbErrors,
  }
  cache.set(cacheKey, { at: Date.now(), data: result })
  return NextResponse.json(result)
}
