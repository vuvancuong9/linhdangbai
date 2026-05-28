// GET /api/trinh-quan-ly/ads?accountId=X&adsetIds=aid1,aid2,...&since=&until=
// Trả về list ads của nhiều ad set (1+) trong cùng 1 TKQC + insights + thumbnail + page name.
// Strategy: FB API filtering ở account-level — 1 call cho mọi adset đã tick.

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { prisma } from "@/lib/prisma"
import { getFbToken } from "@/lib/token-store"
import { buildDateParam, computeResults, deliveryLabel, fbFetchAll } from "@/lib/trinh-quan-ly"

const FILTER_THRESHOLD = 50

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const ownerId = user.userId
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get("accountId")
    const adsetIdsStr = searchParams.get("adsetIds") || ""
    const since = searchParams.get("since")
    const until = searchParams.get("until")

    if (!accountId) return NextResponse.json({ error: "Thieu accountId" }, { status: 400 })
    const adsetIds = adsetIdsStr.split(",").map(s => s.trim()).filter(Boolean)
    if (adsetIds.length === 0) return NextResponse.json({ ads: [], total: 0 })

    const acc = await prisma.adAccount.findFirst({ where: { id: accountId, userId: ownerId } })
    if (!acc) return NextResponse.json({ error: "TKQC khong ton tai" }, { status: 404 })

    const tokenRec = await getFbToken(ownerId)
    if (!tokenRec) return NextResponse.json({ error: "Chua co FB token" }, { status: 400 })
    const token = tokenRec.longToken
    const actPath = acc.actId.startsWith("act_") ? acc.actId : `act_${acc.actId}`
    const dateParam = buildDateParam(null, since, until)

    const useFilter = adsetIds.length <= FILTER_THRESHOLD
    const adsetIdSet = new Set(adsetIds)
    const filteringJson = useFilter
      ? encodeURIComponent(JSON.stringify([{ field: "adset.id", operator: "IN", value: adsetIds }]))
      : null

    const adFields = "id,name,status,effective_status,created_time,adset_id,campaign{objective},creative{id,thumbnail_url,effective_object_story_id,object_story_spec{page_id}}"
    const adsUrl = useFilter
      ? `https://graph.facebook.com/v19.0/${actPath}/ads?fields=${adFields}&filtering=${filteringJson}&limit=500`
      : `https://graph.facebook.com/v19.0/${actPath}/ads?fields=${adFields}&limit=500`

    const insightFields = "ad_id,adset_id,spend,impressions,reach,clicks,inline_link_clicks,actions,cost_per_action_type"
    const insightsUrl = useFilter
      ? `https://graph.facebook.com/v19.0/${actPath}/insights?level=ad&fields=${insightFields}&filtering=${filteringJson}&limit=500&${dateParam}`
      : `https://graph.facebook.com/v19.0/${actPath}/insights?level=ad&fields=${insightFields}&limit=500&${dateParam}`

    const [adsRaw, insightsRaw] = await Promise.all([
      fbFetchAll(adsUrl, token, 30),
      fbFetchAll(insightsUrl, token, 30),
    ])

    const adsFiltered = useFilter ? adsRaw : adsRaw.filter((a: any) => adsetIdSet.has(a.adset_id))
    const insightsMap = new Map<string, any>()
    for (const r of insightsRaw) {
      if (useFilter || adsetIdSet.has(r.adset_id)) insightsMap.set(r.ad_id, r)
    }

    // Collect pageIds. FB không có field page_id trực tiếp trên Ad — phải parse từ creative.
    // 3 chỗ có thể chứa pageId (tuỳ loại creative):
    //   1. creative.object_story_spec.page_id (post tạo mới từ creative)
    //   2. creative.effective_object_story_id = "pageId_postId" (post có sẵn)
    //   3. creative.object_story_id (legacy field, format giống)
    const pageIds = new Set<string>()
    for (const a of adsFiltered) {
      const c = a.creative || {}
      const eos = c.effective_object_story_id || c.object_story_id || ""
      const pid = c.object_story_spec?.page_id
        || (eos.includes("_") ? eos.split("_")[0] : null)
      if (pid) pageIds.add(pid)
    }

    // STEP 1: lookup DB FanPage (đã sync).
    const dbPages = pageIds.size
      ? await prisma.fanPage.findMany({ where: { userId: ownerId, pageId: { in: Array.from(pageIds) } }, select: { pageId: true, name: true } })
      : []
    const pageNameById = new Map(dbPages.map((p) => [p.pageId, p.name]))

    // STEP 2: page chưa có trong DB → fetch trực tiếp FB bằng batch API (max 50/batch).
    const missingPageIds = Array.from(pageIds).filter(pid => !pageNameById.has(pid))
    if (missingPageIds.length > 0) {
      const BATCH_LIMIT = 50
      for (let i = 0; i < missingPageIds.length; i += BATCH_LIMIT) {
        const slice = missingPageIds.slice(i, i + BATCH_LIMIT)
        const subRequests = slice.map(pid => ({ method: "GET", relative_url: `${pid}?fields=name` }))
        try {
          const formData = new URLSearchParams()
          formData.set("batch", JSON.stringify(subRequests))
          formData.set("access_token", token)
          const r = await fetch("https://graph.facebook.com/v19.0/", { method: "POST", body: formData })
          const results: any = await r.json()
          if (Array.isArray(results)) {
            for (let j = 0; j < results.length; j++) {
              const sub = results[j]
              if (sub?.code !== 200) continue
              try {
                const body = JSON.parse(sub.body || "{}")
                if (body.id && body.name) pageNameById.set(body.id, body.name)
              } catch {}
            }
          }
        } catch (e) { console.error("[trinh-quan-ly/ads] batch fetch pages error:", e) }
      }
    }

    const ads = adsFiltered.map((a: any) => {
      const ins = insightsMap.get(a.id)
      const objective = a.campaign?.objective
      const { results, costPerResult, resultLabel } = computeResults(objective, ins?.actions, ins?.cost_per_action_type)
      const pageId = a.creative?.object_story_spec?.page_id
        || (a.creative?.effective_object_story_id ? a.creative.effective_object_story_id.split("_")[0] : null)
      return {
        id: a.id,
        name: a.name,
        adsetId: a.adset_id,
        status: a.status,
        effectiveStatus: a.effective_status,
        delivery: deliveryLabel(a.status, a.effective_status),
        createdTime: a.created_time,
        thumbnailUrl: a.creative?.thumbnail_url || null,
        pageId,
        pageName: pageId ? (pageNameById.get(pageId) || null) : null,
        spend: ins?.spend ? Math.round(parseFloat(ins.spend)) : 0,
        impressions: ins?.impressions ? parseInt(ins.impressions) : 0,
        reach: ins?.reach ? parseInt(ins.reach) : 0,
        clicks: ins?.clicks ? parseInt(ins.clicks) : 0,
        results,
        costPerResult,
        resultLabel,
      }
    })

    return NextResponse.json({ ads, total: ads.length })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[trinh-quan-ly/ads]", e)
    return safeError(e, "trinh-quan-ly/ads")
  }
}
