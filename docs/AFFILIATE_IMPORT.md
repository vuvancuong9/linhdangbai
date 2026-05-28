# Shopee Affiliate Import

Tính năng cho phép import file CSV/XLSX báo cáo Shopee Affiliate (Affiliate Commission Report) để điền cột **HOA HỒNG** trong trang Quản lý Campaign.

## Logic mapping

- Aggregate `SUM(Hoa hồng ròng tiếp thị liên kết(₫))` GROUP BY (`Sub_id2`, `DATE(Thời gian Click)`).
- Match `Sub_id2` (file Shopee) ↔ `Campaign.name` (DB).
- Lưu vào bảng `affiliate_commission_daily` theo `userId` của user đang đăng nhập.
- Khi load Campaign trong khoảng ngày X→Y, server SUM commission theo (campaign.name, X≤date≤Y) rồi tính:
  - `profitLoss = commission - spend`
  - `adsHH = spend / commission` (nếu commission > 0)

## Endpoints mới

- `POST /api/affiliate/import` — nhận `{ records: [{subId2, date, commission, orderCount}] }`, upsert theo unique key (userId, subId2, date).
- `GET /api/affiliate/commission?from=YYYY-MM-DD&to=YYYY-MM-DD` — trả về aggregated theo subId2 trong khoảng ngày của user hiện tại.

## Schema

Thêm model `AffiliateCommissionDaily` (bảng `affiliate_commission_daily`):

```prisma
model AffiliateCommissionDaily {
  id         String   @id @default(cuid())
  userId     String
  subId2     String
  date       DateTime @db.Date
  commission Int      @default(0)
  orderCount Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, subId2, date])
  @@index([userId, date])
  @@map("affiliate_commission_daily")
}
```

## Cách test trước khi merge

### 1. Sync schema lên DB local/staging
```bash
npx prisma db push
npx prisma generate
```

### 2. Chạy dev server
```bash
npm run dev
```

### 3. Đăng nhập và test
1. Mở `http://localhost:3000/quan-ly-campaign`.
2. Bấm "Chọn file" trong section Shopee Affiliate, chọn file `AffiliateCommissionReport*.csv`.
3. Đợi import xong (status hiện ✅).
4. Verify case mẫu: campaign `R0704N02` ngày `01/05/2026` phải hiện hoa hồng `751.536₫` khi date range bao gồm ngày này.
5. Đổi date range Từ/Đến → bấm "Tải Campaigns" → cột HOA HỒNG cập nhật theo khoảng mới.

## Test case quan trọng

| Campaign | Ngày | Hoa hồng kỳ vọng |
|----------|------|------------------|
| R0704N02 | 01/05/2026 | 751.536₫ (83 đơn) |
| R0704N02 | 30/04/2026 | 379.044₫ |
| R0704N02 | 29/04/2026 | 677.971₫ |

(Đã verify từ file thật có 73,374 đơn, 1,268 campaigns × 42 ngày, tổng 561.340.139₫)

## Migration trên production

1. Branch này tự động deploy preview lên Vercel khi mở PR — có thể test trực tiếp trên preview URL.
2. Sau khi PR được merge vào main, cần chạy `prisma db push` (hoặc `prisma migrate deploy` nếu dùng migrations) trên DB production để tạo bảng mới.
3. Vercel build sẽ tự chạy `prisma generate` (đã config trong `postinstall` + `build` script).

## Lưu ý

- File quá lớn (>50,000 dòng aggregated) sẽ bị reject với `TOO_MANY_RECORDS`. Có thể tăng limit trong `/api/affiliate/import/route.ts` nếu cần.
- Import được chia chunk 5,000 records/request ở client, 500 records/transaction ở server để tránh timeout.
- Endpoint chạy trên `runtime: 'nodejs'` (cần Prisma) với `maxDuration: 60s`.
