import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { getEffectiveLockDate, ROLLING_LOCK_DAYS } from "@/lib/data-lock"

// POST /api/affiliate/clear-all
// Reset Hoa hồng (commission + orderCount) về 0, GIỮ NGUYÊN clickCount.
// Body (optional): { shopeeAccountId?: string, type?: "commission" | "click" | "all" }
//   - type=commission (default): reset hoa hồng, giữ click
//   - type=click: reset click, giữ hoa hồng
//   - type=all: reset cả 2 (xoá row luôn nếu cả 2 đều 0)
//   - shopeeAccountId: chỉ reset của TK đó, không có → reset all TK của user
//
// ROLLING LOCK: chỉ xoá data có clickDate >= (hôm nay - ROLLING_LOCK_DAYS).
// Data cũ hơn được BẢO VỆ — không thể xoá.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    // CSRF defense in depth: header X-Confirm bắt buộc cho destructive op.
    if (req.headers.get("x-confirm") !== "yes") {
      return NextResponse.json({ error: "Cần header X-Confirm=yes (destructive op)" }, { status: 400 })
    }
    const body = await req.json().catch(() => ({}))
    const shopeeAccountId = body?.shopeeAccountId ? String(body.shopeeAccountId) : null
    const type = (body?.type as string) || "commission"

    const lockDate = getEffectiveLockDate()
    const lockDateObj = new Date(lockDate + "T00:00:00Z")

    const where: any = { userId: user.userId }
    if (shopeeAccountId) {
      const acc = await prisma.shopeeAffiliateToken.findFirst({ where: { id: shopeeAccountId, userId: user.userId } })
      if (!acc) return NextResponse.json({ error: "TK Shopee không hợp lệ" }, { status: 400 })
      where.shopeeAccountId = shopeeAccountId
    }

    // Where có rolling lock (chỉ áp dụng cho OrderCommission - có cột clickDate)
    const whereOrderRecent = { ...where, clickDate: { gte: lockDateObj } }
    // AffiliateCommissionDaily dùng cột `date`
    const whereDailyRecent = { ...where, date: { gte: lockDateObj } }

    if (type === "all") {
      // Xoá cả OrderCommission (V2) và AffiliateCommissionDaily (legacy click data)
      const [r1, r2] = await Promise.all([
        prisma.orderCommission.deleteMany({ where: whereOrderRecent }),
        prisma.affiliateCommissionDaily.deleteMany({ where: whereDailyRecent }),
      ])
      return NextResponse.json({
        ok: true,
        deleted: r1.count + r2.count,
        deletedOrders: r1.count,
        deletedLegacy: r2.count,
        lockDate,
        rollingLockDays: ROLLING_LOCK_DAYS,
        message: `Đã xoá ${r1.count} đơn (V2) + ${r2.count} bản ghi click. Data trước ${lockDate} (>${ROLLING_LOCK_DAYS} ngày) được BẢO VỆ.`,
      })
    }

    if (type === "click") {
      // Reset click count chỉ trong legacy table
      const r = await prisma.affiliateCommissionDaily.updateMany({ where: whereDailyRecent, data: { clickCount: 0 } })
      const cleanup = await prisma.affiliateCommissionDaily.deleteMany({
        where: { ...whereDailyRecent, commission: 0, clickCount: 0 },
      })
      return NextResponse.json({
        ok: true,
        updated: r.count,
        cleaned: cleanup.count,
        lockDate,
        rollingLockDays: ROLLING_LOCK_DAYS,
        message: `Đã reset Click SP cho ${r.count} bản ghi (>= ${lockDate}). Data cũ hơn được bảo vệ.`,
      })
    }

    // type=commission (default) → xoá đơn từ OrderCommission (V2)
    const r = await prisma.orderCommission.deleteMany({ where: whereOrderRecent })
    return NextResponse.json({
      ok: true,
      deleted: r.count,
      lockDate,
      rollingLockDays: ROLLING_LOCK_DAYS,
      message: `Đã xoá ${r.count} đơn (Hoa hồng V2). Data trước ${lockDate} (>${ROLLING_LOCK_DAYS} ngày) được BẢO VỆ.`,
    })
  } catch (e: any) {
  return safeError(e, "affiliate/clear-all")
}
}
