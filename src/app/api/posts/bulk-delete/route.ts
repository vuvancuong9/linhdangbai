import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// POST /api/posts/bulk-delete
// Body: { ids: string[] }
// Soft delete (deleted=true) hàng loạt theo array IDs. Chỉ xoá data thuộc user hiện tại
// (không cho user xoá nhầm data của user khác qua dataAccess grant).
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === "string") : []
    if (ids.length === 0) {
      return NextResponse.json({ error: "Thiếu ids" }, { status: 400 })
    }
    // SECURITY (P3): cap 5000 (giảm từ 50000) — tránh DoS DB pool. Frontend
    // đã chunk 1000/request rồi nên cap thấp không ảnh hưởng UX bình thường.
    if (ids.length > 5000) {
      return NextResponse.json({ error: "Quá nhiều ids (max 5000/request)" }, { status: 400 })
    }

    const r = await prisma.post.updateMany({
      where: { id: { in: ids }, userId: user.userId, deleted: false },
      data: { deleted: true, deletedAt: new Date() },
    })

    return NextResponse.json({ ok: true, count: r.count, requested: ids.length })
  } catch (e: any) {
  return safeError(e, "posts/bulk-delete")
}
}
