import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// DELETE /api/mapping/[id] — xoá 1 mapping (chỉ owner)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const m = await prisma.sheetMapping.findUnique({ where: { id: params.id }, select: { userId: true } })
    if (!m) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 })
    if (m.userId !== user.userId) return NextResponse.json({ error: "Không có quyền" }, { status: 403 })
    await prisma.sheetMapping.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "mapping/[id]")
}
}
