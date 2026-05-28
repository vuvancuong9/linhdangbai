import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { calcTNCN, calcHKD, calcTNDN } from "@/lib/tax"

// GET /api/tax?groupId=... — lấy record gần nhất của group
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get("groupId")
    if (!groupId) return NextResponse.json({ error: "Thiếu groupId" }, { status: 400 })

    const grp = await prisma.accountGroup.findFirst({ where: { id: groupId, userId: user.userId } })
    if (!grp) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 })

    const latest = await prisma.taxRecord.findFirst({
      where: { groupId, userId: user.userId },
      orderBy: { updatedAt: "desc" },
    })
    return NextResponse.json({ record: latest, group: { id: grp.id, name: grp.name, taxType: grp.taxType, taxId: grp.taxId } })
  } catch (e: any) {
  return safeError(e, "tax")
}
}

// POST /api/tax — save record (input + output computed server-side)
// Body: { groupId, taxType, fromDate, toDate, inputs }
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const { groupId, taxType, fromDate, toDate, inputs } = body
    if (!groupId || !taxType) return NextResponse.json({ error: "Thiếu groupId/taxType" }, { status: 400 })
    if (!["personal", "household", "company"].includes(taxType)) return NextResponse.json({ error: "taxType không hợp lệ" }, { status: 400 })

    const grp = await prisma.accountGroup.findFirst({ where: { id: groupId, userId: user.userId } })
    if (!grp) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 })

    let outputs: any
    if (taxType === "personal") outputs = calcTNCN(inputs)
    else if (taxType === "household") outputs = calcHKD(inputs)
    else outputs = calcTNDN(inputs)

    const fromD = fromDate ? new Date(fromDate + "T00:00:00Z") : new Date()
    const toD = toDate ? new Date(toDate + "T00:00:00Z") : new Date()

    // Cũng update taxType vào group để dashboard chip còn dùng được
    await prisma.accountGroup.update({ where: { id: groupId }, data: { taxType } })

    const saved = await prisma.taxRecord.create({
      data: {
        userId: user.userId,
        groupId,
        taxType,
        fromDate: fromD,
        toDate: toD,
        inputs,
        outputs,
      },
    })
    return NextResponse.json({ ok: true, record: saved })
  } catch (e: any) {
  return safeError(e, "tax")
}
}
