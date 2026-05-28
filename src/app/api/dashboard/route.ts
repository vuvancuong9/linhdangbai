import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { calcTax } from "@/lib/tax"
import { getFbToken } from "@/lib/token-store"
import { clampDateStr } from "@/lib/data-lock"
import { COMMISSION_NET_FACTOR, ADS_COST_FACTOR } from "@/lib/constants-server"

export const runtime = "nodejs"
// Range nhiều tháng + 25 TKQC + cold cache = 30-60s. Set 90s cho an toàn.
export const maxDuration = 90

// Cache FB Insights spend BY MONTH per (userId|actId|from|to) trong 30 phút.
// Returns Map<monthKey, spend> để Dashboard chia spend đúng theo tháng.
// LRU eviction (cap 500 entries) — chống memory leak.
// TTL trước là 3 phút → load lại liên tục là phải gọi lại 25 TKQC × FB API → 10-20s.
// Tăng lên 30 phút (Quy 2026-05-08): lần đầu vẫn chậm, các lần sau gần như tức thì.
type MonthlySpend = Record<string, number> // monthKey → spend
const spendCache = new Map<string, { data: MonthlySpend; ts: number }>()
const SPEND_TTL = 30 * 60 * 1000
const SPEND_CACHE_MAX = 500

function setSpendCache(key: string, data: MonthlySpend) {
  if (spendCache.size >= SPEND_CACHE_MAX) {
    const firstKey = spendCache.keys().next().value
    if (firstKey) spendCache.delete(firstKey)
  }
  spendCache.delete(key)
  spendCache.set(key, { data, ts: Date.now() })
}

// Fetch spend với time_increment=1 (daily) → aggregate vào monthly buckets.
// 1 API call/account, rồi tự chia theo tháng → support date range chạm nhiều tháng.
// Stale-while-revalidate: nếu cache còn fresh → return ngay.
// Nếu stale (≥ TTL) nhưng tuổi < 6h → trả CŨ ngay + refresh background (không await).
// Nếu quá cũ (> 6h) hoặc chưa có cache → fetch fresh và đợi.
const SPEND_STALE_MAX = 6 * 60 * 60 * 1000 // 6 giờ
const inflightRefresh = new Set<string>() // dedupe background refresh

// Fetch 1 chunk (≤ 37 ngày) — FB Insights time_increment=1 limit.
async function _fetchSpendChunk(
  actPath: string,
  accessToken: string,
  fromStr: string,
  toStr: string,
): Promise<MonthlySpend> {
  const result: MonthlySpend = {}
  const tr = encodeURIComponent(JSON.stringify({ since: fromStr, until: toStr }))
  const url = `https://graph.facebook.com/v19.0/${actPath}/insights?fields=spend,date_start&time_increment=1&level=account&time_range=${tr}&access_token=${accessToken}&limit=500`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    const d: any = await r.json()
    const rows: any[] = d?.data || []
    for (const row of rows) {
      const monthKey = String(row.date_start || "").slice(0, 7) // "YYYY-MM"
      if (!monthKey) continue
      const spend = parseFloat(row.spend || "0")
      if (!Number.isFinite(spend)) continue
      result[monthKey] = (result[monthKey] || 0) + spend
    }
  } catch {
    clearTimeout(timer)
  }
  return result
}

