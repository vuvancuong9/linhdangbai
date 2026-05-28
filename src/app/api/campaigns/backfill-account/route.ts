import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"
export const maxDuration = 60

// POST /api/campaigns/backfill-account
// Backfill Campaign.adAccountId = NULL → từ Post.adAccountId của Post đầu tiên (có gán).
// Fix bug cu: create-campaign khong luu adAccountId vao Campaign -> camp bi "legacy".
// One-shot endpoint, user goi manual khi can (vd 1 lan sau deploy).
export async function POST() {
  try {
    const user = await requireAuth()

    // 1. Tim camp cua user co adAccountId = null
    const orphanCamps = await prisma.campaign.findMany({
      where: { userId: user.userId, adAccountId: null },
      select: { id: true },
    })
    if (orphanCamps.length === 0) {
      return NextResponse.json({ ok: true, fixed: 0, message: "Không có camp nào thiếu TKQC" })
    }

    const campIds = orphanCamps.map(c => c.id)

    // 2. Lay Post co adAccountId trong cac camp do
    const posts = await prisma.post.findMany({
      where: {
        userId: user.userId,
        campaignId: { in: campIds },
        adAccountId: { not: null },
      },
      select: { campaignId: true, adAccountId: true },
      orderBy: { createdAt: "asc" },
    })

    // 3. Map: campId -> adAccountId (Post dau tien co gan)
    const adAccountByCampId = new Map<string, string>()
    for (const p of posts) {
      if (p.campaignId && p.adAccountId && !adAccountByCampId.has(p.campaignId)) {
        adAccountByCampId.set(p.campaignId, p.adAccountId)
      }
    }

    // 4. Bulk update camp - group by adAccountId
    const grouped = new Map<string, string[]>()
    for (const [campId, accId] of Array.from(adAccountByCampId.entries())) {
      const arr = grouped.get(accId) || []
      arr.push(campId)
      grouped.set(accId, arr)
    }

    let fixed = 0
    for (const [accId, ids] of Array.from(grouped.entries())) {
      const r = await prisma.campaign.updateMany({
        where: { id: { in: ids }, userId: user.userId },
        data: { adAccountId: accId },
      })
      fixed += r.count
    }

    return NextResponse.json({
      ok: true,
      orphanCount: orphanCamps.length,
      fixed,
      noPostMatch: orphanCamps.length - adAccountByCampId.size,
      message: `Đã gán TKQC cho ${fixed}/${orphanCamps.length} camp. ${orphanCamps.length - adAccountByCampId.size} camp không có Post nào trace được TKQC.`,
    })
  } catch (e: any) {
  return safeError(e, "campaigns/backfill-account")
}
}
