// POST /api/nghiem-thu/rename
// Input:  { ids: string[] }  (NghiemThuItem.id list)
// Output: { ok, rows: [{ id, ok, error }], summary }
//
// Logic:
//   1. Load items tu DB (ownership check: only user's own)
//   2. Per item co adId va newAdName → POST /{adId} name=newAdName qua FB Graph API
//   3. Throttle 400ms/req de tranh FB rate limit (200/h user-level)
//   4. Update DB: renamedAt = now (success) | renameError = msg (fail)

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getFbToken } from "@/lib/token-store"
import { fbPost } from "@/lib/fb-fetch"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 300

const GRAPH = "https://graph.facebook.com/v21.0"
const SLEEP_MS = 400

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => null)
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === "string") : []
    if (ids.length === 0) return NextResponse.json({ error: "Thiếu ids" }, { status: 400 })
    if (ids.length > 200) {
      return NextResponse.json({ error: "Tối đa 200 ads/lần (FB rate limit)" }, { status: 400 })
    }

    const fbToken = await getFbToken(user.userId)
    if (!fbToken) return NextResponse.json({ error: "FB token chưa cấu hình" }, { status: 400 })
    const token = fbToken.longToken

    const items = await prisma.nghiemThuItem.findMany({
      where: { userId: user.userId, id: { in: ids } },
      select: { id: true, adId: true, newAdName: true },
    })

    const results: Array<{ id: string; ok: boolean; error: string | null }> = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it.adId || !it.newAdName) {
        results.push({ id: it.id, ok: false, error: "Thiếu adId hoặc newAdName (chưa lookup?)" })
        await prisma.nghiemThuItem.update({ where: { id: it.id }, data: { renameError: "Thieu adId/newAdName" } })
        continue
      }
      try {
        const fbBody = new URLSearchParams({ name: it.newAdName })
        const r = await fbPost(`${GRAPH}/${it.adId}`, token, fbBody)
        const d: any = await r.json().catch(() => ({}))
        if (!r.ok || d?.error) {
          const errMsg = d?.error?.message?.slice(0, 250) || `HTTP ${r.status}`
          results.push({ id: it.id, ok: false, error: errMsg })
          await prisma.nghiemThuItem.update({ where: { id: it.id }, data: { renameError: errMsg } })
        } else {
          results.push({ id: it.id, ok: true, error: null })
          await prisma.nghiemThuItem.update({
            where: { id: it.id },
            data: { renamedAt: new Date(), renameError: null },
          })
        }
      } catch (e: any) {
        const errMsg = e?.message?.slice(0, 250) || "Network error"
        results.push({ id: it.id, ok: false, error: errMsg })
        await prisma.nghiemThuItem.update({ where: { id: it.id }, data: { renameError: errMsg } }).catch(() => {})
      }
      if (i < items.length - 1) await sleep(SLEEP_MS)
    }

    const okCount = results.filter(r => r.ok).length
    return NextResponse.json({
      ok: true,
      rows: results,
      summary: { total: items.length, success: okCount, fail: items.length - okCount },
    })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Lỗi") }, { status: 500 })
  }
}
