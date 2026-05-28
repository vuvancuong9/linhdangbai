import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { getFbToken } from "@/lib/token-store"

export const runtime = "nodejs"
export const maxDuration = 90

const FB_VER = "v19.0"

// POST /api/fb/delete-campaign
// Body: { campaignIds: string[] }  (DB Campaign.id)
// Với mỗi campaign: gọi FB Marketing API DELETE, sau đó xoá Campaign trong DB.
export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.campaignIds) ? body.campaignIds : []
  // skipFb=true: bỏ qua step gọi FB API DELETE, chỉ xoá DB.
  // Dùng khi FB trả Permissions error (TKQC không thuộc owner / token thiếu ads_management) —
  // user vẫn cần dọn record bẩn khỏi app dù không xoá được trên FB.
  const skipFb: boolean = body?.skipFb === true
  if (ids.length === 0) return NextResponse.json({ error: "Thiếu campaignIds" }, { status: 400 })

  // Token chỉ cần khi gọi FB. Nếu skipFb thì bypass check.
  let token: string | null = null
  if (!skipFb) {
    const tokenRec = await getFbToken(user.userId)
    if (!tokenRec) return NextResponse.json({ error: "Chưa cấu hình FB token" }, { status: 400 })
    token = tokenRec.longToken
  }

  const camps = await prisma.campaign.findMany({
    where: { id: { in: ids }, userId: user.userId },
  })
  if (camps.length === 0) return NextResponse.json({ error: "Không tìm thấy campaign nào" }, { status: 404 })

  // Step 1: FB DELETE song song (concurrency 10) — phần chậm nhất
  const CONCURRENCY = 10
  type DeleteResult = { id: string; name: string; campId: string; ok: boolean; error: string | null }
  const fbResults: DeleteResult[] = []

  async function callFbDelete(c: typeof camps[0]): Promise<DeleteResult> {
    let fbOk = true
    let fbError: string | null = null
    // skipFb=true → bỏ qua FB call hoàn toàn, mark OK để DB cleanup chạy
    if (skipFb) {
      return { id: c.id, name: c.name, campId: c.campId, ok: true, error: null }
    }
    if (c.campId && !c.campId.startsWith("new_")) {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 20000)
        const url = `https://graph.facebook.com/${FB_VER}/${encodeURIComponent(c.campId)}?access_token=${encodeURIComponent(token)}`
        const r = await fetch(url, { method: "DELETE", signal: ctrl.signal })
        clearTimeout(timer)
        const d: any = await r.json().catch(() => ({}))
        if (d?.error) {
          const code = d.error.code
          const msg = String(d.error.message || "").toLowerCase()
          if (code === 100 && (msg.includes("does not exist") || msg.includes("không tồn tại") || msg.includes("not found"))) {
            fbOk = true
            fbError = "FB camp đã không còn — vẫn xoá DB"
          } else {
            fbOk = false
            fbError = d.error.message || `FB error code ${code}`
          }
        }
      } catch (e: any) {
        fbOk = false
        fbError = e?.message || "FB call exception"
      }
    }
    return { id: c.id, name: c.name, campId: c.campId, ok: fbOk, error: fbError }
  }

  for (let i = 0; i < camps.length; i += CONCURRENCY) {
    const chunk = camps.slice(i, i + CONCURRENCY)
    const chunkRes = await Promise.all(chunk.map(callFbDelete))
    fbResults.push(...chunkRes)
  }

  // Step 2: BULK DB cleanup (1 transaction) cho TẤT CẢ camp đã DELETE FB OK
  const okIds = fbResults.filter((r) => r.ok).map((r) => r.id)
  if (okIds.length > 0) {
    try {
      await prisma.$transaction([
        prisma.post.updateMany({ where: { campaignId: { in: okIds } }, data: { campaignId: null } }),
        prisma.campLog.updateMany({ where: { campaignId: { in: okIds } }, data: { campaignId: null } }),
        prisma.campaign.deleteMany({ where: { id: { in: okIds } } }),
      ])
    } catch (e: any) {
      // Nếu bulk fail (rare), mark tất cả là failed
      console.error("[delete-campaign] bulk DB cleanup fail:", e?.message)
      for (const r of fbResults) {
        if (r.ok) { r.ok = false; r.error = `DB cleanup fail: ${e?.message || "exception"}` }
      }
    }
  }

  const results = fbResults

  const okCount = results.filter((r) => r.ok).length
  return NextResponse.json({
    ok: true,
    requested: camps.length,
    deleted: okCount,
    failed: results.length - okCount,
    results,
  })
}
