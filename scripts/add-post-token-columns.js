// Add postLongToken + postTokenExpiresAt cot vao fb_tokens.
// Chay: node scripts/add-post-token-columns.js

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  console.log("[add-post-token] Adding columns to fb_tokens...")
  await prisma.$executeRawUnsafe(`ALTER TABLE "fb_tokens" ADD COLUMN IF NOT EXISTS "postLongToken" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "fb_tokens" ADD COLUMN IF NOT EXISTS "postTokenExpiresAt" TIMESTAMP(3)`)
  console.log("[add-post-token] DONE.")
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
