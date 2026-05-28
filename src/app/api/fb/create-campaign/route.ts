import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createCampaignsForBatch } from "@/lib/fb-create-campaign"

export const runtime = "nodejs"
export const maxDuration = 300

/**
 * POST /api/fb/create-campaign
 * Body: {
 *   accountId: string (DB AdAccount.id),
 *   postIds: string[] (DB Post.id),
 *   config: { ... }
 * }
 *
 * Logic chinh tach ra src/lib/fb-create-campaign.ts de cron auto-camp tai dung.
 */
export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { accountId, postIds, config } = body as {
    accountId?: string
    postIds?: string[]
    config?: any
  }
  if (!accountId) return NextResponse.json({ error: "Thiếu accountId" }, { status: 400 })
  if (!Array.isArray(postIds) || postIds.length === 0)
    return NextResponse.json({ error: "Thiếu postIds" }, { status: 400 })
  if (!config) return NextResponse.json({ error: "Thiếu config" }, { status: 400 })

  const result = await createCampaignsForBatch({
    userId: user.userId,
    accountId,
    postIds,
    config,
  })

  if (!result.ok && result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    totalRequested: result.totalRequested,
    success: result.success,
    failed: result.failed,
    results: result.results,
  })
}
