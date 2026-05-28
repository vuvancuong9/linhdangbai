const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const total = await prisma.affiliateCommissionDaily.count()
  // Xóa hẳn các row chỉ có click (commission=0, orderCount=0) để dọn data rác.
  const onlyClicks = await prisma.affiliateCommissionDaily.deleteMany({
    where: { commission: 0, orderCount: 0 },
  })
  // Reset clickCount của các row có commission về 0.
  const reset = await prisma.affiliateCommissionDaily.updateMany({
    where: { OR: [{ commission: { not: 0 } }, { orderCount: { not: 0 } }] },
    data: { clickCount: 0 },
  })
  console.log(`Tổng row trước: ${total}`)
  console.log(`Đã xoá row chỉ có click (không có commission): ${onlyClicks.count}`)
  console.log(`Đã reset clickCount=0 cho row có commission: ${reset.count}`)
  const after = await prisma.affiliateCommissionDaily.count()
  console.log(`Còn lại: ${after} row (data commission được giữ nguyên)`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
