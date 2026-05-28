// prisma/seed.ts
import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Tạo admin
  const adminPwd = await bcrypt.hash('123456', 10)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@fb.com' },
    update: {},
    create: {
      name: 'Nguyễn Trọng Quy',
      email: 'admin@fb.com',
      password: adminPwd,
      role: Role.ADMIN,
    },
  })

  // Tạo admin 2
  const admin2 = await prisma.user.upsert({
    where: { email: 'admin2@fb.com' },
    update: {},
    create: {
      name: 'Trần Thị Mai',
      email: 'admin2@fb.com',
      password: adminPwd,
      role: Role.ADMIN,
    },
  })

  // Tạo user
  const userPwd = await bcrypt.hash('123456', 10)
  const user = await prisma.user.upsert({
    where: { email: 'user@fb.com' },
    update: {},
    create: {
      name: 'Lê Văn User',
      email: 'user@fb.com',
      password: userPwd,
      role: Role.USER,
    },
  })

  // Seed tài khoản ads cho admin
  await prisma.adAccount.createMany({
    skipDuplicates: true,
    data: [
      { name: 'Nguyễn Store - Chính', actId: 'act_2847361920', status: 'ON', budget: 100000, userId: admin.id },
      { name: 'Brand Vietnam QC', actId: 'act_9182736450', status: 'ON', budget: 500000, userId: admin.id },
      { name: 'Backup Account', actId: 'act_5019283746', status: 'ERROR', budget: 0, userId: admin.id },
    ],
  })

  // Seed fanpage cho admin
  await prisma.fanPage.createMany({
    skipDuplicates: true,
    data: [
      { name: 'Nguyễn Store Official', pageId: '107382940162', category: 'Cửa hàng bán lẻ', userId: admin.id },
      { name: 'Vietnam Tech News', pageId: '203847561029', category: 'Công nghệ & khoa học', userId: admin.id },
      { name: 'Ẩm thực Việt Nam', pageId: '364829105738', category: 'Nhà hàng', userId: admin.id },
    ],
  })

  // Seed tài khoản ads cho user
  await prisma.adAccount.createMany({
    skipDuplicates: true,
    data: [
      { name: 'TechShop Media', actId: 'act_7364829105', status: 'ON', budget: 200000, userId: user.id },
    ],
  })

  await prisma.fanPage.createMany({
    skipDuplicates: true,
    data: [
      { name: 'TechShop Vietnam', pageId: '495018273640', category: 'Cửa hàng điện tử', userId: user.id },
    ],
  })

  console.log('✅ Seed hoàn tất!')
  console.log(`   Admin: admin@fb.com / 123456`)
  console.log(`   Admin: admin2@fb.com / 123456`)
  console.log(`   User:  user@fb.com / 123456`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
