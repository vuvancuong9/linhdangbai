// POST /api/push/test — gửi 1 notification test cho user hiện tại.

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { sendPushToUser } from "@/lib/web-push-server"

export async function POST() {
  try {
    const user = await requireAuth()
    const sent = await sendPushToUser(user.userId, {
      title: "🔔 Test thông báo",
      body: "Push hoạt động! Đây là tin nhắn test từ app.quybeo.com.",
      url: "/",
      tag: "test",
    })
    return NextResponse.json({ ok: true, sent })
  } catch (e: any) {
  return safeError(e, "push/test")
}
}
