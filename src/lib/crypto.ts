import crypto from "crypto"

// AES-256-GCM mã hoá đối xứng cho secrets lưu DB (FB token, Shopee API key).
// Ciphertext format: enc:v1:<iv_base64>:<tag_base64>:<ciphertext_base64>
// Backward compat: nếu prefix không phải "enc:v1:" → coi là plaintext (chưa migrate).

const ENC_PREFIX = "enc:v1:"

function getKey(): Buffer | null {
  const raw = process.env.TOKEN_ENC_KEY
  if (!raw) return null
  // Hỗ trợ key dạng hex 64 ký tự (32 byte) hoặc base64 32 byte hoặc passphrase (sẽ SHA-256).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex")
  try {
    const b = Buffer.from(raw, "base64")
    if (b.length === 32) return b
  } catch {}
  // Fallback: derive 32-byte key từ passphrase qua SHA-256
  return crypto.createHash("sha256").update(raw, "utf8").digest()
}

const KEY = getKey()

export function encryptSecret(plain: string): string {
  if (!plain) return plain
  if (!KEY) return plain // Không có key → trả nguyên (dev hoặc env chưa cấu hình)
  if (plain.startsWith(ENC_PREFIX)) return plain // đã mã hoá rồi
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv)
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENC_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`
}

export function decryptSecret(value: string): string {
  if (!value) return value
  if (!value.startsWith(ENC_PREFIX)) return value // plaintext (chưa migrate hoặc env không có key)
  if (!KEY) {
    // Đã encrypt nhưng key biến mất → throw để tránh dùng nhầm
    throw new Error("TOKEN_ENC_KEY missing — cannot decrypt secret")
  }
  const parts = value.slice(ENC_PREFIX.length).split(":")
  if (parts.length !== 3) throw new Error("Invalid encrypted format")
  const iv = Buffer.from(parts[0], "base64")
  const tag = Buffer.from(parts[1], "base64")
  const ct = Buffer.from(parts[2], "base64")
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString("utf8")
}

export function isEncryptionConfigured(): boolean {
  return KEY != null
}
