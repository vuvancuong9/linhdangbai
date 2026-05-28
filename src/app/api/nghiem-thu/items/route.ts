// GET    /api/nghiem-thu/items?affiliateId=xxx → list item cua user (filter optional)
//        Tra ve them affiliates: [{ affiliateId, count }] de UI render dropdown.
// DELETE /api/nghiem-thu/items → { ids?: string[], all?: true, affiliateId?: string } bulk delete

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const affiliateIdFilter = searchParams.get("affiliateId") || ""

    const where: any = { userId: user.userId }
    if (affiliateIdFilter === "_null_") {
      where.affiliateId = null
    } else if (affiliateIdFilter) {
      where.affiliateId = affiliateIdFilter
    }

    const items = await prisma.nghiemThuItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
    })

    // Aggregate affiliates cua user (cho dropdown filter)
    const affGroups = await prisma.nghiemThuItem.groupBy({
      by: ["affiliateId"],
      where: { userId: user.userId },
      _count: { _all: true },
      orderBy: { _count: { affiliateId: "desc" } },
    })
    const affiliates = affGroups.map(g => ({
      affiliateId: g.affiliateId,
      count: g._count._all,
    }))

    return NextResponse.json({ ok: true, items, affiliates })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Lỗi") }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => null)
    // Xoa theo affiliateId (chi nick do).
    // SECURITY (R2.A4): yêu cầu X-Confirm header để khớp pattern với "all=true".
    // Xoá 1 nick có thể wipe hàng trăm items → nguy hiểm như all=true.
    if (body?.affiliateId) {
      const confirm = req.headers.get("x-confirm")
      if (confirm !== "yes") {
        return NextResponse.json({
          error: "Cần header X-Confirm: yes để xác nhận xoá theo nick",
        }, { status: 400 })
      }
      const affId = String(body.affiliateId)
      const where: any = affId === "_null_"
        ? { userId: user.userId, affiliateId: null }
        : { userId: user.userId, affiliateId: affId }
      const r = await prisma.nghiemThuItem.deleteMany({ where })
      return NextResponse.json({ ok: true, deleted: r.count })
    }
    if (body?.all === true) {
      // SECURITY (P3): yêu cầu X-Confirm header để tránh accident wipe toàn bộ.
      // Match pattern affiliate/clear-all.
      const confirm = req.headers.get("x-confirm")
      if (confirm !== "yes") {
        return NextResponse.json({
          error: "Cần header X-Confirm: yes để xác nhận wipe tất cả",
        }, { status: 400 })
      }
      const r = await prisma.nghiemThuItem.deleteMany({ where: { userId: user.userId } })
      return NextResponse.json({ ok: true, deleted: r.count })
    }
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === "string") : []
    if (ids.length === 0) return NextResponse.json({ error: "Thiếu ids" }, { status: 400 })
    const r = await prisma.nghiemThuItem.deleteMany({ where: { userId: user.userId, id: { in: ids } } })
    return NextResponse.json({ ok: true, deleted: r.count })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Lỗi") }, { status: 500 })
  }
}
