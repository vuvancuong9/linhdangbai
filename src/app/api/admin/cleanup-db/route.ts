import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { cleanupOldData } from "@/lib/db-cleanup"

// POST /api/admin/cleanup-db
// Manual trigger cleanup DB. Chỉ SUPER_ADMIN.
// Trả về số rows đã xoá theo từng category + thời gian chạy.
export async function POST() {
  try {
    await requireSuperAdmin()
    const result = await cleanupOldData()
    return NextResponse.json({ ok: true, result })
  } catch (e: any) {
    if (e?.message === "FORBIDDEN") return NextResponse.json({ error: "Chỉ SUPER_ADMIN được dọn dẹp DB" }, { status: 403 })
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return safeError(e, "admin/cleanup-db")
  }
}
