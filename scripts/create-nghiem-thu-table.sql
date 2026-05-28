-- Migration: tao bang nghiem_thu_items cho feature Nghiem thu Shopee Affiliates
-- Chay manual tren Supabase SQL Editor.
-- (KHONG dung prisma db push vi co orphan campaigns block FK validate — memory note 2026-05-18)

CREATE TABLE IF NOT EXISTS "nghiem_thu_items" (
  "id"            TEXT PRIMARY KEY,
  "userId"        TEXT NOT NULL,
  "accountId"     TEXT NOT NULL,
  "campaignName"  TEXT NOT NULL,
  "oldAdName"     TEXT NOT NULL,
  "newAdName"     TEXT NOT NULL,
  "adId"          TEXT,
  "linkPost"      TEXT,
  "shopeeLink"    TEXT,
  "renamedAt"     TIMESTAMP(3),
  "renameError"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "nghiem_thu_items_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "nghiem_thu_items_userId_accountId_oldAdName_key"
  ON "nghiem_thu_items" ("userId", "accountId", "oldAdName");

CREATE INDEX IF NOT EXISTS "nghiem_thu_items_userId_createdAt_idx"
  ON "nghiem_thu_items" ("userId", "createdAt" DESC);
