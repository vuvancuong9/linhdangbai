import { NextResponse } from 'next/server'

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status })
}

export function err(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

export function unauthorized() { return err('Chưa đăng nhập', 401) }
export function forbidden() { return err('Không có quyền', 403) }
export function notFound(what = 'Không tìm thấy') { return err(what, 404) }

// safeError: production trả error generic + log stack server-side.
// Dev/staging trả full error.message để debug.
// Dùng cho 500 catch block trong route handlers thay vì `e?.message`.
export function safeError(e: any, prefix = 'Error', status = 500): NextResponse {
  const isProd = process.env.NODE_ENV === 'production'
  const msg = e?.message || String(e)
  // Log đầy đủ server-side (Railway logs)
  console.error(`[${prefix}]`, e?.stack || e)
  // Auth errors map sang status code đúng
  if (msg === 'UNAUTHORIZED') return unauthorized()
  if (msg === 'FORBIDDEN') return forbidden()
  // Production: KHÔNG expose Prisma error / stack trace / DB column names
  return NextResponse.json(
    { error: isProd ? 'Internal server error' : msg },
    { status }
  )
}

export async function apiHandler(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try { return await fn() } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Lỗi server'
    if (msg === 'UNAUTHORIZED') return unauthorized()
    if (msg === 'FORBIDDEN') return forbidden()
    console.error('[apiHandler]', e)
    const isProd = process.env.NODE_ENV === 'production'
    return err(isProd ? 'Lỗi server nội bộ' : msg, 500)
  }
}
