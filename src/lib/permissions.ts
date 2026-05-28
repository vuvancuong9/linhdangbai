// Định nghĩa các menu/quyền có thể gán cho USER.
// Admin tích chọn từ danh sách này khi tạo/sửa user.
//
// `key` = identifier lưu trong DB (User.permissions JSON array).
// `path` = path Next.js. Middleware whitelist user vào path này.
// Path con (`/api/...`) tự động map theo `apiPaths`.

export interface MenuPermission {
  key: string
  label: string
  path: string
  apiPaths: string[]
  group: 'main' | 'manage' | 'finance'
}

// Granular FB sub-paths:
//   /api/fb/sync-*: dùng cho keo-ads, fanpage-posts, billing (đọc thông tin)
//   /api/fb/create-campaign, /api/fb/update-budget, /api/fb/delete-campaign, /api/fb/toggle-status: chỉ fanpage-posts + quan-ly-campaign + lai-lo-camp
//   /api/fb/billing: chỉ billing menu
//   /api/fb/check-perms, check-campaign: debug, allow tất cả menu có FB
export const MENU_PERMISSIONS: MenuPermission[] = [
  // CHÍNH
  { key: 'keo-ads',           label: 'Kéo Ads',            path: '/keo-ads',           apiPaths: ['/api/accounts', '/api/pages', '/api/fb/sync-assets', '/api/fb/sync-posts', '/api/fb/check-perms', '/api/fb/token', '/api/sync', '/api/token'], group: 'main' },
  { key: 'fanpage-posts',     label: 'Fanpage Posts',      path: '/fanpage-posts',     apiPaths: ['/api/posts', '/api/fb/create-campaign', '/api/fb/sync-posts', '/api/fb/check-perms', '/api/fb/check-campaign', '/api/pages', '/api/accounts', '/api/campaigns', '/api/mapping', '/api/user/auto-campaign', '/api/user/camp-defaults', '/camp-da-tao', '/camp-loi', '/camp-da-xuat'], group: 'main' },
  { key: 'nghiem-thu',        label: 'Nghiệm thu Shopee',  path: '/nghiem-thu',        apiPaths: ['/api/nghiem-thu', '/api/campaigns'], group: 'main' },
  // QUẢN LÝ
  { key: 'dashboard',         label: 'Dashboard',          path: '/dashboard',         apiPaths: ['/api/dashboard', '/api/campaigns', '/api/orders', '/api/shopee-bonus', '/api/tax'], group: 'manage' },
  { key: 'insights',          label: 'Insights (Top SP)',  path: '/insights',          apiPaths: ['/api/insights'], group: 'manage' },
  { key: 'trinh-quan-ly',     label: 'Trình quản lý',      path: '/trinh-quan-ly',     apiPaths: ['/api/trinh-quan-ly', '/api/accounts'], group: 'manage' },
  { key: 'quan-ly-campaign',  label: 'Quản lý Campaign',   path: '/quan-ly-campaign',  apiPaths: ['/api/campaigns', '/api/fb/sync-metrics', '/api/fb/update-budget', '/api/fb/delete-campaign', '/api/fb/toggle-status', '/api/fb/export-csv', '/api/fb/check-campaign', '/api/affiliate', '/api/orders', '/api/accounts'], group: 'manage' },
  { key: 'lai-lo-camp',       label: 'Lãi/Lỗ Camp',        path: '/lai-lo-camp',       apiPaths: ['/api/campaigns', '/api/fb/toggle-status', '/api/fb/update-budget', '/api/fb/check-campaign', '/api/user/auto-manage', '/api/pages'], group: 'manage' },
  { key: 'camp-khong-can-tien', label: 'Camp không cắn tiền', path: '/camp-khong-can-tien', apiPaths: ['/api/campaigns', '/api/fb/toggle-status', '/api/fb/update-budget', '/api/fb/check-campaign', '/api/user/auto-manage', '/api/pages'], group: 'manage' },
  { key: 'gioi-han-quang-cao', label: 'Giới hạn QC Page',   path: '/gioi-han-quang-cao', apiPaths: ['/api/pages'], group: 'manage' },
  { key: 'chi-tieu-fanpage',  label: 'Chi tiêu Fanpage',   path: '/chi-tieu-fanpage',  apiPaths: ['/api/dashboard/spend-by-page', '/api/dashboard/commission-by-subid3'], group: 'manage' },
  { key: 'nhom-tai-khoan',    label: 'Nhóm tài khoản',     path: '/nhom-tai-khoan',    apiPaths: ['/api/groups', '/api/accounts', '/api/pages', '/api/account-assignment', '/api/shopee/token'], group: 'manage' },
  { key: 'billing',           label: 'Billing FB',         path: '/billing',           apiPaths: ['/api/fb/billing', '/api/fb/sync-billing', '/api/accounts', '/api/user/telegram', '/api/user-cards'], group: 'manage' },
  { key: 'invoices',          label: 'Invoices',           path: '/invoices',          apiPaths: ['/api/fb/billing/invoices', '/api/accounts/import-invoice-csv', '/api/accounts'], group: 'manage' },
  // Note: /api/accounts/sync-invoices-from-ext + sync-threshold-from-ext là sub-paths của /api/accounts → đã match
  // TÀI CHÍNH
  { key: 'chi-phi-van-phong', label: 'Chi phí văn phòng',  path: '/chi-phi-van-phong', apiPaths: ['/api/office-expense'], group: 'finance' },
]

