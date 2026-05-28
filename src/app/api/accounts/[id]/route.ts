import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    // deleteMany với userId guard → user A không xoá được data user B (IDOR fix)
    const r = await prisma.adAccount.deleteMany({ where: { id: params.id, userId: user.userId } })
    if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "accounts/[id]")
}
}
