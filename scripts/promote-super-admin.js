const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const TARGET_EMAIL = process.argv[2]

if (!TARGET_EMAIL) {
  console.error("Usage: node scripts/promote-super-admin.js <email>")
  process.exit(1)
}

async function main() {
  console.log(`Promote ${TARGET_EMAIL} → SUPER_ADMIN`)
  const u = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } })
  if (!u) {
    console.error(`Không tìm thấy user ${TARGET_EMAIL}`)
    process.exit(1)
  }
  const updated = await prisma.user.update({
    where: { id: u.id },
    data: { role: "SUPER_ADMIN" },
  })
  console.log(`✅ Đã promote: ${updated.email} → ${updated.role}`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
