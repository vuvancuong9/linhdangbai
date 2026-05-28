import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

function isValidMonthKey(s: any): boolean {
  if (s === "default") return true
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

// POST /api/account-assignment/copy
// Body: { fromMonthKey, toMonthKey }
// Copy toàn bộ assignment của user từ tháng A sang tháng B (overwrite tháng B).
//
// Assignment giờ key theo (userId, actId, monthKey) — copy logic dùng userId trực tiếp,
// không phải qua list accountId nữa.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const fromMonthKey = String(body?.fromMonthKey || "").trim()
    const toMonthKey = String(body?.toMonthKey || "").trim()

    if (!isValidMonthKey(fromMonthKey)) return NextResponse.json({ error: "fromMonthKey không hợp lệ" }, { status: 400 })
    if (!isValidMonthKey(toMonthKey)) return NextResponse.json({ error: "toMonthKey không hợp lệ" }, { status: 400 })
    if (fromMonthKey === toMonthKey) return NextResponse.json({ error: "Tháng nguồn = tháng đích" }, { status: 400 })

    const sourceAssigns = await prisma.adAccountGroupAssignment.findMany({
      where: { userId: user.userId, monthKey: fromMonthKey },
    })

    if (sourceAssigns.length === 0) {
      return NextResponse.json({ ok: true, copied: 0, message: "Tháng nguồn không có assignment nào" })
    }

    // Xoá tất cả assignment của tháng đích trước (để overwrite)
    await prisma.adAccountGroupAssignment.deleteMany({
      where: { userId: user.userId, monthKey: toMonthKey },
    })

    // Insert mới từ tháng nguồn → tháng đích
    await prisma.adAccountGroupAssignment.createMany({
      data: sourceAssigns.map((s) => ({
        userId: user.userId,
        actId: s.actId,
        groupId: s.groupId,
        monthKey: toMonthKey,
      })),
      skipDuplicates: true,
    })

    return NextResponse.json({ ok: true, copied: sourceAssigns.length })
  } catch (e: any) {
  return safeError(e, "account-assignment/copy")
}
}
