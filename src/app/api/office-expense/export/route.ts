import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// GET /api/office-expense/export?from=&to=&categoryId=&q=
// Trả file .xlsx download.
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from") || ""
    const to = searchParams.get("to") || ""
    const categoryId = searchParams.get("categoryId") || ""
    const q = (searchParams.get("q") || "").trim()

    const where: any = { userId: user.userId }
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      const fromD = new Date(from + "T00:00:00Z")
      const toD = new Date(to + "T00:00:00Z")
      toD.setUTCDate(toD.getUTCDate() + 1)
      where.date = { gte: fromD, lt: toD }
    }
    if (categoryId) where.categoryId = categoryId
    if (q) {
      where.OR = [
        { content: { contains: q, mode: "insensitive" } },
        { supplier: { contains: q, mode: "insensitive" } },
        { note: { contains: q, mode: "insensitive" } },
      ]
    }

    const items = await prisma.officeExpense.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { category: { select: { name: true } } },
    })

    const XLSX = await import("xlsx")
    const rows = items.map((it, idx) => ({
      STT: idx + 1,
      "Ngày chi": it.date.toISOString().slice(0, 10),
      "Nội dung": it.content,
      "Danh mục": it.category?.name || "",
      "Nhà cung cấp": it.supplier || "",
      "Số tiền (VND)": it.amount,
      "Ghi chú": it.note || "",
    }))
    const total = items.reduce((s, x) => s + x.amount, 0)
    rows.push({
      STT: "" as any,
      "Ngày chi": "",
      "Nội dung": "TỔNG CỘNG",
      "Danh mục": "",
      "Nhà cung cấp": "",
      "Số tiền (VND)": total,
      "Ghi chú": `${items.length} khoản`,
    })

    const ws = XLSX.utils.json_to_sheet(rows)
    ws["!cols"] = [
      { wch: 5 },
      { wch: 12 },
      { wch: 35 },
      { wch: 22 },
      { wch: 24 },
      { wch: 16 },
      { wch: 20 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Chi phí văn phòng")
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

    const fname = `chi-phi-van-phong${from && to ? `-${from}-${to}` : ""}.xlsx`
    return new NextResponse(buf as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    })
  } catch (e: any) {
  return safeError(e, "office-expense/export")
}
}
