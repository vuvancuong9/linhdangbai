import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { comparePassword, signToken, createLoginSession } from '@/lib/auth'
import { checkRateLimit, recordFail, recordSuccess } from '@/lib/rate-limit'

// Rate limit: 5 lần fail / 15 phút → lock 15 phút.
const MAX_FAILS = 5
const WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    // SECURITY (R2.A4): normalize email case → ngăn brute-force spread
    // (Admin@x.com vs admin@x.com nhân đôi rate-limit budget). Match
    // emailKey lowercase pattern bên dưới.
    const email = String(body?.email || '').toLowerCase().trim()
    const password = body?.password
    if (!email || !password) return NextResponse.json({ success: false, message: 'Thieu thong tin' }, { status: 400 })

    // Rate limit theo email + IP (kết hợp để chặn brute-force kiểu spread).
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
    const emailKey = `login:email:${email}`  // đã lowercase + trim ở trên
    const ipKey = `login:ip:${ip}`
    const checkEmail = checkRateLimit(emailKey, MAX_FAILS, WINDOW_MS, LOCK_MS)
    const checkIp = checkRateLimit(ipKey, MAX_FAILS * 2, WINDOW_MS, LOCK_MS)
    const retry = Math.max(checkEmail.retryAfterSec, checkIp.retryAfterSec)
    if (retry > 0) {
      return NextResponse.json(
        { success: false, message: `Quá nhiều lần đăng nhập sai. Thử lại sau ${Math.ceil(retry / 60)} phút.` },
        { status: 429, headers: { 'Retry-After': String(retry) } }
      )
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      recordFail(emailKey, MAX_FAILS, WINDOW_MS, LOCK_MS)
      recordFail(ipKey, MAX_FAILS * 2, WINDOW_MS, LOCK_MS)
      return NextResponse.json({ success: false, message: 'Email hoac mat khau khong dung' }, { status: 401 })
    }
    if (user.status === 'LOCKED') return NextResponse.json({ success: false, message: 'Tai khoan bi khoa' }, { status: 403 })
    const valid = await comparePassword(password, user.password)
    if (!valid) {
      recordFail(emailKey, MAX_FAILS, WINDOW_MS, LOCK_MS)
      recordFail(ipKey, MAX_FAILS * 2, WINDOW_MS, LOCK_MS)
      return NextResponse.json({ success: false, message: 'Email hoac mat khau khong dung' }, { status: 401 })
    }
    // Login thành công → clear rate-limit bucket cho email + IP.
    recordSuccess(emailKey)
    recordSuccess(ipKey)

    const userAgent = req.headers.get('user-agent') || undefined
    const sessionId = await createLoginSession(user.id, ip === 'unknown' ? undefined : ip, userAgent)

    // Include userType + permissions + parentId trong JWT → middleware (Edge) check route access không cần query DB.
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      sessionId,
      userType: (user as any).userType ?? null,
      permissions: (user as any).permissions ?? null,
      parentId: (user as any).parentId ?? null,
    }
    const token = signToken(payload)
    const response = NextResponse.json({ success: true, data: { user: { userId: user.id, email: user.email, role: user.role, name: user.name, userType: (user as any).userType ?? null, permissions: (user as any).permissions ?? null } } })
    response.cookies.set('fb_ads_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
      path: '/'
    })
    return response
  } catch (e) {
    console.error('[LOGIN ERROR]', e)
    return NextResponse.json({ success: false, message: 'Loi server' }, { status: 500 })
  }
}
