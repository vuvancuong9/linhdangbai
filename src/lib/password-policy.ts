// Password policy: tối thiểu 10 ký tự, có ít nhất 1 chữ cái + 1 số.
// Đủ mạnh chống brute-force cơ bản, không quá khắt khe gây UX tệ.

export const PASSWORD_MIN_LEN = 10

export function validatePassword(pw: string): { ok: boolean; error: string } {
  if (typeof pw !== "string") return { ok: false, error: "Mật khẩu không hợp lệ" }
  if (pw.length < PASSWORD_MIN_LEN) {
    return { ok: false, error: `Mật khẩu tối thiểu ${PASSWORD_MIN_LEN} ký tự` }
  }
  if (pw.length > 100) {
    return { ok: false, error: "Mật khẩu quá dài (tối đa 100 ký tự)" }
  }
  if (!/[a-zA-Z]/.test(pw)) {
    return { ok: false, error: "Mật khẩu phải có ít nhất 1 chữ cái" }
  }
  if (!/[0-9]/.test(pw)) {
    return { ok: false, error: "Mật khẩu phải có ít nhất 1 số" }
  }
  // Phổ biến quá → reject
  const COMMON = ["password", "12345678", "qwertyuiop", "11111111", "abcd1234", "admin1234"]
  if (COMMON.some((c) => pw.toLowerCase() === c)) {
    return { ok: false, error: "Mật khẩu quá phổ biến, chọn cái khác" }
  }
  return { ok: true, error: "" }
}