export const MENU_KEYS = MENU_PERMISSIONS.map(m => m.key)

// Path luôn cho phép USER nào cũng vào (không cần permission)
export const ALWAYS_ALLOWED = [
  '/lich-su-dang-nhap',
  '/api/auth',
  '/api/me',
  '/api/extension',
  '/api/push',   // Web Push: subscribe/unsubscribe/public-key — mọi user đã login đều dùng được
]

// Backward compat: userType cũ → permissions mặc định.
const LEGACY_USERTYPE_MAP: Record<string, string[]> = {
  accountant: ['chi-phi-van-phong'],
}

// Parse permissions từ DB (lưu dạng JSON string) hoặc fallback userType cũ.
// Trả về null = full access (SUPER_ADMIN hoặc legacy USER/ADMIN không bị giới hạn).
export function parsePermissions(input: { permissions?: string | null; userType?: string | null; role?: string | null }): string[] | null {
  // CHỈ SUPER_ADMIN luôn full quyền. ADMIN con có thể bị giới hạn.
  if (input.role === 'SUPER_ADMIN') return null

  // Có permissions trong DB → dùng cái đó
  if (input.permissions) {
    try {
      const parsed = JSON.parse(input.permissions)
      if (Array.isArray(parsed)) {
        return parsed.filter(k => typeof k === 'string' && MENU_KEYS.includes(k))
      }
    } catch {}
  }

  // Fallback: legacy userType → map
  if (input.userType && LEGACY_USERTYPE_MAP[input.userType]) {
    return LEGACY_USERTYPE_MAP[input.userType]
  }

  // Legacy USER không có gì → full access (giữ tương thích cũ)
  return null
}

// Check user có quyền truy cập path không.
// permissions = null → full access. permissions = [] → không có quyền nào.
export function isPathAllowed(pathname: string, permissions: string[] | null): boolean {
  if (permissions === null) return true // admin hoặc legacy full

  // Always-allowed
  if (ALWAYS_ALLOWED.some(p => pathname === p || pathname.startsWith(p + '/'))) return true

  // Check theo permissions: với mỗi key user có, check path có khớp không
  for (const key of permissions) {
    const menu = MENU_PERMISSIONS.find(m => m.key === key)
    if (!menu) continue
    // Match page path (exact hoặc prefix)
    if (pathname === menu.path || pathname.startsWith(menu.path + '/')) return true
    // Match api path
    for (const ap of menu.apiPaths) {
      if (pathname === ap || pathname.startsWith(ap + '/')) return true
    }
  }
  return false
}

// Path mặc định khi user vào root hoặc page không có quyền.
export function getHomePath(permissions: string[] | null): string {
  if (permissions === null) return '/keo-ads'
  if (permissions.length === 0) return '/lich-su-dang-nhap'
  const first = MENU_PERMISSIONS.find(m => permissions.includes(m.key))
  return first?.path || '/lich-su-dang-nhap'
}
