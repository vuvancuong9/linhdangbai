const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  // Với mỗi user, nếu họ chỉ có 1 Shopee account → gán tất cả records null cho account đó.
  // Nếu có nhiều account → skip (user phải re-sync để có per-account data chính xác).
  const users = await prisma.user.findMany({
    include: { shopeeTokens: { select: { id: true, name: true } } },
  })
  let totalFilled = 0
  let skippedUsers = 0
  for (const u of users) {
    if (u.shopeeTokens.length === 1) {
      const accId = u.shopeeTokens[0].id
      const r = await prisma.affiliateCommissionDaily.updateMany({
        where: { userId: u.id, shopeeAccountId: null },
        data: { shopeeAccountId: accId },
      })
      if (r.count > 0) {
        console.log(`User ${u.id} (1 Shopee account "${u.shopeeTokens[0].name}"): backfill ${r.count} rows`)
        totalFilled += r.count
      }
    } else if (u.shopeeTokens.length > 1) {
      const orphan = await prisma.affiliateCommissionDaily.count({ where: { userId: u.id, shopeeAccountId: null } })
      if (orphan > 0) {
        console.log(`⚠ User ${u.id} có ${u.shopeeTokens.length} Shopee accounts, ${orphan} rows null — SKIP (cần xoá + re-sync)`)
        skippedUsers++
      }
    }
  }
  console.log(`\n✅ Đã backfill tổng: ${totalFilled} rows`)
  if (skippedUsers > 0) console.log(`⚠ Skip ${skippedUsers} user (nhiều Shopee accounts) — chạy clear-commission.js + Sync API thủ công`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
