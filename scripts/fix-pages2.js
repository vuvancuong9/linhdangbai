const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const allPages = await prisma.fanPage.findMany()
  console.log('All pages:', JSON.stringify(allPages.map(p => ({ id: p.id, name: p.name })), null, 2))

  const deleted = await prisma.fanPage.deleteMany({
    where: { name: { contains: 'TechShop' } }
  })
  console.log('Deleted:', deleted.count)
}

main().catch(console.error).finally(() => prisma.$disconnect())
