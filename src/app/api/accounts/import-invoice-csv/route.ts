import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"
export const maxDuration = 60

// POST /api/accounts/import-invoice-csv
// Body: { csv: string }  (raw CSV content tu file FB Invoice Summary export)
//
// Parse FB Invoice Summary CSV format:
//   Line 1: "Thông tin của Meta"
//   Line 5: "Tài khoản: {actId}, Doanh nghiệp: ..."
//   Line 9: "Thanh toán Quảng cáo trên Meta"
//   Line 10: header "Ngày,ID giao dịch,Phương thức thanh toán,Số tiền,Tiền tệ"
//   Line 11+: data rows "DD/MM/YYYY,xxx-xxx,Visa ···· XXXX,12.345.678,VND"
//   Footer: ",,Tổng số tiền đã lập hóa đơn,X,VND" + VAT info
//
// Upsert vao FbAdAccountInvoice, dedupe theo (adAccountId, fbInvoiceId).
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const csv = String(body?.csv || "")
    if (!csv) return NextResponse.json({ error: "Thieu csv" }, { status: 400 })

    const result = parseFbInvoiceCsv(csv)
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const { actId, rows, total } = result

    // Lookup AdAccount (3 variant actId)
    const bareId = actId.replace(/^act_/, "")
    const withPrefix = `act_${bareId}`
    const variants = Array.from(new Set([actId, bareId, withPrefix]))
    const acc = await prisma.adAccount.findFirst({
      where: { userId: user.userId, actId: { in: variants } },
      select: { id: true, name: true, actId: true },
    })
    if (!acc) {
      return NextResponse.json({
        error: `TKQC ${actId} không tìm thấy trong app. Bấm "Đồng bộ FB" ở Keo Ads trước.`,
      }, { status: 404 })
    }

    // PERF (R2.B5): bulk createMany skipDuplicates + parallel update existing.
    // Trước: N×upsert tuần tự (200 rows × 50ms = 10s). Sau: ~300ms.
    let upserted = 0
    let skipped = 0
    const errors: string[] = []
    if (rows.length > 0) {
      const fbIds = rows.map(r => r.fbInvoiceId)
      const existing = await prisma.fbAdAccountInvoice.findMany({
        where: { adAccountId: acc.id, fbInvoiceId: { in: fbIds } },
        select: { fbInvoiceId: true },
      })
      const existingSet = new Set(existing.map(e => e.fbInvoiceId))
      const toCreate = rows.filter(r => !existingSet.has(r.fbInvoiceId))
      const toUpdate = rows.filter(r => existingSet.has(r.fbInvoiceId))
      if (toCreate.length > 0) {
        try {
          const r = await prisma.fbAdAccountInvoice.createMany({
            data: toCreate.map(row => ({
              userId: user.userId,
              adAccountId: acc.id,
              fbInvoiceId: row.fbInvoiceId,
              invoiceDate: row.invoiceDate,
              totalAmount: BigInt(row.totalAmount),
              fundingSource: row.fundingSource,
              currency: row.currency || "VND",
            })),
            skipDuplicates: true,
          })
          upserted += r.count
        } catch (e: any) {
          errors.push(`bulk create: ${e?.message?.slice(0, 80)}`)
          skipped += toCreate.length
        }
      }
      if (toUpdate.length > 0) {
        const DB_CONC = 15
        for (let i = 0; i < toUpdate.length; i += DB_CONC) {
          const slice = toUpdate.slice(i, i + DB_CONC)
          const results = await Promise.allSettled(slice.map(row =>
            prisma.fbAdAccountInvoice.update({
              where: { adAccountId_fbInvoiceId: { adAccountId: acc.id, fbInvoiceId: row.fbInvoiceId } },
              data: {
                invoiceDate: row.invoiceDate,
                totalAmount: BigInt(row.totalAmount),
                fundingSource: row.fundingSource,
                currency: row.currency || "VND",
              },
            })
          ))
          for (const r of results) {
            if (r.status === "fulfilled") upserted++; else skipped++
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      accountName: acc.name,
      actId: acc.actId,
      total: rows.length,
      upserted,
      skipped,
      totalAmountCsv: total, // tong tu footer CSV, de doi chieu
      errors: errors.slice(0, 5),
    })
  } catch (e: any) {
  return safeError(e, "accounts/import-invoice-csv")
}
}

type ParsedRow = {
  fbInvoiceId: string
  invoiceDate: Date
  totalAmount: number
  fundingSource: string
  currency: string
}

function parseFbInvoiceCsv(csv: string): { actId: string; rows: ParsedRow[]; total: number } | { error: string } {
  // Strip BOM if present
  const text = csv.replace(/^﻿/, "")
  const lines = text.split(/\r?\n/)

  // 1. Find actId tu dong "Tài khoản: XXXXXXXXXXX"
  let actId: string | null = null
  for (const line of lines) {
    const m = line.match(/Tài khoản:\s*(\d{8,})/i) || line.match(/Account:\s*(\d{8,})/i)
    if (m) { actId = m[1]; break }
  }
  if (!actId) return { error: "Không tìm thấy 'Tài khoản: XXXXX' trong CSV. File có đúng định dạng FB Invoice Summary không?" }

  // 2. Find header row "Ngày,ID giao dịch,..."
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^Ngày,ID giao dịch/i.test(lines[i])) { headerIdx = i; break }
  }
  if (headerIdx === -1) return { error: "Không tìm thấy header 'Ngày,ID giao dịch,...' trong CSV." }

  // 3. Parse rows tu headerIdx+1 toi khi gap empty line hoac dong "Tổng"
  const rows: ParsedRow[] = []
  let total = 0
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) break
    // Footer: ",,Tổng số tiền đã lập hóa đơn,357.807.500,VND"
    const totalMatch = line.match(/Tổng số tiền đã lập hóa đơn[,;]\s*([\d.,]+)/i) || line.match(/Total billed[,;]\s*([\d.,]+)/i)
    if (totalMatch) {
      total = parseAmount(totalMatch[1])
      break
    }
    const parsed = parseRow(line)
    if (parsed) rows.push(parsed)
  }

  return { actId, rows, total }
}

function parseRow(line: string): ParsedRow | null {
  // CSV simple split (FB không quote field, dùng dấu "·" hoặc đặc biệt nhưng không có comma trong fields)
  const parts = line.split(",")
  if (parts.length < 5) return null

  const [dateStr, fbInvoiceId, fundingSource, amountStr, currency] = parts

  if (!dateStr || !fbInvoiceId) return null

  const invoiceDate = parseVnDate(dateStr.trim())
  if (!invoiceDate) return null

  const totalAmount = parseAmount(amountStr.trim())
  if (totalAmount <= 0) return null

  return {
    fbInvoiceId: fbInvoiceId.trim(),
    invoiceDate,
    totalAmount,
    fundingSource: fundingSource.trim(),
    currency: (currency || "VND").trim(),
  }
}

// "15/5/2026" -> Date
function parseVnDate(s: string): Date | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const d = new Date(Date.UTC(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10)))
  return isNaN(d.getTime()) ? null : d
}

// "6.468.364" or "6,468,364" -> 6468364
function parseAmount(s: string): number {
  const raw = s.replace(/[.,\s]/g, "")
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : 0
}
