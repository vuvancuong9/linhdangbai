import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { getEffectiveLockDate, ROLLING_LOCK_DAYS } from "@/lib/data-lock"

// POST /api/affiliate/clear-manual
// Xoá riêng rows source='manual' cho 1 shopee account (giữ nguyên sync rows).
// Dùng khi user upload CSV nhầm vào account khác.
// Body: { shopeeAccountId: string, from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }
// Header: X-Confirm: yes
//
// ROLLING LOCK: chỉ xoá data có clickDate >= (hôm nay - ROLLING_LOCK_DAYS).
// Nếu user truyền from/to, server sẽ clamp from về MAX(from, lockDate).
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (req.headers.get("x-confirm") !== "yes") {
      return NextResponse.json({ error: "Cần header X-Confirm=yes (destructive op)" }, { status: 400 })
    }
    const body = await req.json().catch(() => ({}))
    const shopeeAccountId = body?.shopeeAccountId ? String(body.shopeeAccountId) : null
    if (!shopeeAccountId) {
      return NextResponse.json({ error: "Thiếu shopeeAccountId" }, { status: 400 })
    }
    const acc = await prisma.shopeeAffiliateToken.findFirst({
      where: { id: shopeeAccountId, userId: user.userId },
    })
    if (!acc) return NextResponse.json({ error: "TK Shopee không hợp lệ" }, { status: 400 })

    const lockDate = getEffectiveLockDate()
    const lockDateObj = new Date(lockDate + "T00:00:00Z")

    const where: any = {
      userId: user.userId,
      shopeeAccountId,
      source: "manual",
    }
    const fromStr = typeof body?.from === "string" ? body.from : ""
    const toStr = typeof body?.to === "string" ? body.to : ""
    // Clamp from về MAX(user.from, lockDate). Always set clickDate.gte = max(...)
    let gteDate = lockDateObj
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromStr)) {
      const userFrom = new Date(fromStr + "T00:00:00Z")
      if (userFrom > lockDateObj) gteDate = userFrom
    }
    where.clickDate = { gte: gteDate }
    if (/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      where.clickDate.lte = new Date(toStr + "T23:59:59Z")
    }

    // V2: query OrderCommission table
    const sumComm = await prisma.orderCommission.aggregate({
      where,
      _sum: { commission: true },
    })

    const r = await prisma.orderCommission.deleteMany({ where })

    return NextResponse.json({
      ok: true,
      deleted: r.count,
      totalCommission: Math.round(sumComm._sum.commission || 0),
      accountName: acc.name,
      lockDate,
      rollingLockDays: ROLLING_LOCK_DAYS,
      message: `Đã xoá ${r.count} đơn manual (commission ${Math.round(sumComm._sum.commission || 0).toLocaleString("vi-VN")}đ) cho ${acc.name}. Data trước ${lockDate} (>${ROLLING_LOCK_DAYS} ngày) BẢO VỆ.`,
    })
  } catch (e: any) {
  return safeError(e, "affiliate/clear-manual")
}
}
