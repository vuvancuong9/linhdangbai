import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { fetchSheetCSV } from "@/lib/sheet"

export const runtime = "nodejs"
export const maxDuration = 60

// Cache rows mapping theo userId — TTL 5 phút.
type CachedMapping = { rows: Array<{ link: string; campName: string }>; ts: number }
const mappingCache = new Map<string, CachedMapping>()
const CACHE_TTL = 5 * 60 * 1000

async function getMappingRows(userId: string): Promise<Array<{ link: string; campName: string }>> {
  const cached = mappingCache.get(userId)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.rows
  const sheets = await prisma.sheetMapping.findMany({ where: { userId } })
  const allRows: Array<{ link: string; campName: string }> = []
  for (const s of sheets) {
    try {
      const rows = await fetchSheetCSV(s.sheetUrl)
      allRows.push(...rows)
    } catch {}
  }
  mappingCache.set(userId, { rows: allRows, ts: Date.now() })
  return allRows
}

// GET /api/posts/search-by-name?q=R0704N08
// Tìm Post tương ứng với tên camp X qua 2 nguồn:
//
// SOURCE 1 — CampLog (chính xác nhất):
//   CampLog lưu mỗi lần tạo camp với `campName` plain string + `postId`.
//   Camp bị xoá vẫn còn log → tra `campName=X` trực tiếp ra postId.
//
// SOURCE 2 — Sheet Mapping (fallback nếu CampLog không có):
//   Đọc rows [link Shopee, tên camp] từ Google Sheet, filter campName=X,
//   match Post.link CONTAINS link đó.
//
// Combine + dedupe theo Post.id → trả unique Posts.
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get("q") || "").trim()
    if (!q || q.length < 2) {
      return NextResponse.json({ error: "Keyword phải ≥2 ký tự" }, { status: 400 })
    }

    // Chạy SONG SONG 2 source — total time = max(CampLog, Sheet) thay vì sum.
    // CampLog priority cao hơn (chính xác hơn) nhưng cả 2 đều run, KHÔNG block lẫn nhau.
    const [logs, sheetResult] = await Promise.all([
      // SOURCE 1: CampLog (instant DB query)
      prisma.campLog.findMany({
        where: {
          userId: user.userId,
          campName: { equals: q, mode: "insensitive" },
          postId: { not: null },
        },
        select: { postId: true },
        distinct: ["postId"],
      }),
      // SOURCE 2: Sheet Mapping (slow nếu cache miss — fetch Google Sheet)
      (async () => {
        const allRows = await getMappingRows(user.userId)
        const matchedLinks = Array.from(new Set(
          allRows.filter((r) => r.campName.toLowerCase() === q.toLowerCase()).map((r) => r.link)
        ))
        if (matchedLinks.length === 0) return { posts: [] as Array<{ id: string }>, rowsCount: allRows.length, matchedLinks }
        const sheetPosts = await prisma.post.findMany({
          where: {
            userId: user.userId,
            deleted: false,
            OR: matchedLinks.map((link) => ({ link: { contains: link } })),
          },
          select: { id: true },
        })
        return { posts: sheetPosts, rowsCount: allRows.length, matchedLinks }
      })(),
    ])

    const postIdSet = new Set<string>()
    const sourcesByPostId = new Map<string, string[]>() // postId → ["camplog", "sheet"]

    // Apply CampLog FIRST (priority) — overlap với sheet sẽ có cả 2 source
    for (const l of logs) {
      if (l.postId) {
        postIdSet.add(l.postId)
        sourcesByPostId.set(l.postId, ["camplog"])
      }
    }
    for (const p of sheetResult.posts) {
      if (!postIdSet.has(p.id)) sourcesByPostId.set(p.id, ["sheet"])
      else sourcesByPostId.get(p.id)!.push("sheet")
      postIdSet.add(p.id)
    }
    const allRowsLen = sheetResult.rowsCount
    const matchedLinks = sheetResult.matchedLinks

    if (postIdSet.size === 0) {
      return NextResponse.json({
        ok: true,
        total: 0,
        posts: [],
        note: `Không tìm thấy "${q}" trong CampLog (${logs.length} match) hoặc Sheet Mapping (${allRowsLen} rows quét).`,
      })
    }

    // Fetch Post details
    const posts = await prisma.post.findMany({
      where: { id: { in: Array.from(postIdSet) }, userId: user.userId, deleted: false },
      orderBy: { postedAt: "desc" },
      select: {
        id: true,
        fbId: true,
        name: true,
        link: true,
        postedAt: true,
        campaignId: true,
        adCreated: true,
        page: { select: { name: true, pageId: true, accountId: true } },
      },
      take: 100,
    })

    // Inject source info
    const postsWithSource = posts.map((p) => ({ ...p, _sources: sourcesByPostId.get(p.id) || [] }))

    return NextResponse.json({
      ok: true,
      total: postsWithSource.length,
      posts: postsWithSource,
      campLogCount: logs.length,
      sheetLinksMatched: matchedLinks.length,
    })
  } catch (e: any) {
  return safeError(e, "posts/search-by-name")
}
}
