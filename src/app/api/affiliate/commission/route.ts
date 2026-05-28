import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * GET /api/affiliate/commission?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns aggregated commission per subId2 within [from, to] for the
 * current user's userId. Used by the campaign page to fill the
 * "Hoa hồng" column based on the selected date range.
 *
 * Response: [{ subId2: string, commission: number, orderCount: number }]
 */
export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const fromStr = searchParams.get('from') || ''
  const toStr = searchParams.get('to') || ''

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
    return NextResponse.json({ error: 'INVALID_DATE_RANGE' }, { status: 400 })
  }

  const from = new Date(fromStr + 'T00:00:00Z')
  const to = new Date(toStr + 'T00:00:00Z')
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
    return NextResponse.json({ error: 'INVALID_DATE_RANGE' }, { status: 400 })
  }
  const toExclusive = new Date(to)
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1)

  const grouped = await prisma.affiliateCommissionDaily.groupBy({
    by: ['subId2'],
    where: {
      userId: user.userId,
      date: { gte: from, lt: toExclusive },
    },
    _sum: {
      commission: true,
      orderCount: true,
    },
  })

  const result = grouped.map((g) => ({
    subId2: g.subId2,
    commission: g._sum.commission ?? 0,
    orderCount: g._sum.orderCount ?? 0,
  }))

  return NextResponse.json(result)
}
