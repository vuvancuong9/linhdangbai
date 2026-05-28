import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { DATA_LOCK_DATE } from '@/lib/data-lock'

export const runtime = 'nodejs'
export const maxDuration = 60

// Giới hạn body 20MB để chống DoS (CSV ~50k rows ≈ 8-10MB, dư an toàn).
const MAX_BODY_BYTES = 20 * 1024 * 1024

/**
 * POST /api/affiliate/import
 *
 * Accepts JSON payload with pre-aggregated commission records:
 * {
 *   records: [{ subId2: string, date: 'YYYY-MM-DD', commission: number, orderCount?: number }]
 * }
 *
 * Aggregates by (userId, subId2, date) using upsert.
 * Auth: requireAuth(); rows are stored under the current user's userId.
 */
export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  // Body size check: chống DoS bằng JSON cực lớn.
  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: `Body quá lớn (${Math.round(contentLength / 1024 / 1024)}MB), giới hạn 20MB` }, { status: 413 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const records = Array.isArray(body?.records) ? body.records : null
  if (!records) {
    return NextResponse.json({ error: 'records[] required' }, { status: 400 })
  }
  if (records.length > 50000) {
    return NextResponse.json({ error: 'TOO_MANY_RECORDS', limit: 50000 }, { status: 413 })
  }
  // Tuỳ chọn: gắn record vào 1 Shopee account cụ thể (track per-account).
  const shopeeAccountIdRaw = typeof body?.shopeeAccountId === 'string' ? body.shopeeAccountId.trim() : null
  let shopeeAccountId: string | null = null
  if (shopeeAccountIdRaw) {
    const sh = await prisma.shopeeAffiliateToken.findFirst({ where: { id: shopeeAccountIdRaw, userId: user.userId } })
    if (!sh) return NextResponse.json({ error: 'Shopee account không hợp lệ' }, { status: 400 })
    shopeeAccountId = sh.id
  }

  // Validate + normalize. Skip rows trước mốc DATA_LOCK_DATE.
  const valid: { subId2: string; date: Date; commission: number; orderCount: number }[] = []
  let skippedLocked = 0
  let skippedLockedCommission = 0
  let skippedZero = 0
  for (const r of records) {
    const subId2 = typeof r?.subId2 === 'string' ? r.subId2.trim() : ''
    const dateStr = typeof r?.date === 'string' ? r.date.trim() : ''
    const commission = Number(r?.commission)
    const orderCount = Number(r?.orderCount ?? 0)
    if (!subId2) continue
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue
    if (!Number.isFinite(commission)) continue
    // Safety: skip records có commission <= 0 → tránh ghi đè data cũ thành 0.
    // (Voucher/bonus rows, cancelled không match → frontend filter rồi nhưng double-check ở backend.)
    if (commission <= 0) {
      skippedZero++
      continue
    }
    // Lock: bỏ qua mọi record date < DATA_LOCK_DATE
    if (dateStr < DATA_LOCK_DATE) {
      skippedLocked++
      skippedLockedCommission += commission
      continue
    }
    const date = new Date(dateStr + 'T00:00:00Z')
    if (isNaN(date.getTime())) continue
    valid.push({
      subId2,
      date,
      commission,
      orderCount: Number.isFinite(orderCount) ? Math.round(orderCount) : 0,
    })
  }

  if (valid.length === 0) {
    return NextResponse.json({ imported: 0, message: 'No valid records', skippedLocked, skippedLockedCommission })
  }

  // Bulk INSERT với ON CONFLICT DO UPDATE — 1 round-trip / chunk.
  // Update commission + orderCount, GIỮ NGUYÊN clickCount nếu đã có.
  // SET source='manual' để cron API không bao giờ ghi đè data CSV.
  const CHUNK = 500
  let imported = 0
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK)
    const values = chunk.map((r) =>
      Prisma.sql`(${randomUUID()}, ${user.userId}, ${shopeeAccountId}, ${r.subId2}, ${r.date}, ${r.commission}, ${r.orderCount}, 0, 'manual', NOW(), NOW())`
    )
    await prisma.$executeRaw`
      INSERT INTO affiliate_commission_daily ("id", "userId", "shopeeAccountId", "subId2", "date", "commission", "orderCount", "clickCount", "source", "createdAt", "updatedAt")
      VALUES ${Prisma.join(values, ", ")}
      ON CONFLICT ("userId", "shopeeAccountId", "subId2", "date") DO UPDATE SET
        "commission" = EXCLUDED."commission",
        "orderCount" = EXCLUDED."orderCount",
        "source" = 'manual',
        "updatedAt" = NOW()
    `
    imported += chunk.length
  }

  // Date range covered
  let minDate: Date | null = null
  let maxDate: Date | null = null
  for (const v of valid) {
    if (!minDate || v.date < minDate) minDate = v.date
    if (!maxDate || v.date > maxDate) maxDate = v.date
  }

  return NextResponse.json({
    imported,
    skippedLocked,
    skippedLockedCommission: Math.round(skippedLockedCommission),
    skippedZero,
    totalCommission: valid.reduce((s, r) => s + r.commission, 0),
    fromDate: minDate?.toISOString().slice(0, 10) ?? null,
    toDate: maxDate?.toISOString().slice(0, 10) ?? null,
  })
}
