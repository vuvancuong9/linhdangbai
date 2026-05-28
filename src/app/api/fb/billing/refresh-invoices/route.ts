import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { syncUserInvoices } from "@/lib/fb-billing"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/fb/billing/refresh-invoices
// Manual trigger: fetch invoices từ FB Graph API → upsert vào DB.
export async function POST() {
  try {
    const user = await requireAuth()
    const results = await syncUserInvoices(user.userId)
    const ok = results.filter((r) => r.ok).length
    const totalFetched = results.reduce((s, r) => s + r.fetched, 0)
    return NextResponse.json({
      ok: true,
      results,
      summary: { total: results.length, success: ok, totalFetched },
    })
  } catch (e: any) {
  return safeError(e, "fb/billing/refresh-invoices")
}
}
