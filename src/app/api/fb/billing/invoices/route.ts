import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// GET /api/fb/billing/invoices?actId=&from=&to=
// List invoices của user, có thể filter theo TKQC + date range.
// Billing info (bank/owner) đọc từ AdAccountBillingInfo key (userId, actId) — không JOIN AdAccount.
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const actId = searchParams.get("actId") || ""
    const from = searchParams.get("from") || ""
    const to = searchParams.get("to") || ""

    const where: any = { userId: user.userId }
    if (actId) {
      const acc = await prisma.adAccount.findFirst({ where: { userId: user.userId, actId }, select: { id: true } })
      if (!acc) return NextResponse.json({ ok: true, invoices: [] })
      where.adAccountId = acc.id
    }
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      where.invoiceDate = { ...(where.invoiceDate || {}), gte: new Date(from + "T00:00:00Z") }
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      where.invoiceDate = { ...(where.invoiceDate || {}), lte: new Date(to + "T23:59:59Z") }
    }

    const invoices = await prisma.fbAdAccountInvoice.findMany({
      where,
      orderBy: { invoiceDate: "desc" },
      include: {
        adAccount: { select: { id: true, name: true, actId: true } },
      },
      take: 1000,
    })

    // Inject bankName/cardOwnerName từ bảng billing-info (key actId)
    const actIds = Array.from(new Set(invoices.map((i) => i.adAccount?.actId).filter(Boolean) as string[]))
    const billingInfos = actIds.length > 0 ? await prisma.adAccountBillingInfo.findMany({
      where: { userId: user.userId, actId: { in: actIds } },
      select: { actId: true, bankName: true, cardOwnerName: true },
    }) : []
    const biByActId = new Map<string, typeof billingInfos[0]>()
    for (const b of billingInfos) biByActId.set(b.actId, b)
    for (const inv of invoices as any[]) {
      if (inv.adAccount?.actId) {
        const bi = biByActId.get(inv.adAccount.actId)
        inv.adAccount.bankName = bi?.bankName ?? null
        inv.adAccount.cardOwnerName = bi?.cardOwnerName ?? null
      }
    }

    return NextResponse.json({ ok: true, invoices: serialize(invoices) })
  } catch (e: any) {
  return safeError(e, "fb/billing/invoices")
}
}

function serialize(arr: any[]): any[] {
  return arr.map((row) => {
    const out: any = { ...row }
    for (const k of Object.keys(out)) {
      if (typeof out[k] === "bigint") out[k] = out[k].toString()
    }
    return out
  })
}
