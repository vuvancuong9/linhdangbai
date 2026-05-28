import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { safeError } from "@/lib/api"

export async function GET() {
  try {
    const me = await requireAdmin()

    // Scope users:
    // - SUPER_ADMIN: thấy tất cả users
    // - ADMIN: chỉ thấy bản thân + USER có parentId = self.id
    const userWhere: any = me.role === "SUPER_ADMIN"
      ? {}
      : { OR: [{ id: me.userId }, { parentId: me.userId }] }

    // Bước 1: lấy users đã scope theo team trước.
    const users = await prisma.user.findMany({
      where: userWhere,
      select: {
        id: true, name: true, email: true, role: true, status: true, createdAt: true,
        parentId: true, userType: true, permissions: true,
        _count: { select: { campaigns: true, posts: true, accounts: true, pages: true } }
      },
      orderBy: { createdAt: "desc" }
    })
    const userIds = users.map((u) => u.id)

    // Bước 2: aggregate stats CHỈ cho team users (IDOR fix: tránh ADMIN con leak data team khác)
    const [campStats, campActiveByUser, tokens] = userIds.length === 0 ? [[], [], []] : await Promise.all([
      prisma.campaign.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds } },
        _sum: { spend: true, commission: true, profitLoss: true, clicks: true },
      }),
      prisma.campaign.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds }, status: "on" },
        _count: { _all: true },
      }),
      prisma.fbToken.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, expiresAt: true, updatedAt: true }
      })
    ])

    // Build maps để lookup nhanh
    const sumByUser = new Map<string, any>()
    for (const c of campStats) sumByUser.set(c.userId, c._sum)
    const activeByUser = new Map<string, number>()
    for (const c of campActiveByUser) activeByUser.set(c.userId, c._count._all)
    const tokenByUser = new Map<string, any>()
    for (const t of tokens) tokenByUser.set(t.userId, t)

    const userStats = users.map(u => {
      const sums = sumByUser.get(u.id)
      const tok = tokenByUser.get(u.id)
      return {
        ...u,
        stats: {
          campaigns: u._count.campaigns,
          posts: u._count.posts,
          accounts: u._count.accounts,
          pages: u._count.pages,
          totalSpend: sums?.spend || 0,
          totalCommission: sums?.commission || 0,
          totalPL: sums?.profitLoss || 0,
          totalClicks: sums?.clicks || 0,
          activeCamps: activeByUser.get(u.id) || 0,
          hasToken: !!tok,
          tokenExpiry: tok?.expiresAt || null,
          lastSync: tok?.updatedAt || null
        }
      }
    })

    // Tổng hệ thống
    let totalSpend = 0, totalCommission = 0, totalPL = 0, totalCampaigns = 0
    for (const c of campStats) {
      totalSpend += c._sum.spend || 0
      totalCommission += c._sum.commission || 0
      totalPL += c._sum.profitLoss || 0
    }
    for (const u of users) totalCampaigns += u._count.campaigns

    const totals = {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.status === "ACTIVE").length,
      totalCampaigns,
      totalPosts: users.reduce((s, u) => s + u._count.posts, 0),
      totalSpend,
      totalCommission,
      totalPL,
      usersWithToken: tokens.length
    }

    return NextResponse.json({ totals, users: userStats })
  } catch (e: any) {
    return safeError(e, "admin/overview")
  }
}
