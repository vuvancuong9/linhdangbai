// Helper cho trang /trinh-quan-ly — fetch FB Marketing API data ở 3 cấp:
// Campaign / Ad Set / Ad. Insights được fetch ở account-level (1 call duy nhất)
// rồi merge theo id → siêu nhanh.

const FB_API = "https://graph.facebook.com/v19.0"

// Map FB date preset string → param FB accept.
// FE truyền 1 trong các key dưới, hoặc { since, until } cho custom range.
export const DATE_PRESETS = [
  "today",
  "yesterday",
  "this_week_mon_today",
  "last_week_mon_sun",
  "last_7d",
  "last_14d",
  "last_30d",
  "this_month",
  "last_month",
  "maximum",
] as const
export type DatePreset = typeof DATE_PRESETS[number]

export function buildDateParam(datePreset?: string | null, since?: string | null, until?: string | null): string {
  if (since && until) {
    const tr = encodeURIComponent(JSON.stringify({ since, until }))
    return `time_range=${tr}`
  }
  const p = (datePreset && DATE_PRESETS.includes(datePreset as any)) ? datePreset : "today"
  return `date_preset=${p}`
}

// Parse actions[] + cost_per_action_type[] → ra (results, costPerResult, resultLabel)
// Dựa vào objective campaign:
//   OUTCOME_TRAFFIC / LINK_CLICKS / OUTCOME_AWARENESS → link_click
//   OUTCOME_ENGAGEMENT / POST_ENGAGEMENT → post_engagement
//   OUTCOME_LEADS → lead
//   OUTCOME_SALES / CONVERSIONS → offsite_conversion.fb_pixel_purchase (hoặc purchase)
// Fallback: link_click nếu objective không nhận diện được.
export function computeResults(objective: string | null | undefined, actions: any[] | undefined, costs: any[] | undefined): {
  results: number
  costPerResult: number | null
  resultLabel: string
} {
  let actionType = "link_click"
  let label = "Link Click"
  const obj = (objective || "").toUpperCase()
  if (obj.includes("ENGAGEMENT")) { actionType = "post_engagement"; label = "Post Engagement" }
  else if (obj.includes("LEAD")) { actionType = "lead"; label = "Lead" }
  else if (obj.includes("SALES") || obj.includes("CONVERSION")) { actionType = "offsite_conversion.fb_pixel_purchase"; label = "Purchase" }
  else if (obj.includes("VIDEO_VIEWS")) { actionType = "video_view"; label = "Video View" }
  // Mặc định: link_click

  const findVal = (arr: any[] | undefined, type: string): number => {
    if (!Array.isArray(arr)) return 0
    const hit = arr.find((a) => a?.action_type === type)
    return hit ? parseFloat(hit.value || "0") : 0
  }
  const results = findVal(actions, actionType)
  const cost = findVal(costs, actionType)
  return {
    results: Math.round(results),
    costPerResult: results > 0 ? Math.round(cost) : null,
    resultLabel: label,
  }
}

// Map FB status (ACTIVE/PAUSED/ARCHIVED/DELETED) + effective_status →
// label hiển thị Delivery: "Active" / "Paused" / "Not delivering" / ...
export function deliveryLabel(status: string | undefined, effectiveStatus: string | undefined): string {
  const es = effectiveStatus || status || ""
  if (es === "ACTIVE") return "Active"
  if (es === "PAUSED") return "Paused"
  if (es === "DELETED" || es === "ARCHIVED") return es.charAt(0) + es.slice(1).toLowerCase()
  if (es === "WITH_ISSUES") return "With Issues"
  if (es === "PENDING_REVIEW") return "Pending Review"
  if (es === "DISAPPROVED") return "Disapproved"
  if (es === "CAMPAIGN_PAUSED") return "Campaign off"
  if (es === "ADSET_PAUSED") return "Ad set off"
  if (es === "IN_PROCESS") return "In process"
  return es.replace(/_/g, " ").toLowerCase()
}

// Fetch toàn bộ pages của 1 FB endpoint (paging.next), cap maxPages.
export async function fbFetchAll(url: string, token: string, maxPages = 20): Promise<any[]> {
  const out: any[] = []
  let next: string | null = url + (url.includes("?") ? "&" : "?") + `access_token=${token}`
  let pages = 0
  while (next && pages < maxPages) {
    const r = await fetch(next)
    const d: any = await r.json()
    if (d.error) throw new Error(d.error.message || "FB error")
    for (const it of (d.data || [])) out.push(it)
    next = d.paging?.next || null
    pages++
  }
  return out
}

// Fetch insights ở level cụ thể, cho 1 entity cha (ad account / campaign / adset).
// Trả về Map<id, insightRow>.
// Lợi thế: 1 call duy nhất trả về toàn bộ con + metrics.
export async function fbFetchInsightsMap(
  parentPath: string,        // "act_123" | "1234567890" (camp id) | "9876543210" (adset id)
  level: "campaign" | "adset" | "ad",
  dateParam: string,         // "date_preset=today" | "time_range=..."
  token: string,
): Promise<Map<string, any>> {
  const fields = "campaign_id,adset_id,ad_id,spend,impressions,reach,clicks,inline_link_clicks,actions,cost_per_action_type,frequency,cpm,objective"
  const url = `${FB_API}/${parentPath}/insights?level=${level}&fields=${fields}&limit=500&${dateParam}`
  const rows = await fbFetchAll(url, token, 30)
  const map = new Map<string, any>()
  for (const r of rows) {
    const key = level === "campaign" ? r.campaign_id : level === "adset" ? r.adset_id : r.ad_id
    if (key) map.set(key, r)
  }
  return map
}

// Format budget (FB trả về string số xu — VND không có xu nên parse int là OK).
export function parseBudget(daily: string | undefined, lifetime: string | undefined): { value: number | null; type: "daily" | "lifetime" | null } {
  if (daily && daily !== "0") return { value: parseInt(daily), type: "daily" }
  if (lifetime && lifetime !== "0") return { value: parseInt(lifetime), type: "lifetime" }
  return { value: null, type: null }
}
