import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { AUTO_CAMP_RETRY_HOURS, AUTO_CAMP_MAX_RETRY } from "@/lib/constants-server"

// GET /api/posts/auto-camp-diagnose
// Trả về list posts pending (chưa adCreated, chưa deleted) của user kèm lý do cron sẽ làm gì.
// Mục đích: user debug vì sao 1 post cụ thể không được cron auto-tạo camp.
export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth()

    const posts = await prisma.post.findMany({
      where: {
        userId: user.userId,
        adCreated: false,
        deleted: false,
      },
      include: {
        page: { select: { id: true, name: true, accountId: true } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    })

    const now = Date.now()
    const retryCutoffMs = AUTO_CAMP_RETRY_HOURS * 3600 * 1000

    const items = posts.map((p) => {
      let cronAction: "create" | "skip-no-campaign" | "skip-no-tkqc" | "skip-error-cooldown" | "skip-error-maxed" | "retry-now" = "create"
      let reason = ""

      if (!p.campaignId) {
        cronAction = "skip-no-campaign"
        reason = "Chưa gắn Tên Campaign (campaignId=null) → user phải vào Mapping hoặc gắn manual"
      } else if (!p.page?.accountId) {
        cronAction = "skip-no-tkqc"
        reason = `Page "${p.page?.name || "?"}" chưa được gán TKQC → vào "Cấu hình Page → TKQC" để gán`
      } else if (p.adError) {
        const errAt = p.adErrorAt?.getTime() || 0
        const hoursSince = errAt ? Math.floor((now - errAt) / 3600000) : 0
        if (p.adErrorRetryCount >= AUTO_CAMP_MAX_RETRY) {
          cronAction = "skip-error-maxed"
          reason = `Đã retry ${p.adErrorRetryCount}/${AUTO_CAMP_MAX_RETRY} lần đều fail → user click "Thử lại" trong /camp-loi để reset`
        } else if (now - errAt < retryCutoffMs) {
          cronAction = "skip-error-cooldown"
          const hoursLeft = Math.ceil((retryCutoffMs - (now - errAt)) / 3600000)
          reason = `Đã fail ${hoursSince}h trước (retry ${p.adErrorRetryCount}/${AUTO_CAMP_MAX_RETRY}). Cron sẽ retry sau ~${hoursLeft}h nữa`
        } else {
          cronAction = "retry-now"
          reason = `Đã fail ${hoursSince}h trước (retry ${p.adErrorRetryCount}/${AUTO_CAMP_MAX_RETRY}). Cron lần tới sẽ retry`
        }
      } else {
        cronAction = "create"
        reason = "Đủ điều kiện. Cron đầu giờ tới sẽ tạo camp"
      }

      return {
        id: p.id,
        fbId: p.fbId,
        pageName: p.page?.name || null,
        campaignName: p.campaign?.name || null,
        campaignId: p.campaignId,
        pageAccountId: p.page?.accountId || null,
        adError: p.adError,
        adErrorAt: p.adErrorAt,
        adErrorRetryCount: p.adErrorRetryCount,
        createdAt: p.createdAt,
        cronAction,
        reason,
      }
    })

    // Aggregate stats by cronAction
    const stats: Record<string, number> = {}
    for (const it of items) stats[it.cronAction] = (stats[it.cronAction] || 0) + 1

    return NextResponse.json({ items, stats, total: items.length, retryHours: AUTO_CAMP_RETRY_HOURS, maxRetry: AUTO_CAMP_MAX_RETRY })
  } catch (e: any) {
  return safeError(e, "posts/auto-camp-diagnose")
}
}
