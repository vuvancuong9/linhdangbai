# QuyBeo Billing Sync — Chrome Extension

Đồng bộ **payment threshold + invoices** của TKQC từ Meta Ads Manager → app QuyBeo. FB Graph API v19+ không expose data này, extension scrape DOM trên trang Billing FB.

## ⚠ Auto-sync đã TẮT (2026-05-17)

**Version cũ (1.0.0)** auto mở tab ẩn `chrome.tabs.create()` mỗi 4h để sync 22 TKQC. → FB detect bot ngay từ tab đầu (vì tab không có referrer + không có user gesture) → "Cần xác minh tài khoản" → rủi ro khoá account.

**Version mới (2.0.0)** chỉ hoạt động khi USER tự click vào trang FB Billing. Mở 1 TKQC = sync 1 lần. Không có tab tự động.

## Cách cài / update

1. Mở Chrome → `chrome://extensions/`.
2. Nếu đã cài version cũ: bấm **Xoá** (Remove) → cài lại từ folder này để chắc chắn alarm cũ bị xoá.
3. Bật **Developer mode** (góc phải trên).
4. Bấm **Load unpacked** → chọn folder `chrome-extension-billing/`.
5. Extension xuất hiện trong thanh extension (icon 💰).

## Cách dùng

1. **Login app.quybeo.com** trong 1 tab Chrome.
2. Click icon extension → kiểm tra status "✅ Đã login".
3. Tự navigate (click chuột) vào trang FB Billing TKQC: vd. mở Ads Manager → click "Quản lý thanh toán" của TKQC → đợi 2-3s.
4. Extension auto scan DOM → tìm threshold + invoices → POST app.
5. Toast xanh hiện trên trang FB: "✅ QuyBeo: Đồng bộ threshold X đ".

Muốn sync TKQC nào → vào trang Billing TKQC đó. Không có nút "Sync hết" nữa để tránh FB ban.

## Files

| File | Mục đích |
|---|---|
| `manifest.json` | V3 manifest, host permissions, content script match URLs |
| `content.js` | Chạy trên FB billing page: scrape threshold + invoices từ DOM/URL |
| `background.js` | Service worker: nhận message từ content, POST app.quybeo.com. Clear alarm cũ khi update. |
| `popup.html` + `popup.js` | UI popup: hiện status login + nút mở app |

## Backend endpoints

- `POST /api/accounts/sync-threshold-from-ext` — body `{ actId, threshold }`
- `POST /api/accounts/sync-invoices-from-ext` — body `{ actId, invoices[] }`

Auth: cookie session app.quybeo.com (`credentials: include`).

## Debug

Nếu extension không sync được:
1. F12 trên trang FB Billing → tab Console → tìm log `[QuyBeo Billing Sync]`.
2. Nếu "Không tìm thấy số threshold" → DOM FB đã đổi, gửi em screenshot inspect element.
3. Nếu "TKQC không tìm thấy trong app" → bấm "Đồng bộ FB" ở Keo Ads trước để add TKQC vào app.
