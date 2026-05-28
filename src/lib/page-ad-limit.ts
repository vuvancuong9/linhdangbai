/**
 * Page Ad Limit checker
 *
 * Background: FB applies an "ad limit per Page" (default 250 ads running + in review per page,
 * higher tiers for larger pages). UI exposed trong Ads Manager > Settings > Ad limit per Page.
 * Khi page vượt limit → ads mới không được approve.
 *
 * API endpoint: GET /act_{adAccountId}/ads_volume?page_id={pageId}&fields=...
 * Permission: ads_read (token user level đủ).
 *
 * Fields fetch:
 * - ads_running_or_in_review_count: TỔNG ads từ MỌI ad account chạy trên page.
 * - current_account_ads_running_or_in_review_count: ads từ ad account đang query.
 * - limit_on_ads_running_or_in_review: ngưỡng FB (250 default).
 *
 * "Ads từ TKQC khác" = total - current_account.
 *
 * Run cadence:
 * - Cron 6h sáng VN (cùng slot product-check Shopee).
 * - Manual trigger button "Sync ngay" trong UI /gioi-han-quang-cao.
 *
 * Concurrency: 3 user song song, 4 page song song / user. Throttle 200ms giữa page calls
 * → FB rate limit 200/h user-level: với 50 pages = 50 calls/sync, an toàn.
 */
import { prisma } from "./prisma"
import { getFbToken } from "./token-store"

const FB_VER = "v19.0"
const PAGE_CONC = 4
const USER_CONC = 3
const THROTTLE_MS = 200

type AdsVolumeData = {
  total: number
  currentAccount: number
  limit: number
}

export async function fetchPageAdLimitOne(
  pageFbId: string,
  actId: string,
  token: string,
): Promise<{ ok: true; data: AdsVolumeData } | { ok: false; error: string }> {
  const actPath = actId.startsWith("act_") ? actId : `act_${actId}`
  const fields = [
    "ads_running_or_in_review_count",
    "current_account_ads_running_or_in_review_count",
    "limit_on_ads_running_or_in_review",
  ].join(",")
  const url = `https://graph.facebook.com/${FB_VER}/${actPath}/ads_volume?page_id=${encodeURIComponent(pageFbId)}&fields=${fields}&access_token=${encodeURIComponent(token)}`
  try {
    const r = await fetch(url)
    const j: any = await r.json()
    if (j?.error) {
      const msg = (j.error.message || "FB API error").slice(0, 200)
      return { ok: false, error: `FB ${j.error.code || "?"}: ${msg}` }
    }
    // ads_volume trả về { data: [{ ... }] } — lấy row đầu.
    const row = Array.isArray(j?.data) ? j.data[0] : null
    if (!row) return { ok: false, error: "Empty response" }
    const total = Number(row.ads_running_or_in_review_count) || 0
    const currentAccount = Number(row.current_account_ads_running_or_in_review_count) || 0
    const limit = Number(row.limit_on_ads_running_or_in_review) || 0
    return { ok: true, data: { total, currentAccount, limit } }
  } catch (e: any) {
    return { ok: false, error: (e?.message || "network error").slice(0, 200) }
  }
}

/**
 * Run check cho 1 user — iterate FanPage có accountId, fetch + update.
 * Throttle PAGE_CONC parallel + sleep giữa batches.
 */
export async function runPageAdLimitForUser(userId: string): Promise<{
  total: number
  ok: number
  failed: number
  skipped: number
}> {
  const result = { total: 0, ok: 0, failed: 0, skipped: 0 }

  const tokenRec = await getFbToken(userId)
  if (!tokenRec) return result
  const token = tokenRec.longToken

  // Chỉ check page có accountId (đã gán TKQC) — page chưa gán không gọi được endpoint.
  const pages = await prisma.fanPage.findMany({
    where: { userId, accountId: { not: null }, isSelected: true },
    select: { id: true, pageId: true, accountId: true, account: { select: { actId: true } } },
  })
  result.total = pages.length

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  for (let i = 0; i < pages.length; i += PAGE_CONC) {
    const slice = pages.slice(i, i + PAGE_CONC)
    await Promise.all(slice.map(async (p) => {
      if (!p.account?.actId) {
        result.skipped++
        return
      }
      const res = await fetchPageAdLimitOne(p.pageId, p.account.actId, token)
      const now = new Date()
      if (res.ok === true) {
        result.ok++
        await prisma.fanPage.update({
          where: { id: p.id },
          data: {
            pageAdsTotal: res.data.total,
            pageAdsCurrentAccount: res.data.currentAccount,
            pageAdLimit: res.data.limit,
            pageAdLimitCheckedAt: now,
            pageAdLimitError: null,
          },
        }).catch(() => {})
      } else {
        result.failed++
        const errMsg = res.error
        await prisma.fanPage.update({
          where: { id: p.id },
          data: {
            pageAdLimitCheckedAt: now,
            pageAdLimitError: errMsg,
          },
        }).catch(() => {})
      }
    }))
    if (i + PAGE_CONC < pages.length) await sleep(THROTTLE_MS)
  }

  return result
}

/**
 * Cron runner — concurrency 3 user song song.
 * Trả về tổng stats cho log.
 */
export async function runPageAdLimitForAllUsers(): Promise<{
  users: number
  pagesChecked: number
  ok: number
  failed: number
}> {
  const users = await prisma.user.findMany({ select: { id: true } })
  let pagesChecked = 0
  let ok = 0
  let failed = 0
  for (let i = 0; i < users.length; i += USER_CONC) {
    const slice = users.slice(i, i + USER_CONC)
    const results = await Promise.all(slice.map(u => runPageAdLimitForUser(u.id).catch(() => null)))
    for (const r of results) {
      if (!r) continue
      pagesChecked += r.total
      ok += r.ok
      failed += r.failed
    }
  }
  return { users: users.length, pagesChecked, ok, failed }
}
