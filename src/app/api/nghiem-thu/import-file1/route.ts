// POST /api/nghiem-thu/import-file1
// Input:  { rows: [{ tkqcId, campName, oldAdName, newAdName }] }
// Output: { ok, summary, rows: [{ ...input, id, adId, error }] }
//
// Buoc 1 cua workflow:
//   1. Group rows theo tkqcId
//   2. Per TKQC: fetch /act_X/ads?fields=id,name,campaign{name} → match (camp, old_ad) → ad_id
//   3. Upsert NghiemThuItem (unique theo userId+accountId+oldAdName)
//
// Sau buoc 1, user dung /api/nghiem-thu/rename de doi ten ads, va /import-file2 de bo sung
// link post + shopee link.

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getFbToken } from "@/lib/token-store"
import { fbGet } from "@/lib/fb-fetch"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 120

const GRAPH = "https://graph.facebook.com/v21.0"

type InputRow = { tkqcId: string; campName: string; oldAdName: string; newAdName: string }

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
    const body = await req.json().catch(() => null)
    const rows: InputRow[] = body?.rows
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "rows phải là array không rỗng" }, { status: 400 })
    }
    if (rows.length > 3000) {
      return NextResponse.json({ error: "Tối đa 3000 dòng/lần" }, { status: 400 })
    }

    const fbToken = await getFbToken(user.userId)
    if (!fbToken) return NextResponse.json({ error: "FB token chưa cấu hình" }, { status: 400 })
    const token = fbToken.longToken

    const cleanRows = rows.map(r => ({
      tkqcId: String(r?.tkqcId || "").trim(),
      campName: String(r?.campName || "").trim(),
      oldAdName: String(r?.oldAdName || "").trim(),
      newAdName: String(r?.newAdName || "").trim(),
    })).filter(r => r.tkqcId && r.campName && r.oldAdName && r.newAdName)

    // Group by tkqcId (bare) de dedupe FB API calls
    const byTkqc = new Map<string, InputRow[]>()
    for (const r of cleanRows) {
      const bare = stripActPrefix(r.tkqcId)
      const arr = byTkqc.get(bare) || []
      arr.push(r)
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

    // PERF FIX (P2.2): per-TKQC fetch parallel cap 3 (FB rate limit account-level).
    const tkqcResults = new Map<string, { map: Map<string, string>; error: string | null }>()
    const tkqcList = Array.from(byTkqc.keys())
    const FETCH_CONCURRENCY = 3
    const fetchOneTkqc = async (bareId: string) => {
      if (!ownedBareIds.has(bareId)) {
        tkqcResults.set(bareId, { map: new Map(), error: "TKQC không thuộc tài khoản này (chưa sync hoặc sai ID)" })
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
      tkqcResults.set(bareId, { map: adsMap, error: pageErr })
    }
    for (let i = 0; i < tkqcList.length; i += FETCH_CONCURRENCY) {
      const slice = tkqcList.slice(i, i + FETCH_CONCURRENCY)
      await Promise.all(slice.map(fetchOneTkqc))
    }

    // Upsert + build output
    const out: any[] = []
    for (const r of cleanRows) {
      const bare = stripActPrefix(r.tkqcId)
      const tkqcInfo = tkqcResults.get(bare)
      let adId: string | null = null
      let error: string | null = null
      if (!tkqcInfo) {
        error = "TKQC không hợp lệ"
      } else if (tkqcInfo.error && tkqcInfo.map.size === 0) {
        error = tkqcInfo.error
      } else {
        const key = `${r.campName.toLowerCase()}||${r.oldAdName.toLowerCase()}`
        adId = tkqcInfo.map.get(key) || null
        if (!adId) error = "Không tìm thấy (camp + ad) trong TKQC"
      }
      // Parse affiliateId tu newAdName (chu so dau truoc dau _, vd "17305500347_SHPAAR26_..." → "17305500347")
      const affMatch = r.newAdName.match(/^(\d+)/)
      const affiliateId = affMatch ? affMatch[1] : null

      // Upsert vao DB (theo unique userId+accountId+oldAdName).
      // Luu lookupError de UI hien tooltip + retry-able sau nay.
      try {
        const item = await prisma.nghiemThuItem.upsert({
          where: {
            userId_accountId_oldAdName: {
              userId: user.userId,
              accountId: bare,
              oldAdName: r.oldAdName,
            },
          },
          update: {
            campaignName: r.campName,
            newAdName: r.newAdName,
            adId: adId,
            affiliateId,
            lookupError: adId ? null : (error || "Không tìm thấy"),
          },
          create: {
            userId: user.userId,
            accountId: bare,
            campaignName: r.campName,
            oldAdName: r.oldAdName,
            newAdName: r.newAdName,
            adId: adId,
            affiliateId,
            lookupError: adId ? null : (error || "Không tìm thấy"),
          },
          select: { id: true },
        })
        out.push({ ...r, id: item.id, adId, error })
      } catch (e: any) {
        out.push({ ...r, id: null, adId, error: `DB upsert fail: ${e?.message?.slice(0, 150) || "unknown"}` })
      }
    }

    return NextResponse.json({
      ok: true,
      rows: out,
      summary: {
        totalRows: cleanRows.length,
        matched: out.filter(r => r.adId).length,
        tkqcCount: byTkqc.size,
      },
    })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Lỗi") }, { status: 500 })
  }
}
