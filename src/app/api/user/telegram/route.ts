import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { sendTelegramMessage } from "@/lib/telegram"

export const runtime = "nodejs"

// GET /api/user/telegram → lấy chat ID hiện tại
export async function GET() {
  try {
    const user = await requireAuth()
    const u = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { telegramChatId: true },
    })
    return NextResponse.json({ ok: true, chatId: u?.telegramChatId || "" })
  } catch (e: any) {
  return safeError(e, "user/telegram")
}
}

// PATCH /api/user/telegram → update chat ID, body { chatId: string }
// Empty string = xoá config (tắt alert).
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const raw = String(body?.chatId || "").trim()
    // Validate: chatId là số (positive cho user, negative cho group), max 20 ký tự
    if (raw && !/^-?\d{1,20}$/.test(raw)) {
      return NextResponse.json({ error: "Chat ID phải là số (vd 123456789). Lấy từ @userinfobot trên Telegram." }, { status: 400 })
    }
    await prisma.user.update({
      where: { id: user.userId },
      data: { telegramChatId: raw || null },
    })
    return NextResponse.json({ ok: true, chatId: raw })
  } catch (e: any) {
  return safeError(e, "user/telegram")
}
}

// POST /api/user/telegram (test) → gửi tin test tới chat ID hiện tại
// Debug info: trả thêm tokenSet, tokenPrefix (4 ký tự), botInfo (sau khi test) để user verify.
export async function POST() {
  try {
    const user = await requireAuth()
    const u = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { name: true, telegramChatId: true },
    })
    if (!u?.telegramChatId) {
      return NextResponse.json({ error: "Chưa cấu hình Chat ID — lưu trước khi test" }, { status: 400 })
    }

    const token = process.env.TELEGRAM_BOT_TOKEN
    const debug: any = {
      tokenSet: !!token,
      tokenLength: token?.length || 0,
      tokenPrefix: token ? token.slice(0, 4) + "..." : "(empty)",
      chatId: u.telegramChatId,
    }

    if (!token) {
      return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN chưa set trên Railway env", debug }, { status: 500 })
    }

    // Verify bot trước: gọi getMe để biết bot có sống không
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`)
      const meData: any = await meRes.json().catch(() => ({}))
      if (meData?.ok) {
        debug.botUsername = meData.result?.username
        debug.botName = meData.result?.first_name
      } else {
        return NextResponse.json({
          error: `Bot token sai hoặc bị revoke: ${meData?.description || "unknown"}`,
          debug,
        }, { status: 500 })
      }
    } catch (e: any) {
      return NextResponse.json({ error: "Không kết nối được Telegram API: " + e?.message, debug }, { status: 500 })
    }

    const r = await sendTelegramMessage(
      u.telegramChatId,
      `<b>🤖 cuongbg Alert</b>\n\nXin chào <b>${u.name || "bạn"}</b>!\nKết nối Telegram thành công ✅\n\nBạn sẽ nhận cảnh báo khi <b>balance/threshold ≥ 80%</b> của TKQC có threshold &gt; 2.000.000đ.\nCron check 10p mỗi lần.`,
    )
    if (!r.ok) {
      return NextResponse.json({
        error: "Gửi fail: " + r.error,
        debug,
        hint: r.error?.includes("chat not found")
          ? `Anh chưa bấm Start với bot @${debug.botUsername}. Mở t.me/${debug.botUsername} → bấm Start → thử lại.`
          : r.error?.includes("blocked")
          ? "Anh đã block bot này. Mở chat bot → unblock → thử lại."
          : undefined,
      }, { status: 500 })
    }
    return NextResponse.json({ ok: true, message: `Đã gửi tin test qua bot @${debug.botUsername} — kiểm tra Telegram`, debug })
  } catch (e: any) {
  return safeError(e, "user/telegram")
}
}
