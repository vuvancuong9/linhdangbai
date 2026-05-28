import { prisma } from "./prisma"
import { getFbToken } from "./token-store"

const FB_VER = "v19.0"
// Server: xu ly 3 post song song / chunk + sleep 500ms giua batches.
// FB user-level rate limit ~200 calls/hour. Moi post = 4 FB calls (camp+adset+creative+ad)
// = max 12 calls/batch × 60 batches/hour = 720 calls/hour neu lien tuc.
// Voi sleep 500ms + 3 concurrent: ~6 batches/second × 4 calls = 24 calls/s peak nhung
// distributed → safe duoi 200/hour quota.
const POST_CONCURRENCY = 3
const BATCH_SLEEP_MS = 500

// Module-level page-token cache, persist cross-request (cron + manual API).
// Key = `${userId}|${pageFbId}` (user-token differs per user, ko share giữa user khác).
// TTL 1h → page token loại "page_access_token" ngắn hạn vẫn live ~1h-vài giờ.
// Lý do persist: cron auto-camp chạy mỗi đầu giờ + bulk create user click cùng page
// → tiết kiệm 1 FB call/page/lần (giảm rate limit pressure 200/h).
const PAGE_TOKEN_TTL_MS = 60 * 60 * 1000
const pageTokenCacheGlobal = new Map<string, { token: string; expiresAt: number }>()

export type CreateCampConfig = {
  objective?: string
  budget?: number
  bidStrategy?: string
  bidAmount?: number
  ageMin?: number
  ageMax?: number
  gender?: "all" | "male" | "female"
  country?: string
  optimizationGoal?: string
  billingEvent?: string
}

export type CreateCampResult = {
  ok: boolean
  totalRequested: number
  success: number
  failed: number
  results: Array<{ postId: string; ok: boolean; campaignFbId?: string; error?: string }>
  error?: string
}

export type CreateCampOpts = {
  userId: string
  accountId: string
  postIds: string[]
  config: CreateCampConfig
}

