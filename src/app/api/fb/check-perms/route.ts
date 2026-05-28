import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { getFbToken } from "@/lib/token-store"
import { fbGet } from "@/lib/fb-fetch"

export const runtime = "nodejs"

// GET /api/fb/check-perms?pageId=xxx
// Trả về: scopes của user token, scopes của page token (nếu pageId truyền vào).
// Để debug khi post video FB bị fail #100 "No permission".
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const fbToken = await getFbToken(user.userId)
    if (!fbToken) return NextResponse.json({ error: "FB token chưa set" }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const pageId = searchParams.get("pageId") || ""

    // 1) User token permissions
    const meRes = await fbGet(`https://graph.facebook.com/v19.0/me/permissions`, fbToken.longToken)
    const meData: any = await meRes.json()
    const userPerms = (meData?.data || []).filter((p: any) => p.status === "granted").map((p: any) => p.permission)
    const userPermsDeclined = (meData?.data || []).filter((p: any) => p.status === "declined").map((p: any) => p.permission)

    // 2) Required perms cho post video lên page.
    // pages_manage_posts (modern) OR publish_video (legacy) — FB chấp nhận 1 trong 2.
    const REQUIRED_BASE = ["pages_show_list", "pages_read_engagement"]
    const REQUIRED_VIDEO = ["pages_manage_posts", "publish_video"] // 1 trong 2 đủ
    const hasVideoPerm = REQUIRED_VIDEO.some((p) => userPerms.includes(p))
    const missingBase = REQUIRED_BASE.filter((p) => !userPerms.includes(p))
    const missing = [...missingBase, ...(hasVideoPerm ? [] : ["pages_manage_posts hoặc publish_video"])]

    // 3) List ALL pages user manage + tasks
    // FB chuyển sang task-based permission: nếu page có task "CREATE_CONTENT" → post được.
    let allPages: any[] = []
    try {
      const pgListRes = await fbGet(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,tasks,access_token&limit=100`, fbToken.longToken)
      const pgListData: any = await pgListRes.json()
      allPages = (pgListData?.data || []).map((p: any) => ({
        fbPageId: p.id,
        name: p.name,
        tasks: p.tasks || [],
        canCreateContent: (p.tasks || []).includes("CREATE_CONTENT"),
        hasPageToken: !!p.access_token,
      }))
    } catch (e: any) {
      allPages = [{ error: e?.message?.slice(0, 200) }]
    }

    // 4) Page-specific check (nếu pageId truyền)
    let pageInfo: any = null
    if (pageId) {
      // pageId có thể là DB cuid hoặc FB page id raw. Verify ownership 2 cách:
      // - cuid → match FanPage.id + userId
      // - raw FB pageId → match FanPage.pageId + userId
      // Reject nếu không match cả 2 (tránh probe page user không own qua FB token chung).
      const { prisma } = await import("@/lib/prisma")
      const dbPage = await prisma.fanPage.findFirst({
        where: { userId: user.userId, OR: [{ id: pageId }, { pageId }] },
      })
      if (!dbPage) {
        return NextResponse.json({ error: "Page không thuộc về bạn" }, { status: 403 })
      }
      const fbPageId = dbPage.pageId

      const pgRes = await fbGet(`https://graph.facebook.com/v19.0/${fbPageId}?fields=id,name,access_token,tasks`, fbToken.longToken)
      const pgData: any = await pgRes.json()
      if (pgData?.access_token) {
        // Check page token's permissions
        const pgPermRes = await fbGet(`https://graph.facebook.com/v19.0/me/permissions`, pgData.access_token)
        const pgPermData: any = await pgPermRes.json()
        const pageTokenPerms = (pgPermData?.data || []).filter((p: any) => p.status === "granted").map((p: any) => p.permission)
        pageInfo = {
          fbPageId,
          name: pgData.name,
          hasAccessToken: true,
          tasks: pgData.tasks || [],
          pageTokenPerms,
        }
      } else {
        pageInfo = {
          fbPageId,
          error: pgData?.error || "Không lấy được page token",
        }
      }
    }

    return NextResponse.json({
      ok: true,
      userPerms,
      userPermsDeclined,
      requiredForPostVideo: { base: REQUIRED_BASE, videoOneOf: REQUIRED_VIDEO },
      missing,
      hasAllRequired: missing.length === 0,
      allPages,
      pageInfo,
      tokenInfo: {
        appId: fbToken.appId,
        expiresAt: fbToken.expiresAt,
      },
    })
  } catch (e: any) {
  return safeError(e, "fb/check-perms")
}
}
