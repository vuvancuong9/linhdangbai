import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { runPageAdLimitForUser } from "@/lib/page-ad-limit"

export const runtime = "nodejs"
export const maxDuration = 300

// POST /api/pages/ad-limit-sync
// Manual trigger sync ad limit cho mọi page của user. ~200ms × page count + throttle.
// 50 pages ≈ 15-20s. Frontend disable button trong khi đợi.
export async function POST() {
  try {
    const user = await requireAuth()
    const r = await runPageAdLimitForUser(user.userId)
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return safeError(e, "pages/ad-limit-sync")
  }
}
