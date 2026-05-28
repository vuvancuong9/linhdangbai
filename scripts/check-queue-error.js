// Xem error chi tiet cua PostQueue jobs gan day.
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const items = await prisma.postQueue.findMany({
    orderBy: { updatedAt: "desc" },
    take: 5,
    include: {
      savedPost: { select: { sourceFbId: true, sourceUrl: true, mediaUrls: true } },
      user: { select: { name: true } },
    },
  })
  for (const it of items) {
    console.log("\n========================================")
    console.log("ID:", it.id)
    console.log("User:", it.user.name)
    console.log("Status:", it.status)
    console.log("RetryCount:", it.retryCount)
    console.log("UpdatedAt:", it.updatedAt.toLocaleString("vi-VN"))
    console.log("Source FB ID:", it.savedPost?.sourceFbId)
    console.log("Source URL:", it.savedPost?.sourceUrl)
    const media = JSON.parse(it.savedPost?.mediaUrls || "[]")
    console.log("Media URLs count:", media.length)
    if (media[0]) console.log("Media[0] sample:", media[0].slice(0, 150))
    console.log("Error FULL:", it.error)
  }
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
