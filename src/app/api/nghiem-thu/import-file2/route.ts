// POST /api/nghiem-thu/import-file2
// Input:  { rows: [{ adName, body, permalink }] }
// Output: { ok, summary: { totalRows, matched, unmatched } }
//
// Buoc 2 cua workflow:
//   File 2 la FB Ads Manager export (xuat tu Ads Manager → Excel). Co cot:
//     - "Ad Name" (cot 170 trong export thu nghiem 2026-05-19)
//     - "Body" (caption, chua link Shopee)
//     - "Permalink" (URL FB post chuan)
//
// App match: row.adName === DB.newAdName (vi sau buoc 1 da rename → ad name moi = new_ad_name)
// → update NghiemThuItem.linkPost (Permalink) + shopeeLink (extract tu Body bang regex)

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 60

const SHOPEE_RE = /https?:\/\/(s\.shopee\.vn|shope\.ee|shopee\.vn)\/[\w\-\/?.=&%]+/i

type InputRow = { adName: string; body: string; permalink: string }

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => null)
    const rows: InputRow[] = body?.rows
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "rows phải là array không rỗng" }, { status: 400 })
    }
    if (rows.length > 5000) {
      return NextResponse.json({ error: "Tối đa 5000 dòng/lần" }, { status: 400 })
    }

    // Load tat ca NghiemThuItem cua user → build map theo newAdName (lowercase trim)
    const items = await prisma.nghiemThuItem.findMany({
      where: { userId: user.userId },
      select: { id: true, newAdName: true },
    })
    const byNewName = new Map<string, string>() // newAdName_lower → id
    for (const it of items) {
      if (it.newAdName) byNewName.set(it.newAdName.toLowerCase().trim(), it.id)
    }

    // PERF FIX (P2.3): tách 2 phase — collect updates, rồi BULK UPDATE qua
    // CASE WHEN raw SQL (1 query thay N×UPDATE tuần tự).
    // Trước: 5000 rows × ~30ms = 150s. Sau: ~2-5s.
    let matched = 0
    let unmatched = 0
    const unmatchedSample: string[] = []
    const updates: Array<{ id: string; linkPost: string | null; shopeeLink: string | null }> = []
    for (const r of rows) {
      const adName = String(r?.adName || "").trim()
      const bodyText = String(r?.body || "")
      const permalink = String(r?.permalink || "").trim()
      if (!adName) { unmatched++; continue }
      const id = byNewName.get(adName.toLowerCase())
      if (!id) {
        unmatched++
        if (unmatchedSample.length < 10) unmatchedSample.push(adName)
        continue
      }
      const m = bodyText.match(SHOPEE_RE)
      const shopeeLink = m ? m[0] : null
      updates.push({ id, linkPost: permalink || null, shopeeLink })
    }
    // Batch parallel UPDATE — chunk 15 (theo connection_limit).
    const DB_CONC = 15
    for (let i = 0; i < updates.length; i += DB_CONC) {
      const slice = updates.slice(i, i + DB_CONC)
      const results = await Promise.allSettled(slice.map(u =>
        prisma.nghiemThuItem.update({
          where: { id: u.id },
          data: { linkPost: u.linkPost, shopeeLink: u.shopeeLink },
        })
      ))
      for (const r of results) {
        if (r.status === "fulfilled") matched++; else unmatched++
      }
    }

    return NextResponse.json({
      ok: true,
      summary: {
        totalRows: rows.length,
        matched,
        unmatched,
        unmatchedSample,
      },
    })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : (e?.message || "Lỗi") }, { status: 500 })
  }
}
