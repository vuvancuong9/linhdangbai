-- Migration: thêm cột lookupError vào nghiem_thu_items.
-- Idempotent — safe chạy lại trên Supabase SQL Editor.

ALTER TABLE nghiem_thu_items
  ADD COLUMN IF NOT EXISTS "lookupError" TEXT;
