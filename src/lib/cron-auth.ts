import { timingSafeEqual } from "crypto"

// Verify x-cron-secret header an toàn (timing-safe).
// Trả về true chỉ khi env CRON_SECRET set + headerValue khớp chính xác.
export function verifyCronSecret(headerValue: string | null): boolean {
  if (!headerValue) return false
  const env = process.env.CRON_SECRET
  if (!env || env.length < 16) return false // không có env hợp lệ → reject
  if (env.length !== headerValue.length) return false // length mismatch → fast reject (vẫn an toàn timing)
  try {
    return timingSafeEqual(Buffer.from(env, "utf8"), Buffer.from(headerValue, "utf8"))
  } catch {
    return false
  }
}
