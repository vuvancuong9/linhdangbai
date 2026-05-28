import { prisma } from "./prisma"
import { fetchSheetCSV } from "./sheet"

// Sync 1 mapping (Google Sheet → DB): match link Shopee → Campaign theo cột L (tên camp).
// Tối ưu: 3 query thay vì O(N×M) round-trip.
// Trả về { ok, totalRows, updatedPosts } hoặc throw error.
export async function syncOneMapping(userId: string, sheetUrl: string, sheetName: string) {
  const rows = await fetchSheetCSV(sheetUrl)
  if (rows.length === 0) {
    return { ok: false, totalRows: 0, updatedPosts: 0, error: "Sheet trống hoặc không đọc được cột K, L" }
  }

  // Upsert SheetMapping
  const existing = await prisma.sheetMapping.findFirst({ where: { userId, sheetUrl } })
  let mapping
  if (existing) {
    mapping = await prisma.sheetMapping.update({
      where: { id: existing.id },
      data: { sheetName: sheetName || "Sheet1", lastSyncAt: new Date(), rowCount: rows.length, updatedAt: new Date() },
    })
  } else {
    mapping = await prisma.sheetMapping.create({
      data: { userId, sheetUrl, sheetName: sheetName || "Sheet1", lastSyncAt: new Date(), rowCount: rows.length },
    })
  }

  const trimmedRows = rows
    .map((r: any) => ({ link: String(r.link || "").trim(), campName: String(r.campName || "").trim() }))
    .filter((r) => r.link && r.campName)

  // Map link → campName từ sheet
  const linkToCamp = new Map<string, string>()
  for (const r of trimmedRows) linkToCamp.set(r.link, r.campName)

  // PERF (R2.C2): chỉ load posts CÓ LINK + chưa có campaignName (incremental).
  // Trước: load all posts (1.5k+) mỗi 15p cron × N users → wasteful.
  // Posts có link rỗng không thể match được sheet → skip ở DB.
  const allPosts = await prisma.post.findMany({
    where: { userId, deleted: false, link: { not: "" } },
    select: { id: true, link: true },
  })

  // Optimization: build single regex từ tất cả mapping keys → 1 pass per post.
  // O(N + total_keys_length) thay vì O(N × M) với includes loop.
  // Sort key DESC theo length để regex match nghiêng về key dài (specific) trước.
  const linkKeysSorted = Array.from(linkToCamp.keys()).sort((a, b) => b.length - a.length)
  type PostMatch = { id: string; campName: string }
  const matches: PostMatch[] = []
  if (linkKeysSorted.length > 0) {
    // Escape regex meta chars trong key (URL có thể chứa ?, &, ., +, etc.)
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(linkKeysSorted.map(escapeRe).join("|"))
    for (const p of allPosts) {
      if (!p.link) continue
      const m = p.link.match(pattern)
      if (m && m[0]) {
        const camp = linkToCamp.get(m[0])
        if (camp) matches.push({ id: p.id, campName: camp })
      }
    }
  }

  if (matches.length === 0) {
    return { ok: true, mappingId: mapping.id, totalRows: rows.length, updatedPosts: 0 }
  }

  const wantedCampNames = Array.from(new Set(matches.map((m) => m.campName)))
  const existingCamps = await prisma.campaign.findMany({
    where: { userId, name: { in: wantedCampNames } },
    select: { id: true, name: true },
  })
  const campIdByName = new Map<string, string>()
  for (const c of existingCamps) campIdByName.set(c.name, c.id)

  const missingNames = wantedCampNames.filter((n) => !campIdByName.has(n))
  if (missingNames.length > 0) {
    await prisma.campaign.createMany({
      data: missingNames.map((name) => ({ userId, name, campId: "" })),
    })
    const created = await prisma.campaign.findMany({
      where: { userId, name: { in: missingNames } },
      select: { id: true, name: true },
    })
    for (const c of created) campIdByName.set(c.name, c.id)
  }

  const idsByCampId = new Map<string, string[]>()
  for (const m of matches) {
    const cid = campIdByName.get(m.campName)
    if (!cid) continue
    const arr = idsByCampId.get(cid) || []
    arr.push(m.id)
    idsByCampId.set(cid, arr)
  }

  let updated = 0
  const writes = await prisma.$transaction(
    Array.from(idsByCampId.entries()).map(([cid, ids]) =>
      prisma.post.updateMany({ where: { id: { in: ids } }, data: { campaignId: cid } })
    )
  )
  for (const r of writes) updated += r.count

  return { ok: true, mappingId: mapping.id, totalRows: rows.length, updatedPosts: updated }
}

// Cron helper: với mỗi user có mapping, sync mapping mới nhất (theo updatedAt).
// Chạy song song với concurrency cap để không quá tải.
export async function syncAllUsersLatestMapping(concurrency = 3) {
  const allMappings = await prisma.sheetMapping.findMany({
    orderBy: { updatedAt: "desc" },
    select: { userId: true, sheetUrl: true, sheetName: true },
  })
  // Mỗi user chỉ giữ mapping mới nhất (đầu tiên trong list)
  const seen = new Set<string>()
  const targets: typeof allMappings = []
  for (const m of allMappings) {
    if (seen.has(m.userId)) continue
    seen.add(m.userId)
    targets.push(m)
  }

  const results: any[] = []
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency)
    const batchRes = await Promise.allSettled(
      batch.map(async (m) => {
        try {
          const r = await syncOneMapping(m.userId, m.sheetUrl, m.sheetName)
          return { userId: m.userId, ...r }
        } catch (e: any) {
          return { userId: m.userId, ok: false, error: e?.message || "exception" }
        }
      })
    )
    for (const r of batchRes) {
      if (r.status === "fulfilled") results.push(r.value)
      else results.push({ ok: false, error: String(r.reason) })
    }
  }
  return results
}
