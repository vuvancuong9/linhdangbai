// FB Graph API helper cho billing info + invoices.
// Doc: https://developers.facebook.com/docs/marketing-api/business-manager-api/billing
//
// Permissions cần: ads_management hoặc ads_read (user đã có).

import { prisma } from "./prisma"
import { getFbToken } from "./token-store"

// ===== Snapshot billing fetch từ FB Graph API =====

export interface FbBillingSnapshot {
  accountStatus: string  // "1"=ACTIVE, "2"=DISABLED, ...
  currency: string
  amountSpent: bigint    // tổng đã chi (lifetime)
  balance: bigint | null // số dư
  dailySpendLimit: bigint | null
  spendCap: bigint | null
  fundingSource: string | null
  fundingType: string | null
}

// FB trả số tiền dạng "1234567" string trong currency cents/units.
// VND không có cents → giá trị thực = parse trực tiếp.
function parseAmount(s: any): bigint | null {
  if (s === null || s === undefined || s === "") return null
  const n = String(s).trim()
  if (!/^-?\d+$/.test(n)) return null
  try {
    return BigInt(n)
  } catch { return null }
}

function statusToString(code: number | string): string {
  const map: Record<string, string> = {
    "1": "ACTIVE",
    "2": "DISABLED",
    "3": "UNSETTLED",
    "7": "PENDING_RISK_REVIEW",
    "8": "PENDING_SETTLEMENT",
    "9": "IN_GRACE_PERIOD",
    "100": "PENDING_CLOSURE",
    "101": "CLOSED",
    "201": "ANY_ACTIVE",
    "202": "ANY_CLOSED",
  }
  return map[String(code)] || `UNKNOWN_${code}`
}

