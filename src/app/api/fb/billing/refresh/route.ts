import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { snapshotUserBilling } from "@/lib/fb-billing"

export const runtime = "nodejs"
export const maxDuration = 90

// POST /api/fb/billing/refresh
// Manual trigger: snapshot billing TẤT CẢ TKQC của user ngay (không chờ cron).
export async function POST() {
  try {
    const user = await requireAuth()
    const results = await snapshotUserBilling(user.userId)
    const ok = results.filter((r) => r.ok).length
    const reduced = results.filter((r) => r.limitReduced).length
    return NextResponse.json({
      ok: true,
      results,
      summary: { total: results.length, success: ok, limitReduced: reduced },
    })
  } catch (e: any) {
  return safeError(e, "fb/billing/refresh")
}
}
