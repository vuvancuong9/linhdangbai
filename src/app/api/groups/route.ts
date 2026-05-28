import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// GET /api/groups — list all groups + members
export async function GET() {
  try {
    const user = await requireAuth()
    const groups = await prisma.accountGroup.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "asc" },
      include: {
        accounts: { select: { id: true, name: true, actId: true, status: true } },
        shopees: { select: { id: true, name: true, appId: true } },
      },
    })
    return NextResponse.json({ groups })
  } catch (e: any) {
  return safeError(e, "groups")
}
}

// POST /api/groups — create or update by id
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { id, name, color, taxType, taxId } = await req.json()
    const validTypes = ["personal", "household", "company"]
    const data: any = {}
    if (name != null) data.name = String(name).trim()
    if (color != null) data.color = String(color || "#4f7ef8")
    if (taxType !== undefined) data.taxType = taxType && validTypes.includes(taxType) ? taxType : null
    if (taxId !== undefined) data.taxId = taxId ? String(taxId).trim() : null

    let saved
    if (id) {
      const existing = await prisma.accountGroup.findFirst({ where: { id, userId: user.userId } })
      if (!existing) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 })
      saved = await prisma.accountGroup.update({ where: { id }, data: { ...data, updatedAt: new Date() } })
    } else {
      if (!data.name) return NextResponse.json({ error: "Thiếu tên nhóm" }, { status: 400 })
      saved = await prisma.accountGroup.create({ data: { ...data, userId: user.userId } })
    }
    return NextResponse.json({ ok: true, group: saved })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (e?.code === "P2002") return NextResponse.json({ error: "Tên nhóm đã tồn tại" }, { status: 409 })
    return safeError(e, "groups")
  }
}

// DELETE /api/groups?id=... — xoá nhóm (TKQC + Shopee bên trong sẽ về ungrouped)
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Thiếu id" }, { status: 400 })
    const grp = await prisma.accountGroup.findFirst({ where: { id, userId: user.userId } })
    if (!grp) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 })
    await prisma.$transaction([
      prisma.adAccount.updateMany({ where: { groupId: id }, data: { groupId: null } }),
      prisma.shopeeAffiliateToken.updateMany({ where: { groupId: id }, data: { groupId: null } }),
      prisma.accountGroup.delete({ where: { id } }),
    ])
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "groups")
}
}
