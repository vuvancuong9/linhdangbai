import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, isAdminRole } from '@/lib/auth'
import { safeError } from "@/lib/api"

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const skip = (page - 1) * limit
    const tab = searchParams.get('tab') || 'all'
    const pageId = searchParams.get('pageId') || ''
    // pageIds: comma-separated, multi-select fanpage filter
    const pageIdsRaw = searchParams.get('pageIds') || ''
    const pageIds = pageIdsRaw ? pageIdsRaw.split(',').map(s => s.trim()).filter(Boolean) : []
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const search = searchParams.get('search') || ''
    const adAccountId = searchParams.get('adAccountId') || ''

    const status = searchParams.get('status') || 'pending'
    // Cross-account dedupe: khi tab pending, loại bỏ posts có fbId trùng với
    // post đã được TẠO CAMP (bất kỳ user nào). Use case: 1 fanpage chung của 2 nick
    // → sync về 2 record cùng fbId. Nick A đã tạo camp → Nick B không hiện lại.
    // ?dedupeAcrossUsers=0 để tắt (debug).
    const dedupeAcrossUsers = searchParams.get('dedupeAcrossUsers') !== '0'
    // Sort: tham so 'sort' = tên cột ('page'), 'order' = 'asc' | 'desc'.
    // Mặc định sort theo createdAt desc (latest trước).
    const sort = searchParams.get('sort') || ''
    const order = (searchParams.get('order') === 'asc') ? 'asc' : 'desc'
    // ?idsOnly=1 → return CHỈ array IDs (cho UI "Chọn tất cả" cross-page)
    const idsOnly = searchParams.get('idsOnly') === '1'
    // Mọi user (kể cả admin/super_admin) chỉ thấy post của mình.
    const where: any = { userId: user.userId, deleted: false }

    // status filter: pending = chưa tạo & chưa lỗi, created = đã tạo OK, error = đã lỗi, exported = CSV cũ
    if (status === 'created') {
      where.adCreated = true
    } else if (status === 'error') {
      where.adError = { not: null }
    } else if (status === 'exported') {
      where.exported = true
    } else {
      // pending (default): chưa tạo, chưa lỗi, chưa export CSV
      where.adCreated = false
      where.adError = null
      where.exported = false
    }

    if (tab === 'none') where.campaignId = null
    if (tab === 'has') where.campaignId = { not: null }
    if (pageIds.length > 0) where.pageId = { in: pageIds }
    else if (pageId) where.pageId = pageId

    // Cross-account dedupe đã bỏ — gây chậm khi DB có nhiều post (distinct query trên fbId).
    void dedupeAcrossUsers
    if (adAccountId) where.adAccountId = adAccountId
    if (search) {
      // Search trong post.name HOẶC campaign.name
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { campaign: { name: { contains: search, mode: 'insensitive' } } },
      ]
    }
    if (from || to) {
      where.createdAt = {}
      // Parse theo UTC để đồng nhất giữa local dev và Railway (UTC server).
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) where.createdAt.gte = new Date(from + 'T00:00:00Z')
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) where.createdAt.lte = new Date(to + 'T23:59:59.999Z')
    }

    // Build orderBy:
    // - Khi user click sort theo Fanpage → đặt page.name làm primary key, nhưng vẫn giữ
    //   createdAt desc + id desc làm secondary để paginate ổn định (post cùng tên fanpage
    //   không bị nhảy thứ tự giữa các trang).
    const orderBy: any[] = []
    if (sort === 'page') orderBy.push({ page: { name: order } })
    orderBy.push({ createdAt: 'desc' }, { id: 'desc' })

    // Mode idsOnly: chỉ trả array IDs theo filter, không pagination, không include.
    if (idsOnly) {
      const rows = await prisma.post.findMany({
        where,
        select: { id: true },
        orderBy,
        take: 50000, // safety cap
      })
      return NextResponse.json({ ids: rows.map(r => r.id), total: rows.length })
    }

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy,
        take: limit,
        skip,
        include: {
          campaign: { select: { id: true, name: true, campId: true, adAccount: { select: { id: true, name: true, actId: true } } } },
          page: { select: { id: true, name: true, pageId: true, accountId: true, account: { select: { id: true, name: true, actId: true } } } },
          adAccount: { select: { id: true, name: true, actId: true } },
        },
      }),
      prisma.post.count({ where })
    ])

    return NextResponse.json({ posts, total, page, limit })
  } catch (e: any) {
  return safeError(e, "posts")
}
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const post = await prisma.post.create({
      data: {
        userId: user.userId,
        name: body.name || '',
        fbId: body.fbId || '',
        link: body.link || '',
        pageId: body.pageId ?? null,
        campaignId: body.campaignId ?? null,
      }
    })
    return NextResponse.json(post)
  } catch (e: any) {
  return safeError(e, "posts")
}
}
