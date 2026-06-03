// Shared CORS helper cho Chrome extension endpoints.
// SECURITY (R2.A1): KHÔNG dùng "Access-Control-Allow-Origin: *" với
// "Allow-Credentials: true" (browser reject). Whitelist origin explicit:
//   - chrome-extension://<id>
//   - moz-extension://<id> (Firefox)
//   - Domain của chính app (từ env NEXT_PUBLIC_APP_URL) — self-call
//
// Origin nào KHÔNG nằm trong list trên sẽ bị reject (string rỗng) → browser
// không cho phép request có credentials. Đây là phòng thủ bắt buộc để không
// một domain bên ngoài nào (kể cả domain cũ của repo nguyên gốc) gọi được
// API có cookie auth của user.

const SELF_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")

export function buildExtCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("moz-extension://") ||
    (SELF_ORIGIN && origin === SELF_ORIGIN)
  ) ? origin : ""
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  }
}
