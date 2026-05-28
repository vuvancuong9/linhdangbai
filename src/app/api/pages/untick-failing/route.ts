import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// POST /api/pages/untick-failing
// Body: { names: string[] }
// Bỏ tích (isSelected=false) các page theo name. Match exact, scope userId.
// Dùng khi sync FB lỗi permission #10 cho 1 số page user không phải admin →
// tránh spam lỗi mỗi lần sync.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const names: string[] = Array.isArray(body?.names) ? body.names.filter((x: any) => typeof x === "string" && x.trim()) : []
    if (names.length === 0) return NextResponse.json({ error: "names[] required" }, { status: 400 })
    if (names.length > 100) return NextResponse.json({ error: "TOO_MANY" }, { status: 413 })

    const r = await prisma.fanPage.updateMany({
      where: { userId: user.userId, name: { in: names } },
      data: { isSelected: false },
    })
    return NextResponse.json({ ok: true, untickedCount: r.count, requested: names.length })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return safeError(e, "pages/untick-failing")
  }
}