// Logic chinh tao campaign cho 1 batch posts cua 1 user.
// Duoc goi tu API /api/fb/create-campaign (manual) va cron auto-camp.
//
// Validate:
//  - User co FB token
//  - AdAccount thuoc user
//  - Moi post.page co accountId va khop voi accountId arg
// Xu ly: chia POST_CONCURRENCY parallel, moi post chay 4 FB API calls + DB updates.
export async function createCampaignsForBatch(opts: CreateCampOpts): Promise<CreateCampResult> {
  const { userId, accountId, postIds, config } = opts

  if (!accountId) return errResult(postIds.length, "Thieu accountId")
  if (!Array.isArray(postIds) || postIds.length === 0) return errResult(0, "Thieu postIds")
  if (!config) return errResult(postIds.length, "Thieu config")

  const tokenRec = await getFbToken(userId)
  if (!tokenRec) return errResult(postIds.length, "Chua cau hinh FB token")
  const token = tokenRec.longToken

  const account = await prisma.adAccount.findFirst({ where: { id: accountId, userId } })
  if (!account) return errResult(postIds.length, "Tai khoan ads khong hop le")

  const posts = await prisma.post.findMany({
    where: { id: { in: postIds }, userId, campaignId: { not: null }, deleted: false },
    include: {
      campaign: { select: { id: true, name: true } },
      page: { select: { id: true, name: true, pageId: true, accountId: true } },
    },
  })
  if (posts.length === 0) return errResult(postIds.length, "Khong co post nao co ten Campaign")

  const unassignedPages = new Set<string>()
  const mismatchPages = new Map<string, string>()
  const accNameCache = new Map<string, string>()
  for (const p of posts) {
    if (!p.page) continue
    if (!p.page.accountId) {
      unassignedPages.add(p.page.name)
      continue
    }
    if (p.page.accountId !== accountId) {
      let name = accNameCache.get(p.page.accountId)
      if (!name) {
        const a = await prisma.adAccount.findUnique({ where: { id: p.page.accountId }, select: { name: true } })
        name = a?.name || "(?)"
        accNameCache.set(p.page.accountId, name)
      }
      mismatchPages.set(p.page.name, name)
    }
  }
  if (unassignedPages.size > 0) {
    return errResult(posts.length, `Page chua chi dinh TKQC: ${Array.from(unassignedPages).join(", ")}. Vao "Cau hinh Page → TKQC" de gan.`)
  }
  if (mismatchPages.size > 0) {
    const lines = Array.from(mismatchPages.entries()).map(([pg, acc]) => `${pg} → ${acc}`).join("; ")
    return errResult(posts.length, `TKQC chon khong khop voi page: ${lines}. Doi TKQC hoac sua cau hinh.`)
  }

  const objective = String(config.objective || "OUTCOME_TRAFFIC")
  const budget = Math.max(1000, Math.round(Number(config.budget) || 100000))
  const bidStrategy = String(config.bidStrategy || "LOWEST_COST_WITHOUT_CAP")
  const bidAmount = Number(config.bidAmount) || 0
  const ageMin = Math.max(13, Math.min(65, Number(config.ageMin) || 18))
  const ageMax = Math.max(ageMin, Math.min(65, Number(config.ageMax) || 65))
  const genderRaw = String(config.gender || "all")
  const genders = genderRaw === "male" ? [1] : genderRaw === "female" ? [2] : undefined
  const country = String(config.country || "VN")
  const optimizationGoal = String(config.optimizationGoal || "LINK_CLICKS")
  const billingEvent = String(config.billingEvent || "IMPRESSIONS")

  const actPath = account.actId.startsWith("act_") ? account.actId : `act_${account.actId}`
  const baseUrl = `https://graph.facebook.com/${FB_VER}/${actPath}`

  const odaxToLegacy: Record<string, string> = {
    OUTCOME_TRAFFIC: "LINK_CLICKS",
    OUTCOME_ENGAGEMENT: "POST_ENGAGEMENT",
    OUTCOME_AWARENESS: "REACH",
    OUTCOME_LEADS: "LEAD_GENERATION",
    OUTCOME_SALES: "CONVERSIONS",
    OUTCOME_APP_PROMOTION: "APP_INSTALLS",
  }
  const legacyToOdax: Record<string, string> = Object.fromEntries(
    Object.entries(odaxToLegacy).map(([odax, leg]) => [leg, odax])
  )

  // Cache page access token: subcode 1487472 thường do user_token thiếu quyền promote post.
  // Page token có quyền đầy đủ trên post của page đó → fix error này.
  // Cache persist cross-request qua `pageTokenCacheGlobal` (module-level, TTL 1h) +
  // local Map cho error logging trong 1 batch.
  const pageTokenDebug = new Map<string, string>() // For error logging
  async function getPageToken(pageFbId: string): Promise<string | null> {
    if (!pageFbId) return null
    const ck = `${userId}|${pageFbId}`
    const cached = pageTokenCacheGlobal.get(ck)
    if (cached && cached.expiresAt > Date.now()) return cached.token
    try {
      const r = await fetch(`https://graph.facebook.com/${FB_VER}/${pageFbId}?fields=access_token&access_token=${encodeURIComponent(token)}`)
      const j: any = await r.json()
      if (j?.access_token) {
        pageTokenCacheGlobal.set(ck, { token: j.access_token, expiresAt: Date.now() + PAGE_TOKEN_TTL_MS })
        pageTokenDebug.set(pageFbId, "ok")
        return j.access_token
      }
      pageTokenDebug.set(pageFbId, `no_token: ${JSON.stringify(j).slice(0, 200)}`)
    } catch (e: any) {
      pageTokenDebug.set(pageFbId, `exception: ${e?.message || e}`.slice(0, 200))
    }
    return null
  }

  const fbErr = (prefix: string, data: any): string => {
    const e = data?.error
    if (!e) return prefix + ": unknown"
    const parts = [e.message]
    if (e.error_user_msg) parts.push(e.error_user_msg)
    if (e.error_user_title) parts.unshift(e.error_user_title)
    if (e.error_subcode) parts.push(`subcode ${e.error_subcode}`)
    return prefix + ": " + parts.filter(Boolean).join(" — ")
  }

  async function processOnePost(post: any): Promise<{ postId: string; ok: boolean; campaignFbId?: string; error?: string }> {
    const campName = post.campaign?.name || `Camp_${post.fbId}`
    try {
      const tryCreateCamp = async (obj: string) => {
        const p = new URLSearchParams()
        p.set("name", campName)
        p.set("objective", obj)
        p.set("status", "ACTIVE")
        p.set("special_ad_categories", "[]")
        p.set("buying_type", "AUCTION")
        p.set("daily_budget", String(budget))
        p.set("bid_strategy", bidStrategy)
        p.set("access_token", token)
        const r = await fetch(`${baseUrl}/campaigns`, { method: "POST", body: p })
        return { res: r, data: await r.json() }
      }
      let { data: campData } = await tryCreateCamp(objective)
      const fallback = legacyToOdax[objective]
      if (campData?.error && fallback) {
        const retry = await tryCreateCamp(fallback)
        campData = retry.data
      }
      if (campData?.error || !campData?.id) {
        throw new Error(fbErr("Campaign", campData))
      }
      const campaignFbId = campData.id

      const targeting: any = {
        geo_locations: { countries: [country] },
        age_min: ageMin,
        age_max: ageMax,
        targeting_automation: { advantage_audience: 0 },
        // Vị trí quảng cáo thủ công (KHÔNG Advantage+ auto, KHÔNG Instagram/Audience Network/Messenger).
        // Match config user manual trong Ads Manager (2026-05-14):
        //   - Bảng feed → "feed"
        //   - Tin, Trạng thái, Reels → "story" + "facebook_reels"
        //   - Quảng cáo trong luồng cho thước phim → "instream_video"
        //   - Kết quả tìm kiếm → "search"
        // Thiết bị: tất cả (mobile + desktop).
        publisher_platforms: ["facebook"],
        facebook_positions: ["feed", "story", "facebook_reels", "instream_video", "search"],
        device_platforms: ["mobile", "desktop"],
      }
      if (genders) targeting.genders = genders

      const adsetParams = new URLSearchParams()
      adsetParams.set("name", campName)
      adsetParams.set("campaign_id", campaignFbId)
      adsetParams.set("billing_event", billingEvent)
      adsetParams.set("optimization_goal", optimizationGoal)
      if (bidStrategy !== "LOWEST_COST_WITHOUT_CAP" && bidAmount > 0) {
        adsetParams.set("bid_amount", String(Math.round(bidAmount)))
      }
      adsetParams.set("targeting", JSON.stringify(targeting))
      adsetParams.set("status", "ACTIVE")
      adsetParams.set("start_time", new Date().toISOString())
      adsetParams.set("access_token", token)
      const adsetRes = await fetch(`${baseUrl}/adsets`, { method: "POST", body: adsetParams })
      const adsetData: any = await adsetRes.json()
      if (adsetData.error || !adsetData.id) {
        throw new Error(fbErr("AdSet", adsetData))
      }
      const adsetFbId = adsetData.id

      // Page token fallback: subcode 1487472 thường do user_token thiếu quyền promote post.
      const pageFbId = post.page?.pageId
      const pageToken = pageFbId ? await getPageToken(pageFbId) : null
      const tokenDebug = pageFbId ? (pageTokenDebug.get(pageFbId) || "unknown") : "no_pageId"
      const creativeToken = pageToken || token

      const creativeParams = new URLSearchParams()
      creativeParams.set("name", campName)
      creativeParams.set("object_story_id", post.fbId)
      creativeParams.set("access_token", creativeToken)
      const creativeRes = await fetch(`${baseUrl}/adcreatives`, { method: "POST", body: creativeParams })
      const creativeData: any = await creativeRes.json()

      if (creativeData.error || !creativeData.id) {
        // Log full FB error để debug subcode 1487472
        const fullErr = JSON.stringify(creativeData?.error || {}).slice(0, 400)
        const debugCtx = `[pageId=${pageFbId || "?"}, fbId=${post.fbId}, pageToken=${tokenDebug}]`

        // Nếu chưa dùng page token (chưa fetch được) → đã là user token rồi, throw luôn
        // Nếu đã dùng page token → fallback retry user token
        if (pageToken) {
          creativeParams.set("access_token", token)
          const retry = await fetch(`${baseUrl}/adcreatives`, { method: "POST", body: creativeParams })
          const retryData: any = await retry.json()
          if (retryData.error || !retryData.id) {
            const retryErr = JSON.stringify(retryData?.error || {}).slice(0, 400)
            throw new Error(`Creative fail: ${fbErr("page-token", creativeData)} | retry user-token: ${fbErr("user-token", retryData)} ${debugCtx} | raw_page=${fullErr} | raw_user=${retryErr}`)
          }
          creativeData.id = retryData.id
        } else {
          throw new Error(`Creative fail: ${fbErr("user-token", creativeData)} ${debugCtx} | raw=${fullErr}`)
        }
      }
      const creativeFbId = creativeData.id

      const adParams = new URLSearchParams()
      adParams.set("name", campName)
      adParams.set("adset_id", adsetFbId)
      adParams.set("creative", JSON.stringify({ creative_id: creativeFbId }))
      adParams.set("status", "ACTIVE")
      // Thử page token trước (post promotion thường yêu cầu page-level token)
      adParams.set("access_token", pageToken || token)
      const adRes = await fetch(`${baseUrl}/ads`, { method: "POST", body: adParams })
      const adData: any = await adRes.json()
      if (adData.error || !adData.id) {
        const adFullErr = JSON.stringify(adData?.error || {}).slice(0, 500)
        const debugCtx = `[pageId=${pageFbId || "?"}, fbId=${post.fbId}, pageToken=${tokenDebug}, usedToken=${pageToken ? "page" : "user"}]`
        // Retry với token còn lại (đã thử page → retry user, hoặc đã thử user → throw)
        if (pageToken) {
          adParams.set("access_token", token)
          const retry = await fetch(`${baseUrl}/ads`, { method: "POST", body: adParams })
          const retryData: any = await retry.json()
          if (retryData.error || !retryData.id) {
            const retryErr = JSON.stringify(retryData?.error || {}).slice(0, 500)
            throw new Error(`Ad fail: ${fbErr("page-token", adData)} | retry user-token: ${fbErr("user-token", retryData)} ${debugCtx} | raw_page=${adFullErr} | raw_user=${retryErr}`)
          }
          adData.id = retryData.id
        } else {
          throw new Error(`Ad fail: ${fbErr("user-token", adData)} ${debugCtx} | raw=${adFullErr}`)
        }
      }

      if (post.campaignId) {
        await prisma.campaign.update({
          where: { id: post.campaignId },
          data: { campId: campaignFbId, status: "on", budget, adAccountId: account!.id, updatedAt: new Date() },
        }).catch(() => {})
      }
      await prisma.post.update({
        where: { id: post.id },
        data: { adCreated: true, adCreatedAt: new Date(), adError: null, adErrorAt: null, adErrorRetryCount: 0, adAccountId: account!.id },
      }).catch(() => {})
      await prisma.campLog.create({
        data: {
          userId,
          campaignId: post.campaignId,
          postId: post.id,
          postName: post.name?.slice(0, 200) || "",
          postFbId: post.fbId,
          pageName: post.page?.name || "",
          campName,
          campFbId: campaignFbId,
          status: "ok",
        },
      }).catch(() => {})

      return { postId: post.id, ok: true, campaignFbId }
    } catch (e: any) {
      const errMsg = e?.message || String(e)
      // Detect permanent failure: post FB đã bị xoá (1487790) hoặc post không eligible vĩnh viễn (1487475)
      // → set retry count = MAX để cron skip vĩnh viễn, tránh phí FB API quota cho post chết.
      // Subcodes phổ biến:
      //   1487790 - "Object invalid - đã xoá hoặc chưa bao giờ tạo"
      //   1487475 - "The post cannot be promoted" (vĩnh viễn, vd policy violation)
      const isPermanentFail = /subcode 1487790|subcode 1487475/i.test(errMsg)
      const { AUTO_CAMP_MAX_RETRY } = await import("./constants-server")
      try {
        await prisma.post.update({
          where: { id: post.id },
          data: {
            adError: errMsg.slice(0, 500),
            adErrorAt: new Date(),
            // Permanent fail → cap luôn ở MAX. Transient fail → increment +1.
            adErrorRetryCount: isPermanentFail ? AUTO_CAMP_MAX_RETRY : { increment: 1 },
          },
        })
        await prisma.campLog.create({
          data: {
            userId,
            campaignId: post.campaignId,
            postId: post.id,
            postName: post.name?.slice(0, 200) || "",
            postFbId: post.fbId,
            pageName: post.page?.name || "",
            campName,
            campFbId: "",
            status: "error",
            errorMsg: errMsg.slice(0, 500),
          },
        })
      } catch {}
      return { postId: post.id, ok: false, error: errMsg }
    }
  }

  const results: Array<{ postId: string; ok: boolean; campaignFbId?: string; error?: string }> = []
  for (let i = 0; i < posts.length; i += POST_CONCURRENCY) {
    const batch = posts.slice(i, i + POST_CONCURRENCY)
    const batchRes = await Promise.all(batch.map(processOnePost))
    results.push(...batchRes)
    // FB rate limit: sleep giữa batches để giảm peak QPS
    if (i + POST_CONCURRENCY < posts.length) await new Promise((res) => setTimeout(res, BATCH_SLEEP_MS))
  }

  const okCount = results.filter((r) => r.ok).length
  return {
    ok: true,
    totalRequested: posts.length,
    success: okCount,
    failed: results.length - okCount,
    results,
  }
}

function errResult(total: number, error: string): CreateCampResult {
  return { ok: false, totalRequested: total, success: 0, failed: total, results: [], error }
}
