// Sync hoa hong + don tu Shopee Affiliate Open API.
// Cho moi ShopeeAffiliateToken cua user, fetch conversionReport (paginated)
// va upsert vao OrderCommission + AffiliateCommissionDaily.

import { prisma } from "./prisma"
import { fetchConversionReport } from "./shopee"
import { decryptSecret } from "./crypto"

export interface SyncShopeeResult {
  tokenId: string
  tokenName: string
  ok: boolean
  error?: string
  conversionsFetched: number
  ordersUpserted: number
  dailyAggregateUpserted: number
}

// Map conversionStatus tu Shopee -> status internal
function mapStatus(s: string): "pending" | "completed" | "cancelled" {
  const upper = String(s || "").toUpperCase()
  if (upper === "COMPLETED" || upper === "PAID" || upper === "FULFILLED") return "completed"
  if (upper === "CANCELED" || upper === "CANCELLED" || upper === "INVALID") return "cancelled"
  return "pending"
}

// Truncate Date to day (UTC midnight) - khop voi @db.Date trong schema
function dayOnly(unixSec: number): Date {
  const d = new Date(unixSec * 1000)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// Sync 1 token cua user
export async function syncShopeeTokenForUser(
  userId: string,
  tokenId: string,
  daysBack: number = 7,
): Promise<SyncShopeeResult> {
  const result: SyncShopeeResult = {
    tokenId,
    tokenName: "",
    ok: false,
    conversionsFetched: 0,
    ordersUpserted: 0,
    dailyAggregateUpserted: 0,
  }
  try {
    const token = await prisma.shopeeAffiliateToken.findUnique({
      where: { id: tokenId },
      select: { id: true, userId: true, name: true, appId: true, apiKey: true },
    })
    if (!token || token.userId !== userId) {
      result.error = "Token khong ton tai hoac khong thuoc user"
      return result
    }
    result.tokenName = token.name

    // Decrypt apiKey (luu encrypted theo pattern token-store)
    let appSecret: string
    try {
      appSecret = decryptSecret(token.apiKey)
    } catch {
      // Fallback: neu khong encrypted thi dung raw
      appSecret = token.apiKey
    }

    // Range: daysBack ngay gan day
    const now = Math.floor(Date.now() / 1000)
    const start = now - daysBack * 86400

    const conversions = await fetchConversionReport(token.appId, appSecret, start, now)
    result.conversionsFetched = conversions.length

    // PERF (R2.B3): bulk upsert chunked parallel (chunk 15 theo DB pool).
    // Trước: N×upsert tuần tự với 1.5k orders × 30ms = ~45s. Sau: ~3-5s.
    let ordersUpserted = 0
    const DB_CONC = 15
    for (let i = 0; i < conversions.length; i += DB_CONC) {
      const slice = conversions.slice(i, i + DB_CONC)
      const results = await Promise.allSettled(slice.map(c => {
        const status = mapStatus(c.conversionStatus)
        const firstItem = c.items[0]
        const orderValue = c.items.reduce((s, it) => s + it.price * it.quantity, 0)
        const clickDate = c.clickTime > 0 ? dayOnly(c.clickTime) : dayOnly(c.purchaseTime || now)
        const data = {
          status,
          commission: c.totalNetCommission,
          orderValue,
          subId1: c.subId1 || null,
          subId2: c.subId2 || null,
          subId3: c.subId3 || null,
          subId4: c.subId4 || null,
          subId5: c.subId5 || null,
          shopName: firstItem?.shopName || null,
          shopId: firstItem?.shopId || null,
          productName: firstItem?.itemName || null,
          itemCount: c.items.length,
          clickTime: c.clickTime > 0 ? new Date(c.clickTime * 1000) : null,
          purchaseTime: c.purchaseTime > 0 ? new Date(c.purchaseTime * 1000) : null,
          clickDate,
          channel: "Shopee API",
        }
        return prisma.orderCommission.upsert({
          where: { userId_shopeeAccountId_orderId: { userId, shopeeAccountId: token.id, orderId: c.orderId } },
          update: data,
          create: { userId, shopeeAccountId: token.id, orderId: c.orderId, ...data },
        })
      }))
      for (const r of results) {
        if (r.status === "fulfilled") ordersUpserted++
      }
    }
    result.ordersUpserted = ordersUpserted

    // Aggregate vao AffiliateCommissionDaily per (subId2, date)
    // Chi tinh order completed + pending (loai cancelled).
    type AggKey = string // `${subId2}_${dateISO}`
    const agg = new Map<AggKey, { subId2: string; date: Date; commission: number; orderCount: number; clickCount: number }>()
    for (const c of conversions) {
      const status = mapStatus(c.conversionStatus)
      if (status === "cancelled") continue
      const subId2 = c.subId2 || ""
      if (!subId2) continue
      const date = c.clickTime > 0 ? dayOnly(c.clickTime) : dayOnly(c.purchaseTime || now)
      const key = `${subId2}_${date.toISOString()}`
      let bucket = agg.get(key)
      if (!bucket) {
        bucket = { subId2, date, commission: 0, orderCount: 0, clickCount: 0 }
        agg.set(key, bucket)
      }
      bucket.commission += c.totalNetCommission
      bucket.orderCount++
      // Note: conversionReport API tra orders, KHONG tra raw click count.
      // clickCount o day = order count (1 conversion = 1 unique click ban dau).
      // Neu can click raw, dung traffickingReport API (chua impl).
    }

    // PERF (R2.B3): bulk lookup manual rows + parallel upsert.
    // Trước: N rows × (findUnique + upsert) = 2N round-trip. Sau: 1 query + N/15 chunks.
    const buckets = Array.from(agg.values())
    let dailyAggregateUpserted = 0
    if (buckets.length > 0) {
      // 1 query lookup tất cả manual rows trong range buckets.
      const manualKeys = await prisma.affiliateCommissionDaily.findMany({
        where: {
          userId,
          shopeeAccountId: token.id,
          source: "manual",
          subId2: { in: buckets.map(b => b.subId2) },
          date: { in: buckets.map(b => b.date) },
        },
        select: { subId2: true, date: true },
      })
      const manualSet = new Set(manualKeys.map(k => `${k.subId2}_${k.date.toISOString()}`))
      const toUpsert = buckets.filter(b => !manualSet.has(`${b.subId2}_${b.date.toISOString()}`))
      // Chunk parallel upsert
      for (let i = 0; i < toUpsert.length; i += DB_CONC) {
        const slice = toUpsert.slice(i, i + DB_CONC)
        const results = await Promise.allSettled(slice.map(bucket =>
          prisma.affiliateCommissionDaily.upsert({
            where: {
              userId_shopeeAccountId_subId2_date: {
                userId, shopeeAccountId: token.id, subId2: bucket.subId2, date: bucket.date,
              },
            },
            update: { commission: bucket.commission, orderCount: bucket.orderCount, source: "sync" },
            create: {
              userId,
              shopeeAccountId: token.id,
              subId2: bucket.subId2,
              date: bucket.date,
              commission: bucket.commission,
              orderCount: bucket.orderCount,
              clickCount: 0,
              source: "sync",
            },
          })
        ))
        for (const r of results) {
          if (r.status === "fulfilled") dailyAggregateUpserted++
        }
      }
    }
    result.dailyAggregateUpserted = dailyAggregateUpserted

    // Update lastSyncAt
    await prisma.shopeeAffiliateToken.update({
      where: { id: token.id },
      data: { lastSyncAt: new Date() },
    })

    result.ok = true
  } catch (e: any) {
    result.error = e?.message?.slice(0, 300) || String(e)
  }
  return result
}

// Sync tat ca token cua 1 user
export async function syncShopeeAffForUser(userId: string, daysBack: number = 7): Promise<SyncShopeeResult[]> {
  const tokens = await prisma.shopeeAffiliateToken.findMany({
    where: { userId },
    select: { id: true },
  })
  const results: SyncShopeeResult[] = []
  for (const t of tokens) {
    const r = await syncShopeeTokenForUser(userId, t.id, daysBack)
    results.push(r)
  }
  return results
}

// Sync cho tat ca user co token (goi tu cron daily 7h sang)
export async function syncShopeeAffForAllUsers(daysBack: number = 7): Promise<{
  totalUsers: number
  totalTokens: number
  totalConversions: number
  totalOrdersUpserted: number
  results: Array<{ userId: string; userName: string; tokens: SyncShopeeResult[] }>
}> {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", shopeeTokens: { some: {} } },
    select: { id: true, name: true },
  })
  const out: any = { totalUsers: 0, totalTokens: 0, totalConversions: 0, totalOrdersUpserted: 0, results: [] }
  for (const u of users) {
    const tokenResults = await syncShopeeAffForUser(u.id, daysBack)
    out.totalUsers++
    out.totalTokens += tokenResults.length
    out.totalConversions += tokenResults.reduce((s, r) => s + r.conversionsFetched, 0)
    out.totalOrdersUpserted += tokenResults.reduce((s, r) => s + r.ordersUpserted, 0)
    out.results.push({ userId: u.id, userName: u.name, tokens: tokenResults })
  }
  return out
}
