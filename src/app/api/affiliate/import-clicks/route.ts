import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * POST /api/affiliate/import-clicks
 * Body: { records: [{ subId2: string, date: 'YYYY-MM-DD', clickCount: number }] }
 *
 * Upsert clickCount per (userId, subId2, date) vào AffiliateCommissionDaily.
 * Nếu record chưa có → tạo mới với commission=0, orderCount=0.
 * Nếu đã có → chỉ update clickCount, giữ nguyên commission/orderCount.
 */
export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 })
  }

  const records = Array.isArray(body?.records) ? body.records : null
  if (!records) return NextResponse.json({ error: "records[] required" }, { status: 400 })
  if (records.length > 50000) return NextResponse.json({ error: "TOO_MANY_RECORDS" }, { status: 413 })
  const shopeeAccountIdRaw = typeof body?.shopeeAccountId === "string" ? body.shopeeAccountId.trim() : null
  let shopeeAccountId: string | null = null
  if (shopeeAccountIdRaw) {
    const sh = await prisma.shopeeAffiliateToken.findFirst({ where: { id: shopeeAccountIdRaw, userId: user.userId } })
    if (!sh) return NextResponse.json({ error: "Shopee account không hợp lệ" }, { status: 400 })
    shopeeAccountId = sh.id
  }

  const valid: { subId2: string; date: Date; clickCount: number }[] = []
  for (const r of records) {
    const subId2 = typeof r?.subId2 === "string" ? r.subId2.trim() : ""
    const dateStr = typeof r?.date === "string" ? r.date.trim() : ""
    const clickCount = Number(r?.clickCount)
    if (!subId2) continue
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue
    if (!Number.isFinite(clickCount) || clickCount < 0) continue
    valid.push({ subId2, date: new Date(dateStr + "T00:00:00Z"), clickCount: Math.round(clickCount) })
  }

  if (valid.length === 0) return NextResponse.json({ imported: 0 })

  // Bulk INSERT với ON CONFLICT DO UPDATE — 1 round-trip / chunk thay vì N queries.
  // Khi conflict (đã có row cùng userId+subId2+date) → chỉ update clickCount,
  // giữ nguyên commission, orderCount.
  // SET source='manual' để cron API (shopee-aff-sync) không bao giờ ghi đè data CSV.
  const CHUNK = 500
  let imported = 0
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK)
    const values = chunk.map((r) =>
      Prisma.sql`(${randomUUID()}, ${user.userId}, ${shopeeAccountId}, ${r.subId2}, ${r.date}, 0, 0, ${r.clickCount}, 'manual', NOW(), NOW())`
    )
    await prisma.$executeRaw`
      INSERT INTO affiliate_commission_daily ("id", "userId", "shopeeAccountId", "subId2", "date", "commission", "orderCount", "clickCount", "source", "createdAt", "updatedAt")
      VALUES ${Prisma.join(values, ", ")}
      ON CONFLICT ("userId", "shopeeAccountId", "subId2", "date") DO UPDATE SET
        "clickCount" = EXCLUDED."clickCount",
        "source" = 'manual',
        "updatedAt" = NOW()
    `
    imported += chunk.length
  }

  return NextResponse.json({ imported })
}
