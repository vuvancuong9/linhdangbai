// Wrapper cho FbToken / ShopeeAffiliateToken: encrypt khi save, decrypt khi đọc.
// Backward compat: row plaintext cũ vẫn đọc được; bất kỳ save mới nào sẽ encrypt.
import { prisma } from "./prisma"
import { encryptSecret, decryptSecret } from "./crypto"

// === FB Token ===
export type DecryptedFbToken = {
  id: string
  userId: string
  appId: string
  appSecret: string
  shortToken: string
  longToken: string
  expiresAt: Date | null
  updatedAt: Date
} | null

export async function getFbToken(userId: string): Promise<DecryptedFbToken> {
  const t = await prisma.fbToken.findUnique({ where: { userId } })
  if (!t) return null
  return {
    id: t.id,
    userId: t.userId,
    appId: t.appId,
    appSecret: decryptSecret(t.appSecret),
    shortToken: decryptSecret(t.shortToken),
    longToken: decryptSecret(t.longToken),
    expiresAt: t.expiresAt,
    updatedAt: t.updatedAt,
  }
}

export async function saveFbToken(userId: string, params: {
  appId: string
  appSecret: string
  shortToken: string
  longToken: string
  expiresAt: Date | null
}) {
  const data = {
    appId: params.appId,
    appSecret: encryptSecret(params.appSecret),
    shortToken: encryptSecret(params.shortToken),
    longToken: encryptSecret(params.longToken),
    expiresAt: params.expiresAt,
  }
  const existing = await prisma.fbToken.findUnique({ where: { userId } })
  if (existing) {
    return prisma.fbToken.update({ where: { userId }, data: { ...data, updatedAt: new Date() } })
  }
  return prisma.fbToken.create({ data: { userId, ...data } })
}

// === Shopee Token (per account) ===
export async function decryptShopeeAccount(t: any) {
  if (!t) return t
  return {
    ...t,
    appKey: t.appKey ? decryptSecret(t.appKey) : t.appKey,
    appSecret: t.appSecret ? decryptSecret(t.appSecret) : t.appSecret,
  }
}

export function encryptShopeeFields<T extends { appKey?: string; appSecret?: string }>(input: T): T {
  const r: any = { ...input }
  if (r.appKey) r.appKey = encryptSecret(r.appKey)
  if (r.appSecret) r.appSecret = encryptSecret(r.appSecret)
  return r
}
