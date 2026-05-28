// Phân tích file CSV Shopee Affiliate Commission Report.
// So sánh commission theo orderTime (Console) vs clickTime (App) cho từng tháng.
// Usage: node scripts/analyze-shopee-csv.js "D:/AffiliateCommissionReport202605070837.csv"
const fs = require("fs")
const readline = require("readline")

const file = process.argv[2]
if (!file) {
  console.error("Usage: node analyze-shopee-csv.js <csv-file>")
  process.exit(1)
}

// Simple CSV parser xử lý quoted fields với commas/newlines bên trong
function parseCsvLine(line) {
  const result = []
  let cur = ""
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') {
        inQuote = false
      } else {
        cur += c
      }
    } else {
      if (c === '"') inQuote = true
      else if (c === ",") {
        result.push(cur)
        cur = ""
      } else {
        cur += c
      }
    }
  }
  result.push(cur)
  return result
}

function ymKey(dateStr) {
  // "2026-04-30 23:59:51" → "2026-04"
  if (!dateStr || dateStr.length < 7) return ""
  return dateStr.slice(0, 7)
}

function dateKey(dateStr) {
  if (!dateStr || dateStr.length < 10) return ""
  return dateStr.slice(0, 10)
}

async function main() {
  const stream = fs.createReadStream(file, { encoding: "utf8" })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  let header = null
  let colIdx = {}
  let lineNum = 0

  // Aggregations
  const commByOrderMonth = new Map() // YYYY-MM → { net, count, byStatus: {} }
  const commByClickMonth = new Map()
  const commByOrderDate = new Map() // YYYY-MM-DD
  const statusCount = new Map()
  let totalRows = 0
  let totalNet = 0
  let canceledNet = 0
  let canceledCount = 0
  let parseErrors = 0

  for await (const line of rl) {
    lineNum++
    if (!line.trim()) continue
    if (!header) {
      header = parseCsvLine(line.replace(/^﻿/, "")) // strip BOM
      // Build column index map
      header.forEach((h, i) => {
        colIdx[h.trim()] = i
      })
      console.log("Columns found:", Object.keys(colIdx).length)
      console.log("Key columns:")
      console.log("  - Thời Gian Đặt Hàng:", colIdx["Thời Gian Đặt Hàng"])
      console.log("  - Thời gian Click:", colIdx["Thời gian Click"])
      console.log("  - Hoa hồng ròng tiếp thị liên kết(₫):", colIdx["Hoa hồng ròng tiếp thị liên kết(₫)"])
      console.log("  - Trạng thái đặt hàng:", colIdx["Trạng thái đặt hàng"])
      console.log("  - Sub_id2:", colIdx["Sub_id2"])
      continue
    }

    let cols
    try {
      cols = parseCsvLine(line)
    } catch (e) {
      parseErrors++
      continue
    }
    if (cols.length < header.length / 2) {
      parseErrors++
      continue
    }

    const orderTime = (cols[colIdx["Thời Gian Đặt Hàng"]] || "").trim()
    const clickTime = (cols[colIdx["Thời gian Click"]] || "").trim()
    const netStr = (cols[colIdx["Hoa hồng ròng tiếp thị liên kết(₫)"]] || "").trim()
    const status = (cols[colIdx["Trạng thái đặt hàng"]] || "").trim()
    const subId2 = (cols[colIdx["Sub_id2"]] || "").trim()

    const net = parseFloat(netStr.replace(/,/g, "")) || 0
    totalRows++
    totalNet += net

    statusCount.set(status, (statusCount.get(status) || 0) + 1)

    // Skip CANCELLED orders trong app (shopee.ts logic)
    const isCanceled = /hủy/i.test(status) || /cancel/i.test(status)
    if (isCanceled) {
      canceledNet += net
      canceledCount++
      continue
    }

    const orderMonth = ymKey(orderTime)
    const clickMonth = ymKey(clickTime)
    const orderDate = dateKey(orderTime)

    if (orderMonth) {
      if (!commByOrderMonth.has(orderMonth)) commByOrderMonth.set(orderMonth, { net: 0, count: 0 })
      const e = commByOrderMonth.get(orderMonth)
      e.net += net
      e.count++
    }
    if (clickMonth) {
      if (!commByClickMonth.has(clickMonth)) commByClickMonth.set(clickMonth, { net: 0, count: 0 })
      const e = commByClickMonth.get(clickMonth)
      e.net += net
      e.count++
    }
    if (orderDate) {
      if (!commByOrderDate.has(orderDate)) commByOrderDate.set(orderDate, { net: 0, count: 0 })
      const e = commByOrderDate.get(orderDate)
      e.net += net
      e.count++
    }
  }

  console.log("\n=== TỔNG QUAN ===")
  console.log(`Total rows: ${totalRows.toLocaleString("vi-VN")}`)
  console.log(`Parse errors: ${parseErrors}`)
  console.log(`Total net commission (raw): ${Math.round(totalNet).toLocaleString("vi-VN")} đ`)
  console.log(`Canceled rows: ${canceledCount} (net: ${Math.round(canceledNet).toLocaleString("vi-VN")} đ)`)
  console.log(`Net commission AFTER skip canceled: ${Math.round(totalNet - canceledNet).toLocaleString("vi-VN")} đ`)

  console.log("\n=== STATUS BREAKDOWN ===")
  Array.from(statusCount.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, c]) => console.log(`  ${s}: ${c.toLocaleString("vi-VN")}`))

  console.log("\n=== COMMISSION BY ORDER MONTH (theo Shopee Console) ===")
  Array.from(commByOrderMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([m, v]) => console.log(`  ${m}: ${Math.round(v.net).toLocaleString("vi-VN").padStart(15)} đ (${v.count.toLocaleString("vi-VN")} items)`))

  console.log("\n=== COMMISSION BY CLICK MONTH (theo App logic hiện tại) ===")
  Array.from(commByClickMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([m, v]) => console.log(`  ${m}: ${Math.round(v.net).toLocaleString("vi-VN").padStart(15)} đ (${v.count.toLocaleString("vi-VN")} items)`))

  console.log("\n=== DISCREPANCY ===")
  const allMonths = new Set([...commByOrderMonth.keys(), ...commByClickMonth.keys()])
  Array.from(allMonths)
    .sort()
    .forEach((m) => {
      const o = commByOrderMonth.get(m)?.net || 0
      const c = commByClickMonth.get(m)?.net || 0
      const diff = c - o
      const diffStr = (diff >= 0 ? "+" : "") + Math.round(diff).toLocaleString("vi-VN")
      console.log(`  ${m}: order=${Math.round(o).toLocaleString("vi-VN").padStart(15)} | click=${Math.round(c).toLocaleString("vi-VN").padStart(15)} | diff=${diffStr.padStart(15)}`)
    })

  // Daily breakdown tháng 4 + 5 cuối tháng để xem cluster
  console.log("\n=== DAILY (cuối tháng 4 + đầu tháng 5) ===")
  const dates = Array.from(commByOrderDate.keys())
    .filter((d) => d.startsWith("2026-04-2") || d.startsWith("2026-04-3") || d.startsWith("2026-05-0"))
    .sort()
  dates.forEach((d) => {
    const v = commByOrderDate.get(d)
    console.log(`  ${d}: ${Math.round(v.net).toLocaleString("vi-VN").padStart(15)} đ (${v.count} items)`)
  })
}

main().catch((e) => {
  console.error("ERROR:", e)
  process.exit(1)
})
