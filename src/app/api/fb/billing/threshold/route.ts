import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { getThresholdStatus } from "@/lib/fb-billing"

export const runtime = "nodejs"

// GET /api/fb/billing/threshold
// Trả về dự đoán bao nhiêu ngày nữa từng TKQC sẽ đạt threshold.
export async function GET() {
  try {
    const user = await requireAuth()
    const results = await getThresholdStatus(user.userId)
    // Serialize BigInt
    const out = results.map((r) => ({
      ...r,
      threshold: r.threshold !== null ? r.threshold.toString() : null,
      currentBalance: r.currentBalance !== null ? r.currentBalance.toString() : null,
      dailySpendRate: r.dailySpendRate.toString(),
    }))
    return NextResponse.json({ ok: true, results: out })
  } catch (e: any) {
  return safeError(e, "fb/billing/threshold")
}
}
