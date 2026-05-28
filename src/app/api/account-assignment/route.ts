import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// Validate monthKey: "YYYY-MM" hoặc "default"
function isValidMonthKey(s: any): boolean {
  if (s === "default") return true
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

// GET /api/account-assignment?monthKey=YYYY-MM | default
// Trả về list assignment của user cho tháng đó (kèm fallback "default" nếu thiếu).
// Response: [{ accountId, accountName, accountActId, accountStatus, groupId, fromDefault, hasMonthOverride }]
//
// Assignment giờ key theo (userId, actId, monthKey) → bền với việc AdAccount bị xoá+recreate.
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const monthKey = searchParams.get("monthKey") || "default"
    if (!isValidMonthKey(monthKey)) return NextResponse.json({ error: "monthKey không hợp lệ" }, { status: 400 })

    // Lấy tất cả TKQC của user
    const accounts = await prisma.adAccount.findMany({
      where: { userId: user.userId },
      select: { id: true, name: true, actId: true, status: true },
      orderBy: { createdAt: "asc" },
    })

    // Lấy assignment cho tháng này VÀ default (để biết nếu fallback)
    const assigns = await prisma.adAccountGroupAssignment.findMany({
      where: {
        userId: user.userId,
        actId: { in: accounts.map((a) => a.actId) },
        monthKey: { in: monthKey === "default" ? ["default"] : [monthKey, "default"] },
      },
    })

    // Map: actId → assignment cho monthKey trước, fallback default
    // monthAssign tồn tại (kể cả groupId=null tombstone) → dùng nó (KHÔNG fallback default)
    const out = accounts.map((a) => {
      const monthAssign = assigns.find((x) => x.actId === a.actId && x.monthKey === monthKey)
      const defaultAssign = assigns.find((x) => x.actId === a.actId && x.monthKey === "default")
      const eff = monthAssign !== undefined ? monthAssign : defaultAssign
      return {
        accountId: a.id,
        accountName: a.name,
        accountActId: a.actId,
        accountStatus: a.status,
        groupId: eff?.groupId || null,
        fromDefault: !monthAssign && !!defaultAssign,
        hasMonthOverride: !!monthAssign,
      }
    })

    return NextResponse.json({ items: out, monthKey })
  } catch (e: any) {
  return safeError(e, "account-assignment")
}
}

// POST /api/account-assignment
// Body: { accountId, groupId, monthKey }
// Set/update assignment. Frontend gửi accountId (DB ID), server tự lookup actId.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const accountId = String(body?.accountId || "").trim()
    const groupId = body?.groupId ? String(body.groupId).trim() : null
    const monthKey = String(body?.monthKey || "").trim()

    if (!accountId) return NextResponse.json({ error: "Thiếu accountId" }, { status: 400 })
    if (!isValidMonthKey(monthKey)) return NextResponse.json({ error: "monthKey không hợp lệ" }, { status: 400 })

    // Verify ownership + lấy actId
    const acc = await prisma.adAccount.findFirst({ where: { id: accountId, userId: user.userId } })
    if (!acc) return NextResponse.json({ error: "TKQC không hợp lệ" }, { status: 400 })
    const actId = acc.actId

    // groupId === null/empty:
    //   - monthKey === "default": delete entry (về 'không có default')
    //   - monthKey === "YYYY-MM": upsert TOMBSTONE (groupId=null) → override default thành 'không nhóm'
    if (groupId === null || groupId === "") {
      if (monthKey === "default") {
        await prisma.adAccountGroupAssignment.deleteMany({ where: { userId: user.userId, actId, monthKey } })
        return NextResponse.json({ ok: true, removed: true })
      }
      // Tombstone cho tháng cụ thể
      const item = await prisma.adAccountGroupAssignment.upsert({
        where: { userId_actId_monthKey: { userId: user.userId, actId, monthKey } },
        create: { userId: user.userId, actId, groupId: null, monthKey },
        update: { groupId: null },
      })
      return NextResponse.json({ ok: true, item, tombstone: true })
    }

    const grp = await prisma.accountGroup.findFirst({ where: { id: groupId, userId: user.userId } })
    if (!grp) return NextResponse.json({ error: "Nhóm không hợp lệ" }, { status: 400 })

    // Upsert với group thực
    const item = await prisma.adAccountGroupAssignment.upsert({
      where: { userId_actId_monthKey: { userId: user.userId, actId, monthKey } },
      create: { userId: user.userId, actId, groupId, monthKey },
      update: { groupId },
    })
    return NextResponse.json({ ok: true, item })
  } catch (e: any) {
  return safeError(e, "account-assignment")
}
}
