import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// PATCH /api/pages/select
// Body: { ids: string[] } — list page IDs user đã tích chọn
// Logic: set isSelected=true cho ids list, false cho tất cả pages khác của user.
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const ids = Array.isArray(body?.ids) ? body.ids.map((id: any) => String(id)) : []

    await prisma.$transaction([
      prisma.fanPage.updateMany({
        where: { userId: user.userId, id: { in: ids } },
        data: { isSelected: true },
      }),
      prisma.fanPage.updateMany({
        where: { userId: user.userId, id: { notIn: ids.length > 0 ? ids : ["__none__"] } },
        data: { isSelected: false },
      }),
    ])

    return NextResponse.json({ ok: true, selected: ids.length })
  } catch (e: any) {
  return safeError(e, "pages/select")
}
}
