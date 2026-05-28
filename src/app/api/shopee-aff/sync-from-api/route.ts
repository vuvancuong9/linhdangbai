import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { syncShopeeAffForUser } from "@/lib/shopee-aff-sync"

export const runtime = "nodejs"
export const maxDuration = 300 // 5 phut - tu pagniate co the mat ~1-2 phut/token

// POST /api/shopee-aff/sync-from-api
// Body: { daysBack?: number, tokenId?: string }
// Trigger sync Shopee Affiliate Open API cho user dang dang nhap.
// Neu tokenId truyen vao -> chi sync 1 token. Default sync tat ca.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const daysBack = Math.max(1, Math.min(30, Number(body?.daysBack) || 7))

    const results = await syncShopeeAffForUser(user.userId, daysBack)
    const summary = {
      totalTokens: results.length,
      totalConversions: results.reduce((s, r) => s + r.conversionsFetched, 0),
      totalOrdersUpserted: results.reduce((s, r) => s + r.ordersUpserted, 0),
      totalDailyAggUpserted: results.reduce((s, r) => s + r.dailyAggregateUpserted, 0),
      failedTokens: results.filter(r => !r.ok).length,
    }
    return NextResponse.json({ ok: true, summary, results })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return safeError(e, "shopee-aff/sync-from-api")
  }
}
