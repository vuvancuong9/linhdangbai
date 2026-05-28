const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const total = await prisma.affiliateCommissionDaily.count()
  let withId = 0, withoutId = 0
  try {
    withId = await prisma.affiliateCommissionDaily.count({ where: { shopeeAccountId: { not: null } } })
    withoutId = await prisma.affiliateCommissionDaily.count({ where: { shopeeAccountId: null } })
  } catch (e) {
    console.error("⚠ Lỗi truy vấn shopeeAccountId — schema có thể chưa được push:", e.message)
    return
  }
  console.log(`Tổng row: ${total}`)
  console.log(`  - Có shopeeAccountId: ${withId}`)
  console.log(`  - KHÔNG có shopeeAccountId (data cũ): ${withoutId}`)

  if (withId > 0) {
    const sample = await prisma.affiliateCommissionDaily.findFirst({ where: { shopeeAccountId: { not: null } }, include: { shopeeAccount: { select: { name: true, appId: true } } } })
    console.log(`Sample record có account:`, JSON.stringify(sample, null, 2))
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
