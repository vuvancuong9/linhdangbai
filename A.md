# PHÂN TÍCH TOÀN BỘ TÍNH NĂNG — FB ADS MANAGER (linhdangbai)

> Tài liệu phân tích đầy đủ mọi tính năng của web. Tổng hợp từ việc đọc toàn bộ source code:
> **24 trang (pages), 110 API routes, 32 file thư viện (lib), 9 cron job, 25 bảng database, 1 Chrome extension.**
>
> - Repo: https://github.com/vuvancuong9/linhdangbai
> - Web chạy thật: https://linhdangbai-2odf.vercel.app
> - DB: Supabase `webquy` (jzkiabbsqhmhjpqbxrls)

---

## MỤC LỤC

1. [Tổng quan & công nghệ](#1-tổng-quan--công-nghệ)
2. [Tài khoản, phân quyền & bảo mật](#2-tài-khoản-phân-quyền--bảo-mật)
3. [Sơ đồ menu (toàn bộ tính năng)](#3-sơ-đồ-menu)
4. [NHÓM CHÍNH](#4-nhóm-chính)
5. [NHÓM QUẢN LÝ](#5-nhóm-quản-lý)
6. [NHÓM TÀI CHÍNH](#6-nhóm-tài-chính)
7. [Trang hệ thống & tài khoản](#7-trang-hệ-thống--tài-khoản)
8. [Tự động hóa — 9 Cron Job](#8-tự-động-hóa--9-cron-job)
9. [Tích hợp bên ngoài](#9-tích-hợp-bên-ngoài)
10. [Chrome Extension](#10-chrome-extension)
11. [Công thức nghiệp vụ](#11-công-thức-nghiệp-vụ)
12. [Cơ sở dữ liệu — 25 bảng](#12-cơ-sở-dữ-liệu--25-bảng)
13. [Lưu ý kỹ thuật & cảnh báo](#13-lưu-ý-kỹ-thuật--cảnh-báo)

---

## 1. TỔNG QUAN & CÔNG NGHỆ

**FB Ads Manager** là hệ thống quản lý quảng cáo Facebook **đa người dùng (multi-user)** chuyên cho mô hình **Affiliate Shopee**: nhân viên lấy bài post Shopee từ fanpage → tự tạo campaign FB → theo dõi chi phí ads vs hoa hồng Shopee → tính lãi/lỗ → quản lý billing/thuế.

| Hạng mục | Công nghệ |
|----------|-----------|
| Framework | Next.js 14 (App Router) + React 18 + TypeScript |
| Backend | Next.js API Routes (serverless functions) |
| ORM / DB | Prisma 5 + PostgreSQL (Supabase) |
| Auth | JWT (jose + jsonwebtoken) + cookie httpOnly, bcrypt |
| State (client) | Zustand |
| Style | Tailwind + inline CSS, theme tự đổi sáng/tối theo giờ VN |
| Cron | node-cron (chạy trong process, qua `instrumentation.ts`) |
| Tích hợp | Facebook Graph API (v19/v21), Shopee Affiliate Open API, Telegram Bot, Web Push (VAPID), Google Sheets |
| PWA | Có (manifest, service worker, push notification, cài lên điện thoại) |
| Phụ trợ | Chrome Extension (đồng bộ ngưỡng/limit billing), xlsx, papaparse |

**Kiến trúc dữ liệu:** mỗi bản ghi gắn `userId` của người tạo (self-scoped). Phân quyền theo cây: `SUPER_ADMIN` → `ADMIN` → `USER` (con của admin qua `parentId`).

**Giao diện:** Topbar (avatar, role, đổi MK, đăng xuất) + Sidebar trái (desktop, 180px) chia 4 nhóm menu + Bottom nav (mobile, chỉ Dashboard + Billing). Theme **tự động**: 6h–18h59 sáng / 19h–5h59 tối (tính theo giờ VN UTC+7).

---

## 2. TÀI KHOẢN, PHÂN QUYỀN & BẢO MẬT

### 2.1. Ba vai trò (Role)
- **SUPER_ADMIN** — toàn quyền, thấy data tất cả user, không bao giờ bị giới hạn menu.
- **ADMIN** — quản lý các USER mình tạo (`parentId`), thấy data của team mình. Có thể bị giới hạn menu.
- **USER** — chỉ thấy data của mình; menu giới hạn theo `permissions`.

### 2.2. Phân quyền menu (`src/lib/permissions.ts`)
- `User.permissions` = JSON array các "menu key" (vd `["keo-ads","dashboard"]`). `null` = full quyền (super admin / legacy).
- Mỗi menu key map sang 1 page path + danh sách `apiPaths` được phép gọi.
- **Middleware (Edge)** (`src/middleware.ts`) verify JWT, chặn truy cập page/API không có quyền (redirect hoặc 403). Logic này được **nhân bản** trong middleware vì Edge runtime không import được file lib.
- `ALWAYS_ALLOWED` (mọi user đã login): `/lich-su-dang-nhap`, `/api/auth`, `/api/me`, `/api/extension`, `/api/push`.

### 2.3. Đăng nhập / phiên (session)
- `POST /api/auth/login`: chuẩn hóa email → rate-limit → so bcrypt → tạo `LoginSession` → ký JWT (chứa userId, role, name, sessionId, permissions, parentId) → set cookie `fb_ads_token` (httpOnly, secure, sameSite=strict, 7 ngày).
- JWT mang `sessionId`; `requireAuth` kiểm tra session có bị revoke chưa (cache 60s trong RAM để giảm tải DB).
- **Force logout tự động:** khi admin đổi role/permissions/userType hoặc khóa user → **revoke toàn bộ session** của user đó ngay.
- Đổi mật khẩu: `/api/auth/change-password` → đổi xong tự đăng xuất.

### 2.4. Bảo mật
- **Rate limit đăng nhập** (`rate-limit.ts`): 5 lần sai/15 phút (theo email) + 10 lần (theo IP) → khóa 15 phút. *(In-memory — reset khi redeploy.)*
- **Chính sách mật khẩu** (`password-policy.ts`): tối thiểu 10 ký tự, có chữ + số, chặn mật khẩu phổ biến.
- **Mã hóa token nhạy cảm** (`crypto.ts`): AES-256-GCM (định dạng `enc:v1:iv:tag:ct`), key từ env `TOKEN_ENC_KEY`. Áp dụng cho FB token (`appSecret`, `longToken`) và Shopee `apiKey`. **Token FB dài không bao giờ trả về client** — chỉ trả 20 ký tự preview.
- Cookie httpOnly + SameSite strict; HTTPS bắt buộc.

---

## 3. SƠ ĐỒ MENU

| Nhóm | Menu | Path | Chức năng tóm tắt |
|------|------|------|--------------------|
| **CHÍNH** | Kéo Ads | `/keo-ads` | Kết nối FB token, đồng bộ TKQC/fanpage/bài post |
| | Fanpage Posts | `/fanpage-posts` | Quản lý bài post Shopee → tạo campaign hàng loạt |
| | Nghiệm thu Shopee | `/nghiem-thu` | Đổi tên ad + ghép link → xuất file nghiệm thu Shopee |
| **QUẢN LÝ** | Dashboard | `/dashboard` | Tổng quan lãi/lỗ, chi ads, hoa hồng theo nhóm |
| | Insights (Top SP) | `/insights` | Top sản phẩm lãi/lỗ/hoa hồng/đơn |
| | Trình quản lý | `/trinh-quan-ly` | Bản sao live FB Ads Manager (camp/adset/ad) |
| | Quản lý Campaign | `/quan-ly-campaign` | Bảng campaign tổng: bật/tắt, đổi budget, xóa, export |
| | Lãi/Lỗ Camp | `/lai-lo-camp` | Theo dõi ADS/HH theo ngày + auto-manage |
| | Camp không cắn tiền | `/camp-khong-can-tien` | Lọc camp tiêu < 50k/5 ngày |
| | Giới hạn QC Page | `/gioi-han-quang-cao` | Theo dõi số ad/limit từng fanpage |
| | Chi tiêu Fanpage | `/chi-tieu-fanpage` | Chi ads + hoa hồng theo từng page / theo nhân viên |
| | Nhóm tài khoản | `/nhom-tai-khoan` | Gom TKQC + Shopee vào nhóm theo tháng |
| | Billing FB | `/billing` | Số dư, ngưỡng, limit, thẻ, cảnh báo Telegram |
| | Invoices | `/invoices` | Hóa đơn/giao dịch FB (import CSV) |
| **TÀI CHÍNH** | Chi phí văn phòng | `/chi-phi-van-phong` | Quản lý chi phí + danh mục + biểu đồ |
| **TÀI KHOẢN** | Lịch sử đăng nhập | `/lich-su-dang-nhap` | Danh sách thiết bị đăng nhập, đăng xuất từ xa |
| **HỆ THỐNG** | Quản lý User | `/admin` | (Admin) tạo/sửa/xóa user, gán quyền |

Trang công khai: `/login`, `/privacy`, `/data-deletion` (+ alias `/datadeletion`).

---

## 4. NHÓM CHÍNH

### 4.1. Kéo Ads (`/keo-ads`)
Cổng kết nối Facebook và đồng bộ tài sản.

**Kết nối FB token:**
- Modal nhập `appId` + `appSecret` + `shortToken` (token ngắn lấy từ Graph API Explorer, scope `ads_read, ads_management, pages_read_engagement`).
- `POST /api/fb/token`: đổi short-token → **long-lived token (~60 ngày)** qua OAuth, lưu mã hóa AES-256.
- Token chỉ hiện `tokenPreview` (20 ký tự); có nút Cập nhật/Xóa.

**Đồng bộ tài sản (`/api/fb/sync-assets`):**
- Gọi `me/adaccounts` + `me/accounts` (fanpage). Nếu không có TKQC trực tiếp → fallback qua `me/businesses` → `owned/client_ad_accounts`.
- Import TKQC (id, tên, status, businessId) + fanpage (id, tên, category). Dedupe theo `actId`/`pageId`, chỉ update khi tên/status đổi. **Không đụng `groupId`** (giữ nhóm).
- Nút "Chỉ Fanpage" (`only=pages`) cho token thiếu quyền ads.

**Giao diện:** 2 cột TKQC + Fanpage, mỗi cột có đếm, tìm kiếm, thêm tay, **tích chọn theo dõi** (lưu DB qua `isSelected` → đồng bộ cross-browser, đa chọn shift/ctrl).

### 4.2. Fanpage Posts (`/fanpage-posts`)
Màn hình trung tâm — biến bài post Shopee thành campaign.

**Đồng bộ bài (`/api/fb/sync-posts`):** dùng **FB Batch API** lấy `{page}/posts` (incremental theo `since`), **chỉ giữ bài có link Shopee** (`s.shopee.vn`/`shope.ee`/`shopee.vn`). Lưu fbId, text, link Shopee, pageId, postedAt. Dedupe theo fbId.

**Bảng post:** phân trang 20/trang, mặc định tab `pending` (chưa tạo ad, chưa export, chưa lỗi). Lọc theo: tên campaign (all/none/has), khoảng ngày, fanpage (đa chọn), sắp xếp A→Z. Chọn theo dải STT, chọn tất cả cross-page.

**Gán Campaign name qua Google Sheet (Mapping):** modal "Tải lên Mapping" → nhập URL Google Sheet (cột Link Shopee + Tên Campaign) → ghép link Shopee của post với sheet → tạo/gán `campaignId`. Cron tự sync mỗi 15 phút.

**Tạo Campaign hàng loạt:**
- Điều kiện: chọn ≥1 post (đã có campaign name) + mỗi fanpage phải được gán đúng 1 TKQC (modal "⚙️ Page → TKQC").
- Nếu tất cả post về 1 TKQC → dropdown TKQC tự khóa (🔒).
- `POST /api/fb/create-campaign` chạy theo chunk (5 post/chunk, 2 song song), có thanh tiến trình.
- **Cấu hình camp:** objective (OUTCOME_*), budget/ngày, bid strategy (LOWEST_COST / WITH_BID_CAP / COST_CAP), bidAmount, tuổi, giới tính, quốc gia, optimization goal. Lưu localStorage + seed từ `/api/user/camp-defaults`.

**Auto-camp (🤖):** bật/tắt `autoCampaignEnabled` → cron mỗi đầu giờ tự tạo camp cho post mới. Có modal "🔍 Vì sao chưa auto?" (chẩn đoán từng post) + nút "⚡ Trigger ngay".

**Export CSV:** xuất file campaign mẫu (đánh dấu post `exported`).

### 4.3. Ba màn hình hàng đợi (sub của Fanpage Posts)
- **Camp đã tạo** (`/camp-da-tao`): post đã tạo ad thành công (`adCreated=true`). Có nút "🔄 Tạo lại" (reset về pending để cron tạo lại) + backfill TKQC legacy.
- **Camp lỗi** (`/camp-loi`): post bị `adError`. Hiện lỗi FB, nút "Thử lại" (max 3 lần), admin có "Reset" + "Xóa hết data".
- **Camp đã xuất** (`/camp-da-xuat`): danh sách post đã export CSV (read-only).

### 4.4. Nghiệm thu Shopee (`/nghiem-thu`)
Quy trình đổi tên ad + ghép link để nộp nghiệm thu Shopee Affiliate. Dữ liệu lưu ở `NghiemThuItem`.

**Luồng 5 bước:**
1. **Upload File 1** (Excel 4 cột: `account_id, campaign_name, old_ad_name, new_ad_name`) → server gọi FB `GET /act_{id}/ads` → match `ad_id` theo (campaign + tên ad cũ). Tự parse `affiliateId` (nick Shopee) từ đầu `new_ad_name`.
2. **Đổi tên ad trên FB** (`POST /{adId}` body `name=newAdName`, throttle 400ms, max 200 ad/lần). Đây là thao tác đổi tên thật trên Facebook (không hoàn tác).
3. **Upload File 2** (FB Ads Manager export, cột `Ad Name, Body, Permalink`) → match theo tên ad mới → lưu `linkPost` (Permalink) + `shopeeLink` (trích từ Body).
4. **Lookup-retry:** chạy lại lookup cho item chưa match (ad tạo sau lần import đầu).
5. **Xuất Excel nghiệm thu** (client) gồm: account_id, campaign_name, old/new ad name, link_post, shopee_link → nộp Shopee.

**Nick Shopee (labels):** đặt tên thân thiện cho `affiliateId` (vd `17305500347` → "Tổng Kho Lý Ngô"), dùng làm chip lọc.

---

## 5. NHÓM QUẢN LÝ

### 5.1. Dashboard (`/dashboard`)
Tổng quan tài chính theo khoảng ngày (mặc định "Tổng thời gian" từ 2026-02-01 → hôm qua).

**Thẻ thống kê:** Tổng chi FB Ads, Tổng hoa hồng Shopee (+ bonus), **Lợi nhuận thực tế** (tính server-side), ADS/HH (<65% lãi tốt / ≤110% cảnh báo / lỗ nặng), Tổng thuế (cả năm), Chi phí văn phòng.

**Breakdown theo nhóm tài khoản:** mỗi `AccountGroup` 1 thẻ — spend, hoa hồng, ADS/HH, thuế (click mở modal thuế); cột FB accounts + cột Shopee accounts (click mở modal bonus).

- Resolve nhóm theo từng tháng (`AdAccountGroupAssignment` + fallback `default`); spend chia theo tháng.
- Cache: client localStorage 5 phút + server cache spend FB 30 phút.
- Thuế chỉ trừ khi full range (≥60 ngày từ mốc lock).

### 5.2. Insights — Top SP (`/insights`)
Phân tích **top sản phẩm**. Gom đơn `OrderCommission` theo `productItemId`. 4 tab top 20: **Top lãi / Top lỗ / Top HH / Top đơn**.
- Cờ `spendAccurate`: chỉ chính xác khi full range (vì `Campaign.spend` là all-time) → nếu không, ẩn cột spend/profit.
- Heatmap **Fanpage × Ngành hàng (L1)** + biểu đồ **hoa hồng theo giờ trong ngày**. Export Excel 7 sheet.

### 5.3. Trình quản lý (`/trinh-quan-ly`)
**Bản sao live của Facebook Ads Manager** (read-only, không lưu DB). Drill-down 3 cấp: chọn TKQC → Campaigns → tích camp → Ad sets → tích adset → Ads.
- Lấy trực tiếp từ FB Marketing API: metadata + insights (spend, impressions, reach, clicks, **results / cost-per-result / result label** theo objective).
- Cột: Delivery, Results, Cost/result, Budget, Amount spent, Bid strategy, Date created; tab Ads thêm thumbnail + tên Page.
- Click tên = copy clipboard. Lọc/sắp xếp/phân trang client, preset ngày như FB.

### 5.4. Quản lý Campaign (`/quan-ly-campaign`)
Bảng campaign tổng (DB), sync metrics từ FB.
- **Cột:** tên + campId + TKQC, trạng thái (toggle), NS/ngày, đổi budget (inline), CPC, Click FB, Click SP, Chi phí, Hoa hồng, **ADS/HH** (màu theo ngưỡng), **SP/FB**, **Lãi/Lỗ**.
- **Lọc:** tab all/on/off, tìm tên, "chỉ camp ×2+" (trùng tên), chọn TKQC, lọc số (cpc/profit/spend/commission/adsHH). Phân trang 50.
- **Hành động:** bật/tắt (đơn + hàng loạt), đổi budget (preset 30k–1M), **xóa trên FB** (fallback xóa DB), **export CSV** 13 cột, upload CSV hoa hồng Shopee + CSV click, modal "đơn mồ côi" (`/orphan` — hoa hồng subId2 không khớp camp nào).

### 5.5. Lãi/Lỗ Camp (`/lai-lo-camp`)
Chỉ camp đang **bật**, lọc camp có **tổng spend > 100k** trong N ngày (mặc định 3).
- Cột: tên, **Fanpage**, NS/ngày, **ADS/HH mỗi ngày D0..Dn** (màu), **Tổng ads**. Sắp xếp theo Tổng ads / Lãi-Lỗ. Mobile có Top lãi/Top lỗ + thẻ tổng.
- **Auto-manage toggle** + modal cấu hình ngưỡng **per-fanpage** (`autoBudgetUpThreshold`, `autoOffThreshold`).

### 5.6. Camp không cắn tiền (`/camp-khong-can-tien`)
Chỉ camp đang bật, lọc **tổng spend < 50k / 5 ngày** + tạo trước D4 (loại camp mới). Hiện spend thô mỗi ngày D0..D4. Cùng bộ công cụ + modal auto-manage.

### 5.7. Giới hạn QC Page (`/gioi-han-quang-cao`)
Theo dõi số ad đang chạy vs giới hạn từng fanpage (`page-ad-limit.ts`, FB `ads_volume`).
- `pageAdsTotal` = ad đang chạy/review từ MỌI TKQC; `pageAdsCurrentAccount` = từ TKQC đã gán; `pageAdLimit` = ngưỡng FB (mặc định 250).
- Cột: page, TKQC gán, **QC TK này / QC TK khác / Tổng / Giới hạn / % usage** (progress bar), status (over ≥100% / warning ≥80% / ok / no-data / error). Sync mỗi 30 phút.

### 5.8. Chi tiêu Fanpage (`/chi-tieu-fanpage`)
Hai phần, mặc định 7 ngày:
- **Spend theo page** (`spend-by-page`): lấy spend FB live theo camp → map `campId → pageId` → gom theo fanpage (campCount, spend, commission, profit). Có dòng "Khác" = spend FB trên camp không có trong tool (mồ côi).
- **Hoa hồng theo nhân viên** (`commission-by-subid3`): gom `OrderCommission` theo `subId3` (tên nhân viên từ utm_content): số đơn, hoa hồng, giá trị đơn, TB/đơn.

### 5.9. Nhóm tài khoản (`/nhom-tai-khoan`)
- Tạo nhóm (`AccountGroup`): tên, màu (8 màu), `taxType` (personal/household/company) + `taxId` (MST).
- **Gán TKQC theo từng tháng** (`monthKey` `YYYY-MM`, fallback `default`, tombstone `groupId=null`). Gán Shopee account (không theo tháng).
- **Copy assignment** từ tháng trước sang tháng này (ghi đè).

### 5.10. Billing FB (`/billing`)
Theo dõi billing từng TKQC.
- **Bảng:** trạng thái, tên + actId, **Số dư**, **Ngưỡng** (nhập tay), **Ngưỡng còn lại** (đỏ khi <20%), **Limit** (ưu tiên `dailySpendLimit` do extension cào), Tổng tiêu, thẻ (brand + last4), bank + chủ thẻ. Footer tổng.
- `fb-billing.ts`: lấy `account_status, balance, amount_spent, spend_cap, funding_source` (FB **không** trả `daily_spend_limit`). Snapshot hằng ngày vào `fb_ad_account_billings`; cờ **limitReduced** khi `spend_cap` giảm >30% so hôm qua.
- **Cảnh báo Telegram** (`billing-alert.ts`): khi `ngưỡng > 2 triệu` VÀ `số dư/ngưỡng ≥ 80%`. Chống spam: chỉ alert lại sau 12h hoặc khi số dư reset <50%. Gửi Telegram + Web Push.
- Modal: cấu hình Telegram Chat ID, quản lý thẻ (`UserCard`: bank, chủ thẻ, 4 số cuối — tự match TKQC theo last4), sửa ngưỡng/ghi chú.

### 5.11. Invoices (`/invoices`)
Hóa đơn/giao dịch FB phục vụ kế toán/thuế.
- ⚠️ API `transactions` của FB v19 **đã bị gỡ** → dữ liệu nạp chủ yếu qua **import CSV** (FB Business → Lập hóa đơn → Export).
- `import-invoice-csv`: parse CSV (actId, ngày, ID giao dịch, số tiền, phương thức) → lưu `FbAdAccountInvoice`. Bảng hiện ID giao dịch, TKQC, ngày, số tiền, phương thức (thẻ), trạng thái. Thống kê tổng + **VAT 10% tham khảo**. Export CSV.

---

## 6. NHÓM TÀI CHÍNH

### 6.1. Chi phí văn phòng (`/chi-phi-van-phong`)
- **Danh mục** (`OfficeExpenseCategory`): tên + màu. Xóa danh mục → chi phí về "Không phân loại".
- **Khoản chi** (`OfficeExpense`): ngày, nội dung, nhà cung cấp, số tiền (VND), ghi chú, danh mục. Lọc theo ngày/danh mục/từ khóa.
- **Biểu đồ:** donut theo danh mục + cột 6 tháng gần nhất. Export Excel có dòng tổng cộng.

---

## 7. TRANG HỆ THỐNG & TÀI KHOẢN

### 7.1. Lịch sử đăng nhập (`/lich-su-dang-nhap`)
Liệt kê tối đa 50 phiên (đang hoạt động / đã đăng xuất): OS, trình duyệt, IP, thời gian, badge "thiết bị này". Nút **đăng xuất từ xa** từng phiên (revoke session).

### 7.2. Quản lý User (`/admin`) — chỉ Admin
- Thẻ thống kê: Tổng users, có token. Bảng user: avatar, tên/email, role, quyền, token (+hạn), số camp/post, trạng thái.
- **Thêm user:** tên/email/MK, chọn role (ADMIN chỉ tạo USER; SUPER_ADMIN tạo cả ADMIN), tích quyền menu theo nhóm.
- **Sửa quyền / đổi role / khóa-mở / xóa** (với ràng buộc theo cây quyền). Đổi quyền → user bị force logout.
- **🧹 Dọn dẹp DB** (super admin): xóa data cũ thủ công.
- `GET /api/admin/overview`: thống kê toàn team (spend/commission/profit/clicks, camp active, token).

### 7.3. Trang pháp lý (cho FB App Review)
- `/privacy`: chính sách bảo mật (dữ liệu thu thập, mã hóa token AES-256, quyền user, liên hệ).
- `/data-deletion` (+ alias `/datadeletion` vì FB không nhận URL có dấu `-`): hướng dẫn xóa tài khoản (tự xóa trong app hoặc gửi email, hoàn tất trong 7 ngày).

---

## 8. TỰ ĐỘNG HÓA — 9 CRON JOB

Khai báo ở `src/lib/cron.ts`, khởi động qua `instrumentation.ts` (timezone Asia/Ho_Chi_Minh):

| # | Lịch | Job | Mô tả |
|---|------|-----|-------|
| 1 | mỗi 10 phút | Sync Posts | Kéo bài Shopee mới từ FB cho tất cả user |
| 2 | phút 3,18,33,48 | Sync Mapping | Đồng bộ Google Sheet → gán campaign name cho post |
| 3 | CN 03:00 | Cleanup DB | Xóa session/log/đơn hủy/post soft-delete cũ |
| 4 | mỗi 30 phút | Page Ad Limit | Cập nhật số ad/limit từng fanpage |
| 5 | 07:00 hằng ngày | Billing snapshot | Snapshot số dư/limit + sync invoice + alert Telegram |
| 6 | 07:30 hằng ngày | Shopee Aff sync | Kéo conversion 7 ngày từ Shopee Open API |
| 7 | mỗi đầu giờ | Auto-create campaign | Tự tạo camp cho post mới (retry sau 6h, max 3) |
| 8 | 13:00 hằng ngày | Auto-manage camp | Tắt camp lỗ / tăng budget camp lãi / tắt camp không cắn tiền |
| 9 | phút 2,12,...,52 | Balance refresh + alert | Snapshot + cảnh báo cho user có Telegram |

> ⚠️ **Quan trọng:** cron dùng `node-cron` cần một **process Node chạy 24/7** (app thiết kế cho Railway). Trên **Vercel serverless (đang deploy)**, function chạy theo request rồi tắt → `node-cron` **không chạy ổn định**. Xem mục [13](#13-lưu-ý-kỹ-thuật--cảnh-báo).

---

## 9. TÍCH HỢP BÊN NGOÀI

### 9.1. Facebook Graph API (v19.0 chính, v21.0 cho nghiệm-thu & caption)
- **OAuth:** đổi short token → long-lived token (~60 ngày).
- **Đọc:** ad accounts, pages, posts (Batch API), insights (spend/clicks/cpc/reach/results), billing (balance/spend_cap/funding), ads_volume (limit), permissions.
- **Ghi:** tạo Campaign → AdSet → AdCreative (`object_story_id` = post FB) → Ad; update budget; bật/tắt (status ACTIVE/PAUSED); xóa camp; đổi tên ad (nghiệm thu).
- **Xử lý lỗi:** mã `1487472` (chưa eligible — retry sau), `1487790`/`1487475` (vĩnh viễn — không retry). Cache page token (TTL 1h) dùng chung cron + manual.

### 9.2. Shopee Affiliate Open API (`shopee.ts`)
- GraphQL `open-api.affiliate.shopee.vn`, ký `SHA256(appId+timestamp+payload+appSecret)`.
- `conversionReport` (phân trang `scrollId`): lấy `utmContent` (s1-s5), thời gian click/mua, `netCommission`, items (tên SP, hoa hồng, ngành hàng L1/L2).
- Upsert vào **`OrderCommission`** (per-đơn) + aggregate **`AffiliateCommissionDaily`** (theo subId2 = tên campaign). `source` phân biệt `sync` (API) vs `manual` (CSV) — CSV không bị API ghi đè.

### 9.3. Telegram Bot (`telegram.ts`)
Gửi cảnh báo billing qua `api.telegram.org/bot{TOKEN}/sendMessage` (1 bot chung, chatId theo user). Cũng dùng để báo khi extension phát hiện checkpoint FB.

### 9.4. Web Push (VAPID, `web-push-server.ts`)
PWA push: subscribe (lưu `PushSubscription` theo endpoint), gửi tới mọi thiết bị của user, tự xóa subscription hết hạn (404/410) hoặc fail ≥5 lần. Dùng cho cảnh báo billing + nút test.

### 9.5. Google Sheets (`sheet.ts`)
Đọc sheet công khai qua URL export CSV (`/export?format=csv&gid=`). Tìm cột "Link Shopee" + "Tên Campaign" (fallback cột A/B). Ghép link → gán campaign name cho post.

---

## 10. CHROME EXTENSION (`chrome-extension-billing/`)
**Phiên bản hiện tại: v5.1.0 "FB Ads Manager — Billing Sync"** (Manifest V3).
- Quyền: `storage, alarms, tabs`; host: domain web (`linhdangbai-2odf.vercel.app`) + `adscheck.smit.vn`.
- ⚠️ Không còn cào trực tiếp FB Ads Manager (tránh bị FB ban) — chuyển sang cào trang **`adscheck.smit.vn`**.
- Alarm mỗi **20–50 phút (random)** → mở/refresh tab SMIT → `content-smit.js` đọc bảng billing (actId, tên, số dư, ngưỡng, ngưỡng còn lại, limit, tổng tiêu) → `POST /api/accounts/sync-thresholds-bulk-from-ext`.
- Route đó cập nhật `AdAccountBillingInfo.paymentThreshold` + `AdAccount.dailySpendLimit`.
- Endpoint phụ: `sync-threshold-from-ext`, `sync-invoices-from-ext`, `/api/extension/alert` (báo Telegram khi FB checkpoint).
- Popup: kiểm tra login `/api/auth/me`, hiện lần sync gần nhất, nút "Sync SMIT ngay".

---

## 11. CÔNG THỨC NGHIỆP VỤ

Hằng số ẩn ở `constants-server.ts` (server-only, không lộ qua F12).

**Lợi nhuận** (Dashboard tính cả thuế + chi phí; route camp chỉ tính 2 yếu tố đầu):
```
Lợi nhuận = HoaHồng × 0.99  −  Ads × 1.01  [− Thuế − Chi phí VP]
```
- `COMMISSION_NET_FACTOR = 0.99` (Shopee giữ 1% phí), `ADS_COST_FACTOR = 1.01` (phụ phí ads).
- **ADS/HH** = spend / commission × 100 (%). Càng thấp càng lãi.
- **SP/FB** = clickSP / clickFB × 100 (%).

**Auto-manage (cron 13h):**
- **Tắt camp lỗ:** 3 ngày liền ADS/HH > ngưỡng tắt (mặc định 110%) + tổng spend > 100k.
- **Tăng budget camp lãi:** 3 ngày liền ADS/HH < ngưỡng (mặc định 65%) + spend > 100k → budget × **1.30** (cap **500k**).
- **Tắt camp không cắn tiền:** tổng spend 5 ngày < 50k VÀ mỗi ngày < 15k VÀ camp tạo trước D4.

**Auto-create (cron mỗi giờ):** post mới tạo camp ngay; post lỗi retry sau **6h**, tối đa **3 lần**.

**Thuế** (`tax.ts`, "Luật 2026"): 3 cách tính —
- **TNCN** (cá nhân): giảm trừ 186tr/năm + 74.4tr/người phụ thuộc, bậc lũy tiến 5–35%.
- **HKD** (hộ kinh doanh): theo ngành — dịch vụ (affiliate) 5% VAT + 5% TNCN; <1 tỷ miễn thuế.
- **TNDN** (công ty): ≤3 tỷ = 15%, 3–50 tỷ = 17%, >50 tỷ = 20%.

**Khóa dữ liệu** (`data-lock.ts`): `DATA_LOCK_DATE = 2026-02-01` (data trước đã xóa) + rolling lock 30 ngày. Không cho ghi đè/xóa data cũ hơn mốc khóa khi upload CSV mới.

---

## 12. CƠ SỞ DỮ LIỆU — 25 BẢNG

| Nhóm | Bảng |
|------|------|
| Người dùng | `users`, `login_sessions`, `push_subscriptions` |
| FB assets | `ad_accounts`, `fan_pages`, `posts`, `campaigns`, `camp_logs`, `fb_tokens` |
| Billing | `fb_ad_account_billings`, `fb_ad_account_invoices`, `ad_account_billing_info`, `user_cards` |
| Nhóm | `account_groups`, `ad_account_group_assignments` |
| Shopee Affiliate | `shopee_affiliate_tokens`, `order_commission`, `affiliate_commission_daily`, `shopee_bonuses` |
| Nghiệm thu | `nghiem_thu_items`, `shopee_affiliate_labels` |
| Tài chính | `tax_records`, `office_expense_categories`, `office_expenses` |
| Khác | `sheet_mappings` |

Điểm thiết kế đáng chú ý: billing info & group assignment **key theo `(userId, actId)`** (không FK tới `AdAccount.id`) để **không mất khi sync xóa-tạo lại** TKQC. Tiền VND dùng `BigInt` (>2.1 tỷ). Nhiều index composite tối ưu query theo `userId`.

---

## 13. LƯU Ý KỸ THUẬT & CẢNH BÁO

Những điểm cần biết khi vận hành (phát hiện khi đọc code):

1. **Cron không chạy trên Vercel.** App dùng `node-cron` (cần server 24/7, thiết kế cho Railway). Trên Vercel serverless, 9 cron job **sẽ không tự chạy**. → Cần một trong: (a) deploy thêm lên Railway/VPS để chạy cron, (b) chuyển sang **Vercel Cron Jobs** (`vercel.json` → gọi các route như `/api/fb/sync-posts`, `/api/mapping` kèm header `x-cron-secret`), hoặc (c) cron-job.org gọi endpoint. *(Hiện tại có thể trigger thủ công các nút sync trong UI.)*
2. **Rate-limit & session-cache là in-memory** → reset mỗi lần redeploy và không chia sẻ giữa nhiều instance serverless. Trên Vercel nên cân nhắc chuyển sang Redis/Upstash nếu cần chính xác.
3. **Logout không revoke session trong DB** (chỉ xóa cookie) — JWT bị lộ vẫn còn hiệu lực tới khi hết hạn 7 ngày (chỉ đổi MK / khóa user mới revoke).
4. **API hóa đơn FB đã chết** (`transactions` bị gỡ ở v19) → Invoices chỉ hoạt động qua import CSV.
5. **`daily_spend_limit` FB không trả qua API** → cột "Limit" lấy từ Chrome extension cào SMIT; cờ "limit giảm >30%" thực ra tính trên `spend_cap`.
6. **Phiên bản Graph API trộn lẫn** v19.0 và v21.0 — nên thống nhất 1 phiên bản khi bảo trì.
7. **Một số text UI/cron lệch nhau** (vd modal Telegram ghi "9h"/"7h"/"1 alert/ngày" trong khi code là 80%, 12h re-alert) — chỉ là copy cũ, không ảnh hưởng logic.
8. **README extension đã cũ** — mô tả luồng cào FB cũ (đã tắt), không phải luồng SMIT hiện tại.
9. **Cần set thêm env nếu dùng đầy đủ:** `TOKEN_ENC_KEY` (mã hóa token — bắt buộc nếu muốn mã hóa), `TELEGRAM_BOT_TOKEN`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (web push), `ANTHROPIC_API_KEY` + `RAPIDAPI_*` (tính năng video AI, optional).

---

*Tài liệu tạo tự động bằng phân tích source code toàn bộ repo. Mọi công thức, ngưỡng, luồng API đều trích trực tiếp từ code.*
