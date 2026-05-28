import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// PATCH /api/accounts/[id]/billing-info
// Body: { bankName?, cardOwnerName?, paymentThreshold?, billingNotes? }
// Upsert vào table AdAccountBillingInfo key theo (userId, actId).
// Lookup actId từ AdAccount.id để giữ API contract cũ (FE vẫn truyền adAccountId).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const acc = await prisma.adAccount.findUnique({
      where: { id: params.id },
      select: { userId: true, actId: true },
    })
    if (!acc || acc.userId !== user.userId) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 })

    const body = await req.json()
    const data: any = {}
    if (body.bankName !== undefined) data.bankName = String(body.bankName).trim().slice(0, 100) || null
    if (body.cardOwnerName !== undefined) data.cardOwnerName = String(body.cardOwnerName).trim().slice(0, 100) || null
    if (body.cardLast4 !== undefined) {
      const last4 = String(body.cardLast4 || "").replace(/\D/g, "").slice(0, 4)
      data.cardLast4 = last4 || null
    }
    if (body.billingNotes !== undefined) data.billingNotes = String(body.billingNotes).trim().slice(0, 500) || null
    if (body.paymentThreshold !== undefined) {
      const v = body.paymentThreshold
      if (v === null || v === "") data.paymentThreshold = null
      else {
        const n = String(v).replace(/[^\d]/g, "")
        if (n) data.paymentThreshold = BigInt(n)
        else data.paymentThreshold = null
      }
    }

    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Không có thay đổi" }, { status: 400 })

    await prisma.adAccountBillingInfo.upsert({
      where: { userId_actId: { userId: user.userId, actId: acc.actId } },
      update: data,
      create: { userId: user.userId, actId: acc.actId, ...data },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "accounts/[id]/billing-info")
}
}
