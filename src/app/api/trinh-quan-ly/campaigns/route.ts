// GET /api/trinh-quan-ly/campaigns?accountId=X&datePreset=today
// Trả về list campaigns của 1 TKQC + insights (spend, results, cost per result, ...) merge sẵn.
// Chiến lược: 2 FB API call song song (campaigns metadata + account-level insights) → merge.
// Thời gian ~1.5-3s cho TKQC có 3000 camp.

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { prisma } from "@/lib/prisma"
import { getFbToken } from "@/lib/token-store"
import { buildDateParam, computeResults, deliveryLabel, fbFetchAll, fbFetchInsightsMap, parseBudget } from "@/lib/trinh-quan-ly"

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const ownerId = user.userId
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get("accountId")
    const datePreset = searchParams.get("datePreset") || "today"
    const since = searchParams.get("since")
    const until = searchParams.get("until")

    if (!accountId) return NextResponse.json({ error: "Thieu accountId" }, { status: 400 })

    // Verify TKQC thuộc về user (hoặc team của ADMIN).
    const acc = await prisma.adAccount.findFirst({ where: { id: accountId, userId: ownerId } })
    if (!acc) return NextResponse.json({ error: "TKQC khong ton tai" }, { status: 404 })

    const tokenRec = await getFbToken(ownerId)
    if (!tokenRec) return NextResponse.json({ error: "Chua co FB token" }, { status: 400 })
    const token = tokenRec.longToken
    const actPath = acc.actId.startsWith("act_") ? acc.actId : `act_${acc.actId}`

    const dateParam = buildDateParam(datePreset, since, until)

    // PARALLEL: campaigns metadata + insights account-level (1 call cho tất cả camp).
    const [campsRaw, insightsMap] = await Promise.all([
      fbFetchAll(
        `https://graph.facebook.com/v19.0/${actPath}/campaigns?fields=id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,objective,created_time&limit=200`,
        token,
        30,
      ),
      fbFetchInsightsMap(actPath, "campaign", dateParam, token),
    ])

    const campaigns = campsRaw.map((c: any) => {
      const ins = insightsMap.get(c.id)
      const { results, costPerResult, resultLabel } = computeResults(c.objective, ins?.actions, ins?.cost_per_action_type)
      const { value: budget, type: budgetType } = parseBudget(c.daily_budget, c.lifetime_budget)
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        effectiveStatus: c.effective_status,
        delivery: deliveryLabel(c.status, c.effective_status),
        objective: c.objective,
        budget,
        budgetType,
        bidStrategy: c.bid_strategy || null,
        createdTime: c.created_time,
        spend: ins?.spend ? Math.round(parseFloat(ins.spend)) : 0,
        impressions: ins?.impressions ? parseInt(ins.impressions) : 0,
        reach: ins?.reach ? parseInt(ins.reach) : 0,
        clicks: ins?.clicks ? parseInt(ins.clicks) : 0,
        results,
        costPerResult,
        resultLabel,
      }
    })

    return NextResponse.json({ campaigns, total: campaigns.length })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[trinh-quan-ly/campaigns]", e)
    return safeError(e, "trinh-quan-ly/campaigns")
  }
}
