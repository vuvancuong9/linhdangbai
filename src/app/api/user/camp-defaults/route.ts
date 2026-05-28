// GET /api/user/camp-defaults
// Trả về default config cho tạo campaign + export CSV.
//
// SECURITY (P5): default values (age, country, budget, bid) ĐƯỢC GIỮ SERVER-ONLY
// để KHÔNG lộ qua F12 → Sources tab. Client fetch khi load page, không hardcode.
// Yêu cầu auth (user phải login mới gọi được).

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { DEFAULT_CAMP_CONFIG, DEFAULT_EXPORT_CONFIG } from "@/lib/constants-server"

export async function GET() {
  try {
    await requireAuth()
    return NextResponse.json({
      campConfig: DEFAULT_CAMP_CONFIG,
      exportConfig: DEFAULT_EXPORT_CONFIG,
    })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return NextResponse.json({ error: "Error" }, { status: 500 })
  }
}
