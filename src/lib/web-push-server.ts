// Gửi Web Push notification từ server.
// Dùng web-push lib (RFC 8030 + VAPID).
// VAPID keys lưu env: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT (mailto:).
//
// Tự cleanup subscription expired (HTTP 404/410 từ push service).

import webpush from "web-push"
import { prisma } from "./prisma"

let configured = false
function ensureConfig() {
  if (configured) return true
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || "mailto:noreply@app.quybeo.com"
  if (!pub || !priv) {
    console.warn("[web-push] VAPID keys chưa set — push sẽ không hoạt động")
    return false
  }
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
  return true
}

export type PushPayload = {
  title: string
  body: string
  url?: string            // URL mở khi click notification
  tag?: string            // Group notification (tag mới đè cũ cùng tag)
  icon?: string
  requireInteraction?: boolean
}

// Gửi push cho 1 user (qua TẤT CẢ device đã subscribe).
// Trả về số subscription gửi thành công.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfig()) return 0
  const subs = await prisma.pushSubscription.findMany({ where: { userId } })
  if (subs.length === 0) return 0

  const payloadStr = JSON.stringify(payload)
  let okCount = 0
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payloadStr,
        { TTL: 60 * 60 * 24 },  // 24h — push service giữ message này tối đa 1 ngày
      )
      okCount++
      // Reset failCount + update lastUsedAt
      await prisma.pushSubscription.update({
        where: { id: sub.id },
        data: { failCount: 0, lastUsedAt: new Date() },
      }).catch(() => {})
    } catch (e: any) {
      const status = e?.statusCode
      // 404 Not Found, 410 Gone → subscription expired (user uninstall app, tắt push, đổi browser).
      // Xoá để không retry.
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
        return
      }
      // Lỗi khác → tăng failCount, xoá khi >5.
      const next = (sub.failCount || 0) + 1
      if (next >= 5) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
      } else {
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { failCount: next },
        }).catch(() => {})
      }
      console.warn(`[web-push] send fail (${status || "no-code"}) for user ${userId}: ${e?.message}`)
    }
  }))
  return okCount
}

// Helper: kiểm tra user có sub đang active không.
export async function userHasActivePushSub(userId: string): Promise<boolean> {
  const count = await prisma.pushSubscription.count({ where: { userId } })
  return count > 0
}
