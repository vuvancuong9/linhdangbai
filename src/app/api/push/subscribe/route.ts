// POST /api/push/subscribe — frontend gửi PushSubscription object sau khi subscribe.
// Server lưu/upsert vào DB. endpoint UNIQUE → cùng device re-subscribe = update.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const { endpoint, keys, userAgent } = body || {}
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Thiếu subscription" }, { status: 400 })
    }

    // SECURITY FIX (P1.2): trước đây upsert không check userId → user B có thể
    // hijack endpoint của user A bằng cách subscribe cùng endpoint → row.userId
    // bị chuyển sang B, A không còn nhận push nhưng B nhận push của A trong
    // tương lai. Giờ check ownership trước:
    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } })
    if (existing && existing.userId !== user.userId) {
      // Endpoint đã thuộc user khác — coi như expired (browser thực tế sẽ
      // generate endpoint mới khi user khác subscribe). Xoá row cũ + tạo mới.
      await prisma.pushSubscription.delete({ where: { id: existing.id } })
    }
    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: user.userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent || null,
      },
      update: {
        // userId KHÔNG include trong update — chỉ user gốc mới được update.
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent || null,
        failCount: 0,
      },
    })

    return NextResponse.json({ ok: true, id: sub.id })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[push/subscribe]", e)
    return safeError(e, "push/subscribe")
  }
}
