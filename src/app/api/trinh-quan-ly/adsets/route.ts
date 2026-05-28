// GET /api/trinh-quan-ly/adsets?accountId=X&campaignIds=cid1,cid2,...&since=&until=
// Trả về list ad sets của nhiều campaign (1+) trong cùng 1 TKQC + insights merge.
// Strategy: FB API filtering ở account-level — 1 call duy nhất cho mọi camp đã tick.

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { prisma } from "@/lib/prisma"
import { getFbToken } from "@/lib/token-store"
import { buildDateParam, computeResults, deliveryLabel, fbFetchAll, parseBudget } from "@/lib/trinh-quan-ly"

// Ngưỡng số campaignIds để chuyển từ filtering sang fetch-all + filter JS.
// FB filtering IN có giới hạn ~50-100 giá trị, vượt thì lỗi/chậm.
const FILTER_THRESHOLD = 50

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const ownerId = user.userId
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get("accountId")
    const campaignIdsStr = searchParams.get("campaignIds") || ""
    const since = searchParams.get("since")
    const until = searchParams.get("until")

    if (!accountId) return NextResponse.json({ error: "Thieu accountId" }, { status: 400 })
    const campaignIds = campaignIdsStr.split(",").map(s => s.trim()).filter(Boolean)
    if (campaignIds.length === 0) return NextResponse.json({ adsets: [], total: 0 })

    // Verify TKQC thuộc user.
    const acc = await prisma.adAccount.findFirst({ where: { id: accountId, userId: ownerId } })
    if (!acc) return NextResponse.json({ error: "TKQC khong ton tai" }, { status: 404 })

    const tokenRec = await getFbToken(ownerId)
    if (!tokenRec) return NextResponse.json({ error: "Chua co FB token" }, { status: 400 })
    const token = tokenRec.longToken
    const actPath = acc.actId.startsWith("act_") ? acc.actId : `act_${acc.actId}`
    const dateParam = buildDateParam(null, since, until)

    // Filter strategy:
    //   1-50 camp: dùng filtering=IN(...) → FB trả về chính xác adsets cần.
    //   >50 camp: fetch ALL adsets của TKQC rồi filter JS theo campaign_id IN ids.
    const useFilter = campaignIds.length <= FILTER_THRESHOLD
    const campIdSet = new Set(campaignIds)
    const filteringJson = useFilter
      ? encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]))
      : null

    const adsetFields = "id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,optimization_goal,billing_event,created_time,campaign_id,campaign{objective}"
    const adsetsUrl = useFilter
      ? `https://graph.facebook.com/v19.0/${actPath}/adsets?fields=${adsetFields}&filtering=${filteringJson}&limit=500`
      : `https://graph.facebook.com/v19.0/${actPath}/adsets?fields=${adsetFields}&limit=500`

    const insightFields = "adset_id,campaign_id,spend,impressions,reach,clicks,inline_link_clicks,actions,cost_per_action_type"
    const insightsUrl = useFilter
      ? `https://graph.facebook.com/v19.0/${actPath}/insights?level=adset&fields=${insightFields}&filtering=${filteringJson}&limit=500&${dateParam}`
      : `https://graph.facebook.com/v19.0/${actPath}/insights?level=adset&fields=${insightFields}&limit=500&${dateParam}`

    const [adsetsRaw, insightsRaw] = await Promise.all([
      fbFetchAll(adsetsUrl, token, 30),
      fbFetchAll(insightsUrl, token, 30),
    ])

    // Filter JS nếu không dùng filter FB.
    const adsetsFiltered = useFilter ? adsetsRaw : adsetsRaw.filter((s: any) => campIdSet.has(s.campaign_id))
    const insightsMap = new Map<string, any>()
    for (const r of insightsRaw) {
      if (useFilter || campIdSet.has(r.campaign_id)) insightsMap.set(r.adset_id, r)
    }

    const adsets = adsetsFiltered.map((s: any) => {
      const ins = insightsMap.get(s.id)
      const objective = s.campaign?.objective
      const { results, costPerResult, resultLabel } = computeResults(objective, ins?.actions, ins?.cost_per_action_type)
      const { value: budget, type: budgetType } = parseBudget(s.daily_budget, s.lifetime_budget)
      return {
        id: s.id,
        name: s.name,
        campaignId: s.campaign_id,
        status: s.status,
        effectiveStatus: s.effective_status,
        delivery: deliveryLabel(s.status, s.effective_status),
        budget,
        budgetType,
        bidStrategy: s.bid_strategy || null,
        optimizationGoal: s.optimization_goal || null,
        billingEvent: s.billing_event || null,
        createdTime: s.created_time,
        spend: ins?.spend ? Math.round(parseFloat(ins.spend)) : 0,
        impressions: ins?.impressions ? parseInt(ins.impressions) : 0,
        reach: ins?.reach ? parseInt(ins.reach) : 0,
        clicks: ins?.clicks ? parseInt(ins.clicks) : 0,
        results,
        costPerResult,
        resultLabel,
      }
    })

    return NextResponse.json({ adsets, total: adsets.length })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[trinh-quan-ly/adsets]", e)
    return safeError(e, "trinh-quan-ly/adsets")
  }
}