async function _fetchSpendFromFb(
  actId: string,
  accessToken: string,
  fromStr: string,
  toStr: string
): Promise<MonthlySpend> {
  const actPath = actId.startsWith("act_") ? actId : `act_${actId}`

  // FIX BUG: FB Insights time_increment=1 limit time_range tối đa 37 ngày.
  // Range > 37 ngày → FB trả empty data → spend = 0.
  // Solution: chia range thành chunks 30 ngày, fetch parallel, merge result.
  const CHUNK_DAYS = 30
  const fromDate = new Date(fromStr + "T00:00:00Z")
  const toDate = new Date(toStr + "T00:00:00Z")
  const totalDays = Math.floor((toDate.getTime() - fromDate.getTime()) / (24 * 3600 * 1000)) + 1

  if (totalDays <= 37) {
    // Range ngắn → 1 request
    return _fetchSpendChunk(actPath, accessToken, fromStr, toStr)
  }

  // Range dài → chunks 30 ngày, parallel fetch
  const chunks: Array<{ from: string; to: string }> = []
  let cursor = new Date(fromDate)
  while (cursor.getTime() <= toDate.getTime()) {
    const chunkEnd = new Date(cursor)
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + CHUNK_DAYS - 1)
    if (chunkEnd.getTime() > toDate.getTime()) chunkEnd.setTime(toDate.getTime())
    chunks.push({
      from: cursor.toISOString().slice(0, 10),
      to: chunkEnd.toISOString().slice(0, 10),
    })
    cursor.setUTCDate(cursor.getUTCDate() + CHUNK_DAYS)
  }

  const chunkResults = await Promise.all(
    chunks.map((c) => _fetchSpendChunk(actPath, accessToken, c.from, c.to))
  )

  // Merge: sum cùng monthKey
  const result: MonthlySpend = {}
  for (const cr of chunkResults) {
    for (const [k, v] of Object.entries(cr)) {
      result[k] = (result[k] || 0) + v
    }
  }
  for (const k of Object.keys(result)) result[k] = Math.round(result[k])
  return result
}

async function fetchSpendByMonth(
  actId: string,
  accessToken: string,
  fromStr: string,
  toStr: string,
  cacheKey: string
): Promise<MonthlySpend> {
  const cached = spendCache.get(cacheKey)
  const now = Date.now()
  if (cached) {
    const age = now - cached.ts
    if (age < SPEND_TTL) {
      // Fresh — touch LRU và return ngay
      spendCache.delete(cacheKey)
      spendCache.set(cacheKey, cached)
      return cached.data
    }
    if (age < SPEND_STALE_MAX) {
      // Stale-while-revalidate: trả CŨ ngay, refresh background.
      if (!inflightRefresh.has(cacheKey)) {
        inflightRefresh.add(cacheKey)
        _fetchSpendFromFb(actId, accessToken, fromStr, toStr)
          .then((fresh) => setSpendCache(cacheKey, fresh))
          .catch(() => {})
          .finally(() => inflightRefresh.delete(cacheKey))
      }
      return cached.data
    }
  }
  // Cold cache hoặc quá cũ → fetch fresh và đợi
  try {
    const fresh = await _fetchSpendFromFb(actId, accessToken, fromStr, toStr)
    setSpendCache(cacheKey, fresh)
    return fresh
  } catch {
    return cached?.data ?? {}
  }
}

