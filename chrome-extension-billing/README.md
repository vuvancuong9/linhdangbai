# cuongbg — Billing Sync (Chrome Extension)

Tự đồng bộ **payment threshold + số dư + daily spend limit + tổng tiêu** của TKQC từ trang `adscheck.smit.vn` → web cuongbg. Random 20–50 phút/lần, chạy ngầm, không động vào FB.

> ⚠️ Phiên bản v1/v2 cũ (cào trực tiếp Meta Ads Manager) đã bỏ từ 2026-05-17 để tránh FB checkpoint/ban.

## Cài đặt

1. Mở `chrome://extensions/` → bật **Developer mode** (góc phải trên).
2. Bấm **Load unpacked** → chọn thư mục `chrome-extension-billing/`.
3. Pin extension vào toolbar Chrome cho tiện.

## Sử dụng

1. **Login** vào https://linhdangbai-2odf.vercel.app trong 1 tab.
2. **Login** vào https://adscheck.smit.vn trong tab khác (extension dùng cookie session SMIT để scrape).
3. Bấm icon extension → bấm **🚀 Sync SMIT ngay** để kiểm tra lần đầu.
4. Sau đó tự chạy mỗi 20–50 phút (random).

## File trong extension

| File | Vai trò |
|------|---------|
| `manifest.json` | Khai báo MV3, permissions, host. |
| `background.js` | Service worker: lập lịch alarm, mở tab SMIT, gửi message scrape, POST kết quả về app. |
| `content-smit.js` | Chạy trên `adscheck.smit.vn`, đọc bảng billing (actId, balance, threshold, limit, tổng tiêu). |
| `popup.html` + `popup.js` | UI popup: trạng thái login, lần sync gần nhất, nút sync ngay. |

## Endpoint app gọi về

`POST /api/accounts/sync-thresholds-bulk-from-ext`

Body: `{ rows: [{ actId, accountName, balance, threshold, thresholdLeft, dailyLimit, totalSpent }] }`

Auth: cookie session của app (`credentials: include`). CORS chỉ accept origin của extension hoặc chính domain app (xem `src/lib/ext-cors.ts`).

## Đổi domain app

Nếu deploy app sang domain khác, sửa 3 chỗ cho khớp:

1. `background.js` — biến `APP_BASE`
2. `popup.js` — biến `APP_BASE`
3. `manifest.json` — `host_permissions[0]`

## Debug

Mở `chrome://extensions/` → tìm extension → bấm **service worker** (background) hoặc **Inspect popup** → tab Console, tìm log `[FBAds SMIT] …`.
