import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth, getViewableUserIds } from "@/lib/auth"
import { safeError } from "@/lib/api"

// SECURITY FIX (P1.1): Trước đây ADMIN check `isAdminRole` cho phép thấy + xoá
// log của TẤT CẢ users system-wide (IDOR data leak). Giờ scope theo team:
// SUPER_ADMIN: all. ADMIN: self + children. USER: chỉ self.

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status") // "created" | "error"
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "100", 10)))

    const viewableIds = await getViewableUserIds(user)
    const where: any = {
      userId: { in: viewableIds },
      ...(status ? { status } : {}),
    }
    const [logs, total] = await Promise.all([
      prisma.campLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.campLog.count({ where }),
    ])
    return NextResponse.json({ logs, total, page, limit })
  } catch (e: any) {
  return safeError(e, "camp-logs")
}
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const log = await prisma.campLog.create({
      data: {
        userId: user.userId,
        campaignId: body.campaignId || null,
        postId: body.postId || null,
        postName: body.postName || "",
        postFbId: body.postFbId || "",
        pageName: body.pageName || "",
        campName: body.campName || "",
        campFbId: body.campFbId || "",
        status: body.status || "created",
        errorMsg: body.errorMsg || null,
      },
    })
    return NextResponse.json(log)
  } catch (e: any) {
  return safeError(e, "camp-logs")
}
}

// DELETE retention: xoá log cũ hơn N ngày — SCOPE theo team (không phải all users)
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const olderDays = parseInt(searchParams.get("olderDays") || "90", 10)
    if (!Number.isFinite(olderDays) || olderDays < 1) return NextResponse.json({ error: "olderDays invalid" }, { status: 400 })
    const cutoff = new Date(Date.now() - olderDays * 24 * 3600 * 1000)
    const viewableIds = await getViewableUserIds(user)
    const r = await prisma.campLog.deleteMany({
      where: { createdAt: { lt: cutoff }, userId: { in: viewableIds } },
    })
    return NextResponse.json({ ok: true, deleted: r.count })
  } catch (e: any) {
  return safeError(e, "camp-logs")
}
}
