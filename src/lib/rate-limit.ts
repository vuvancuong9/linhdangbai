// Rate limiter in-memory đơn giản (đủ cho 1 instance Railway).
// Nếu scale nhiều instance → cần Redis/Upstash. Hiện tại 1 instance nên OK.

type Bucket = { count: number; lockedUntil: number; resetAt: number }
const buckets = new Map<string, Bucket>()

const MAX_BUCKETS = 5000 // chống memory leak nếu attacker spam IP/email khác nhau

function evictIfFull() {
  if (buckets.size <= MAX_BUCKETS) return
  // Xóa 20% bucket cũ nhất theo resetAt
  const arr = Array.from(buckets.entries()).sort((a, b) => a[1].resetAt - b[1].resetAt)
  const toRemove = Math.floor(MAX_BUCKETS * 0.2)
  for (let i = 0; i < toRemove; i++) buckets.delete(arr[i][0])
}

/**
 * Check + consume 1 attempt cho key.
 * Trả về { ok: false, retryAfterSec } nếu đã bị lock; { ok: true } nếu chưa.
 *
 * @param key   key duy nhất (vd: `login:${email}` hoặc `login:${ip}`)
 * @param max   số lần fail tối đa trong window
 * @param windowMs  cửa sổ thời gian (ms)
 * @param lockMs    khóa bao lâu sau khi vượt max
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
  lockMs: number
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || b.resetAt < now) {
    b = { count: 0, lockedUntil: 0, resetAt: now + windowMs }
    buckets.set(key, b)
    evictIfFull()
  }
  if (b.lockedUntil > now) {
    return { ok: false, retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000) }
  }
  return { ok: true, retryAfterSec: 0 }
}

// Báo 1 fail attempt cho key. Khi count vượt max → lock theo lockMs.
export function recordFail(key: string, max: number, windowMs: number, lockMs: number): void {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || b.resetAt < now) {
    b = { count: 0, lockedUntil: 0, resetAt: now + windowMs }
  }
  b.count += 1
  if (b.count >= max) {
    b.lockedUntil = now + lockMs
  }
  buckets.set(key, b)
  evictIfFull()
}

// Báo 1 success attempt → reset bucket.
export function recordSuccess(key: string): void {
  buckets.delete(key)
}
