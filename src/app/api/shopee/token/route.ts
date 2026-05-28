import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { encryptSecret, decryptSecret } from "@/lib/crypto"
import { randomBytes } from "crypto"

// Prefix cho account chưa có API → tránh đụng @@unique([userId, appId]) khi nhiều TK đều rỗng.
const NO_API_PREFIX = "noapi_"

const isNoApi = (appId: string) => !appId || appId.startsWith(NO_API_PREFIX)

// GET /api/shopee/token — list tất cả Shopee accounts của user
export async function GET() {
  try {
    const user = await requireAuth()
    const tokens = await prisma.shopeeAffiliateToken.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "asc" },
    })
    return NextResponse.json({
      accounts: tokens.map((t) => {
        const noApi = isNoApi(t.appId)
        let preview = ""
        if (!noApi && t.apiKey) {
          try {
            const plain = decryptSecret(t.apiKey)
            // SECURITY (P3): chỉ hiện 4 chars cuối (industry standard, giống bank).
            // Trước hiện 6 chars liên tiếp → giảm entropy quá nhiều.
            preview = plain ? "***" + plain.slice(-4) : ""
          } catch { preview = "" }
        }
        return {
          id: t.id,
          name: t.name,
          appId: noApi ? "" : t.appId,
          apiKeyPreview: noApi ? "" : preview,
          hasApi: !noApi,
          groupId: t.groupId,
          lastSyncAt: t.lastSyncAt,
          updatedAt: t.updatedAt,
        }
      }),
    })
  } catch {
    return NextResponse.json({ accounts: [] })
  }
}

// POST /api/shopee/token — tạo mới hoặc update theo id
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { id, name, appId, apiKey } = await req.json()

    const cleanName = String(name || "Shopee Account").trim()
    const cleanAppId = String(appId || "").trim()
    const cleanApiKey = String(apiKey || "").trim()

    if (!cleanName) return NextResponse.json({ error: "Thiếu tên (gợi nhớ)" }, { status: 400 })

    // Cho phép lưu chỉ với tên: nếu thiếu cả appId hoặc apiKey → coi là "không có API",
    // dùng placeholder appId để vẫn lưu được mà không vi phạm unique constraint.
    const noApi = !cleanAppId || !cleanApiKey
    const finalAppId = noApi ? `${NO_API_PREFIX}${randomBytes(8).toString("hex")}` : cleanAppId
    const finalApiKey = noApi ? "" : encryptSecret(cleanApiKey)

    const data = {
      name: cleanName,
      appId: finalAppId,
      apiKey: finalApiKey,
    }

    let saved
    if (id) {
      const existing = await prisma.shopeeAffiliateToken.findFirst({ where: { id, userId: user.userId } })
      if (!existing) return NextResponse.json({ error: "Không tìm thấy account" }, { status: 404 })
      // Khi update: nếu user không nhập appId/apiKey mới mà đã có sẵn → giữ nguyên
      const updateData: any = { name: cleanName, updatedAt: new Date() }
      if (cleanAppId && cleanApiKey) {
        updateData.appId = cleanAppId
        updateData.apiKey = encryptSecret(cleanApiKey)
      } else if (!cleanAppId && !cleanApiKey && !isNoApi(existing.appId)) {
        // User xoá API thật → chuyển thành no-api
        updateData.appId = `${NO_API_PREFIX}${randomBytes(8).toString("hex")}`
        updateData.apiKey = ""
      }
      saved = await prisma.shopeeAffiliateToken.update({ where: { id }, data: updateData })
    } else {
      saved = await prisma.shopeeAffiliateToken.create({ data: { ...data, userId: user.userId } })
    }
    return NextResponse.json({ ok: true, id: saved.id, name: saved.name, hasApi: !noApi })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (e?.code === "P2002") return NextResponse.json({ error: "AppID này đã tồn tại" }, { status: 409 })
    return safeError(e, "shopee/token")
  }
}

// DELETE /api/shopee/token?id=... — xoá account theo id
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Thiếu id" }, { status: 400 })
    await prisma.shopeeAffiliateToken.deleteMany({ where: { id, userId: user.userId } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "shopee/token")
}
}
