-- Page Ad Limit feature (2026-05-26): track FB ad limit per page.
-- Cron 6h sang fetch /act_X/ads_volume?page_id=Y -> store current + limit.
-- UI /gioi-han-quang-cao hien danh sach page kem % usage + cảnh báo.

ALTER TABLE fan_pages
  ADD COLUMN IF NOT EXISTS "pageAdsTotal"           INTEGER,
  ADD COLUMN IF NOT EXISTS "pageAdsCurrentAccount"  INTEGER,
  ADD COLUMN IF NOT EXISTS "pageAdLimit"            INTEGER,
  ADD COLUMN IF NOT EXISTS "pageAdLimitCheckedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pageAdLimitError"       TEXT;
