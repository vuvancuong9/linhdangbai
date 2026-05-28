import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// POST /api/campaigns/clear-all
// Xoá HẾT Campaign records CỦA USER (mỗi user chỉ wipe data của mình).
// Detach Post.campaignId + CampLog.campaignId trước (FK).
// KHÔNG động đến camp trên Facebook — chỉ wipe data DB.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (req.headers.get("x-confirm") !== "yes") {
      return NextResponse.json({ error: "Cần header X-Confirm=yes (destructive op)" }, { status: 400 })
    }
    const userScope = { userId: user.userId }

    // Đếm trước để feedback
    const total = await prisma.campaign.count({ where: userScope as any })
    if (total === 0) {
      return NextResponse.json({ ok: true, deleted: 0, message: "Không có data nào để xoá" })
    }

    // Lấy IDs để detach references
    const camps = await prisma.campaign.findMany({ where: userScope as any, select: { id: true } })
    const ids = camps.map((c) => c.id)

    await prisma.$transaction([
      // Detach Post.campaignId
      prisma.post.updateMany({
        where: { campaignId: { in: ids } },
        data: { campaignId: null },
      }),
      // Detach CampLog.campaignId
      prisma.campLog.updateMany({
        where: { campaignId: { in: ids } },
        data: { campaignId: null },
      }),
      // Xoá Campaign
      prisma.campaign.deleteMany({ where: { id: { in: ids } } }),
    ])

    return NextResponse.json({
      ok: true,
      deleted: ids.length,
      message: `Đã xoá ${ids.length} campaign khỏi DB. Bấm "Tải Campaigns" để load lại từ FB.`,
    })
  } catch (e: any) {
  return safeError(e, "campaigns/clear-all")
}
}
