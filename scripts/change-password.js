const { PrismaClient } = require("@prisma/client")
const bcrypt = require("bcryptjs")
const prisma = new PrismaClient()

const email = process.argv[2]
const newPassword = process.argv[3]

if (!email || !newPassword) {
  console.error("Usage: node scripts/change-password.js <email> <new-password>")
  console.error("Ví dụ: node scripts/change-password.js admin@fb.com matkhau-moi-123")
  process.exit(1)
}

async function main() {
  const u = await prisma.user.findUnique({ where: { email } })
  if (!u) {
    console.error(`❌ Không tìm thấy user với email: ${email}`)
    process.exit(1)
  }
  const hashed = await bcrypt.hash(newPassword, 10)
  await prisma.user.update({ where: { id: u.id }, data: { password: hashed } })
  console.log(`✅ Đã đổi mật khẩu cho ${email} (role: ${u.role})`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
