// POST /api/nghiem-thu/lookup-retry
// Re-run lookup cho NghiemThuItems trong DB (adId = null), tự động group
// theo TKQC + fetch FB API → match.
//
// Use case: sau import-file1, một số dòng không match do FB camp/ad chưa tồn tại,
// hoặc tên sai. User sửa lại trên FB → bấm "Tra cứu lại" để app re-match.
//
// Body: { ids?: string[] }  — nếu cung cấp, chỉ retry các ids đó.
// Mặc định: retry TẤT CẢ items có adId=null của user.

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getFbToken } from "@/lib/token-store"
import { fbGet } from "@/lib/fb-fetch"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 120

const GRAPH = "https://graph.facebook.com/v21.0"

function stripActPrefix(s: string): string {
  return s.startsWith("act_") ? s.slice(4) : s
}
function normalizeActId(s: string): string {
  const v = String(s || "").trim()
  if (!v) return ""
  return v.startsWith("act_") ? v : `act_${v}`
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const requestedIds: string[] | undefined = Array.isArray(body?.ids) ? body.ids : undefined

    const fbToken = await getFbToken(user.userId)
    if (!fbToken) return NextResponse.json({ error: "FB token chưa cấu hình" }, { status: 400 })
    const token = fbToken.longToken

    // Fetch items cần retry: adId=null + (subset ids hoặc all of user)
    const items = await prisma.nghiemThuItem.findMany({
      where: {
        userId: user.userId,
        adId: null,
        ...(requestedIds ? { id: { in: requestedIds } } : {}),
      },
      select: {
        id: true, accountId: true, campaignName: true, oldAdName: true,
      },
    })
    if (items.length === 0) {
      return NextResponse.json({ ok: true, matched: 0, total: 0, message: "Không có dòng nào cần tra cứu lại (tất cả đã có ad_id)" })
    }

    // Group by accountId (bare) để dedupe FB calls
    const byTkqc = new Map<string, typeof items>()
    for (const it of items) {
      const bare = stripActPrefix(it.accountId)
      const arr = byTkqc.get(bare) || []
      arr.push(it)
      byTkqc.set(bare, arr)
    }

    // Ownership check
    const variants: string[] = []
    for (const b of Array.from(byTkqc.keys())) { variants.push(b, `act_${b}`) }
    const ownedAccs = await prisma.adAccount.findMany({
      where: { userId: user.userId, actId: { in: variants } },
      select: { actId: true },
    })
    const ownedBareIds = new Set(ownedAccs.map(a => stripActPrefix(a.actId)))

    // PERF FIX (P2.2): per-TKQC fetch PARALLEL với concurrency cap 3 (FB rate
    // limit ở account-level, không cộng dồn user-level). Trước: tuần tự 14 TKQC
    // × ~20s = ~280s timeout. Giờ: ~80s.
    const tkqcMaps = new Map<string, { map: Map<string, string>; error: string | null }>()
    const tkqcList = Array.from(byTkqc.keys())
    const FETCH_CONCURRENCY = 3
    const fetchOneTkqc = async (bareId: string) => {
      if (!ownedBareIds.has(bareId)) {
        tkqcMaps.set(bareId, { map: new Map(), error: `TKQC ${bareId} chưa sync vào app (vào Keo Ads → sync TKQC)` })
        return
      }
      const actId = normalizeActId(bareId)
      const adsMap = new Map<string, string>()
      let url: string | null = `${GRAPH}/${actId}/ads?fields=id,name,campaign{name}&limit=100`
      let pages = 0
      let pageErr: string | null = null
      while (url && pages < 50) {
        const r: Response = await fbGet(url, token)
        const d: any = await r.json()
        if (!r.ok || d?.error) {
          pageErr = `FB API: ${d?.error?.message || r.status}`
          break
        }
        for (const ad of (d?.data || [])) {
          const adName = String(ad.name || "").trim()
          const campName = String(ad.campaign?.name || "").trim()
          if (!adName || !campName) continue
          adsMap.set(`${campName.toLowerCase()}||${adName.toLowerCase()}`, ad.id)
        }
        url = d?.paging?.next || null
        pages++
      }
      tkqcMaps.set(bareId, { map: adsMap, error: pageErr })
    }
    // Chunk pattern thay cho pLimit dep
    for (let i = 0; i < tkqcList.length; i += FETCH_CONCURRENCY) {
      const slice = tkqcList.slice(i, i + FETCH_CONCURRENCY)
      await Promise.all(slice.map(fetchOneTkqc))
    }

    // Update DB
    // PERF FIX (P2.2): tính kết quả trước, gom updates → batch parallel.
    // Trước: N×UPDATE tuần tự (~30ms × 1000 items = 30s). Giờ: chunk parallel.
    let matched = 0
    const errors: Record<string, number> = {}  // counter: errorMsg → count
    const updates: Array<{ id: string; adId: string | null; lookupError: string | null }> = []
    for (const it of items) {
      const bare = stripActPrefix(it.accountId)
      const tkqcInfo = tkqcMaps.get(bare)
      let adId: string | null = null
      let error: string | null = null
      if (!tkqcInfo) {
        error = "TKQC không hợp lệ"
      } else if (tkqcInfo.error && tkqcInfo.map.size === 0) {
        error = tkqcInfo.error
      } else {
        const key = `${it.campaignName.toLowerCase()}||${it.oldAdName.toLowerCase()}`
        adId = tkqcInfo.map.get(key) || null
        if (!adId) {
          const sameCamp = Array.from(tkqcInfo.map.keys()).filter(k => k.startsWith(it.campaignName.toLowerCase() + "||"))
          if (sameCamp.length === 0) {
            error = `Camp "${it.campaignName}" không có ads nào trên FB (có thể đã xoá hoặc tên không khớp)`
          } else {
            error = `Có ${sameCamp.length} ads trong camp "${it.campaignName}" nhưng tên ad cũ không khớp`
          }
        }
      }
      if (adId) matched++
      else if (error) errors[error] = (errors[error] || 0) + 1
      updates.push({ id: it.id, adId, lookupError: adId ? null : (error || "Không tìm thấy") })
    }
    // Batch UPDATE: 15 row/parallel (theo connection_limit=15).
    const DB_CONC = 15
    for (let i = 0; i < updates.length; i += DB_CONC) {
      const slice = updates.slice(i, i + DB_CONC)
      await Promise.all(slice.map(u =>
        prisma.nghiemThuItem.update({
          where: { id: u.id },
          data: { adId: u.adId, lookupError: u.lookupError },
        }).catch(() => {})
      ))
    }
    // Top 3 error reasons
    const topErrors = Object.entries(errors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([msg, count]) => ({ msg, count }))

    return NextResponse.json({
      ok: true,
      total: items.length,
      matched,
      failed: items.length - matched,
      topErrors,
    })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[nghiem-thu/lookup-retry]", e)
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Lỗi") }, { status: 500 })
  }
}
