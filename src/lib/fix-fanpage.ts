import { prisma } from "./prisma"

// Backfill pageId cho posts cũ:
//  - Posts có pageId null → suy ra từ fbId (format "{fbPageId}_{fbPostId}")
//  - Posts có pageId trỏ tới FanPage không còn tồn tại → cũng remap
// Logic dùng chung cho cả API manual và cron sync-posts auto-fix.
//
// PERF: Query CHỈ posts cần fix (pageId NULL OR NOT IN validIds) thay vì fetch toàn bộ
// posts của user — 99% lần chạy trả về 0 rows → gần như free, không tốn I/O Supabase.
export async function fixFanpageForUser(userId: string): Promise<{
  pagesInDb: number
  needFix: number
  fixed: number
  skipped: number
}> {
  const allPages = await prisma.fanPage.findMany({
    where: { userId },
    select: { id: true, pageId: true },
  })

  if (allPages.length === 0) {
    return { pagesInDb: 0, needFix: 0, fixed: 0, skipped: 0 }
  }

  const pageMap = new Map<string, string>()
  for (const p of allPages) pageMap.set(p.pageId, p.id)
  const validDbIds = allPages.map((p) => p.id)

  // Lấy CHỈ posts cần fix — đẩy filter xuống DB, không fetch toàn bộ.
  const needFix = await prisma.post.findMany({
    where: {
      userId,
      deleted: false,
      OR: [
        { pageId: null },
        { pageId: { notIn: validDbIds } },
      ],
    },
    select: { id: true, fbId: true, pageId: true },
  })

  if (needFix.length === 0) {
    return { pagesInDb: allPages.length, needFix: 0, fixed: 0, skipped: 0 }
  }

  let skipped = 0
  const updates: Array<{ id: string; newPageId: string }> = []
  for (const post of needFix) {
    if (!post.fbId) { skipped++; continue }
    const parts = post.fbId.split("_")
    if (parts.length < 2) { skipped++; continue }
    const fbPageId = parts[0]
    const dbPageId = pageMap.get(fbPageId)
    if (!dbPageId) { skipped++; continue }
    if (post.pageId === dbPageId) continue
    updates.push({ id: post.id, newPageId: dbPageId })
  }

  let fixed = 0
  if (updates.length > 0) {
    const byPageId = new Map<string, string[]>()
    for (const u of updates) {
      const arr = byPageId.get(u.newPageId) || []
      arr.push(u.id)
      byPageId.set(u.newPageId, arr)
    }
    const entries = Array.from(byPageId.entries())
    for (let i = 0; i < entries.length; i++) {
      const [pid, ids] = entries[i]
      const r = await prisma.post.updateMany({
        where: { id: { in: ids } },
        data: { pageId: pid },
      })
      fixed += r.count
    }
  }

  return {
    pagesInDb: allPages.length,
    needFix: needFix.length,
    fixed,
    skipped,
  }
}
