import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// POST /api/posts/backfill-account
// Body: { accountId: string }
// Backfill adAccountId cho posts: adCreated=true nhưng adAccountId=null.
// Camp đã tồn tại trên FB → gán TKQC user chọn (không tạo lại).
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const userScope = { userId: user.userId }

    const { accountId } = await req.json().catch(() => ({}))
    if (!accountId) return NextResponse.json({ error: "Thiếu accountId" }, { status: 400 })

    // Validate accountId thuộc về user (chống IDOR: user A không thể gán account của user B).
    const account = await prisma.adAccount.findFirst({ where: { id: accountId, userId: user.userId } })
    if (!account) return NextResponse.json({ error: "TKQC không tồn tại hoặc không thuộc về bạn" }, { status: 400 })

    const r = await prisma.post.updateMany({
      where: {
        ...(userScope as any),
        adCreated: true,
        adAccountId: null,
        deleted: false,
      },
      data: { adAccountId: accountId },
    })

    return NextResponse.json({
      ok: true,
      updated: r.count,
      message: `Đã gán TKQC "${account.name}" cho ${r.count} bài.`,
    })
  } catch (e: any) {
  return safeError(e, "posts/backfill-account")
}
}
