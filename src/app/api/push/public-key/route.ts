// GET /api/push/public-key — trả về VAPID public key để frontend dùng cho subscribe.
// Public key có thể commit (không nhạy cảm) nhưng đặt qua env để dễ rotate.

import { NextResponse } from "next/server"

export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!key) return NextResponse.json({ error: "VAPID_PUBLIC_KEY chưa set" }, { status: 500 })
  return NextResponse.json({ publicKey: key })
}
