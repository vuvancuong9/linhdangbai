import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export async function GET() {
  try {
    const user = await requireAuth()
    const pages = await prisma.fanPage.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" }
    })
    return NextResponse.json(pages)
  } catch (e: any) {
  return safeError(e, "pages")
}
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const page = await prisma.fanPage.create({
      data: { userId: user.userId, name: body.name, pageId: body.pageId, category: body.category || "" }
    })
    return NextResponse.json(page)
  } catch (e: any) {
  return safeError(e, "pages")
}
}