// Helper: list các tháng (YYYY-MM) trong date range (inclusive).
function monthsInRange(fromStr: string, toStr: string): string[] {
  const out: string[] = []
  const m1 = fromStr.match(/^(\d{4})-(\d{2})/)
  const m2 = toStr.match(/^(\d{4})-(\d{2})/)
  if (!m1 || !m2) return out
  let y = +m1[1], m = +m1[2]
  const eY = +m2[1], eM = +m2[2]
  while (y < eY || (y === eY && m <= eM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

// GET /api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const fromRaw = searchParams.get("from") || ""
    const toStr = searchParams.get("to") || ""
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      return NextResponse.json({ error: "Date format YYYY-MM-DD" }, { status: 400 })
    }
    // Clamp from về ≥ DATA_LOCK_DATE — không query data trước mốc.
    const fromStr = clampDateStr(fromRaw)
    const from = new Date(fromStr + "T00:00:00Z")
    const toExclusive = new Date(toStr + "T00:00:00Z")
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1)

    // Tính danh sách tháng trong range: vd "2026-04", "2026-05" nếu range chạm 2 tháng.
    const monthList = monthsInRange(fromStr, toStr)

    // Parallel: tất cả DB queries chạy đồng thời
    const [groupsRaw, allAccounts, allShopees, fbToken, accAssignments] = await Promise.all([
      prisma.accountGroup.findMany({
        where: { userId: user.userId },
        orderBy: { createdAt: "asc" },
        include: {
          shopees: { select: { id: true, name: true, appId: true } },
        },
      }),
      prisma.adAccount.findMany({
        where: { userId: user.userId },
        select: { id: true, name: true, actId: true, status: true },
      }),
      prisma.shopeeAffiliateToken.findMany({
        where: { userId: user.userId },
        select: { id: true, name: true, appId: true, groupId: true },
      }),
      getFbToken(user.userId),
      // Lấy tất cả assignment cho TKQC: TẤT CẢ tháng trong range + default.
      // Key giờ là (userId, actId, monthKey) — bền với recreate.
      prisma.adAccountGroupAssignment.findMany({
        where: {
          userId: user.userId,
          monthKey: { in: [...monthList, "default"] },
        },
        select: { actId: true, groupId: true, monthKey: true },
      }),
    ])

    // Helper: resolve groupId cho (actId, monthKey).
    // - Nếu monthKey-specific entry tồn tại (kể cả groupId=null tombstone) → dùng nó.
    // - Else fallback default.
    // PERF: pre-build 2 Map để tránh O(N×M) find() trong loop acc × monthList.
    const monthAssignMap = new Map<string, string | null>() // key = actId|mk → groupId
    const defaultAssignMap = new Map<string, string | null>() // key = actId → groupId
    for (const a of accAssignments) {
      if (a.monthKey === "default") {
        defaultAssignMap.set(a.actId, a.groupId)
      } else {
        monthAssignMap.set(`${a.actId}|${a.monthKey}`, a.groupId)
      }
    }
    const resolveGroup = (actId: string, mk: string): string | null => {
      const k = `${actId}|${mk}`
      if (monthAssignMap.has(k)) return monthAssignMap.get(k) ?? null
      return defaultAssignMap.get(actId) ?? null
    }

    // Fetch spend MONTHLY (1 API call/account, returns {monthKey: spend}) — chia spend đúng theo tháng.
    // PERF FIX (P2.4): Concurrency cap 4 (FB user-level rate limit 200/h). Trước:
    // Promise.all fire ALL 14 TKQC song song → risk vượt limit khi nhiều user
    // load cùng lúc.
    const FB_CONC = 4
    const monthlySpendByAcc = new Map<string, MonthlySpend>()
    if (fbToken && allAccounts.length > 0) {
      const fetchOne = async (acc: typeof allAccounts[number]) => {
        const cacheKey = `${user.userId}|${acc.actId}|${fromStr}|${toStr}`
        const ms = await fetchSpendByMonth(acc.actId, fbToken.longToken, fromStr, toStr, cacheKey)
        monthlySpendByAcc.set(acc.id, ms)
      }
      for (let i = 0; i < allAccounts.length; i += FB_CONC) {
        const slice = allAccounts.slice(i, i + FB_CONC)
        await Promise.all(slice.map(fetchOne))
      }
    }

    // Build per-group account spend map: groupId → Map<accId, totalSpendInGroup-during-range>
    // Account có thể ở NHIỀU group nếu range chạm nhiều tháng và group đổi giữa các tháng.
    const accountSpendByGroup = new Map<string, Map<string, number>>()
    const ungroupedSpend = new Map<string, number>()
    const accountsInAnyGroup = new Set<string>()

    for (const acc of allAccounts) {
      const ms = monthlySpendByAcc.get(acc.id) || {}
      for (const mk of monthList) {
        const spend = ms[mk] || 0
        const gid = resolveGroup(acc.actId, mk)
        if (gid) {
          accountsInAnyGroup.add(acc.id)
          if (spend === 0) continue // Skip 0-spend nhưng vẫn track cho display
          if (!accountSpendByGroup.has(gid)) accountSpendByGroup.set(gid, new Map())
          const m = accountSpendByGroup.get(gid)!
          m.set(acc.id, (m.get(acc.id) || 0) + spend)
        } else if (spend > 0) {
          ungroupedSpend.set(acc.id, (ungroupedSpend.get(acc.id) || 0) + spend)
        }
      }
    }

    // Cũng track accounts có resolution nhưng không có spend trong range — hiển thị spend=0 trong group.
    // Group → primary account list (resolved at any month, có or không spend)
    const accountsInGroupAtSomeMonth = new Map<string, Set<string>>() // gid → Set<accId>
    for (const acc of allAccounts) {
      for (const mk of monthList) {
        const gid = resolveGroup(acc.actId, mk)
        if (gid) {
          if (!accountsInGroupAtSomeMonth.has(gid)) accountsInGroupAtSomeMonth.set(gid, new Set())
          accountsInGroupAtSomeMonth.get(gid)!.add(acc.id)
        }
      }
    }

    // Build final groups: accounts với spend chia theo group, status đầy đủ.
    const groups = groupsRaw.map((g) => {
      const accIds = accountsInGroupAtSomeMonth.get(g.id) || new Set<string>()
      const spendMap = accountSpendByGroup.get(g.id) || new Map<string, number>()
      const accountsWithSpend = Array.from(accIds).map((accId) => {
        const a = allAccounts.find((x) => x.id === accId)
        if (!a) return null
        return { id: a.id, name: a.name, actId: a.actId, status: a.status, spend: spendMap.get(accId) || 0 }
      }).filter(Boolean) as Array<{ id: string; name: string; actId: string; status: any; spend: number }>
      return { ...g, accounts: accountsWithSpend }
    })

    // Ungrouped: accounts không thuộc group nào trong toàn bộ range
    const ungroupedAd = allAccounts
      .filter((a) => !accountsInAnyGroup.has(a.id))
      .map((a) => ({ ...a, spend: ungroupedSpend.get(a.id) || 0 }))
    const ungroupedSh = allShopees.filter((s) => !s.groupId)

    const groupedShopees = groups.flatMap((g) => g.shopees)
    // spendByAccountId: total spend per account across all months in range (dùng cho ungrouped + tổng).
    const spendByAccountId = new Map<string, number>()
    monthlySpendByAcc.forEach((ms, accId) => {
      let total = 0
      for (const v of Object.values(ms)) total += v
      spendByAccountId.set(accId, Math.round(total))
    })

    // Parallel: Shopee groupBy + Tax records + Click count + Office expenses + Shopee bonuses
    const [commByGroup, latestTaxRecords, clickByGroup, officeExpenseSum, bonusByShopee] = await Promise.all([
      // V2: commission từ order_commission, group theo Shopee account, bỏ cancelled.
      groupedShopees.length > 0
        ? prisma.orderCommission.groupBy({
            by: ["shopeeAccountId"],
            where: {
              userId: user.userId,
              shopeeAccountId: { in: groupedShopees.map((s) => s.id) },
              clickDate: { gte: from, lt: toExclusive },
              status: { not: "cancelled" },
            },
            _sum: { commission: true },
          })
        : Promise.resolve([] as any[]),
      // Tax records
      groups.length > 0
        ? prisma.taxRecord.findMany({
            where: { userId: user.userId, groupId: { in: groups.map((g) => g.id) } },
            orderBy: { updatedAt: "desc" },
          })
        : Promise.resolve([] as any[]),
      // Click count vẫn lưu ở affiliate_commission_daily (legacy table giữ riêng cho click)
      groupedShopees.length > 0
        ? prisma.affiliateCommissionDaily.groupBy({
            by: ["shopeeAccountId"],
            where: {
              userId: user.userId,
              shopeeAccountId: { in: groupedShopees.map((s) => s.id) },
              date: { gte: from, lt: toExclusive },
            },
            _sum: { clickCount: true },
          })
        : Promise.resolve([] as any[]),
      // Office expenses trong date range — trừ vào lợi nhuận
      prisma.officeExpense.aggregate({
        where: { userId: user.userId, date: { gte: from, lt: toExclusive } },
        _sum: { amount: true },
        _count: true,
      }),
      // Shopee bonus theo THÁNG (Voucher Reels, Voucher ads, % doanh thu...) — cộng vào hoa hồng.
      // CHỈ hiển thị bonus khi date range PHỦ ĐẦY THÁNG đó.
      // Định nghĩa "phủ đầy": from <= 1st AND to >= MIN(monthLast, yesterday).
      // - Cap `monthLast` tại yesterday vì data chỉ available đến hôm qua → user không thể
      //   chọn to > yesterday. Tháng HIỆN TẠI (vd May) có monthLast=31/05 nhưng user pick
      //   "Tháng này" -> to=12/05 (yesterday). Vẫn coi là covered đủ vì user đã pick TẤT
      //   CẢ data có sẵn của tháng đó.
      // Test cases:
      //   - "Tháng này" 01/05-12/05 (yesterday=12/05): cap=12/05, to(12/05)>=12/05 ✓ → show May
      //   - "Tháng trước" 01/04-30/04: cap=30/04, to(30/04)>=30/04 ✓ → show Apr
      //   - 17/04-17/04: from(17/04) > monthFirst(01/04) → exclude
      //   - 01/04-25/04 (partial Apr, cap=30/04): to(25/04)<30/04 → exclude
      //   - "Tổng thời gian" 01/02-12/05: Feb+Mar+Apr+May covered → 4 tháng
      groupedShopees.length > 0
        ? (() => {
            const to = new Date(toStr + "T00:00:00Z")
            const yesterday = new Date()
            yesterday.setUTCHours(0, 0, 0, 0)
            yesterday.setUTCDate(yesterday.getUTCDate() - 1)
            const fullyCoveredMonths: Date[] = []
            let y = from.getUTCFullYear()
            let m = from.getUTCMonth()
            while (true) {
              const monthFirst = new Date(Date.UTC(y, m, 1))
              if (monthFirst > to) break
              const monthLast = new Date(Date.UTC(y, m + 1, 0)) // last day of month
              const monthLastEffective = monthLast > yesterday ? yesterday : monthLast
              if (monthFirst >= from && monthLastEffective <= to) {
                fullyCoveredMonths.push(monthFirst)
              }
              m++
              if (m > 11) { y++; m = 0 }
            }
            if (fullyCoveredMonths.length === 0) {
              return Promise.resolve([] as any[])
            }
            return prisma.shopeeBonus.groupBy({
              by: ["shopeeAccountId"],
              where: {
                userId: user.userId,
                shopeeAccountId: { in: groupedShopees.map((s) => s.id) },
                date: { in: fullyCoveredMonths },
              },
              _sum: { amount: true },
            })
          })()
        : Promise.resolve([] as any[]),
    ])

    const commByShopeeId = new Map<string, number>()
    let totalCommissionRaw = 0
    for (const r of commByGroup as any[]) {
      if (r.shopeeAccountId) {
        const c = r._sum?.commission ?? 0
        commByShopeeId.set(r.shopeeAccountId, Math.round(c))
        totalCommissionRaw += c
      }
    }
    // Click count from legacy table affiliate_commission_daily (chỉ lưu click, không lưu commission)
    let totalClickSP = 0
    for (const r of clickByGroup as any[]) {
      if (r.shopeeAccountId) totalClickSP += r._sum?.clickCount ?? 0
    }

    // Bonus map: shopeeAccountId → tổng bonus
    const bonusByShopeeId = new Map<string, number>()
    let totalBonus = 0
    for (const r of bonusByShopee as any[]) {
      if (r.shopeeAccountId) {
        const b = r._sum?.amount ?? 0
        bonusByShopeeId.set(r.shopeeAccountId, Math.round(b))
        totalBonus += b
      }
    }
    // Tổng hoa hồng = commission gốc + bonus (theo yêu cầu user)
    const totalCommission = totalCommissionRaw + totalBonus

    const totalSpend = Array.from(spendByAccountId.values()).reduce((s, v) => s + v, 0)
    const totalRoas = totalSpend > 0 ? totalCommission / totalSpend : 0

    const taxByGroupId = new Map<string, any>()
    for (const r of latestTaxRecords as any[]) {
      if (!taxByGroupId.has(r.groupId)) taxByGroupId.set(r.groupId, r)
    }

    let totalTax = 0
    const groupCards = groups.map((g) => {
      // g.accounts đã có spend đúng (chỉ phần thuộc group này trong range, đã tách theo tháng).
      const accountsWithSpend = g.accounts
      const shopeesWithComm = g.shopees.map((s) => ({
        ...s,
        commission: commByShopeeId.get(s.id) || 0,
        bonus: bonusByShopeeId.get(s.id) || 0,
      }))
      const groupSpend = accountsWithSpend.reduce((s, a) => s + (a.spend || 0), 0)
      // Hoa hồng "thô" — chỉ commission từ Shopee, KHÔNG cộng bonus.
      const groupCommissionRaw = shopeesWithComm.reduce((s, x) => s + (x.commission || 0), 0)
      // Hoa hồng tổng — commission + bonus (hiển thị trên card).
      const groupCommission = shopeesWithComm.reduce((s, x) => s + (x.commission || 0) + (x.bonus || 0), 0)

      const savedTax = taxByGroupId.get(g.id)
      let taxInfo: any = null
      if (savedTax) {
        const o: any = savedTax.outputs
        const taxAmount = o?.taxAmount ?? o?.totalTax ?? 0
        taxInfo = {
          taxType: savedTax.taxType,
          label: savedTax.taxType === "personal" ? "Cá nhân (TNCN)" : savedTax.taxType === "household" ? "HKD (GTGT+TNCN)" : "Công ty (TNDN)",
          taxBase: o?.taxableIncome ?? o?.vatBase ?? 0,
          taxRate: o?.taxRate ?? (o?.vatRate || 0) + (o?.tncnRate || 0),
          tax: taxAmount,
          fromSavedRecord: true,
          recordUpdatedAt: savedTax.updatedAt,
        }
      } else {
        taxInfo = calcTax(g.taxType, groupCommission, groupSpend)
      }
      if (taxInfo) totalTax += taxInfo.tax
      // SECURITY (P4.2): tính profit server-side để KHÔNG lộ formula
      // COMMISSION_NET_FACTOR + ADS_COST_FACTOR ra client (F12 đọc được).
      const groupProfit = Math.round(groupCommission * COMMISSION_NET_FACTOR - groupSpend * ADS_COST_FACTOR)
      return {
        id: g.id,
        name: g.name,
        color: g.color,
        taxType: g.taxType,
        taxId: g.taxId,
        adAccounts: accountsWithSpend,
        shopees: shopeesWithComm,
        groupSpend,
        groupCommission,           // commission + bonus (hiển thị)
        groupCommissionRaw,        // commission only (dùng tính ADS/HH)
        groupProfit,               // server-side pre-computed (P4.2)
        tax: taxInfo,
      }
    })

    // SECURITY (P4.2): tính realProfit server-side. UI nhận sẵn không cần
    // formula để tính → không lộ COMMISSION_NET / ADS_COST_FACTOR qua F12.
    // Tax tính conditional: nếu full range (>= 60 ngày từ DATA_LOCK) thì trừ
    // thuế, không thì bỏ. Client phải biết flag isFullRange để hiển thị đúng
    // — tính trong API và return.
    const officeExp = Math.round((officeExpenseSum as any)?._sum?.amount || 0)
    // isFullRange logic: from = DATA_LOCK_DATE && span >= 60 ngày
    const isFullRange = (() => {
      try {
        if (fromStr !== "2026-02-01") return false  // DATA_LOCK_DATE
        const fromD = new Date(fromStr + "T00:00:00Z")
        const toD = new Date(toStr + "T00:00:00Z")
        return (toD.getTime() - fromD.getTime()) / (24 * 3600 * 1000) >= 60
      } catch { return false }
    })()
    const taxToSubtract = isFullRange ? totalTax : 0
    const realProfit = Math.round(totalCommission * COMMISSION_NET_FACTOR - totalSpend * ADS_COST_FACTOR - taxToSubtract - officeExp)

    return NextResponse.json({
      groups: groupCards,
      ungrouped: { adAccounts: ungroupedAd, shopees: ungroupedSh },
      totals: {
        totalSpend,
        totalCommission: Math.round(totalCommission),       // commission + bonus
        totalCommissionRaw: Math.round(totalCommissionRaw), // commission only (dùng ADS/HH)
        totalBonus: Math.round(totalBonus),
        totalClickSP,
        totalRoas: Math.round(totalRoas * 100) / 100,
        totalTax,
        totalOfficeExpense: officeExp,
        officeExpenseCount: (officeExpenseSum as any)?._count || 0,
        realProfit,                                          // server-side pre-computed (P4.2)
        isFullRange,                                         // client hiển thị conditional
        adAccountCount: groupCards.reduce((s, g) => s + g.adAccounts.length, 0),
        shopeeCount: groupCards.reduce((s, g) => s + g.shopees.length, 0),
        adAccountActive: groupCards.reduce((s, g) => s + g.adAccounts.filter((a) => a.status === "ON").length, 0),
        groupsWithTax: groupCards.filter((g) => g.tax).length,
        groupsWithoutTax: groupCards.filter((g) => !g.tax).length,
      },
      fromDate: fromStr,
      toDate: toStr,
    })
  } catch (e: any) {
  return safeError(e, "dashboard")
}
}
