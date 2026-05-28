import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

function loadJwtSecret(): string {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET environment variable is required (min 16 chars). Set it in .env.local')
  }
  return s
}
const JWT_SECRET: string = loadJwtSecret()
const COOKIE_NAME = 'fb_ads_token'

export interface JWTPayload {
  userId: string
  email: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER'
  name: string
  sessionId?: string
  // userType: legacy. Dùng làm fallback nếu permissions chưa set. DEPRECATED.
  userType?: 'accountant' | 'product_finder' | null
  // permissions: JSON string của array menu keys (src/lib/permissions.ts).
  // Null/undefined = full access (admin hoặc legacy USER chưa migrate).
  permissions?: string | null
  // parentId = id của ADMIN tạo user này (cho USER và ADMIN do SUPER_ADMIN tạo).
  // Dùng để xác định scope data của ADMIN.
  parentId?: string | null
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): JWTPayload | null {
  try { return jwt.verify(token, JWT_SECRET) as JWTPayload } catch { return null }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function createLoginSession(userId: string, ipAddress?: string, userAgent?: string): Promise<string> {
  const session = await prisma.loginSession.create({
    data: { userId, ipAddress, userAgent }
  })
  return session.id
}

export async function getCurrentUser(): Promise<JWTPayload | null> {
  try {
    const cookieStore = cookies()
    const token = cookieStore.get(COOKIE_NAME)?.value
    if (!token) return null
    return verifyToken(token)
  } catch { return null }
}

export function setAuthCookie(token: string) {
  const cookieStore = cookies()
  cookieStore.set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 60 * 60 * 24 * 7, path: '/' })
}

export function clearAuthCookie() {
  const cookieStore = cookies()
  cookieStore.delete(COOKIE_NAME)
}

// Cache session check trong process memory để giảm hit DB.
// Mỗi user có thể fetch 5-10 endpoint cùng lúc khi mở trang → trước đây = 5-10 query
// loginSession.findUnique → exhaust connection pool Supabase.
// Cache TTL 60s: nếu user logout ở trình duyệt khác, session bị revoke sẽ effective sau ≤60s.
type SessionStatus = { revoked: boolean; ts: number }
const sessionCache = new Map<string, SessionStatus>()
const SESSION_TTL = 60 * 1000
const SESSION_CACHE_MAX = 5000

function setSessionCache(sessionId: string, revoked: boolean) {
  if (sessionCache.size >= SESSION_CACHE_MAX) {
    const firstKey = sessionCache.keys().next().value
    if (firstKey) sessionCache.delete(firstKey)
  }
  sessionCache.delete(sessionId)
  sessionCache.set(sessionId, { revoked, ts: Date.now() })
}

// Public: gọi từ logout / revoke session để invalidate cache ngay.
export function invalidateSessionCache(sessionId: string) {
  sessionCache.delete(sessionId)
}

export async function requireAuth(): Promise<JWTPayload> {
  const user = await getCurrentUser()
  if (!user) throw new Error('UNAUTHORIZED')
  // Nếu token có sessionId → check xem session bị revoke chưa (có cache 60s).
  if (user.sessionId) {
    const cached = sessionCache.get(user.sessionId)
    if (cached && Date.now() - cached.ts < SESSION_TTL) {
      if (cached.revoked) throw new Error('UNAUTHORIZED')
      return user
    }
    const session = await prisma.loginSession.findUnique({ where: { id: user.sessionId }, select: { revokedAt: true } })
    const revoked = !session || !!session.revokedAt
    setSessionCache(user.sessionId, revoked)
    if (revoked) throw new Error('UNAUTHORIZED')
  }
  return user
}

export function isAdminRole(role: string | undefined | null): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

export async function requireAdmin(): Promise<JWTPayload> {
  const user = await requireAuth()
  if (!isAdminRole(user.role)) throw new Error('FORBIDDEN')
  return user
}

export async function requireSuperAdmin(): Promise<JWTPayload> {
  const user = await requireAuth()
  if (user.role !== 'SUPER_ADMIN') throw new Error('FORBIDDEN')
  return user
}

// =============== PHÂN QUYỀN THEO CÂY (ADMIN chỉ thấy data của team mình) ===============

// Trả về danh sách userId mà user hiện tại được phép xem data.
// - SUPER_ADMIN: tất cả users
// - ADMIN: bản thân + tất cả USER có parentId = bản thân
// - USER: bản thân (USER không có quyền xem data của ai khác)
//
// Dùng trong API endpoints để filter `where userId IN (...)`.
export async function getViewableUserIds(jwt: JWTPayload): Promise<string[]> {
  if (jwt.role === 'SUPER_ADMIN') {
    const all = await prisma.user.findMany({ select: { id: true } })
    return all.map((u) => u.id)
  }
  if (jwt.role === 'ADMIN') {
    const children = await prisma.user.findMany({
      where: { parentId: jwt.userId },
      select: { id: true },
    })
    return [jwt.userId, ...children.map((c) => c.id)]
  }
  // USER chỉ thấy data của mình
  return [jwt.userId]
}

// Resolve "owner" id - data của ai (FB token + Camp/Post belong to whom).
// - SUPER_ADMIN → return self.id (root)
// - ADMIN có parentId (= ADMIN con do SUPER_ADMIN tạo) → return parentId (boss owns FB token + camp)
// - USER có parentId → return parentId (boss owns data)
// - Bất kỳ ai không có parentId (legacy hoặc SUPER_ADMIN gốc) → return self.id
//
// ⚠️ ARCHITECTURE DECISION (2026-05-25): Data ownership trong app này LÀ self-scoped
// (`user.userId`), KHÔNG phải tree-rooted. Sync flow (sync-assets, sync-posts, etc.)
// đều tạo row với `userId = user.userId` của người trigger. Tất cả ~71 routes data
// dùng `user.userId` thẳng. `resolveOwnerId` CHỈ còn dùng cho FB token lookup
// (getFbToken) — vì FB token có thể delegate xuống child users qua parentId trong
// tương lai.
//
// LÀM ƠN KHÔNG dùng `resolveOwnerId` cho data scoping nữa — gây inconsistent giữa
// các trang. Nếu cần USER child xem data của parent, dùng `getViewableUserIds`
// (read-only audit pattern, đã áp dụng cho /api/posts/[id] + /api/camp-logs).
export async function resolveOwnerId(jwt: JWTPayload): Promise<string> {
  if (jwt.role === 'SUPER_ADMIN') return jwt.userId
  // ADMIN + USER: nếu có parentId → return parentId (boss). Nếu không → self.
  if (jwt.parentId !== undefined) {
    return jwt.parentId || jwt.userId
  }
  const u = await prisma.user.findUnique({
    where: { id: jwt.userId },
    select: { parentId: true },
  })
  return u?.parentId || jwt.userId
}
