import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import {
  AUTO_MANAGE_DAYS_WINDOW,
  AUTO_MANAGE_LOSS_THRESHOLD,
  AUTO_MANAGE_PROFIT_THRESHOLD,
  AUTO_MANAGE_BUDGET_MULTIPLIER,
} from "@/lib/constants-server"

export const runtime = "nodejs"

// GET /api/user/auto-manage - trang thai + stats lan chay gan nhat
export async function GET() {
  try {
    const user = await requireAuth()
    const u = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        autoManageEnabled: true,
        autoManageLastRunAt: true,
        autoManageLastOffCount: true,
        autoManageLastBudgetUpCount: true,
        autoManageLastError: true,
      },
    })
    if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({
      enabled: u.autoManageEnabled,
      lastRunAt: u.autoManageLastRunAt,
      lastOffCount: u.autoManageLastOffCount,
      lastBudgetUpCount: u.autoManageLastBudgetUpCount,
      lastError: u.autoManageLastError,
      // Expose constants de UI hien explanation
      rules: {
        daysWindow: AUTO_MANAGE_DAYS_WINDOW,
        lossThreshold: AUTO_MANAGE_LOSS_THRESHOLD,
        profitThreshold: AUTO_MANAGE_PROFIT_THRESHOLD,
        budgetMultiplier: AUTO_MANAGE_BUDGET_MULTIPLIER,
      },
    })
  } catch (e: any) {
  return safeError(e, "user/auto-manage")
}
}

// PATCH /api/user/auto-manage - body: { enabled: boolean }
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "Thieu enabled (boolean)" }, { status: 400 })
    }
    await prisma.user.update({
      where: { id: user.userId },
      data: { autoManageEnabled: body.enabled },
    })
    return NextResponse.json({ ok: true, enabled: body.enabled })
  } catch (e: any) {
  return safeError(e, "user/auto-manage")
}
}
