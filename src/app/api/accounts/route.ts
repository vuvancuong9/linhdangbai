import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export async function GET() {
  try {
    const user = await requireAuth()
    const userId = user.userId
    const [accounts, billingInfos] = await Promise.all([
      prisma.adAccount.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
      // Billing info giờ ở bảng riêng key (userId, actId) — fetch all 1 lần.
      prisma.adAccountBillingInfo.findMany({ where: { userId } }),
    ])
    const biByActId = new Map<string, typeof billingInfos[0]>()
    for (const b of billingInfos) biByActId.set(b.actId, b)

    // Convert BigInt → string + inject billing fields từ bảng mới.
    // Vẫn return field cũ paymentThreshold/bankName/cardOwnerName/billingNotes để FE không cần đổi.
    const serialized = accounts.map((a: any) => {
      const bi = biByActId.get(a.actId)
      const out: any = { ...a }
      // Convert BigInt fields -> string de JSON.stringify khong throw
      if (typeof out.dailySpendLimit === "bigint") out.dailySpendLimit = out.dailySpendLimit.toString()
      out.bankName = bi?.bankName ?? null
      out.cardOwnerName = bi?.cardOwnerName ?? null
      out.billingNotes = bi?.billingNotes ?? null
      out.paymentThreshold = bi?.paymentThreshold != null ? bi.paymentThreshold.toString() : null
      return out
    })
    return NextResponse.json(serialized)
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
    console.error("[/api/accounts GET]", e)
    return safeError(e, "accounts")
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const acc = await prisma.adAccount.create({
      data: { userId: user.userId, name: body.name, actId: body.actId, status: body.status?.toUpperCase() || "ON", budget: body.budget || 0 }
    })
    return NextResponse.json(acc)
  } catch (e: any) {
  return safeError(e, "accounts")
}
}