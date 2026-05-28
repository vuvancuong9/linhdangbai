import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { getEffectiveLockDate, ROLLING_LOCK_DAYS } from "@/lib/data-lock"

export const runtime = "nodejs"
export const maxDuration = 120

// Body 50MB limit (CSV ~100k orders ≈ 30MB safe).
const MAX_BODY_BYTES = 50 * 1024 * 1024

type IncomingOrder = {
  orderId: string
  subId1?: string
  subId2?: string
  subId3?: string
  subId4?: string
  subId5?: string
  clickTime?: string   // ISO or "DD/MM/YYYY HH:mm" / "M/D/YYYY HH:mm"
  purchaseTime?: string
  completeTime?: string
  clickDate: string    // YYYY-MM-DD (đã normalize ở frontend)
  status: string       // "pending" | "completed" | "cancelled"
  commission: number
  orderValue?: number
  shopName?: string
  shopId?: string
  productName?: string
  itemCount?: number
  channel?: string
}

function parseDateTimeMaybe(s?: string): Date | null {
  if (!s) return null
  const t = s.trim()
  if (!t) return null
  // ISO format
  const iso = new Date(t)
  if (!isNaN(iso.getTime())) return iso
  return null
}

// POST /api/orders/import
// Body: { records: IncomingOrder[], shopeeAccountId?: string }
// Upsert per orderId. Đơn KHÔNG có trong records sẽ được giữ nguyên.
export async function POST(req: NextRequest) {
  try {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const contentLength = Number(req.headers.get("content-length") || 0)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: `Body quá lớn (${Math.round(contentLength / 1024 / 1024)}MB), giới hạn 50MB` }, { status: 413 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }) }

  const records: IncomingOrder[] = Array.isArray(body?.records) ? body.records : []
  if (records.length === 0) {
    return NextResponse.json({ error: "records[] rỗng" }, { status: 400 })
  }
  if (records.length > 100000) {
    return NextResponse.json({ error: "TOO_MANY_RECORDS", limit: 100000 }, { status: 413 })
  }

  // Verify Shopee account ownership nếu truyền
  let shopeeAccountId: string | null = null
  if (body?.shopeeAccountId) {
    const sh = await prisma.shopeeAffiliateToken.findFirst({
      where: { id: String(body.shopeeAccountId), userId: user.userId },
    })
    if (!sh) return NextResponse.json({ error: "Shopee account không hợp lệ" }, { status: 400 })
    shopeeAccountId = sh.id
  }

  // Validate + normalize
  const valid: Array<Required<Pick<IncomingOrder, "orderId" | "clickDate" | "status" | "commission">> & {
    subId1: string | null
    subId2: string | null
    subId3: string | null
    subId4: string | null
    subId5: string | null
    clickTime: Date | null
    purchaseTime: Date | null
    completeTime: Date | null
    orderValue: number | null
    shopName: string | null
    shopId: string | null
    productName: string | null
    itemCount: number
    channel: string | null
  }> = []
  let skippedLocked = 0
  let skippedInvalid = 0
  // Rolling lock: data co clickDate < (today - 30 days) bi BAO VE - khong cho upsert.
  // Bao ve don hang cu khoi viec ghi de boi CSV moi (vd CSV 30+ ngay co cung orderId).
  const lockDate = getEffectiveLockDate()

  for (const r of records) {
    const orderId = String(r?.orderId || "").trim()
    if (!orderId) { skippedInvalid++; continue }

    const dateStr = String(r?.clickDate || "").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { skippedInvalid++; continue }
    if (dateStr < lockDate) { skippedLocked++; continue }

    const commission = Number(r?.commission)
    if (!Number.isFinite(commission)) { skippedInvalid++; continue }

    const status = String(r?.status || "pending").trim().toLowerCase()
    const normStatus = ["pending", "completed", "cancelled"].includes(status) ? status : "pending"

    valid.push({
      orderId: orderId.slice(0, 60),
      subId1: r.subId1 ? String(r.subId1).trim().slice(0, 50) : null,
      subId2: r.subId2 ? String(r.subId2).trim().slice(0, 50) : null,
      subId3: r.subId3 ? String(r.subId3).trim().slice(0, 50) : null,
      subId4: r.subId4 ? String(r.subId4).trim().slice(0, 50) : null,
      subId5: r.subId5 ? String(r.subId5).trim().slice(0, 50) : null,
      clickTime: parseDateTimeMaybe(r.clickTime),
      purchaseTime: parseDateTimeMaybe(r.purchaseTime),
      completeTime: parseDateTimeMaybe(r.completeTime),
      clickDate: dateStr,
      status: normStatus,
      commission,
      orderValue: Number.isFinite(Number(r.orderValue)) ? Number(r.orderValue) : null,
      shopName: r.shopName ? String(r.shopName).trim().slice(0, 200) : null,
      shopId: r.shopId ? String(r.shopId).trim().slice(0, 50) : null,
      productName: r.productName ? String(r.productName).trim().slice(0, 500) : null,
      itemCount: Number.isFinite(Number(r.itemCount)) ? Math.max(1, Math.round(Number(r.itemCount))) : 1,
      channel: r.channel ? String(r.channel).trim().slice(0, 30) : null,
    })
  }

  if (valid.length === 0) {
    return NextResponse.json({ imported: 0, skippedLocked, skippedInvalid, message: "Không có record hợp lệ" })
  }

  // Bulk INSERT/UPSERT.
  // ON CONFLICT (userId, shopeeAccountId, orderId): UPDATE all fields với data CSV mới.
  // KHÔNG bảo vệ source='manual' vì user dùng CSV làm nguồn chính → mỗi upload là latest state.
  const CHUNK = 500
  let imported = 0
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK)
    const values = chunk.map((r) =>
      Prisma.sql`(
        ${randomUUID()}, ${user.userId}, ${shopeeAccountId},
        ${r.orderId}, ${r.subId1}, ${r.subId2}, ${r.subId3}, ${r.subId4}, ${r.subId5},
        ${r.clickTime}, ${r.purchaseTime}, ${r.completeTime},
        ${r.clickDate}::date,
        ${r.status}, ${r.commission}, ${r.orderValue},
        ${r.shopName}, ${r.shopId}, ${r.productName}, ${r.itemCount}, ${r.channel},
        'manual', NOW(), NOW()
      )`
    )
    await prisma.$executeRaw`
      INSERT INTO order_commission (
        "id", "userId", "shopeeAccountId",
        "orderId", "subId1", "subId2", "subId3", "subId4", "subId5",
        "clickTime", "purchaseTime", "completeTime",
        "clickDate",
        "status", "commission", "orderValue",
        "shopName", "shopId", "productName", "itemCount", "channel",
        "source", "createdAt", "updatedAt"
      )
      VALUES ${Prisma.join(values, ", ")}
      ON CONFLICT ("userId", "shopeeAccountId", "orderId") DO UPDATE SET
        "subId1" = EXCLUDED."subId1",
        "subId2" = EXCLUDED."subId2",
        "subId3" = EXCLUDED."subId3",
        "subId4" = EXCLUDED."subId4",
        "subId5" = EXCLUDED."subId5",
        "clickTime" = COALESCE(EXCLUDED."clickTime", order_commission."clickTime"),
        "purchaseTime" = COALESCE(EXCLUDED."purchaseTime", order_commission."purchaseTime"),
        "completeTime" = COALESCE(EXCLUDED."completeTime", order_commission."completeTime"),
        "clickDate" = EXCLUDED."clickDate",
        "status" = EXCLUDED."status",
        "commission" = EXCLUDED."commission",
        "orderValue" = EXCLUDED."orderValue",
        "shopName" = COALESCE(EXCLUDED."shopName", order_commission."shopName"),
        "shopId" = COALESCE(EXCLUDED."shopId", order_commission."shopId"),
        "productName" = COALESCE(EXCLUDED."productName", order_commission."productName"),
        "itemCount" = EXCLUDED."itemCount",
        "channel" = COALESCE(EXCLUDED."channel", order_commission."channel"),
        "source" = 'manual',
        "updatedAt" = NOW()
    `
    imported += chunk.length
  }

  // Stats summary
  let totalCommission = 0
  let countByStatus: Record<string, number> = {}
  for (const v of valid) {
    totalCommission += v.commission
    countByStatus[v.status] = (countByStatus[v.status] || 0) + 1
  }

  return NextResponse.json({
    ok: true,
    imported,
    skippedLocked,
    skippedInvalid,
    lockDate,
    rollingLockDays: ROLLING_LOCK_DAYS,
    totalCommission: Math.round(totalCommission),
    countByStatus,
  })
  } catch (e: any) {
    // SECURITY (P3): production trả generic message, dev mới log chi tiết.
    console.error("[orders/import ROUTE ERROR]", e)
    const isDev = process.env.NODE_ENV !== "production"
    return NextResponse.json({
      ok: false,
      error: isDev ? (e?.message?.slice(0, 500) || "Internal error") : "Internal error",
      ...(isDev ? { stack: e?.stack?.slice(0, 1000) } : {}),
    }, { status: 500 })
  }
}
