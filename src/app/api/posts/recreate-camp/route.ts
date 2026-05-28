import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { createCampaignsForBatch, type CreateCampConfig } from "@/lib/fb-create-campaign"

export const runtime = "nodejs"
export const maxDuration = 60

// POST /api/posts/recreate-camp
// Body: { postId: string, campName: string }
// Tạo lại Campaign cho 1 Post mồ côi (camp đã xoá nhưng Post.adCreated=true vẫn còn).
//
// Flow:
//   1. Verify Post ownership + page có TKQC.
//   2. Lấy user.autoCampaignConfig (đã save từ lần tạo manual trước).
//   3. Find or create Campaign(userId, name=campName).
//   4. Reset Post: campaignId = camp.id, adCreated=false, adError=null.
//   5. Gọi createCampaignsForBatch để tạo trên FB.
//   6. Return result (campaignFbId hoặc error).
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const postId = String(body?.postId || "").trim()
    const campName = String(body?.campName || "").trim()

    if (!postId) return NextResponse.json({ error: "Thiếu postId" }, { status: 400 })
    if (!campName) return NextResponse.json({ error: "Thiếu campName" }, { status: 400 })

    // 1. Verify Post + page
    const post = await prisma.post.findFirst({
      where: { id: postId, userId: user.userId, deleted: false },
      include: { page: { select: { id: true, name: true, accountId: true } } },
    })
    if (!post) return NextResponse.json({ error: "Post không tồn tại hoặc không thuộc về bạn" }, { status: 404 })
    if (!post.page) return NextResponse.json({ error: "Post chưa gán Fanpage" }, { status: 400 })
    if (!post.page.accountId) {
      return NextResponse.json({
        error: `Page "${post.page.name}" chưa được gán TKQC. Vào /fanpage-posts → "Cấu hình Page → TKQC" trước.`,
      }, { status: 400 })
    }

    // 2. Lấy config từ user
    const u = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { autoCampaignConfig: true },
    })
    let config: CreateCampConfig | null = null
    try {
      config = u?.autoCampaignConfig ? JSON.parse(u.autoCampaignConfig) : null
    } catch {}
    if (!config) {
      return NextResponse.json({
        error: "Chưa có config campaign. Vào /fanpage-posts tạo manual 1 lần để save config trước.",
      }, { status: 400 })
    }

    // 3. Find or create Campaign theo (userId, name)
    let camp = await prisma.campaign.findFirst({
      where: { userId: user.userId, name: campName },
      select: { id: true, name: true, campId: true, adAccountId: true },
    })
    if (!camp) {
      camp = await prisma.campaign.create({
        data: { userId: user.userId, name: campName, campId: "" },
        select: { id: true, name: true, campId: true, adAccountId: true },
      })
    }

    // 4. Reset Post state để createCampaignsForBatch có thể xử lý
    await prisma.post.update({
      where: { id: post.id },
      data: {
        campaignId: camp.id,
        adCreated: false,
        adError: null,
        adErrorAt: null,
        adErrorRetryCount: 0,
      },
    })

    // 5. Call FB create
    const result = await createCampaignsForBatch({
      userId: user.userId,
      accountId: post.page.accountId,
      postIds: [post.id],
      config,
    })

    const first = result.results?.[0]
    if (first?.ok) {
      return NextResponse.json({
        ok: true,
        campaignDbId: camp.id,
        campaignFbId: first.campaignFbId,
        campaignName: campName,
        message: `Đã tạo lại camp "${campName}" trên FB`,
      })
    } else {
      return NextResponse.json({
        ok: false,
        error: first?.error || result.error || "Tạo camp thất bại",
        campaignDbId: camp.id,
      }, { status: 500 })
    }
  } catch (e: any) {
  return safeError(e, "posts/recreate-camp")
}
}
