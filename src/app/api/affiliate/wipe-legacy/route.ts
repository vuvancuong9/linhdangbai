import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// POST /api/affiliate/wipe-legacy
// Xoá TOÀN BỘ data commission cũ (V1 - affiliate_commission_daily) cho user hiện tại.
// Sau đó user upload lại CSV để rebuild data ở table mới (order_commission V2).
//
// Header: X-Confirm: yes
// CHỈ XOÁ commission, KHÔNG đụng clickCount (vì click data vẫn ở legacy table).
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (req.headers.get("x-confirm") !== "yes") {
      return NextResponse.json({ error: "Cần header X-Confirm=yes (destructive)" }, { status: 400 })
    }

    // Reset commission về 0 trong legacy table (giữ clickCount)
    const r = await prisma.affiliateCommissionDaily.updateMany({
      where: { userId: user.userId },
      data: { commission: 0, orderCount: 0 },
    })

    // Cleanup: xoá row có cả commission=0 AND clickCount=0
    const cleanup = await prisma.affiliateCommissionDaily.deleteMany({
      where: { userId: user.userId, commission: 0, clickCount: 0 },
    })

    return NextResponse.json({
      ok: true,
      reset: r.count,
      cleaned: cleanup.count,
      message: `Đã reset commission ở legacy table (${r.count} rows). Click data giữ nguyên. Giờ upload CSV để rebuild data ở V2 (order_commission).`,
    })
  } catch (e: any) {
  return safeError(e, "affiliate/wipe-legacy")
}
}
