import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { buildExtCorsHeaders } from "@/lib/ext-cors"

export const runtime = "nodejs"
export const maxDuration = 60

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: buildExtCorsHeaders(req.headers.get("origin")) })
}

// POST /api/accounts/sync-invoices-from-ext
// Body: { actId: string, invoices: Array<{ fbInvoiceId, invoiceDate, totalAmount, totalTax?, totalAmountWithTax?, paymentStatus?, billingPeriodStart?, billingPeriodEnd?, fundingSource?, currency? }> }
// Extension scrape DOM trang FB Billing → POST data → backend upsert vào FbAdAccountInvoice.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const rawActId = String(body?.actId || "").trim()
    const invoices: any[] = Array.isArray(body?.invoices) ? body.invoices : []

    if (!rawActId) {
      return NextResponse.json({ error: "Thiếu actId" }, { status: 400, headers: buildExtCorsHeaders(req.headers.get("origin")) })
    }
    if (invoices.length === 0) {
      return NextResponse.json({ ok: true, upserted: 0, message: "Không có invoice nào để sync" }, { headers: buildExtCorsHeaders(req.headers.get("origin")) })
    }

    // Lookup AdAccount (3 variant actId)
    const bareId = rawActId.replace(/^act_/, "")
    const withPrefix = `act_${bareId}`
    const variants = Array.from(new Set([rawActId, bareId, withPrefix]))
    const acc = await prisma.adAccount.findFirst({
      where: { userId: user.userId, actId: { in: variants } },
      select: { id: true, name: true, actId: true },
    })
    if (!acc) {
      return NextResponse.json({
        error: `TKQC ${rawActId} không tìm thấy. Bấm "Đồng bộ FB" ở Keo Ads trước.`,
      }, { status: 404, headers: buildExtCorsHeaders(req.headers.get("origin")) })
    }

    // Upsert từng invoice
    let upserted = 0
    let skipped = 0
    const errors: string[] = []
    for (const inv of invoices) {
      const fbInvoiceId = String(inv?.fbInvoiceId || "").trim()
      if (!fbInvoiceId) { skipped++; continue }
      try {
        const data: any = {}
        if (inv.invoiceDate) data.invoiceDate = new Date(inv.invoiceDate)
        if (inv.billingPeriodStart) data.billingPeriodStart = new Date(inv.billingPeriodStart)
        if (inv.billingPeriodEnd) data.billingPeriodEnd = new Date(inv.billingPeriodEnd)
        if (inv.totalAmount != null) data.totalAmount = BigInt(Math.round(Number(inv.totalAmount)))
        if (inv.totalTax != null) data.totalTax = BigInt(Math.round(Number(inv.totalTax)))
        if (inv.totalAmountWithTax != null) data.totalAmountWithTax = BigInt(Math.round(Number(inv.totalAmountWithTax)))
        if (inv.paymentStatus) data.paymentStatus = String(inv.paymentStatus).slice(0, 50)
        if (inv.paymentTerm) data.paymentTerm = String(inv.paymentTerm).slice(0, 50)
        if (inv.fundingSource) data.fundingSource = String(inv.fundingSource).slice(0, 200)
        data.currency = inv.currency || "VND"

        if (!data.invoiceDate) { skipped++; continue } // bắt buộc có ngày

        await prisma.fbAdAccountInvoice.upsert({
          where: { adAccountId_fbInvoiceId: { adAccountId: acc.id, fbInvoiceId } },
          update: data,
          create: {
            userId: user.userId,
            adAccountId: acc.id,
            fbInvoiceId,
            totalAmount: data.totalAmount ?? BigInt(0),
            ...data,
          },
        })
        upserted++
      } catch (e: any) {
        errors.push(`Invoice ${fbInvoiceId}: ${e?.message?.slice(0, 80)}`)
      }
    }

    return NextResponse.json({
      ok: true,
      accountName: acc.name,
      total: invoices.length,
      upserted,
      skipped,
      errors,
      message: `Đã sync ${upserted}/${invoices.length} invoices cho ${acc.name}`,
    }, { headers: buildExtCorsHeaders(req.headers.get("origin")) })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Chưa login app.quybeo.com" }, { status: 401, headers: buildExtCorsHeaders(req.headers.get("origin")) })
    }
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Error") }, { status: 500, headers: buildExtCorsHeaders(req.headers.get("origin")) })
  }
}
