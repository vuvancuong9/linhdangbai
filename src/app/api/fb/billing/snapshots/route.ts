import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// GET /api/fb/billing/snapshots?actId=&days=30
// Trả snapshots theo TKQC + ngày.
// Billing info (bank/owner/threshold/notes) đọc từ AdAccountBillingInfo key theo (userId, actId)
// — không JOIN qua AdAccount để tránh mất khi sync recreate AdAccount.
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const actId = searchParams.get("actId") || ""
    const days = Math.min(365, Math.max(1, parseInt(searchParams.get("days") || "30")))

    const since = new Date()
    since.setUTCHours(0, 0, 0, 0)
    since.setUTCDate(since.getUTCDate() - days)

    const where: any = { userId: user.userId, snapshotDate: { gte: since } }
    if (actId) {
      const acc = await prisma.adAccount.findFirst({ where: { userId: user.userId, actId }, select: { id: true } })
      if (!acc) return NextResponse.json({ ok: true, snapshots: [], latest: [] })
      where.adAccountId = acc.id
    }

    // Filter bo snapshot co adAccountId=null (FbAdAccountBilling.adAccountId nullable
    // SetNull khi sync recreate) - khong co adAccount thi UI khong render duoc.
    const snapshotsRaw = await prisma.fbAdAccountBilling.findMany({
      where: { ...where, adAccountId: { not: null } },
      orderBy: [{ snapshotDate: "desc" }, { adAccountId: "asc" }],
      include: {
        adAccount: { select: { id: true, name: true, actId: true, status: true, businessId: true, dailySpendLimit: true, dailySpendLimitUpdatedAt: true } },
      },
      take: 500,
    })
    // Double-safety: filter adAccount null neu Prisma vi du nao do van include null
    const snapshots = snapshotsRaw.filter((s) => s.adAccount !== null)

    // Lấy billing info từ bảng riêng AdAccountBillingInfo (key userId, actId)
    const actIds = Array.from(new Set(snapshots.map((s) => s.adAccount?.actId).filter(Boolean) as string[]))
    const billingInfos = actIds.length > 0 ? await prisma.adAccountBillingInfo.findMany({
      where: { userId: user.userId, actId: { in: actIds } },
    }) : []
    const billingByActId = new Map<string, typeof billingInfos[0]>()
    for (const b of billingInfos) billingByActId.set(b.actId, b)

    // Inject billing fields vào snapshot.adAccount (giữ shape cũ cho FE không cần đổi)
    for (const s of snapshots as any[]) {
      if (s.adAccount?.actId) {
        const bi = billingByActId.get(s.adAccount.actId)
        s.adAccount.bankName = bi?.bankName ?? null
        s.adAccount.cardOwnerName = bi?.cardOwnerName ?? null
        s.adAccount.cardLast4 = bi?.cardLast4 ?? null
        s.adAccount.paymentThreshold = bi?.paymentThreshold ?? null
        s.adAccount.billingNotes = bi?.billingNotes ?? null
      }
    }

    // Latest snapshot per account (cho dashboard chính)
    const latestPerAccount = new Map<string, any>()
    for (const s of snapshots) {
      if (!latestPerAccount.has(s.adAccountId)) latestPerAccount.set(s.adAccountId, s)
    }

    return NextResponse.json({
      ok: true,
      snapshots: serialize(snapshots),
      latest: serialize(Array.from(latestPerAccount.values())),
    })
  } catch (e: any) {
  return safeError(e, "fb/billing/snapshots")
}
}

// BigInt → string để JSON.stringify được
function serialize(arr: any[]): any[] {
  return arr.map((row) => {
    const out: any = { ...row }
    for (const k of Object.keys(out)) {
      if (typeof out[k] === "bigint") out[k] = out[k].toString()
    }
    if (out.adAccount) {
      const a: any = { ...out.adAccount }
      if (typeof a.paymentThreshold === "bigint") a.paymentThreshold = a.paymentThreshold.toString()
      if (typeof a.dailySpendLimit === "bigint") a.dailySpendLimit = a.dailySpendLimit.toString()
      out.adAccount = a
    }
    return out
  })
}
