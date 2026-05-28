import Papa from "papaparse"

// Lấy CSV từ Google Sheet public.
// Convert sheet URL sang CSV export URL rồi parse 2 cột: Link Shopee + Tên Campaign.
//
// LOGIC TÌM CỘT (ưu tiên từ trên xuống):
//   1. Match theo TÊN HEADER trong row 1 (case-insensitive, contains):
//      - "link shopee" / "shopee" / "link sp" → cột Link
//      - "tên campaign" / "ten campaign" / "campaign" → cột Camp
//   2. Nếu không tìm thấy header → fallback vị trí cứng A + B.
//
//   Input:  https://docs.google.com/spreadsheets/d/SHEET_ID/edit#gid=0
//   Output: https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv&gid=0
export async function fetchSheetCSV(
  sheetUrl: string
): Promise<{ link: string; campName: string }[]> {
  const match = sheetUrl.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (!match) throw new Error("URL Google Sheet không hợp lệ")
  const sheetId = match[1]
  const gidMatch = sheetUrl.match(/gid=(\d+)/)
  const gid = gidMatch ? gidMatch[1] : "0"
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`

  const res = await fetch(csvUrl)
  if (!res.ok) throw new Error("Không thể tải sheet. Hãy chắc sheet được chia sẻ công khai (Anyone with link)")
  const text = await res.text()

  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
  })

  const rows = parsed.data || []
  if (rows.length < 1) return []

  // Tìm cột theo header (row 0)
  const header = (rows[0] || []).map((h) => String(h || "").trim().toLowerCase())
  let linkCol = header.findIndex(
    (h) => h.includes("link shopee") || h === "shopee" || h.includes("link sp"),
  )
  let campCol = header.findIndex(
    (h) => h.includes("tên camp") || h.includes("ten camp") || h.includes("campaign"),
  )

  // Fallback: cột A (0) + B (1)
  const usedFallback = linkCol < 0 || campCol < 0
  if (linkCol < 0) linkCol = 0
  if (campCol < 0) campCol = 1

  const result: { link: string; campName: string }[] = []
  // Bỏ header row đầu tiên (i bắt đầu từ 1)
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i]
    if (!Array.isArray(cols)) continue
    const link = (cols[linkCol] || "").toString().trim()
    const campName = (cols[campCol] || "").toString().trim()
    if (link && campName && link.startsWith("http")) {
      result.push({ link, campName })
    }
  }
  if (result.length === 0 && usedFallback) {
    throw new Error(
      'Sheet không có cột "Link Shopee" / "Tên Campaign" (tìm theo tên header). ' +
      'Hoặc dùng format đơn giản: cột A = Link Shopee, cột B = Tên Campaign.',
    )
  }
  return result
}
