// POST /api/push/unsubscribe — user tắt push trên thiết bị này.
// Xoá row push_subscriptions theo endpoint.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const endpoint = body?.endpoint
    if (!endpoint) return NextResponse.json({ error: "Thiếu endpoint" }, { status: 400 })

    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.userId } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "push/unsubscribe")
}
}