export async function fetchBillingSnapshot(
  fbActId: string, // act_xxxxxxxxx hoặc xxxxxxxxx
  userToken: string,
): Promise<FbBillingSnapshot> {
  const actPath = fbActId.startsWith("act_") ? fbActId : `act_${fbActId}`
  // Note: FB Graph API KHÔNG expose `daily_spend_limit` (Meta-imposed daily limit) qua API.
  // Field này chỉ hiện trên Ads Manager UI. Workaround: track `spend_cap` (user-set) +
  // `balance` để monitor account state. User check daily_spend_limit thủ công nếu cần.
  const fields = [
    "account_status",
    "currency",
    "amount_spent",
    "balance",
    "spend_cap",
    "funding_source_details",
    "min_daily_budget",
  ].join(",")
  const url = `https://graph.facebook.com/v19.0/${actPath}?fields=${fields}&access_token=${encodeURIComponent(userToken)}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  let res: Response
  try {
    res = await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || `FB billing fetch HTTP ${res.status}`)
  }

  // FB chấp nhận spend_cap = "0" cho không cap, set null để UI hiện "—".
  const spendCap = parseAmount(data.spend_cap)
  return {
    accountStatus: statusToString(data.account_status),
    currency: String(data.currency || "VND"),
    amountSpent: parseAmount(data.amount_spent) ?? BigInt(0),
    balance: parseAmount(data.balance),
    dailySpendLimit: null, // FB không expose qua API
    spendCap: spendCap && spendCap > BigInt(0) ? spendCap : null,
    fundingSource: data.funding_source_details?.display_string || null,
    fundingType: data.funding_source_details?.type || null,
  }
}

// ===== Snapshot daily cho 1 user =====

export interface SnapshotResult {
  adAccountId: string
  actId: string
  name: string
  ok: boolean
  error?: string
  limitReduced?: boolean
  limitDeltaPercent?: number
}

// Snapshot tất cả TKQC active của 1 user.
// Compare daily_spend_limit vs hôm qua → flag nếu giảm > 30%.
export async function snapshotUserBilling(userId: string): Promise<SnapshotResult[]> {
  const fbToken = await getFbToken(userId)
  if (!fbToken) throw new Error("FB token chưa set cho user " + userId)

  // Filter status="ON" thay vì isSelected (user có thể bỏ tích isSelected → sync 0)
  const accounts = await prisma.adAccount.findMany({
    where: { userId, status: "ON" },
    select: { id: true, actId: true, name: true },
  })

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const yesterday = new Date(today.getTime() - 24 * 3600 * 1000)

  // PERF (R2.B1): xử lý 14 TKQC parallel với cap 5 (FB rate-limit safe).
  // Trước: serial loop 14 × 80ms = 1.1s. Sau: ~300ms.
  const SNAP_CONC = 5
  const results: SnapshotResult[] = []
  const processOne = async (acc: typeof accounts[number]): Promise<SnapshotResult> => {
    const r: SnapshotResult = { adAccountId: acc.id, actId: acc.actId, name: acc.name, ok: false }
    try {
      const snap = await fetchBillingSnapshot(acc.actId, fbToken.longToken)

      // Compare spend_cap vs hôm qua (vì FB không expose daily_spend_limit qua API).
      // Dùng findFirst với date range thay vì findUnique để tránh issue @db.Date timezone.
      const yesterdayEnd = new Date(yesterday.getTime() + 24 * 3600 * 1000 - 1)
      const prev = await prisma.fbAdAccountBilling.findFirst({
        where: {
          adAccountId: acc.id,
          snapshotDate: { gte: yesterday, lte: yesterdayEnd },
        },
        select: { spendCap: true, accountStatus: true },
      })
      let limitReduced = false
      let limitDeltaPercent: number | null = null
      if (prev?.spendCap && snap.spendCap !== null && prev.spendCap > BigInt(0)) {
        const prevN = Number(prev.spendCap)
        const nowN = Number(snap.spendCap)
        limitDeltaPercent = ((nowN - prevN) / prevN) * 100
        if (limitDeltaPercent < -30) limitReduced = true
      }
      // Cũng flag nếu account chuyển từ ACTIVE sang DISABLED/PENDING (Meta restrict)
      if (prev?.accountStatus === "ACTIVE" && snap.accountStatus !== "ACTIVE") {
        limitReduced = true
      }

      // Insert snapshot dùng raw SQL — bypass Prisma validation issue với @db.Date.
      const snapDateStr = today.toISOString().slice(0, 10) // "YYYY-MM-DD"
      const cuid = "snp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
      await prisma.$executeRaw`
        DELETE FROM "fb_ad_account_billings"
        WHERE "adAccountId" = ${acc.id} AND "snapshotDate" = ${snapDateStr}::date
      `
      await prisma.$executeRaw`
        INSERT INTO "fb_ad_account_billings" (
          "id", "userId", "adAccountId", "snapshotDate",
          "amountSpentTotal", "dailySpendLimit", "balance", "spendCap",
          "accountStatus", "currency", "fundingSource", "fundingType",
          "limitReduced", "limitDeltaPercent"
        ) VALUES (
          ${cuid}, ${userId}, ${acc.id}, ${snapDateStr}::date,
          ${snap.amountSpent.toString()}::bigint,
          ${snap.dailySpendLimit !== null ? snap.dailySpendLimit.toString() : null}::bigint,
          ${snap.balance !== null ? snap.balance.toString() : null}::bigint,
          ${snap.spendCap !== null ? snap.spendCap.toString() : null}::bigint,
          ${snap.accountStatus}, ${snap.currency},
          ${snap.fundingSource}, ${snap.fundingType},
          ${limitReduced}, ${limitDeltaPercent}
        )
      `
      r.ok = true
      r.limitReduced = limitReduced
      if (limitDeltaPercent !== null) r.limitDeltaPercent = limitDeltaPercent
    } catch (e: any) {
      console.error(`[snapshot] FAIL ${acc.actId} ("${acc.name}"):`, e)
      r.error = (e?.message || "fetch fail").slice(0, 1000)
    }
    return r
  }
  // Chunk parallel theo SNAP_CONC.
  for (let i = 0; i < accounts.length; i += SNAP_CONC) {
    const slice = accounts.slice(i, i + SNAP_CONC)
    const batch = await Promise.all(slice.map(processOne))
    results.push(...batch)
  }
  return results
}

// ===== Invoices fetch =====

export interface FbInvoice {
  fbInvoiceId: string
  invoiceDate: Date
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  totalAmount: bigint
  totalTax: bigint | null
  totalAmountWithTax: bigint | null
  paymentStatus: string | null
  paymentTerm: string | null
  fundingSource: string | null
  currency: string
}

// Fetch invoices từ /act_{id}/transactions endpoint.
// ⚠️ DEPRECATED: FB Graph API v19+ đã REMOVE field `transactions` khỏi ad account.
// Error code 100 "Tried accessing nonexisting field (transactions)".
// Hiện endpoint này sẽ luôn fail. User xem invoice trực tiếp trên FB Ads Manager UI.
// Giữ code phòng FB phục hồi hoặc đổi sang endpoint thay thế (business_invoices).
export async function fetchInvoices(fbActId: string, userToken: string): Promise<FbInvoice[]> {
  const actPath = fbActId.startsWith("act_") ? fbActId : `act_${fbActId}`
  const fields = [
    "id",
    "billing_period",
    "billing_reason",
    "payment_option",
    "public_amount",
    "public_amount_with_tax",
    "tax_amount",
    "status",
    "time",
    "vat_invoice_id",
  ].join(",")
  const url = `https://graph.facebook.com/v19.0/${actPath}/transactions?fields=${fields}&limit=100&access_token=${encodeURIComponent(userToken)}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  let res: Response
  try {
    res = await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || `FB invoices fetch HTTP ${res.status}`)
  }

  const items: any[] = data?.data || []
  const out: FbInvoice[] = []
  for (const it of items) {
    const id = String(it.id || "").trim()
    if (!id) continue
    const time = it.time ? new Date(it.time) : new Date()

    // billing_period là object { start_time, end_time } hoặc string
    let bpStart: Date | null = null
    let bpEnd: Date | null = null
    if (it.billing_period) {
      if (typeof it.billing_period === "object") {
        bpStart = it.billing_period.start_time ? new Date(it.billing_period.start_time) : null
        bpEnd = it.billing_period.end_time ? new Date(it.billing_period.end_time) : null
      }
    }

    out.push({
      fbInvoiceId: id,
      invoiceDate: time,
      billingPeriodStart: bpStart,
      billingPeriodEnd: bpEnd,
      totalAmount: parseAmount(it.public_amount) ?? BigInt(0),
      totalTax: parseAmount(it.tax_amount),
      totalAmountWithTax: parseAmount(it.public_amount_with_tax),
      paymentStatus: it.status ? String(it.status) : null,
      paymentTerm: it.payment_option ? String(it.payment_option) : null,
      fundingSource: null, // FB không trả funding source per transaction
      currency: "VND", // assume VND vì user là VN
    })
  }
  return out
}

