const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const before = await prisma.affiliateCommissionDaily.count()
  console.log(`Trước khi xoá: ${before} dòng`)
  const result = await prisma.affiliateCommissionDaily.deleteMany({})
  console.log(`Đã xoá: ${result.count} dòng`)
  const after = await prisma.affiliateCommissionDaily.count()
  console.log(`Còn lại: ${after} dòng`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
