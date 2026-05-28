import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth, getViewableUserIds } from "@/lib/auth"
import { safeError } from "@/lib/api"

// GET /api/posts/[id] — lấy 1 post (chính chủ hoặc admin)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const where: any = { id: params.id, userId: user.userId, deleted: false }
    const post = await prisma.post.findFirst({
      where,
      include: {
        campaign: { select: { id: true, name: true, campId: true } },
        page: { select: { id: true, name: true, pageId: true } },
      },
    })
    if (!post) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    return NextResponse.json(post)
  } catch (e: any) {
  return safeError(e, "posts/[id]")
}
}

// DELETE /api/posts/[id] — SOFT delete (giữ record với deleted=true).
// SECURITY FIX (P1.1): Trước đây ADMIN check `isAdminRole` cho phép ANY admin
// xoá post của bất kỳ user nào system-wide (IDOR). Giờ scope theo team:
// SUPER_ADMIN: all. ADMIN: self + children. USER: chỉ self.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const viewableIds = await getViewableUserIds(user)
    const post = await prisma.post.findFirst({
      where: { id: params.id, userId: { in: viewableIds } },
      select: { id: true },
    })
    if (!post) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    await prisma.post.update({ where: { id: params.id }, data: { deleted: true, deletedAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "posts/[id]")
}
}
