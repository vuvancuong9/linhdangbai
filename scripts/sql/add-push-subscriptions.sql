-- Migration: thêm bảng push_subscriptions cho Web Push notifications.
-- Chạy 1 lần trên Supabase SQL Editor.
-- Idempotent — safe chạy lại.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "failCount" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT push_subscriptions_userId_fkey
    FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS push_subscriptions_userId_idx
  ON push_subscriptions("userId");

-- RLS: bật để khớp policy chung của Supabase project (Prisma bypass via DATABASE_URL postgres role).
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