// Fetch + upsert invoices cho 1 user.
export async function syncUserInvoices(userId: string) {
  const fbToken = await getFbToken(userId)
  if (!fbToken) throw new Error("FB token chưa set")

  // Filter status="ON" thay vì isSelected (user có thể bỏ tích isSelected → sync 0)
  const accounts = await prisma.adAccount.findMany({
    where: { userId, status: "ON" },
    select: { id: true, actId: true, name: true },
  })

  // PERF (R2.B2): bulk INSERT ON CONFLICT thay vì N×upsert.
  // Trước: 14 TKQC × 50 invoice × ~30ms = ~5-10s. Sau: ~100-300ms.
  // Parallel fetch FB invoices cap 5, rồi bulk insert.
  const FETCH_CONC = 5
  const results: { adAccountId: string; name: string; ok: boolean; fetched: number; error?: string }[] = []
  const fetchOne = async (acc: typeof accounts[number]): Promise<{ adAccountId: string; name: string; ok: boolean; fetched: number; error?: string; invoices?: any[] }> => {
    try {
      const invoices = await fetchInvoices(acc.actId, fbToken.longToken)
      return { adAccountId: acc.id, name: acc.name, ok: true, fetched: invoices.length, invoices }
    } catch (e: any) {
      return { adAccountId: acc.id, name: acc.name, ok: false, fetched: 0, error: (e?.message || "").slice(0, 200) }
    }
  }
  // Chunk fetch
  const fetchResults: Array<{ adAccountId: string; name: string; ok: boolean; fetched: number; error?: string; invoices?: any[] }> = []
  for (let i = 0; i < accounts.length; i += FETCH_CONC) {
    const slice = accounts.slice(i, i + FETCH_CONC)
    const batch = await Promise.all(slice.map(fetchOne))
    fetchResults.push(...batch)
  }
  // Bulk upsert per acc — dùng $transaction để gom các create + update.
  for (const fr of fetchResults) {
    if (!fr.ok || !fr.invoices || fr.invoices.length === 0) {
      results.push({ adAccountId: fr.adAccountId, name: fr.name, ok: fr.ok, fetched: 0, error: fr.error })
      continue
    }
    try {
      // Check rows tồn tại trước → split create vs update (1 query thay vì N upsert).
      const fbIds = fr.invoices.map((i: any) => i.fbInvoiceId)
      const existing = await prisma.fbAdAccountInvoice.findMany({
        where: { adAccountId: fr.adAccountId, fbInvoiceId: { in: fbIds } },
        select: { fbInvoiceId: true },
      })
      const existingSet = new Set(existing.map(e => e.fbInvoiceId))
      const toCreate = fr.invoices.filter((inv: any) => !existingSet.has(inv.fbInvoiceId))
      const toUpdate = fr.invoices.filter((inv: any) => existingSet.has(inv.fbInvoiceId))

      // createMany — 1 query
      if (toCreate.length > 0) {
        await prisma.fbAdAccountInvoice.createMany({
          data: toCreate.map((inv: any) => ({
            userId,
            adAccountId: fr.adAccountId,
            fbInvoiceId: inv.fbInvoiceId,
            invoiceDate: inv.invoiceDate,
            billingPeriodStart: inv.billingPeriodStart,
            billingPeriodEnd: inv.billingPeriodEnd,
            totalAmount: inv.totalAmount,
            totalTax: inv.totalTax,
            totalAmountWithTax: inv.totalAmountWithTax,
            paymentStatus: inv.paymentStatus,
            paymentTerm: inv.paymentTerm,
            fundingSource: inv.fundingSource,
            currency: inv.currency,
          })),
          skipDuplicates: true,
        })
      }
      // Update batch parallel chunk 15 (DB pool).
      if (toUpdate.length > 0) {
        const DB_CONC = 15
        for (let i = 0; i < toUpdate.length; i += DB_CONC) {
          const slice = toUpdate.slice(i, i + DB_CONC)
          await Promise.all(slice.map((inv: any) =>
            prisma.fbAdAccountInvoice.update({
              where: { adAccountId_fbInvoiceId: { adAccountId: fr.adAccountId, fbInvoiceId: inv.fbInvoiceId } },
              data: {
                invoiceDate: inv.invoiceDate,
                billingPeriodStart: inv.billingPeriodStart,
                billingPeriodEnd: inv.billingPeriodEnd,
                totalAmount: inv.totalAmount,
                totalTax: inv.totalTax,
                totalAmountWithTax: inv.totalAmountWithTax,
                paymentStatus: inv.paymentStatus,
                paymentTerm: inv.paymentTerm,
                fundingSource: inv.fundingSource,
                currency: inv.currency,
              },
            }).catch(() => {})
          ))
        }
      }
      results.push({ adAccountId: fr.adAccountId, name: fr.name, ok: true, fetched: fr.invoices.length })
    } catch (e: any) {
      results.push({ adAccountId: fr.adAccountId, name: fr.name, ok: false, fetched: 0, error: (e?.message || "").slice(0, 200) })
    }
  }
  return results
}

