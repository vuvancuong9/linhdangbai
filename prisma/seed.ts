// prisma/seed.ts
//
// Seed mẫu — ĐÃ GỠ các tài khoản demo công khai (admin@fb.com / admin2@fb.com / user@fb.com)
// để tránh bất kỳ ai biết file gốc có thể đăng nhập web bằng mật khẩu mặc định "123456".
//
// Nếu muốn tạo super admin lần đầu, dùng:
//   node scripts/promote-super-admin.js <email-cua-ban>
// (sau khi tự tạo user đó qua UI hoặc qua admin SQL).
//
// Hoặc set 4 biến môi trường rồi chạy `npm run db:seed`:
//   SEED_ADMIN_EMAIL    - email super admin
//   SEED_ADMIN_NAME     - tên hiển thị
//   SEED_ADMIN_PASSWORD - mật khẩu (≥10 ký tự, có chữ + số)
//   SEED_ADMIN_ROLE     - SUPER_ADMIN | ADMIN (default SUPER_ADMIN)

import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  const email = process.env.SEED_ADMIN_EMAIL
  const name = process.env.SEED_ADMIN_NAME || 'Admin'
  const password = process.env.SEED_ADMIN_PASSWORD
  const roleStr = (process.env.SEED_ADMIN_ROLE || 'SUPER_ADMIN').toUpperCase()
  const role = roleStr === 'ADMIN' ? Role.ADMIN : Role.SUPER_ADMIN

  if (!email || !password) {
    console.log('⚠️  Bỏ qua seed user — chưa set SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD.')
    console.log('   Set 2 env này rồi chạy lại nếu muốn tạo super admin từ seed.')
    return
  }

  if (password.length < 10) {
    throw new Error('SEED_ADMIN_PASSWORD phải ≥ 10 ký tự (chính sách mật khẩu app).')
  }

  const hashed = await bcrypt.hash(password, 10)
  const u = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name, email, password: hashed, role },
  })
  console.log(`✅ Seed user: ${u.email} (${u.role})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
