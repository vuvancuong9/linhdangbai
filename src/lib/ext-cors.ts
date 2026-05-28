// Shared CORS helper cho Chrome extension endpoints.
// SECURITY (R2.A1): KHÔNG dùng "Access-Control-Allow-Origin: *" với
// "Allow-Credentials: true" (browser reject). Whitelist origin explicit:
//   - chrome-extension://<id>
//   - moz-extension://<id> (Firefox)
//   - https://app.quybeo.com (web app self-call)

export function buildExtCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("moz-extension://") ||
    origin === "https://app.quybeo.com"
  ) ? origin : ""
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  }
}
