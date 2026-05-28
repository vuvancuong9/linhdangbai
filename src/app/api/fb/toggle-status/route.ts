import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { getFbToken } from "@/lib/token-store"
import { safeError } from "@/lib/api"

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    // Mỗi user có camp + FB token riêng. Không resolve về boss.
    const userId = user.userId
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const tokenRecord = await getFbToken(userId)
    if (!tokenRecord) return NextResponse.json({ error: "Chua co token" }, { status: 400 })
    const token = tokenRecord.longToken

    const body = await req.json().catch(() => ({}))
    const { campId, status } = body as { campId?: string, status?: string }
    if (!campId || !status) return NextResponse.json({ error: "Thieu campId/status" }, { status: 400 })

    // Map our internal status -> FB status
    const fbStatus = status === "on" ? "ACTIVE" : status === "off" ? "PAUSED" : null
    if (!fbStatus) return NextResponse.json({ error: "Status khong hop le" }, { status: 400 })

    // SECURITY (R2.A2): verify ownership DB TRƯỚC khi gọi FB API.
    const owned = await prisma.campaign.findFirst({
      where: { userId, campId },
      select: { id: true },
    })
    if (!owned) {
      return NextResponse.json({ error: "Camp khong thuoc tai khoan nay" }, { status: 404 })
    }

    // Call FB Graph API to update campaign status
    const url = `https://graph.facebook.com/v19.0/${campId}`
    const params = new URLSearchParams()
    params.set("status", fbStatus)
    params.set("access_token", token)

    const fbRes = await fetch(url, { method: "POST", body: params })
    const fbData: any = await fbRes.json()
    if (fbData.error) {
      const errMsg: string = fbData.error.message || "FB API error"
      const errCode = fbData.error.code
      // FB code 100 + "does not exist" -> camp da bi xoa tren FB. Don DB local + return deleted flag.
      const isDeleted = errCode === 100 && /does not exist|cannot be loaded/i.test(errMsg)
      if (isDeleted) {
        try {
          await prisma.campaign.deleteMany({ where: { userId, campId } })
        } catch (e: any) {
          console.warn(`[toggle-status] DB cleanup fail campId=${campId}:`, e?.message)
        }
        return NextResponse.json({ ok: true, deleted: true, campId, note: "Camp da bi xoa tren FB - da don khoi DB" })
      }
      return NextResponse.json({ error: errMsg }, { status: 400 })
    }

    // Update DB — log error nhưng không fail request (FB đã update OK rồi).
    try {
      await prisma.campaign.updateMany({
        where: { userId, campId },
        data: { status, updatedAt: new Date() }
      })
    } catch (e: any) {
      console.warn(`[toggle-status] DB update fail (FB OK) campId=${campId}:`, e?.message)
    }

    return NextResponse.json({ ok: true, campId, status, fbStatus })
  } catch (e: any) {
    return safeError(e, "fb/toggle-status")
  }
}
