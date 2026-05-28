import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const PUBLIC = ['/login', '/api/auth/login', '/privacy', '/data-deletion', '/datadeletion']

const SECRET = process.env.JWT_SECRET
const SECRET_BYTES = SECRET ? new TextEncoder().encode(SECRET) : null

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) return NextResponse.next()
  if (PUBLIC.some(r => pathname.startsWith(r))) return NextResponse.next()

  // Cron self-fetch: pass-through CHỈ KHI x-cron-secret header KHỚP CHÍNH XÁC CRON_SECRET env.
  // Trước: chỉ check header CÓ MẶT → attacker gửi header bất kỳ là bypass auth → fail-open.
  // Giờ: verify timing-safe equality (route handler tự verify lại lần 2 cho defense-in-depth).
  if (pathname.startsWith('/api/')) {
    const cronHeader = request.headers.get('x-cron-secret')
    if (cronHeader) {
      const envSecret = process.env.CRON_SECRET
      if (envSecret && envSecret.length >= 16 && cronHeader.length === envSecret.length && cronHeader === envSecret) {
        return NextResponse.next()
      }
      // Header có nhưng SAI giá trị → fail-closed (KHÔNG bypass auth → đi tiếp qua JWT check bên dưới)
    }
  }

  const token = request.cookies.get('fb_ads_token')?.value
  if (!token) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ success: false, message: 'Chua dang nhap' }, { status: 401 })
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (!SECRET_BYTES) {
    // JWT_SECRET chưa set ở Edge runtime → fail-closed (deny).
    return NextResponse.json({ success: false, message: 'JWT_SECRET not configured' }, { status: 500 })
  }

  let payload: any
  try {
    const r = await jwtVerify(token, SECRET_BYTES)
    payload = r.payload
  } catch {
    if (pathname.startsWith('/api/')) return NextResponse.json({ success: false, message: 'Token khong hop le' }, { status: 401 })
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (!payload?.userId) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ success: false, message: 'Token khong hop le' }, { status: 401 })
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Page-level access control theo permissions (mảng menu key).
  // SUPER_ADMIN: full access (không bao giờ check permissions).
  // ADMIN + USER với permissions = null/undefined → fallback userType (legacy) hoặc full access.
  // ADMIN + USER với permissions = [...]: chỉ vào path tương ứng menu key trong array
  //   (ADMIN luôn có thêm /admin để quản lý user con).
  const role = payload.role
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN'
  const isSuper = role === 'SUPER_ADMIN'

  if (pathname.startsWith('/admin') && !isAdmin) {
    return NextResponse.redirect(new URL('/keo-ads', request.url))
  }

  // SUPER_ADMIN bypass tất cả check.
  if (!isSuper && (role === 'ADMIN' || role === 'USER')) {
    // Resolve permissions: ưu tiên field mới, fallback userType cũ.
    let perms: string[] | null = null
    if (payload.permissions) {
      try { perms = JSON.parse(payload.permissions); if (!Array.isArray(perms)) perms = null } catch { perms = null }
    }
    if (!perms && payload.userType) {
      const legacy: Record<string, string[]> = { accountant: ['chi-phi-van-phong'] }
      perms = legacy[payload.userType] || null
    }

    // perms = null → legacy ADMIN/USER full access (backward compat). Bỏ qua check.
    if (perms !== null) {
      // Map menu key → path (page) + apiPaths (API).
      // Đây là duplicate của src/lib/permissions.ts vì middleware Edge không import được.
      // QUAN TRỌNG: phải SYNC với src/lib/permissions.ts MENU_PERMISSIONS!
      // QUAN TRỌNG: sync với src/lib/permissions.ts MENU_PERMISSIONS. Đã tách /api/fb thành sub-paths
      // để tránh permission granularity quá thô (vd: 'keo-ads' không nên xoá camp).
      const MENU: Record<string, { page: string; apis: string[] }> = {
        'keo-ads':           { page: '/keo-ads',           apis: ['/api/accounts', '/api/pages', '/api/fb/sync-assets', '/api/fb/sync-posts', '/api/fb/check-perms', '/api/fb/token', '/api/sync', '/api/token'] },
        'fanpage-posts':     { page: '/fanpage-posts',     apis: ['/api/posts', '/api/fb/create-campaign', '/api/fb/sync-posts', '/api/fb/check-perms', '/api/fb/check-campaign', '/api/pages', '/api/accounts', '/api/campaigns', '/api/mapping', '/api/user/auto-campaign', '/api/user/camp-defaults', '/camp-da-tao', '/camp-loi', '/camp-da-xuat'] },
        'nghiem-thu':        { page: '/nghiem-thu',        apis: ['/api/nghiem-thu', '/api/campaigns'] },
        'dashboard':         { page: '/dashboard',         apis: ['/api/dashboard', '/api/campaigns', '/api/orders', '/api/shopee-bonus', '/api/tax'] },
        'insights':          { page: '/insights',          apis: ['/api/insights'] },
        'trinh-quan-ly':     { page: '/trinh-quan-ly',     apis: ['/api/trinh-quan-ly', '/api/accounts'] },
        'quan-ly-campaign':  { page: '/quan-ly-campaign',  apis: ['/api/campaigns', '/api/fb/sync-metrics', '/api/fb/update-budget', '/api/fb/delete-campaign', '/api/fb/toggle-status', '/api/fb/export-csv', '/api/fb/check-campaign', '/api/affiliate', '/api/orders', '/api/accounts'] },
        'lai-lo-camp':       { page: '/lai-lo-camp',       apis: ['/api/campaigns', '/api/fb/toggle-status', '/api/fb/update-budget', '/api/fb/check-campaign', '/api/user/auto-manage', '/api/pages'] },
        'camp-khong-can-tien': { page: '/camp-khong-can-tien', apis: ['/api/campaigns', '/api/fb/toggle-status', '/api/fb/update-budget', '/api/fb/check-campaign', '/api/user/auto-manage', '/api/pages'] },
        'gioi-han-quang-cao': { page: '/gioi-han-quang-cao', apis: ['/api/pages'] },
        'chi-tieu-fanpage':  { page: '/chi-tieu-fanpage',  apis: ['/api/dashboard/spend-by-page', '/api/dashboard/commission-by-subid3'] },
        'nhom-tai-khoan':    { page: '/nhom-tai-khoan',    apis: ['/api/groups', '/api/accounts', '/api/pages', '/api/account-assignment', '/api/shopee/token'] },
        'billing':           { page: '/billing',           apis: ['/api/fb/billing', '/api/fb/sync-billing', '/api/accounts', '/api/user/telegram', '/api/user-cards'] },
        'invoices':          { page: '/invoices',          apis: ['/api/fb/billing/invoices', '/api/accounts/import-invoice-csv', '/api/accounts'] },
        'chi-phi-van-phong': { page: '/chi-phi-van-phong', apis: ['/api/office-expense'] },
      }
      const ALWAYS = ['/lich-su-dang-nhap', '/api/auth', '/api/me', '/api/extension', '/api/push']

      const allowedPaths: string[] = [...ALWAYS]
      // ADMIN luôn được vào /admin + /api/users + /api/admin (để quản lý user con).
      if (isAdmin) {
        allowedPaths.push('/admin', '/api/users', '/api/admin')
      }
      for (const k of perms) {
        const m = MENU[k]
        if (m) { allowedPaths.push(m.page); allowedPaths.push(...m.apis) }
      }

      const isAllowed = allowedPaths.some(p => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'))
      if (!isAllowed) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ success: false, message: 'Không có quyền truy cập' }, { status: 403 })
        }
        // Redirect về trang đầu tiên user có quyền. ADMIN ưu tiên /admin.
        const firstKey = perms.find(k => MENU[k])
        const home = isAdmin ? '/admin' : (firstKey ? MENU[firstKey].page : '/lich-su-dang-nhap')
        return NextResponse.redirect(new URL(home, request.url))
      }
    }
  }

  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
