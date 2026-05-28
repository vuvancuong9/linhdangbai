// Gửi tin nhắn qua Telegram Bot API.
// Bot token global env TELEGRAM_BOT_TOKEN (1 bot dùng cho mọi user của app).
// Mỗi user có chatId riêng (User.telegramChatId) để bot biết gửi cho ai.

const TG_API = "https://api.telegram.org"

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: "HTML" | "Markdown" | "" = "HTML",
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN chưa set trên Railway env" }
  if (!chatId) return { ok: false, error: "Thiếu chatId" }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const url = `${TG_API}/bot${token}/sendMessage`
    const body: any = { chat_id: chatId, text, disable_web_page_preview: true }
    if (parseMode) body.parse_mode = parseMode
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok || !d.ok) {
      return { ok: false, error: d.description || `HTTP ${r.status}` }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.name === "AbortError" ? "Timeout" : (e?.message || "Fetch fail") }
  }
}

// Format số VND có dấu chấm hàng nghìn cho message đẹp
export function fmtVndShort(n: number | bigint): string {
  const num = typeof n === "bigint" ? Number(n) : n
  if (!Number.isFinite(num)) return "—"
  return num.toLocaleString("vi-VN") + "đ"
}
