// Tao 2 bang moi: saved_posts + post_queue (cho feature Clone Reels).
// Dung raw SQL de tranh re-validate FK cu (orphan campaigns).
//
// Chay: node scripts/create-clone-reels-tables.js

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  console.log("[clone-reels-tables] Bat dau tao bang...")

  // 1. saved_posts
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "saved_posts" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "sourcePageId" TEXT,
      "sourcePageName" TEXT,
      "sourceUrl" TEXT NOT NULL DEFAULT '',
      "sourceFbId" TEXT,
      "originalCaption" TEXT NOT NULL DEFAULT '',
      "mediaType" TEXT NOT NULL DEFAULT 'reel',
      "mediaUrls" TEXT NOT NULL DEFAULT '[]',
      "thumbnailUrl" TEXT,
      "durationSec" INTEGER,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "saved_posts_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "saved_posts_userId_createdAt_idx" ON "saved_posts"("userId", "createdAt" DESC)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "saved_posts_userId_sourceFbId_idx" ON "saved_posts"("userId", "sourceFbId")`)
  // FK saved_posts.userId → users.id (CASCADE)
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_posts_userId_fkey') THEN
        ALTER TABLE "saved_posts" ADD CONSTRAINT "saved_posts_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$
  `)
  console.log("[clone-reels-tables] saved_posts OK")

  // 2. post_queue
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "post_queue" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "savedPostId" TEXT NOT NULL,
      "editedCaption" TEXT NOT NULL DEFAULT '',
      "targetPageId" TEXT NOT NULL,
      "scheduledAt" TIMESTAMP(3),
      "status" TEXT NOT NULL DEFAULT 'pending',
      "postedFbId" TEXT,
      "postedAt" TIMESTAMP(3),
      "postRecordId" TEXT,
      "error" TEXT,
      "errorAt" TIMESTAMP(3),
      "retryCount" INTEGER NOT NULL DEFAULT 0,
      "autoCreateCampaign" BOOLEAN NOT NULL DEFAULT false,
      "campaignConfigSnapshot" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "post_queue_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "post_queue_userId_status_scheduledAt_idx" ON "post_queue"("userId", "status", "scheduledAt")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "post_queue_status_scheduledAt_idx" ON "post_queue"("status", "scheduledAt")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "post_queue_userId_createdAt_idx" ON "post_queue"("userId", "createdAt" DESC)`)
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_queue_userId_fkey') THEN
        ALTER TABLE "post_queue" ADD CONSTRAINT "post_queue_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_queue_savedPostId_fkey') THEN
        ALTER TABLE "post_queue" ADD CONSTRAINT "post_queue_savedPostId_fkey"
          FOREIGN KEY ("savedPostId") REFERENCES "saved_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$
  `)
  console.log("[clone-reels-tables] post_queue OK")

  console.log("[clone-reels-tables] DONE.")
  await prisma.$disconnect()
}

main().catch(e => { console.error("FAIL:", e); process.exit(1) })
