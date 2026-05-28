import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// GET /api/user-cards - list cards cua user
export async function GET() {
  try {
    const user = await requireAuth()
    const cards = await prisma.userCard.findMany({
      where: { userId: user.userId },
      orderBy: { cardLast4: "asc" },
    })
    return NextResponse.json({ ok: true, cards })
  } catch (e: any) {
  return safeError(e, "user-cards")
}
}

// POST /api/user-cards - tao the moi
// Body: { bankName, cardOwnerName, cardLast4, notes? }
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const bankName = String(body?.bankName || "").trim().slice(0, 100)
    const cardOwnerName = String(body?.cardOwnerName || "").trim().slice(0, 100)
    const cardLast4 = String(body?.cardLast4 || "").replace(/\D/g, "").slice(0, 4)
    const notes = body?.notes ? String(body.notes).trim().slice(0, 500) : null

    if (!bankName) return NextResponse.json({ error: "Thieu bankName" }, { status: 400 })
    if (!cardOwnerName) return NextResponse.json({ error: "Thieu cardOwnerName" }, { status: 400 })
    if (cardLast4.length !== 4) return NextResponse.json({ error: "cardLast4 phai dung 4 chu so" }, { status: 400 })

    try {
      const card = await prisma.userCard.create({
        data: { userId: user.userId, bankName, cardOwnerName, cardLast4, notes },
      })
      return NextResponse.json({ ok: true, card })
    } catch (e: any) {
      if (e?.code === "P2002") {
        return NextResponse.json({ error: `Thẻ với 4 số cuối ${cardLast4} đã tồn tại` }, { status: 409 })
      }
      throw e
    }
  } catch (e: any) {
  return safeError(e, "user-cards")
}
}
