import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, isAdminRole } from '@/lib/auth'
import { safeError } from "@/lib/api"
import { COMMISSION_NET_FACTOR, ADS_COST_FACTOR } from '@/lib/constants-server'

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const campIds = searchParams.get('campIds')
    const fromStr = searchParams.get('from') || ''
    const toStr = searchParams.get('to') || ''
    // Mọi user (kể cả admin/super_admin) chỉ thấy camp của mình ở UI thông thường.
    const where = { userId: user.userId }
    const whereFilter = campIds
      ? { ...where, campId: { in: campIds.split(',') } }
      : where
    const campaigns = await prisma.campaign.findMany({
      where: whereFilter,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        campId: true,
        status: true,
        budget: true,
        spend: true,
        cpc: true,
        clicks: true,
        clickSP: true,
        commission: true,
        adsHH: true,
        profitLoss: true,
        adAccountId: true, // FE filter campaigns theo TK đã pick (modal "Tải tất cả TK")
      },
    })

    // Enrich adAccountName tu Map<AdAccount.id, AdAccount.name> de FE hien duoi campId
    const accIds = Array.from(new Set(campaigns.map(c => c.adAccountId).filter(Boolean) as string[]))
    if (accIds.length > 0) {
      const accs = await prisma.adAccount.findMany({
        where: { id: { in: accIds } },
        select: { id: true, name: true },
      })
      const accNameMap = new Map<string, string>()
      for (const a of accs) accNameMap.set(a.id, a.name)
      for (const c of campaigns as any[]) {
        if (c.adAccountId) c.adAccountName = accNameMap.get(c.adAccountId) || null
      }
    }

    // If a date range is provided, override commission/adsHH/profitLoss
    // with values aggregated from AffiliateCommissionDaily for the
    // current user. Match Campaign.name <-> AffiliateCommissionDaily.subId2
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    if (campaigns.length > 0 && dateRe.test(fromStr) && dateRe.test(toStr)) {
      const from = new Date(fromStr + 'T00:00:00Z')
      const to = new Date(toStr + 'T00:00:00Z')
      if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
        const toExclusive = new Date(to)
        toExclusive.setUTCDate(toExclusive.getUTCDate() + 1)
        const subIds = Array.from(new Set(campaigns.map((c) => c.name).filter(Boolean)))
        if (subIds.length > 0) {
          // V2: commission từ order_commission (per-order, bỏ cancelled)
          // Click count vẫn từ legacy table affiliate_commission_daily
          const [commGrouped, clickGrouped] = await Promise.all([
            prisma.orderCommission.groupBy({
              by: ['subId2'],
              where: {
                userId: user.userId,
                subId2: { in: subIds },
                clickDate: { gte: from, lt: toExclusive },
                status: { not: "cancelled" },
              },
              _sum: { commission: true },
            }),
            prisma.affiliateCommissionDaily.groupBy({
              by: ['subId2'],
              where: {
                userId: user.userId,
                subId2: { in: subIds },
                date: { gte: from, lt: toExclusive },
              },
              _sum: { clickCount: true },
            }),
          ])
          const commissionMap = new Map<string, number>()
          const clickMap = new Map<string, number>()
          for (const g of commGrouped) {
            if (g.subId2) commissionMap.set(g.subId2, g._sum.commission ?? 0)
          }
          for (const g of clickGrouped) {
            if (g.subId2) clickMap.set(g.subId2, g._sum.clickCount ?? 0)
          }
          for (const c of campaigns as any[]) {
            const commission = commissionMap.get(c.name) ?? 0
            const spend = c.spend ?? 0
            c.commission = Math.round(commission)
            c.clickSP = clickMap.get(c.name) ?? 0
            // Lãi/Lỗ = hoa hồng × COMMISSION_NET_FACTOR − chi phí × ADS_COST_FACTOR
            // (đã trừ phí HH 1% và cộng VAT chi phí 11%) — định nghĩa trong lib/constants.
            c.profitLoss = Math.round(commission * COMMISSION_NET_FACTOR - spend * ADS_COST_FACTOR)
            // ADS/HH = chi phí / hoa hồng × 100 (%), làm tròn 2 chữ số thập phân.
            c.adsHH = commission > 0 ? Math.round(spend / commission * 10000) / 100 : null
          }
        }
      }
    }

    return NextResponse.json(campaigns)
  } catch (e: any) {
  return safeError(e, "campaigns")
}
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const data: any = {
      userId: user.userId,
      name: String(body.name ?? '').trim(),
      campId: String(body.campId ?? ''),
      status: String(body.status ?? 'on'),
      budget: Number(body.budget) || 0,
      cpc: Number(body.cpc) || 0,
      clicks: Number(body.clicks) || 0,
      clickSP: Number(body.clickSP) || 0,
      spend: Number(body.spend) || 0,
    }
    if (body.commission != null && body.commission !== '') data.commission = Number(body.commission) || 0
    if (body.adsHH != null && body.adsHH !== '') data.adsHH = Number(body.adsHH) || 0
    if (body.profitLoss != null && body.profitLoss !== '') data.profitLoss = Number(body.profitLoss) || 0
    if (!data.name) return NextResponse.json({ error: 'Tên campaign là bắt buộc' }, { status: 400 })
    const created = await prisma.campaign.create({ data })
    return NextResponse.json(created)
  } catch (e: any) {
  return safeError(e, "campaigns")
}
}
