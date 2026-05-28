import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { safeError } from "@/lib/api"

function ownerWhere(id: string, user: { userId: string; role: string }) {
  return { id, userId: user.userId }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const camp = await prisma.campaign.findFirst({ where: ownerWhere(params.id, user) })
    if (!camp) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    return NextResponse.json(camp)
  } catch (e: any) {
  return safeError(e, "campaigns/[id]")
}
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const data: any = {}
    if (body.name != null) data.name = String(body.name).trim()
    if (body.campId != null) data.campId = String(body.campId)
    if (body.status != null) data.status = String(body.status)
    if (body.budget != null) data.budget = Number(body.budget) || 0
    if (body.cpc != null) data.cpc = Number(body.cpc) || 0
    if (body.clicks != null) data.clicks = Number(body.clicks) || 0
    if (body.clickSP != null) data.clickSP = Number(body.clickSP) || 0
    if (body.spend != null) data.spend = Number(body.spend) || 0
    if (body.commission != null) data.commission = Number(body.commission) || 0
    if (body.adsHH != null) data.adsHH = Number(body.adsHH) || 0
    if (body.profitLoss != null) data.profitLoss = Number(body.profitLoss) || 0
    // updateMany với guard userId → 1 round-trip thay vì find rồi update.
    const r = await prisma.campaign.updateMany({ where: ownerWhere(params.id, user), data })
    if (r.count === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const updated = await prisma.campaign.findUnique({ where: { id: params.id } })
    return NextResponse.json(updated)
  } catch (e: any) {
  return safeError(e, "campaigns/[id]")
}
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    // Kiểm tra ownership trước (delete cần biết camp tồn tại để không lộ ID người khác).
    const camp = await prisma.campaign.findFirst({ where: ownerWhere(params.id, user), select: { id: true } })
    if (!camp) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    await prisma.$transaction([
      prisma.post.updateMany({ where: { campaignId: params.id }, data: { campaignId: null } }),
      prisma.campLog.updateMany({ where: { campaignId: params.id }, data: { campaignId: null } }),
      prisma.campaign.delete({ where: { id: params.id } }),
    ])
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "campaigns/[id]")
}
}
