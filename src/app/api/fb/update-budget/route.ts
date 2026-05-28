import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { getFbToken } from "@/lib/token-store"
import { safeError } from "@/lib/api"

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    // Mỗi user (Quy SUPER_ADMIN / Kiên ADMIN con) có camp + FB token RIÊNG.
    // Camp.userId luôn = creator (ai sync TKQC ban đầu). Không inherit từ boss.
    const userId = user.userId

    const tokenRecord = await getFbToken(userId)
    if (!tokenRecord) return NextResponse.json({ error: "Chua co token FB" }, { status: 400 })
    const token = tokenRecord.longToken

    const body = await req.json().catch(() => ({}))
    const { campId, dailyBudget } = body as { campId?: string; dailyBudget?: number }
    if (!campId) return NextResponse.json({ error: "Thieu campId" }, { status: 400 })
    const budget = Number(dailyBudget)
    if (!Number.isFinite(budget) || budget <= 0) {
      return NextResponse.json({ error: "Budget phai > 0" }, { status: 400 })
    }
    const budgetInt = Math.round(budget)

    // SECURITY (R2.A2): verify ownership DB TRƯỚC khi gọi FB API. Tránh shared
    // Business Manager risk (user khác có camp campId này trên FB, token của
    // user hiện tại có thể chạm tới và sửa được). Match pattern delete-campaign.
    const owned = await prisma.campaign.findFirst({
      where: { userId, campId },
      select: { id: true },
    })
    if (!owned) {
      return NextResponse.json({ error: "Camp khong thuoc tai khoan nay" }, { status: 404 })
    }

    // FB daily_budget cho VND là integer VND (đơn vị nhỏ nhất). Min budget của FB ~ 1 USD
    // tương đương vài chục nghìn VND tuỳ tỉ giá.
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(campId)}`
    const params = new URLSearchParams()
    params.set("daily_budget", String(budgetInt))
    params.set("access_token", token)

    const fbRes = await fetch(url, { method: "POST", body: params })
    const fbData: any = await fbRes.json()
    if (fbData.error) {
      return NextResponse.json({ error: fbData.error.message || "FB API error" }, { status: 400 })
    }

    // Sync DB — log error nhưng không fail request (FB đã update OK rồi).
    try {
      await prisma.campaign.updateMany({
        where: { userId, campId },
        data: { budget: budgetInt, updatedAt: new Date() }
      })
    } catch (e: any) {
      console.warn(`[update-budget] DB update fail (FB OK) campId=${campId}:`, e?.message)
    }

    return NextResponse.json({ ok: true, campId, dailyBudget: budgetInt })
  } catch (e: any) {
    return safeError(e, "fb/update-budget")
  }
}
