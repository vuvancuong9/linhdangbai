-- Migration: thêm composite indexes cho perf (Phase 2 audit).
-- Idempotent — chạy 1 lần trên Supabase SQL Editor. Safe chạy lại.
--
-- Impact:
--   1. fan_pages(userId, pageId): -50-200ms cho /insights, /trinh-quan-ly/ads
--   2. posts(userId, adCreated, deleted, adError): -200-800ms cho cron auto-camp
--   3. posts(campaignId): -100-300ms cho /insights + /lai-lo-camp lookup theo campId

CREATE INDEX IF NOT EXISTS "fan_pages_userId_pageId_idx"
  ON fan_pages("userId", "pageId");

CREATE INDEX IF NOT EXISTS "posts_userId_adCreated_deleted_adError_idx"
  ON posts("userId", "adCreated", deleted, "adError");

CREATE INDEX IF NOT EXISTS "posts_campaignId_idx"
  ON posts("campaignId");
