import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { getFbToken } from "@/lib/token-store"

export async function POST(_req: NextRequest) {
  try {
    const user = await requireAuth()
    const userId = user.userId
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const tokenRecord = await getFbToken(userId)
    if (!tokenRecord) return NextResponse.json({ error: "Chua co token" }, { status: 400 })

    const token = tokenRecord.longToken

    // Hỗ trợ chỉ sync 1 phần (vd token chỉ có quyền pages, không có ads_read).
    // Query: ?only=pages | ?only=accounts | (default = all)
    const url = new URL(_req.url)
    const only = url.searchParams.get("only") || "all"
    const wantAccounts = only === "all" || only === "accounts"
    const wantPages = only === "all" || only === "pages"

    // Fetch song song FB API (chỉ fetch phần cần)
    const [accRes, pgRes] = await Promise.all([
      wantAccounts ? fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_status,business&limit=100&access_token=${token}`) : Promise.resolve(null),
      wantPages ? fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,category&limit=100&access_token=${token}`) : Promise.resolve(null),
    ])

    const [accData, pgData] = await Promise.all([
      accRes ? accRes.json() : Promise.resolve(null),
      pgRes ? pgRes.json() : Promise.resolve(null),
    ])

    // Fallback: nếu /me/adaccounts trả về empty → fetch qua Business Manager.
    // Một số TKQC không thuộc owner trực tiếp mà nằm trong BM → cần endpoint khác.
    let bmAccounts: any[] = []
    let bmDebugRaw = ""
    if (wantAccounts && !accData?.error && (!accData?.data || accData.data.length === 0)) {
      try {
        const bizRes = await fetch(`https://graph.facebook.com/v19.0/me/businesses?fields=id,name&limit=50&access_token=${token}`)
        const bizData: any = await bizRes.json()
        bmDebugRaw = JSON.stringify(bizData).slice(0, 400)
        const businesses: any[] = bizData?.data || []
        if (businesses.length > 0) {
          // Fetch ad accounts cho mỗi business (owned + client)
          const bmResults = await Promise.all(businesses.flatMap((b: any) => [
            fetch(`https://graph.facebook.com/v19.0/${b.id}/owned_ad_accounts?fields=id,name,account_status,business&limit=100&access_token=${token}`).then(r => r.json()).catch(() => ({})),
            fetch(`https://graph.facebook.com/v19.0/${b.id}/client_ad_accounts?fields=id,name,account_status,business&limit=100&access_token=${token}`).then(r => r.json()).catch(() => ({})),
          ]))
          for (const bmd of bmResults) {
            if (Array.isArray(bmd?.data)) bmAccounts.push(...bmd.data)
          }
          // Dedupe by id
          const seen = new Set<string>()
          bmAccounts = bmAccounts.filter((a: any) => {
            if (!a?.id || seen.has(a.id)) return false
            seen.add(a.id)
            return true
          })
        }
      } catch (e: any) {
        console.warn("[sync-assets] BM fetch fail:", e?.message)
      }
    }

    // Graceful degradation: 1 phần fail không reject toàn bộ. Track lỗi → warning.
    let accountsError: string | null = null
    let pagesError: string | null = null
    if (wantAccounts && accData?.error) accountsError = accData.error.message || "FB error"
    if (wantPages && pgData?.error) pagesError = pgData.error.message || "FB error"

    // Nếu CẢ 2 đều fail → reject. Nếu chỉ 1 phần fail → tiếp tục.
    if (wantAccounts && wantPages && accountsError && pagesError) {
      return NextResponse.json({ error: "FB: " + accountsError + " | " + pagesError }, { status: 400 })
    }
    if (wantAccounts && !wantPages && accountsError) {
      return NextResponse.json({ error: "FB: " + accountsError }, { status: 400 })
    }
    if (!wantAccounts && wantPages && pagesError) {
      return NextResponse.json({ error: "FB: " + pagesError }, { status: 400 })
    }

    const fbAccountsDirect: any[] = accountsError ? [] : (accData?.data || [])
    // Merge direct + BM, dedupe by id (BM có thể có cùng account với direct)
    const fbAccounts: any[] = (() => {
      const seen = new Set<string>()
      const out: any[] = []
      for (const a of [...fbAccountsDirect, ...bmAccounts]) {
        if (!a?.id || seen.has(a.id)) continue
        seen.add(a.id)
        out.push(a)
      }
      return out
    })()
    const fbPages: any[] = pagesError ? [] : (pgData?.data || [])

    // Lấy existing FULL records (kèm groupId) để biết cần update gì.
    const [existingAccs, existingPages] = await Promise.all([
      prisma.adAccount.findMany({ where: { userId }, select: { id: true, actId: true, name: true, status: true, groupId: true, businessId: true } }),
      prisma.fanPage.findMany({ where: { userId }, select: { id: true, pageId: true, name: true } }),
    ])

    // Map by actId — nếu DB có duplicate (userId, actId), chỉ giữ row CŨ NHẤT (an toàn cho assignment).
    // Dedupe để tránh tạo thêm duplicate khi sync.
    const existingAccByActId = new Map<string, typeof existingAccs[0]>()
    for (const a of existingAccs) {
      const cur = existingAccByActId.get(a.actId)
      if (!cur) existingAccByActId.set(a.actId, a)
      // Nếu đã có, giữ row cũ hơn (giả định DB ID cũ tương ứng row tạo trước)
      // → assignment đã trỏ sang row cũ (legacy).
    }
    const existingPageByPageId = new Map(existingPages.map((p) => [p.pageId, p]))

    // Phân loại: tạo mới vs update name/status (KHÔNG động groupId).
    const newAccs: any[] = []
    const updateAccs: Array<{ id: string; name: string; status: "ON" | "OFF" | "ERROR"; businessId?: string | null }> = []
    for (const a of fbAccounts) {
      const status: "ON" | "OFF" | "ERROR" = a.account_status === 1 ? "ON" : a.account_status === 2 ? "OFF" : "ERROR"
      // businessId tu FB API field `business.id`. Co the null neu khong thuoc BM.
      const businessId: string | null = a.business?.id ? String(a.business.id) : null
      const existing = existingAccByActId.get(a.id)
      if (existing) {
        const nameChanged = existing.name !== (a.name || a.id)
        const statusChanged = existing.status !== status
        // Chi update businessId neu DB chua co va FB tra ve gia tri (immutable, khong overwrite)
        const needSetBusiness = businessId && !existing.businessId
        if (nameChanged || statusChanged || needSetBusiness) {
          updateAccs.push({ id: existing.id, name: a.name || a.id, status, businessId: needSetBusiness ? businessId : undefined })
        }
      } else {
        newAccs.push({ userId, name: a.name || a.id, actId: a.id, status, budget: 0, businessId })
      }
    }

    const newPgs: any[] = []
    const updatePgs: Array<{ id: string; name: string; category: string }> = []
    for (const p of fbPages) {
      const existing = existingPageByPageId.get(p.id)
      if (existing) {
        if (existing.name !== p.name) {
          updatePgs.push({ id: existing.id, name: p.name, category: p.category || "" })
        }
      } else {
        newPgs.push({ userId, name: p.name, pageId: p.id, category: p.category || "" })
      }
    }

    // Execute writes — chunk update + 1 createMany cho mỗi loại.
    const ops: Promise<any>[] = []
    if (newAccs.length > 0) ops.push(prisma.adAccount.createMany({ data: newAccs }))
    for (const u of updateAccs) {
      ops.push(prisma.adAccount.update({
        where: { id: u.id },
        data: { name: u.name, status: u.status, ...(u.businessId !== undefined ? { businessId: u.businessId } : {}) },
      }))
    }
    if (newPgs.length > 0) ops.push(prisma.fanPage.createMany({ data: newPgs }))
    for (const u of updatePgs) {
      ops.push(prisma.fanPage.update({ where: { id: u.id }, data: { name: u.name, category: u.category } }))
    }
    await Promise.all(ops)

    // Build message theo phần đã sync thực tế.
    const parts: string[] = []
    if (wantAccounts && !accountsError) parts.push(`${newAccs.length} TKQC mới, ${updateAccs.length} cập nhật`)
    if (wantPages && !pagesError) parts.push(`${newPgs.length} fanpage mới, ${updatePgs.length} cập nhật`)
    const warnings: string[] = []
    if (wantAccounts && accountsError) warnings.push(`Bỏ qua TKQC (token thiếu quyền ads_read): ${accountsError}`)
    if (wantPages && pagesError) warnings.push(`Bỏ qua fanpage: ${pagesError}`)

    let message = parts.length > 0 ? `Đồng bộ xong! ${parts.join(". ")}.` : "Không có gì để đồng bộ."
    if (wantAccounts && !accountsError && fbAccounts.length === 0) {
      message += " ⚠ FB không trả về TKQC nào (cá nhân + Business Manager). Token có quyền ads_read/ads_management nhưng account này không sở hữu/quản lý TKQC nào — kiểm tra đúng FB account chưa."
    }
    if (warnings.length > 0) message += " ⚠ " + warnings.join(" · ")

    return NextResponse.json({
      ok: true,
      newAccounts: newAccs.length,
      updatedAccounts: updateAccs.length,
      newPages: newPgs.length,
      updatedPages: updatePgs.length,
      totalAccounts: fbAccounts.length,
      totalPages: fbPages.length,
      accountsError,
      pagesError,
      message,
      // Debug info — FB Graph API raw responses
      debug: {
        meAdaccountsRaw: JSON.stringify(accData).slice(0, 600),
        meAdaccountsCount: fbAccountsDirect.length,
        bmFallbackUsed: bmAccounts.length > 0 || (wantAccounts && !accountsError && fbAccountsDirect.length === 0),
        bmAccountsCount: bmAccounts.length,
        bmListRaw: bmDebugRaw,
      },
    })
  } catch (e: any) {
    console.error("[sync-assets] ERROR:", e?.message)
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return safeError(e, "fb/sync-assets")
  }
}
