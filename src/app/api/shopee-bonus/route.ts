import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// Helper: month "YYYY-MM" → Date của ngày 01 của tháng đó (UTC).
function monthToDate(month: string): Date | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null
  const d = new Date(month + "-01T00:00:00Z")
  return isNaN(d.getTime()) ? null : d
}
function dateToMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}
function firstOfMonth(dateStr: string): Date | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})/)
  if (!m) return null
  return new Date(`${m[1]}-${m[2]}-01T00:00:00Z`)
}

// GET /api/shopee-bonus?shopeeAccountId=&from=&to=
// from/to là YYYY-MM-DD; lấy bonus có month chạm range (từ tháng của from → tháng của to).
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const shopeeAccountId = searchParams.get("shopeeAccountId") || ""
    const from = searchParams.get("from") || ""
    const to = searchParams.get("to") || ""
    if (!shopeeAccountId) return NextResponse.json({ error: "shopeeAccountId required" }, { status: 400 })

    const acc = await prisma.shopeeAffiliateToken.findFirst({
      where: { id: shopeeAccountId, userId: user.userId },
      select: { id: true, name: true },
    })
    if (!acc) return NextResponse.json({ error: "TK Shopee không hợp lệ" }, { status: 400 })

    const where: any = { userId: user.userId, shopeeAccountId }
    const monthFrom = firstOfMonth(from)
    const monthTo = firstOfMonth(to)
    if (monthFrom && monthTo) {
      // Bonus được lưu với date = ngày 1 của tháng. Lấy tất cả bonus có month nằm trong range.
      const monthToInclusive = new Date(monthTo)
      monthToInclusive.setUTCMonth(monthToInclusive.getUTCMonth() + 1)
      where.date = { gte: monthFrom, lt: monthToInclusive }
    }
    const items = await prisma.shopeeBonus.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "asc" }],
    })
    const total = items.reduce((s, x) => s + x.amount, 0)
    // Map sang format có thêm "month" cho FE dễ render
    const itemsOut = items.map((x) => ({
      id: x.id,
      programName: x.programName,
      amount: x.amount,
      month: dateToMonth(x.date),
      note: x.note,
    }))
    return NextResponse.json({ items: itemsOut, total: Math.round(total), shopeeAccount: acc })
  } catch (e: any) {
  return safeError(e, "shopee-bonus")
}
}

// POST /api/shopee-bonus
// Body: { shopeeAccountId, month: 'YYYY-MM', programName, amount, note? }
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const shopeeAccountId = String(body?.shopeeAccountId || "").trim()
    const month = String(body?.month || "").trim()
    const programName = String(body?.programName || "").trim()
    const amount = Number(body?.amount)
    const note = body?.note ? String(body.note).trim() : null

    if (!shopeeAccountId) return NextResponse.json({ error: "Thiếu shopeeAccountId" }, { status: 400 })
    const date = monthToDate(month)
    if (!date) return NextResponse.json({ error: "Month format YYYY-MM" }, { status: 400 })
    if (!programName) return NextResponse.json({ error: "Thiếu tên chương trình" }, { status: 400 })
    if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: "Số tiền không hợp lệ" }, { status: 400 })

    const acc = await prisma.shopeeAffiliateToken.findFirst({ where: { id: shopeeAccountId, userId: user.userId } })
    if (!acc) return NextResponse.json({ error: "TK Shopee không hợp lệ" }, { status: 400 })

    const created = await prisma.shopeeBonus.create({
      data: { userId: user.userId, shopeeAccountId, date, programName, amount, note },
    })
    return NextResponse.json({
      ok: true,
      item: { id: created.id, programName: created.programName, amount: created.amount, month: dateToMonth(created.date), note: created.note },
    })
  } catch (e: any) {
  return safeError(e, "shopee-bonus")
}
}
