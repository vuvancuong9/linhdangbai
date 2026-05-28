import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// GET /api/user/auto-campaign
// Tra ve trang thai auto-camp + config + thong ke lan chay gan nhat.
export async function GET() {
  try {
    const user = await requireAuth()
    const u = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        autoCampaignEnabled: true,
        autoCampaignConfig: true,
        autoCampaignLastRunAt: true,
        autoCampaignLastSuccess: true,
        autoCampaignLastFailed: true,
      },
    })
    if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let config: any = null
    if (u.autoCampaignConfig) {
      try { config = JSON.parse(u.autoCampaignConfig) } catch {}
    }

    return NextResponse.json({
      enabled: u.autoCampaignEnabled,
      config,
      lastRunAt: u.autoCampaignLastRunAt,
      lastSuccess: u.autoCampaignLastSuccess,
      lastFailed: u.autoCampaignLastFailed,
    })
  } catch (e: any) {
  return safeError(e, "user/auto-campaign")
}
}

// PATCH /api/user/auto-campaign
// Body: { enabled?: boolean, config?: object }
// - Bat/tat auto-camp + cap nhat config (deu optional, gui field nao update field do).
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const data: any = {}
    if (typeof body.enabled === "boolean") data.autoCampaignEnabled = body.enabled
    if (body.config && typeof body.config === "object") {
      data.autoCampaignConfig = JSON.stringify(body.config)
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Khong co field nao de update" }, { status: 400 })
    }
    await prisma.user.update({ where: { id: user.userId }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "user/auto-campaign")
}
}
