const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  // Lấy tất cả posts thiếu pageId
  const orphans = await prisma.post.findMany({
    where: { pageId: null },
    select: { id: true, fbId: true, userId: true },
  })
  console.log(`Tìm thấy ${orphans.length} posts chưa có pageId`)

  if (orphans.length === 0) return

  // Lấy tất cả FanPage để map FB pageId → DB id (per user)
  const allPages = await prisma.fanPage.findMany({ select: { id: true, pageId: true, userId: true } })
  const pageMap = new Map() // key = userId|fbPageId → dbId
  for (const p of allPages) pageMap.set(p.userId + "|" + p.pageId, p.id)

  let fixed = 0
  let skipped = 0
  for (const post of orphans) {
    // post.fbId thường có format "{fbPageId}_{fbPostId}"
    const parts = post.fbId.split("_")
    if (parts.length < 2) { skipped++; continue }
    const fbPageId = parts[0]
    const dbPageId = pageMap.get(post.userId + "|" + fbPageId)
    if (!dbPageId) { skipped++; continue }
    await prisma.post.update({ where: { id: post.id }, data: { pageId: dbPageId } })
    fixed++
  }

  console.log(`✅ Fixed: ${fixed} posts`)
  console.log(`⚠ Skipped: ${skipped} posts (không tìm thấy FanPage tương ứng — Fanpage có thể đã bị xoá)`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
