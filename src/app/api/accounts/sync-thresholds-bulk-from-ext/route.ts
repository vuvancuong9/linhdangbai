import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { buildExtCorsHeaders } from "@/lib/ext-cors"

export const runtime = "nodejs"
export const maxDuration = 60

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: buildExtCorsHeaders(req.headers.get("origin")) })
}

// POST /api/accounts/sync-thresholds-bulk-from-ext
// Body: {
//   rows: [
//     {
//       actId: string,         // FB act_id (14-18 digit, khong prefix)
//       accountName?: string,
//       threshold?: number | null,         // payment threshold (VND)
//       thresholdLeft?: number | null,     // ngưỡng còn lại
//       balance?: number | null,           // số dư hien tai
//       dailyLimit?: number | null,        // Meta-imposed daily limit
//       totalSpent?: number | null,        // tổng tiêu (lifetime)
//     }
//   ]
// }
//
// Goi tu chrome-extension-billing sau khi scrape adscheck.smit.vn.
// Match rows voi AdAccount qua actId, update AdAccountBillingInfo.paymentThreshold + AdAccount.dailySpendLimit.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const rows = Array.isArray(body?.rows) ? body.rows : []

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, saved: 0, skipped: 0, message: "Empty rows" }, { headers: buildExtCorsHeaders(req.headers.get("origin")) })
    }

    // Load tat ca AdAccount cua user de match nhanh (1 query, no per-row lookup)
    const accs = await prisma.adAccount.findMany({
      where: { userId: user.userId },
      select: { id: true, actId: true, name: true },
    })

    // Build map: bareActId → AdAccount
    const accMap = new Map<string, { id: string; actId: string; name: string }>()
    for (const acc of accs) {
      const bare = String(acc.actId || "").replace(/^act_/, "")
      if (bare) accMap.set(bare, acc)
    }

    // PERF (R2.B5): parallel chunk thay vì 2N round-trip tuần tự.
    let saved = 0
    let skipped = 0
    const skippedList: string[] = []
    const errors: string[] = []

    // Step 1: filter rows hợp lệ + match acc.
    type ValidRow = { acc: { id: string; actId: string }; threshold: number | null; dailyLimit: number | null; bare: string }
    const validRows: ValidRow[] = []
    for (const row of rows) {
      const bareActId = String(row?.actId || "").replace(/^act_/, "").trim()
      if (!bareActId || !/^\d{8,18}$/.test(bareActId)) { skipped++; continue }
      const acc = accMap.get(bareActId)
      if (!acc) { skipped++; skippedList.push(bareActId); continue }
      validRows.push({
        acc, bare: bareActId,
        threshold: toFiniteNum(row?.threshold),
        dailyLimit: toFiniteNum(row?.dailyLimit),
      })
    }

    // Step 2: parallel upsert + update (chunk 15 theo DB pool).
    const DB_CONC = 15
    for (let i = 0; i < validRows.length; i += DB_CONC) {
      const slice = validRows.slice(i, i + DB_CONC)
      await Promise.all(slice.map(async (vr) => {
        if (vr.threshold != null && vr.threshold > 0) {
          try {
            await prisma.adAccountBillingInfo.upsert({
              where: { userId_actId: { userId: user.userId, actId: vr.acc.actId } },
              update: { paymentThreshold: BigInt(Math.round(vr.threshold)) },
              create: {
                userId: user.userId,
                actId: vr.acc.actId,
                paymentThreshold: BigInt(Math.round(vr.threshold)),
              },
            })
          } catch (e: any) {
            errors.push(`${vr.bare}: threshold upsert fail: ${e?.message}`)
          }
        }
        if (vr.dailyLimit != null && vr.dailyLimit > 0) {
          try {
            await prisma.adAccount.update({
              where: { id: vr.acc.id },
              data: {
                dailySpendLimit: BigInt(Math.round(vr.dailyLimit)),
                dailySpendLimitUpdatedAt: new Date(),
              },
            })
          } catch (e: any) {
            errors.push(`${vr.bare}: dailyLimit update fail: ${e?.message}`)
          }
        }
        saved++
      }))
    }

    return NextResponse.json({
      ok: true,
      saved,
      skipped,
      skippedSample: skippedList.slice(0, 5), // 5 actId dau khong match — neu thieu thi user sync FB de bo sung
      errors: errors.slice(0, 5),
      message: `Đã lưu ${saved}/${rows.length} TKQC (bỏ qua ${skipped})`,
    }, { headers: buildExtCorsHeaders(req.headers.get("origin")) })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401, headers: buildExtCorsHeaders(req.headers.get("origin")) })
    }
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Error") }, { status: 500, headers: buildExtCorsHeaders(req.headers.get("origin")) })
  }
}

function toFiniteNum(v: any): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
