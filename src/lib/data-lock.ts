// =================== DATA LOCK ===================
// Hai loại lock:
// 1. STATIC `DATA_LOCK_DATE`: mốc tuyệt đối — data trước mốc này đã bị xoá vĩnh viễn.
// 2. ROLLING `ROLLING_LOCK_DAYS`: cuộn theo thời gian — data cũ hơn N ngày từ HÔM NAY
//    không cho upsert/delete (bảo vệ history, tránh ghi đè/xoá nhầm khi upload CSV mới).
//
// "Effective lock" = MAX(static, rolling). Một date bị lock nếu < cái muộn hơn giữa 2 mốc.
//
// Format: YYYY-MM-DD (ngày bắt đầu được phép, INCLUSIVE).

export const DATA_LOCK_DATE = "2026-02-01"
export const ROLLING_LOCK_DAYS = 30

// Trả về YYYY-MM-DD của (hôm nay - ROLLING_LOCK_DAYS).
// Mọi data có clickDate < ngày này bị lock (rolling).
export function getRollingLockDate(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - ROLLING_LOCK_DAYS)
  return d.toISOString().slice(0, 10)
}

// Effective lock = mốc lock nghiêm khắc nhất (lấy ngày MUỘN hơn giữa static + rolling).
// Tất cả write/delete operation phải tuân: chỉ áp dụng cho clickDate >= effective lock.
export function getEffectiveLockDate(): string {
  const rolling = getRollingLockDate()
  return rolling > DATA_LOCK_DATE ? rolling : DATA_LOCK_DATE
}

// Boolean check: 1 ngày YYYY-MM-DD có bị lock (trước mốc effective) không.
export function isLocked(dateStr: string): boolean {
  return dateStr < getEffectiveLockDate()
}

// Clamp 1 string YYYY-MM-DD về ≥ DATA_LOCK_DATE (static — cho query đọc, vẫn cho xem data cũ).
export function clampDateStr(dateStr: string): string {
  return dateStr < DATA_LOCK_DATE ? DATA_LOCK_DATE : dateStr
}

// Cho server (Date object).
export function clampDate(d: Date): Date {
  const lock = new Date(DATA_LOCK_DATE + "T00:00:00Z")
  return d < lock ? lock : d
}
