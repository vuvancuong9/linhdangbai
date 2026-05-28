import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// POST /api/posts/restore-deleted
// Body: { hoursAgo?: number, mode?: "created" | "errors" | "all" }
// Khôi phục post bị soft-delete trong N giờ gần đây (default 24h).
// - mode "created": chỉ post adCreated=true (delete-created)
// - mode "errors":  chỉ post adError != null (delete-errors)
// - mode "all":     tất cả posts soft-deleted (default)
// Scope: chỉ posts của current user. SUPER_ADMIN có thể pass targetUserId.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const hoursAgo = Math.max(1, Math.min(168, Number(body?.hoursAgo) || 24)) // 1h-7days
    const mode = body?.mode === "created" || body?.mode === "errors" ? body.mode : "all"
    const targetUserId =
      user.role === "SUPER_ADMIN" && typeof body?.targetUserId === "string"
        ? body.targetUserId
        : user.userId

    const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
    const where: any = {
      userId: targetUserId,
      deleted: true,
      deletedAt: { gte: since },
    }
    if (mode === "created") where.adCreated = true
    else if (mode === "errors") where.adError = { not: null }

    // Preview count trước
    const count = await prisma.post.count({ where })
    if (count === 0) {
      return NextResponse.json({ ok: true, count: 0, message: "Không có post nào để khôi phục" })
    }

    const r = await prisma.post.updateMany({
      where,
      data: { deleted: false, deletedAt: null },
    })
    return NextResponse.json({ ok: true, count: r.count, message: `Đã khôi phục ${r.count} post` })
  } catch (e: any) {
    return safeError(e, "posts/restore-deleted")
  }
}

// GET /api/posts/restore-deleted?hoursAgo=24&mode=all
// Preview số post sẽ khôi phục (count + sample).
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const hoursAgo = Math.max(1, Math.min(168, Number(searchParams.get("hoursAgo")) || 24))
    const modeRaw = searchParams.get("mode")
    const mode = modeRaw === "created" || modeRaw === "errors" ? modeRaw : "all"
    const targetUserId =
      user.role === "SUPER_ADMIN" && searchParams.get("targetUserId")
        ? (searchParams.get("targetUserId") as string)
        : user.userId

    const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
    const where: any = {
      userId: targetUserId,
      deleted: true,
      deletedAt: { gte: since },
    }
    if (mode === "created") where.adCreated = true
    else if (mode === "errors") where.adError = { not: null }

    const [count, sample] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where,
        take: 10,
        orderBy: { deletedAt: "desc" },
        select: { id: true, name: true, fbId: true, deletedAt: true, adCreated: true, adError: true, campaign: { select: { name: true } } },
      }),
    ])
    return NextResponse.json({ count, sample, hoursAgo, mode })
  } catch (e: any) {
    return safeError(e, "posts/restore-deleted GET")
  }
}
