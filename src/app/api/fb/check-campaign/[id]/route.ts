import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getFbToken } from "@/lib/token-store"
import { fbGet } from "@/lib/fb-fetch"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

// GET /api/fb/check-campaign/{fbCampaignId}
// Diagnostic: hoi truc tiep FB Graph API xem camp co ton tai khong + status hien tai.
// Verify ownership: chỉ cho phép check camp user ĐÃ tạo qua tool (Campaign.campId trong DB).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const tokenRec = await getFbToken(user.userId)
  if (!tokenRec) return NextResponse.json({ error: "Chua co FB token" }, { status: 400 })

  const campId = params.id

  // Verify ownership: camp phải thuộc user (chống enumerate camps user khác qua FB token nội bộ)
  const owns = await prisma.campaign.findFirst({ where: { campId, userId: user.userId }, select: { id: true } })
  if (!owns) return NextResponse.json({ error: "Camp không thuộc về user" }, { status: 404 })

  const fields = "id,name,status,effective_status,configured_status,objective,daily_budget,created_time,updated_time,start_time,stop_time,issues_info,recommendations,account_id"

  try {
    const r = await fbGet(`https://graph.facebook.com/v19.0/${campId}?fields=${fields}`, tokenRec.longToken)
    const data = await r.json()
    return NextResponse.json({
      httpStatus: r.status,
      httpOk: r.ok,
      fbResponse: data,
    }, { status: 200 })
  } catch (e: any) {
    return NextResponse.json({ error: "Fetch FB API failed: " + (e?.message || "") }, { status: 500 })
  }
}
