import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { sendTelegramMessage } from "@/lib/telegram"
import { buildExtCorsHeaders as buildCorsHeaders } from "@/lib/ext-cors"

export const runtime = "nodejs"
export const maxDuration = 30

export async function OPTIONS(req: NextRequest) {
  const headers = buildCorsHeaders(req.headers.get("origin"))
  return new NextResponse(null, { status: 204, headers })
}

// POST /api/extension/alert
// Body: { reason, url?, kind? }
// Goi tu Chrome extension khi phat hien FB warning (checkpoint/verify/redirect)
// -> Gui Telegram alert cho user.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const reason = String(body?.reason || "Unknown").slice(0, 300)
    const url = String(body?.url || "").slice(0, 500)
    const kind = String(body?.kind || "unknown").slice(0, 50)

    const u = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { telegramChatId: true, name: true },
    })

    if (!u?.telegramChatId) {
      return NextResponse.json({
        ok: false,
        error: "User chưa setup telegram. Vào /billing cấu hình Telegram trước.",
      }, { status: 400, headers: buildCorsHeaders(req.headers.get("origin")) })
    }

    const text =
      `🚨 <b>cuongbg Extension - CẢNH BÁO FB</b>\n\n` +
      `User: <b>${escapeHtml(u.name || "?")}</b>\n` +
      `Lý do: <b>${escapeHtml(reason)}</b>\n` +
      `Kind: <code>${escapeHtml(kind)}</code>\n` +
      (url ? `URL: <code>${escapeHtml(url.slice(0, 200))}</code>\n` : "") +
      `Lúc: ${new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}\n\n` +
      `⚠ Auto-sync đã <b>TỰ ĐỘNG TẠM DỪNG</b>.\n` +
      `Vào FB kiểm tra account (xác minh, checkpoint, đăng nhập lại...). ` +
      `Xử lý xong → mở extension popup → bấm <b>Reset</b> để cho chạy lại.`

    const r = await sendTelegramMessage(u.telegramChatId, text, "HTML")
    if (!r.ok) {
      console.error("[ext-alert] Telegram fail:", r.error)
      return NextResponse.json({ ok: false, error: r.error }, { status: 500, headers: buildCorsHeaders(req.headers.get("origin")) })
    }

    console.log(`[ext-alert] Da gui Telegram alert cho user ${u.name}: ${reason}`)
    return NextResponse.json({ ok: true, message: "Đã gửi Telegram alert" }, { headers: buildCorsHeaders(req.headers.get("origin")) })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401, headers: buildCorsHeaders(req.headers.get("origin")) })
    }
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Error") }, { status: 500, headers: buildCorsHeaders(req.headers.get("origin")) })
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
}
