// Auto-cleanup data cũ để giữ DB gọn.
// Gọi từ cron weekly hoặc admin manual trigger.
//
// Chính sách giữ data:
// - LoginSession revoked > 30 ngày → XOÁ (không còn ý nghĩa audit)
// - LoginSession lastSeenAt > 90 ngày → XOÁ (session bỏ quên)
// - CampLog > 90 ngày → XOÁ (log debug, đủ để truy vết 3 tháng)
// - OrderCommission status=cancelled clickDate > 180 ngày → XOÁ (đơn đã huỷ, không cần audit dài)
// - AffiliateCommissionDaily date > 365 ngày → XOÁ (click data > 1 năm không xài)
// - Post deleted=true deletedAt > 30 ngày → hard delete
//
// Tất cả dùng deleteMany có WHERE date filter — Postgres tự VACUUM sau.

import { prisma } from "./prisma"

export interface CleanupResult {
  loginSessionRevoked: number
  loginSessionStale: number
  campLogOld: number
  orderCommissionCancelled: number
  affiliateClicksOld: number
  postsSoftDeleted: number
  totalDeleted: number
  durationMs: number
}

export async function cleanupOldData(): Promise<CleanupResult> {
  const t0 = Date.now()
  const now = new Date()
  const days30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000)
  const days90 = new Date(now.getTime() - 90 * 24 * 3600 * 1000)
  const days180 = new Date(now.getTime() - 180 * 24 * 3600 * 1000)
  const days365 = new Date(now.getTime() - 365 * 24 * 3600 * 1000)

  // Chạy SONG SONG để tận dụng Postgres concurrency. Mỗi delete dùng date index riêng.
  const [
    loginSessionRevoked,
    loginSessionStale,
    campLogOld,
    orderCommissionCancelled,
    affiliateClicksOld,
    postsSoftDeleted,
  ] = await Promise.all([
    // 1) Session đã revoke > 30 ngày
    prisma.loginSession.deleteMany({
      where: { revokedAt: { not: null, lt: days30 } },
    }),
    // 2) Session bỏ quên — lastSeenAt cũ > 90 ngày (kể cả chưa revoke)
    prisma.loginSession.deleteMany({
      where: { lastSeenAt: { lt: days90 } },
    }),
    // 3) CampLog > 90 ngày
    prisma.campLog.deleteMany({
      where: { createdAt: { lt: days90 } },
    }),
    // 4) Đơn cancelled > 180 ngày
    prisma.orderCommission.deleteMany({
      where: {
        status: "cancelled",
        clickDate: { lt: days180 },
      },
    }),
    // 5) Click data daily > 1 năm
    prisma.affiliateCommissionDaily.deleteMany({
      where: { date: { lt: days365 } },
    }),
    // 6) Post soft-deleted > 30 ngày → hard delete để giải phóng dung lượng
    prisma.post.deleteMany({
      where: { deleted: true, deletedAt: { lt: days30 } },
    }),
  ])

  const totalDeleted =
    loginSessionRevoked.count +
    loginSessionStale.count +
    campLogOld.count +
    orderCommissionCancelled.count +
    affiliateClicksOld.count +
    postsSoftDeleted.count

  return {
    loginSessionRevoked: loginSessionRevoked.count,
    loginSessionStale: loginSessionStale.count,
    campLogOld: campLogOld.count,
    orderCommissionCancelled: orderCommissionCancelled.count,
    affiliateClicksOld: affiliateClicksOld.count,
    postsSoftDeleted: postsSoftDeleted.count,
    totalDeleted,
    durationMs: Date.now() - t0,
  }
}
