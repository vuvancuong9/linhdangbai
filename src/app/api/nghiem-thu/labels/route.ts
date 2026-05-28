// GET /api/nghiem-thu/labels → trả về { labels: [{ affiliateId, label }] }
// PUT /api/nghiem-thu/labels → body { labels: [{ affiliateId, label }] } bulk upsert (label trống = delete)

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET() {
  try {
    const user = await requireAuth()
    const labels = await prisma.shopeeAffiliateLabel.findMany({
      where: { userId: user.userId },
      select: { affiliateId: true, label: true },
      orderBy: { affiliateId: "asc" },
    })
    return NextResponse.json({ ok: true, labels })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Lỗi") }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => null)
    const labels: Array<{ affiliateId: string; label: string }> = body?.labels
    if (!Array.isArray(labels)) return NextResponse.json({ error: "Thiếu labels" }, { status: 400 })

    let upserted = 0
    let deleted = 0
    for (const l of labels) {
      const affId = String(l?.affiliateId || "").trim()
      const label = String(l?.label || "").trim()
      if (!affId) continue
      if (!label) {
        // Label trống → xoá
        await prisma.shopeeAffiliateLabel.deleteMany({
          where: { userId: user.userId, affiliateId: affId },
        })
        deleted++
      } else {
        await prisma.shopeeAffiliateLabel.upsert({
          where: { userId_affiliateId: { userId: user.userId, affiliateId: affId } },
          update: { label },
          create: { userId: user.userId, affiliateId: affId, label },
        })
        upserted++
      }
    }
    return NextResponse.json({ ok: true, upserted, deleted })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Lỗi") }, { status: 500 })
  }
}