// ===== Threshold prediction =====

export interface ThresholdStatus {
  adAccountId: string
  actId: string
  name: string
  threshold: bigint | null  // user-set
  currentBalance: bigint | null
  dailySpendRate: bigint    // average 7 ngày
  daysToThreshold: number | null  // null nếu không tính được
  willHitSoon: boolean      // < 3 ngày
}

// Tính bao nhiêu ngày nữa balance sẽ đạt threshold.
export async function getThresholdStatus(userId: string): Promise<ThresholdStatus[]> {
  const accounts = await prisma.adAccount.findMany({
    where: { userId, isSelected: true },
    select: { id: true, actId: true, name: true },
  })
  if (accounts.length === 0) return []

  // Đọc threshold từ bảng riêng AdAccountBillingInfo (key userId, actId).
  const billingInfos = await prisma.adAccountBillingInfo.findMany({
    where: { userId, actId: { in: accounts.map((a) => a.actId) } },
    select: { actId: true, paymentThreshold: true },
  })
  const thresholdByActId = new Map<string, bigint | null>()
  for (const b of billingInfos) thresholdByActId.set(b.actId, b.paymentThreshold)

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 3600 * 1000)

  const results: ThresholdStatus[] = []
  for (const acc of accounts) {
    const paymentThreshold = thresholdByActId.get(acc.actId) ?? null
    // Snapshot mới nhất
    const latest = await prisma.fbAdAccountBilling.findFirst({
      where: { adAccountId: acc.id },
      orderBy: { snapshotDate: "desc" },
      select: { balance: true, amountSpentTotal: true },
    })
    // Snapshot 7 ngày trước
    const old = await prisma.fbAdAccountBilling.findFirst({
      where: { adAccountId: acc.id, snapshotDate: { lte: sevenDaysAgo } },
      orderBy: { snapshotDate: "desc" },
      select: { amountSpentTotal: true, snapshotDate: true },
    })

    let dailyRate = BigInt(0)
    if (latest?.amountSpentTotal && old?.amountSpentTotal && old.snapshotDate) {
      const diffSpent = latest.amountSpentTotal - old.amountSpentTotal
      const diffDays = Math.max(1, Math.floor((today.getTime() - old.snapshotDate.getTime()) / (24 * 3600 * 1000)))
      dailyRate = diffSpent / BigInt(diffDays)
    }

    let daysToThreshold: number | null = null
    let willHitSoon = false
    if (paymentThreshold && latest?.balance && dailyRate > BigInt(0)) {
      const remaining = paymentThreshold - latest.balance
      if (remaining > BigInt(0)) {
        daysToThreshold = Number(remaining / dailyRate)
        willHitSoon = daysToThreshold < 3
      } else {
        // balance đã >= threshold → đã hoặc sắp bị charge
        daysToThreshold = 0
        willHitSoon = true
      }
    }

    results.push({
      adAccountId: acc.id,
      actId: acc.actId,
      name: acc.name,
      threshold: paymentThreshold,
      currentBalance: latest?.balance ?? null,
      dailySpendRate: dailyRate,
      daysToThreshold,
      willHitSoon,
    })
  }
  return results
}
