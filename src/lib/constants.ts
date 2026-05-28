// Constants CLIENT-SAFE — có thể import từ React component, sẽ vào bundle JS.
// Chỉ giữ giá trị KHÔNG nhạy cảm: cache TTL (UX), file upload limits (validation),
// concurrency cap (tham khảo).
//
// Các business logic nhạy cảm (công thức profit, auto-manage rules) đã chuyển
// sang `constants-server.ts` để TRÁNH LỘ qua F12 / DevTools.

// Cache TTL (ms)
export const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000   // 5 min localStorage
export const SPEND_CACHE_TTL_MS = 3 * 60 * 1000        // 3 min FB Insights spend
export const SPEND_CACHE_MAX_ENTRIES = 500

// File upload limits
// Raise lên 200MB để hỗ trợ CSV nhiều tháng (1 file 69MB = ~3 tháng).
// Client parse stream → server nhận chunk 5000 records (~1-2MB/req) → server cap 20MB OK.
export const MAX_UPLOAD_FILE_MB = 200
export const MAX_IMPORT_BODY_MB = 20

// Concurrency caps (không phải secret — tham khảo)
export const FB_API_CONCURRENCY = 4
export const SHOPEE_SYNC_CONCURRENCY = 3
export const MAPPING_SYNC_CONCURRENCY = 3

// === Re-export server constants để API routes vẫn import từ 1 chỗ ===
// React component import từ "@/lib/constants" sẽ chỉ thấy values ở trên.
// API routes có thể tiếp tục `import { COMMISSION_NET_FACTOR } from "@/lib/constants"`
// nếu cần (Next.js không bundle file này vào client trừ khi import bởi
// component "use client"). An toàn vì các route trong src/app/api/ luôn server-only.
//
// → KHÔNG export business constants ở đây. Server import trực tiếp từ
// `@/lib/constants-server`. Em đã update tất cả file server.