import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { buildExtCorsHeaders } from "@/lib/ext-cors"

export const runtime = "nodejs"

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: buildExtCorsHeaders(req.headers.get("origin")) })
}

// POST /api/accounts/sync-threshold-from-ext
// Body: {
//   actId: string,
//   threshold: number,                 // payment threshold (VND) - bat buoc
//   dailyLimit?: number | null         // daily spend limit Meta dat (optional)
// }
// Update AdAccountBillingInfo.paymentThreshold + AdAccount.dailySpendLimit.
// Auth: cookie session tu app.quybeo.com.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const rawActId = String(body?.actId || "").trim()
    const thresholdNum = Number(body?.threshold)
    const dailyLimitRaw = body?.dailyLimit
    const dailyLimitNum = dailyLimitRaw == null ? null : Number(dailyLimitRaw)

    if (!rawActId) {
      return NextResponse.json({ error: "Thiếu actId" }, { status: 400, headers: buildExtCorsHeaders(req.headers.get("origin")) })
    }
    if (!Number.isFinite(thresholdNum) || thresholdNum <= 0) {
      return NextResponse.json({ error: "Threshold không hợp lệ" }, { status: 400, headers: buildExtCorsHeaders(req.headers.get("origin")) })
    }

    const bareId = rawActId.replace(/^act_/, "")
    const withPrefix = `act_${bareId}`
    const variants = Array.from(new Set([rawActId, bareId, withPrefix]))

    const acc = await prisma.adAccount.findFirst({
      where: { userId: user.userId, actId: { in: variants } },
      select: { id: true, actId: true, name: true },
    })
    if (!acc) {
      return NextResponse.json({
        error: `TKQC ${rawActId} không tìm thấy trong app. Bấm "Đồng bộ FB" ở Keo Ads trước.`,
        triedVariants: variants,
      }, { status: 404, headers: buildExtCorsHeaders(req.headers.get("origin")) })
    }
    const finalActId = acc.actId

    // 1. Upsert threshold (AdAccountBillingInfo)
    await prisma.adAccountBillingInfo.upsert({
      where: { userId_actId: { userId: user.userId, actId: finalActId } },
      update: { paymentThreshold: BigInt(Math.round(thresholdNum)) },
      create: {
        userId: user.userId,
        actId: finalActId,
        paymentThreshold: BigInt(Math.round(thresholdNum)),
      },
    })

    // 2. Update daily spend limit (AdAccount) neu co
    let dailyLimitSaved: number | null = null
    if (dailyLimitNum != null && Number.isFinite(dailyLimitNum) && dailyLimitNum > 0) {
      try {
        await prisma.adAccount.update({
          where: { id: acc.id },
          data: {
            dailySpendLimit: BigInt(Math.round(dailyLimitNum)),
            dailySpendLimitUpdatedAt: new Date(),
          },
        })
        dailyLimitSaved = dailyLimitNum
      } catch (e: any) {
        console.warn("[sync-threshold-from-ext] update dailyLimit fail:", e?.message)
      }
    }

    return NextResponse.json({
      ok: true,
      actId: finalActId,
      accountName: acc?.name || "",
      threshold: thresholdNum,
      dailyLimit: dailyLimitSaved,
      message: `Đã lưu threshold ${thresholdNum.toLocaleString("vi-VN")}đ${dailyLimitSaved ? ` + daily limit ${dailyLimitSaved.toLocaleString("vi-VN")}đ` : ""} cho ${acc?.name || finalActId}`,
    }, { headers: buildExtCorsHeaders(req.headers.get("origin")) })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Chưa login app.quybeo.com. Login ở tab khác trước." }, { status: 401, headers: buildExtCorsHeaders(req.headers.get("origin")) })
    }
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Error") }, { status: 500, headers: buildExtCorsHeaders(req.headers.get("origin")) })
  }
}
