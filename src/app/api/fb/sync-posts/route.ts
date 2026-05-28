import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { getFbToken } from "@/lib/token-store"
import { verifyCronSecret } from "@/lib/cron-auth"
import { fixFanpageForUser } from "@/lib/fix-fanpage"

export const runtime = "nodejs"
export const maxDuration = 300 // 5 phút (Railway/Vercel có thể giới hạn — mặc định 60s gây timeout với nhiều fanpage)

const FB_VER = "v19.0"
const DEFAULT_SINCE = new Date("2026-04-29T00:00:00+07:00") // Mốc seed lần đầu nếu DB chưa có post nào

async function syncUserPosts(userId: string) {
  const token = await getFbToken(userId)
  if (!token) return { ok: false, error: "No token" }
  if (token.expiresAt && token.expiresAt < new Date()) return { ok: false, error: "Token expired" }

  const pages = await prisma.fanPage.findMany({ where: { userId } })
  if (!pages.length) return { ok: false, error: "No pages" }

  // Lấy post mới nhất per page để biết "since" cho incremental sync.
  const latestPerPage = await prisma.post.groupBy({
    by: ["pageId"],
    where: { userId, pageId: { not: null } },
    _max: { postedAt: true },
  })
  const latestByPageId = new Map<string, Date>()
  for (const r of latestPerPage) {
    if (r.pageId && r._max.postedAt) latestByPageId.set(r.pageId, r._max.postedAt)
  }

  const fbToken = token.longToken
  const untilTs = Math.floor(Date.now() / 1000)
  const errors: string[] = []
  let totalNew = 0

  // Fetch ALL page tokens trong 1 call (thay vì N calls per page).
  // /me/accounts trả về { data: [{ id, name, access_token }] }
  const pageTokenMap = new Map<string, string>()
  try {
    const meAccRes = await fetch(`https://graph.facebook.com/${FB_VER}/me/accounts?fields=id,access_token&limit=200&access_token=${fbToken}`)
    const meAccData: any = await meAccRes.json()
    if (Array.isArray(meAccData?.data)) {
      for (const p of meAccData.data) {
        if (p.id && p.access_token) pageTokenMap.set(String(p.id), String(p.access_token))
      }
    } else if (meAccData?.error) {
      errors.push(`/me/accounts: ${meAccData.error.message}`)
    }
  } catch (e: any) {
    errors.push(`/me/accounts fetch fail: ${e?.message?.slice(0, 100)}`)
  }

  // FB Batch API: 1 HTTP request, server-side process N sub-requests song song.
  // Max 50 per batch. 14 fanpage thoải mái trong 1 batch.
  // Trade-off: nếu 1 sub-request fail, sub-request khác vẫn ok — không block.
  async function fetchPostsViaBatch() {
    const subRequests = pages.map((page) => {
      const lastDate = latestByPageId.get(page.id)
      const sinceDate = lastDate ? new Date(lastDate.getTime() + 1000) : DEFAULT_SINCE
      const sinceTs = Math.floor(sinceDate.getTime() / 1000)
      if (sinceTs >= untilTs) return null
      const pageToken = pageTokenMap.get(page.pageId) || fbToken
      return {
        method: "GET",
        relative_url: `${page.pageId}/posts?fields=id,message,story,created_time&since=${sinceTs}&until=${untilTs}&limit=100&access_token=${encodeURIComponent(pageToken)}`,
        _pageRef: page, // attach để map response → page
      }
    })
    const validRequests = subRequests.filter(Boolean) as Array<NonNullable<typeof subRequests[0]>>
    if (validRequests.length === 0) return new Map<string, any[]>()

    const formData = new URLSearchParams()
    formData.set("access_token", fbToken)
    formData.set("batch", JSON.stringify(validRequests.map(({ method, relative_url }) => ({ method, relative_url }))))

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 25000) // batch có thể chậm hơn single
    let res: Response
    try {
      res = await fetch(`https://graph.facebook.com/${FB_VER}/`, { method: "POST", body: formData, signal: ctrl.signal })
    } catch (e: any) {
      clearTimeout(timer)
      errors.push(`Batch API timeout/network`)
      return new Map<string, any[]>()
    }
    clearTimeout(timer)
    const arr: any[] = await res.json()
    if (!Array.isArray(arr)) {
      errors.push(`Batch API trả format lạ: ${JSON.stringify(arr).slice(0, 200)}`)
      return new Map<string, any[]>()
    }

    // Map page.id → posts data của page đó
    const postsByPageDbId = new Map<string, any[]>()
    for (let i = 0; i < arr.length; i++) {
      const subRes = arr[i]
      const page = validRequests[i]._pageRef
      if (!subRes || subRes.code !== 200) {
        const errMsg = subRes?.body ? JSON.parse(subRes.body)?.error?.message || "" : ""
        errors.push(`${page.name}: ${errMsg || `HTTP ${subRes?.code}`}`)
        continue
      }
      try {
        const body = JSON.parse(subRes.body)
        postsByPageDbId.set(page.id, body?.data || [])
      } catch {
        errors.push(`${page.name}: parse body fail`)
      }
    }
    return postsByPageDbId
  }

  // Process từng page sau khi đã có posts từ batch
  async function syncOnePage(page: typeof pages[0], postsData: any[]): Promise<{ newCount: number }> {
    const candidates: any[] = []
    for (const post of postsData) {
      const text = post.message || post.story || ""
      const shopeeMatch = text.match(/https?:\/\/(s\.shopee\.vn|shope\.ee|shopee\.vn)\/[\w\-\/?.=&%]+/i)
      if (!shopeeMatch) continue
      candidates.push({
        fbId: post.id,
        pageDbId: page.id,
        name: text.slice(0, 200),
        link: shopeeMatch[0].trim(),
        postedAt: new Date(post.created_time),
        userId,
      })
    }

    if (!candidates.length) return { newCount: 0 }

    const existing = await prisma.post.findMany({
      where: { userId, fbId: { in: candidates.map((c) => c.fbId) } },
      select: { fbId: true },
    })
    const existingSet = new Set(existing.map((e) => e.fbId))
    const toInsert = candidates.filter((c) => !existingSet.has(c.fbId))

    if (toInsert.length > 0) {
      await prisma.post.createMany({
        data: toInsert.map((c) => ({
          userId: c.userId,
          fbId: c.fbId,
          name: c.name,
          link: c.link,
          pageId: c.pageDbId,
          postedAt: c.postedAt,
        })),
      })
    }
    return { newCount: toInsert.length }
  }

  // Fetch posts qua FB Batch API (1 HTTP request thay vì N)
  const postsByPageDbId = await fetchPostsViaBatch()

  // Process từng page (DB writes parallel)
  const results: PromiseSettledResult<{ newCount: number }>[] = await Promise.allSettled(
    pages.map((page) => syncOnePage(page, postsByPageDbId.get(page.id) || []))
  )
  // Detect rate limit từ errors batch
  const rateLimited = errors.some(e => /Application request limit|rate limit|\(#4\)|\(#17\)|\(#32\)/i.test(e))
  if (rateLimited) {
    errors.unshift("⚠ FB Rate Limit: app đã gọi quá nhiều request. Đợi ~1h rồi thử lại, hoặc giảm số fanpage.")
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === "fulfilled") totalNew += r.value.newCount
    else errors.push(`${pages[i].name}: ${r.reason?.message || r.reason}`)
  }

  // Auto fix-fanpage sau khi sync xong: backfill pageId cho posts có pageId null/orphan.
  // Query đã optimize (WHERE filter) → 0 rows return cực rẻ. Lỗi không block sync result.
  let fanpageFixed = 0
  try {
    const fixR = await fixFanpageForUser(userId)
    fanpageFixed = fixR.fixed
    if (fixR.fixed > 0) {
      console.log(`[SYNC-POSTS] User ${userId}: auto-fixed ${fixR.fixed} posts (pageId backfill)`)
    }
  } catch (e: any) {
    console.warn(`[SYNC-POSTS] User ${userId}: fix-fanpage fail (non-blocking) - ${e?.message?.slice(0, 100)}`)
  }

  return { ok: true, totalNew, errors, pagesCount: pages.length, fanpageFixed }
}

export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth()
    const dbUser = await prisma.user.findUnique({ where: { id: user.userId } })
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 401 })
    const result = await syncUserPosts(dbUser.id)
    return NextResponse.json(result)
  } catch (e: any) {
  return safeError(e, "fb/sync-posts")
}
}

export async function POST(req: NextRequest) {
  try {
    if (!verifyCronSecret(req.headers.get("x-cron-secret"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const tokens = await prisma.fbToken.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { userId: true },
    })

    // Cron: sync nhiều user cũng song song, nhưng giới hạn 3 user 1 lúc để không quá tải FB.
    const CONC = 3
    const results: any[] = []
    for (let i = 0; i < tokens.length; i += CONC) {
      const batch = tokens.slice(i, i + CONC)
      const batchRes = await Promise.all(batch.map(async ({ userId }) => {
        const r = await syncUserPosts(userId)
        return { userId, ...r }
      }))
      results.push(...batchRes)
    }

    return NextResponse.json({ ok: true, syncedUsers: tokens.length, results, timestamp: new Date().toISOString() })
  } catch (e: any) {
  return safeError(e, "fb/sync-posts")
}
}
