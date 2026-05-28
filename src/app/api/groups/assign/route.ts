import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// POST /api/groups/assign — gán account vào nhóm (hoặc bỏ nhóm nếu groupId=null)
// Body: { type: "ad" | "shopee", accountId: string, groupId: string | null }
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { type, accountId, groupId } = await req.json()
    if (!accountId || (type !== "ad" && type !== "shopee")) {
      return NextResponse.json({ error: "type phải là 'ad' hoặc 'shopee'" }, { status: 400 })
    }

    // Verify nhóm thuộc user (nếu groupId không null)
    if (groupId) {
      const grp = await prisma.accountGroup.findFirst({ where: { id: groupId, userId: user.userId } })
      if (!grp) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 })
    }

    if (type === "ad") {
      const acc = await prisma.adAccount.findFirst({ where: { id: accountId, userId: user.userId } })
      if (!acc) return NextResponse.json({ error: "Không tìm thấy TKQC" }, { status: 404 })
      await prisma.adAccount.update({ where: { id: accountId }, data: { groupId: groupId || null } })
    } else {
      const sh = await prisma.shopeeAffiliateToken.findFirst({ where: { id: accountId, userId: user.userId } })
      if (!sh) return NextResponse.json({ error: "Không tìm thấy Shopee account" }, { status: 404 })
      await prisma.shopeeAffiliateToken.update({ where: { id: accountId }, data: { groupId: groupId || null } })
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "groups/assign")
}
}
