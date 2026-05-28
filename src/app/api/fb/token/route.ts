import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { getFbToken, saveFbToken } from "@/lib/token-store"

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const userId = user.userId
    const body = await req.json()
    const { appId, appSecret, shortToken } = body
    if (!appId || !appSecret || !shortToken)
      return NextResponse.json({ error: "Thieu thong tin" }, { status: 400 })

    // FB OAuth endpoint vẫn yêu cầu query string (đó là cách FB design),
    // nhưng dùng URLSearchParams để encode đúng + tránh inject ký tự lạ.
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: String(appId),
      client_secret: String(appSecret),
      fb_exchange_token: String(shortToken),
    })
    const url = `https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`
    const fbRes = await fetch(url)
    const fbData = await fbRes.json()
    if (fbData.error)
      return NextResponse.json({ error: fbData.error.message, code: fbData.error.code }, { status: 400 })

    const longToken = fbData.access_token
    const expiresAt = fbData.expires_in ? new Date(Date.now() + fbData.expires_in * 1000) : null

    const saved = await saveFbToken(userId, { appId, appSecret, shortToken, longToken, expiresAt })

    // KHÔNG trả longToken — tránh lộ trên devtools/log/proxy. Chỉ trả preview.
    return NextResponse.json({ ok: true, tokenPreview: longToken.slice(0, 20) + "...", expiresAt: saved.expiresAt, message: "Da luu token thanh cong!" })
  } catch (e: any) {
  return safeError(e, "fb/token")
}
}

export async function GET() {
  try {
    const user = await requireAuth()
    const t = await getFbToken(user.userId)
    if (!t) return NextResponse.json({ hasToken: false })
    return NextResponse.json({
      hasToken: true,
      appId: t.appId,
      expiresAt: t.expiresAt,
      updatedAt: t.updatedAt,
      tokenPreview: t.longToken.slice(0, 20) + "...",
    })
  } catch {
    return NextResponse.json({ hasToken: false })
  }
}

export async function DELETE() {
  try {
    const user = await requireAuth()
    await prisma.fbToken.deleteMany({ where: { userId: user.userId } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "fb/token")
}
}
