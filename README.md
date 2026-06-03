# FB Ads Manager

Hệ thống quản lý quảng cáo Facebook — Multi-user, Next.js + Supabase.

---

## 🚀 Cài đặt (Windows)

### Bước 1 — Clone / copy project

```bash
# Mở PowerShell hoặc CMD trong thư mục muốn chứa project
cd C:\Projects

# Copy thư mục fb-ads-tool vào đây
# hoặc git clone nếu đã push lên GitHub
```

### Bước 2 — Cài dependencies

```bash
cd fb-ads-tool
npm install
```

### Bước 3 — Tạo Supabase project

1. Vào **https://supabase.com** → Đăng ký / đăng nhập
2. Nhấn **New project** → đặt tên, chọn region (Singapore gần nhất)
3. Đợi project tạo xong (~1-2 phút)
4. Vào **Settings → Database → Connection string → URI**
5. Copy connection string

### Bước 4 — Cấu hình .env

```bash
# Copy file env mẫu
copy .env.example .env.local
```

Mở `.env.local` và điền vào:

```env
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"
JWT_SECRET="thay-bang-chuoi-random-toi-thieu-32-ky-tu"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
CRON_SECRET="thay-bang-chuoi-random-cron"
```

> Sinh JWT_SECRET / CRON_SECRET nhanh:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

### Bước 5 — Tạo bảng database

```bash
# Push schema lên Supabase
npx prisma db push

# Seed dữ liệu mẫu
npx ts-node --project tsconfig.json prisma/seed.ts
```

### Bước 6 — Chạy app

```bash
npm run dev
```

Mở trình duyệt: **http://localhost:3000**

---

## 👤 Tạo tài khoản đầu tiên

Không seed sẵn tài khoản demo. Để tạo super admin lần đầu:

```bash
# Set 3 biến môi trường rồi chạy seed
SEED_ADMIN_EMAIL=ban@vidu.com \
SEED_ADMIN_NAME="Tên Bạn" \
SEED_ADMIN_PASSWORD="MatKhauItNhat10KyTu1" \
npm run db:seed
```

Hoặc tạo user qua UI trên trang `/admin` (cần đã có 1 admin sẵn), hoặc dùng `scripts/promote-super-admin.js <email>` để nâng cấp 1 user thường lên SUPER_ADMIN.

---

## 📁 Cấu trúc project

```
fb-ads-tool/
├── prisma/
│   ├── schema.prisma      # Database schema
│   └── seed.ts            # Dữ liệu mẫu
├── src/
│   ├── app/
│   │   ├── api/           # API routes (backend)
│   │   │   ├── auth/      # login, logout, me
│   │   │   ├── users/     # CRUD users (admin)
│   │   │   ├── accounts/  # Tài khoản FB ads
│   │   │   ├── pages/     # Fanpage
│   │   │   └── campaigns/ # Campaign
│   │   ├── login/         # Trang đăng nhập
│   │   ├── admin/         # Trang admin (quản lý user)
│   │   ├── keo-ads/       # Trang Keo Ads
│   │   ├── fanpage-posts/ # Trang Fanpage Posts
│   │   ├── camp-da-xuat/  # Trang Camp đã xuất
│   │   └── quan-ly-campaign/ # Trang Quản lý Campaign
│   ├── components/        # React components tái sử dụng
│   ├── lib/               # Utilities
│   │   ├── prisma.ts      # Prisma client
│   │   ├── auth.ts        # JWT, bcrypt
│   │   ├── api.ts         # API helpers
│   │   └── cron.ts        # Cron sync FB posts
│   ├── store/             # Zustand state
│   ├── instrumentation.ts # Khởi động cron khi app boot
│   └── middleware.ts      # Route protection
├── .env.local             # Environment variables
├── package.json
└── README.md
```

---

## ☁️ Deploy lên Vercel

```bash
# Cài Vercel CLI
npm i -g vercel

# Deploy
vercel

# Điền environment variables trên Vercel Dashboard:
# DATABASE_URL, JWT_SECRET, NEXT_PUBLIC_APP_URL
```

---

## 🛠️ Lệnh hay dùng

```bash
npm run dev          # Chạy development
npm run build        # Build production
npx prisma studio    # Xem database trực quan
npx prisma db push   # Sync schema lên database
```
