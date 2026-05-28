import crypto from "crypto"

const ENDPOINT = "https://open-api.affiliate.shopee.vn/graphql"

// Sign request theo Shopee Affiliate Open API spec.
// Authorization header format: SHA256 Credential={AppID}, Timestamp={ts}, Signature={hex}
// Signature = SHA256(AppID + Timestamp + Payload + AppSecret)
function signRequest(appId: string, appSecret: string, payload: string) {
  const timestamp = Math.floor(Date.now() / 1000)
  const factor = `${appId}${timestamp}${payload}${appSecret}`
  const signature = crypto.createHash("sha256").update(factor).digest("hex")
  return {
    timestamp,
    signature,
    authHeader: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
  }
}

// Generate affiliate short link với sub_ids.
// subIds: [sub1, sub2, sub3, sub4, sub5] — max 5 phần tử.
// Shopee Affiliate Open API: field tên là `originUrl` (introspect ShortLinkInput xác nhận).
export async function generateShortLink(
  appId: string,
  appSecret: string,
  originUrl: string,
  subIds: string[]
): Promise<string> {
  // Sub IDs: trim, filter empty, max 5
  const cleanSubs = subIds.map((s) => String(s || "").trim()).slice(0, 5)
  // Pad missing với "" để giữ position
  while (cleanSubs.length < 5) cleanSubs.push("")
  // Build mutation — Shopee dùng GraphQL không variables, nhúng inline
  const escOriginal = JSON.stringify(originUrl)
  const subIdsArrayLiteral = "[" + cleanSubs.map((s) => JSON.stringify(s)).join(", ") + "]"
  const query = `
    mutation {
      generateShortLink(input: { originUrl: ${escOriginal}, subIds: ${subIdsArrayLiteral} }) {
        shortLink
        longLink
      }
    }
  `.trim().replace(/\s+/g, " ")
  const payload = JSON.stringify({ query })
  const { authHeader } = signRequest(appId, appSecret, payload)
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: payload,
  })
  const data: any = await r.json().catch(() => ({}))
  if (data?.errors) {
    // In FULL error để debug
    console.error("[Shopee shortLink] full error:", JSON.stringify(data.errors))
    console.error("[Shopee shortLink] payload was:", payload)
    throw new Error("Shopee: " + JSON.stringify(data.errors).slice(0, 500))
  }
  const shortLink = data?.data?.generateShortLink?.shortLink
  if (!shortLink) {
    console.error("[Shopee shortLink] no shortLink in response:", JSON.stringify(data))
    throw new Error("Shopee không trả shortLink: " + JSON.stringify(data).slice(0, 300))
  }
  return String(shortLink)
}

// ============= Sync conversion + click data tu Shopee Affiliate Open API =============

export interface ShopeeOrderItem {
  itemId: string
  itemName: string
  price: number
  quantity: number
  shopId: string
  shopName: string
  globalCategoryLevel1Name?: string
  globalCategoryLevel2Name?: string
}

export interface ShopeeConversion {
  orderId: string
  purchaseTime: number      // unix seconds
  clickTime: number         // unix seconds
  conversionStatus: string  // "PENDING" | "COMPLETED" | "CANCELED"
  totalNetCommission: number // VND total commission of this order
  items: ShopeeOrderItem[]
  subId1?: string
  subId2?: string
  subId3?: string
  subId4?: string
  subId5?: string
}

// Fetch conversionReport - paginated qua scrollId.
// startTime, endTime: unix seconds (mapping → purchaseTimeStart, purchaseTimeEnd args API).
// orderStatus: "ALL" hoac specific. Default "ALL". Truyen LITERAL (enum, KHONG quote string).
// Tra ve TAT CA conversions trong khoang (auto-paginate).
//
// LUU Y (2026-05-20): Shopee da doi schema GraphQL:
//   - startTime → purchaseTimeStart
//   - endTime → purchaseTimeEnd
//   - orderStatus: "ALL" (quoted) → orderStatus: ALL (enum literal)
// Enum values hop le: ALL, UNPAID, PENDING, COMPLETED, CANCELLED
export async function fetchConversionReport(
  appId: string,
  appSecret: string,
  startTime: number,
  endTime: number,
  orderStatus: string = "ALL",
): Promise<ShopeeConversion[]> {
  const all: ShopeeConversion[] = []
  let scrollId = ""
  let safetyCounter = 0

  while (safetyCounter < 200) { // max 200 pages = ~10k orders
    // SCHEMA MOI (2026-05-20): conversionReport tra ve "Conversion" (1 click → 1+ orders).
    // Moi conversion co utmContent (chua subIds dang "s1-s2-s3-s4-s5") + orders[] (array).
    // Moi order co items[] voi field rename: itemPrice (String), qty, itemTotalCommission (String),
    // globalCategoryLv1Name (Lv1 thay vi Level1).
    const queryFields = `
      nodes {
        conversionId
        clickTime
        purchaseTime
        conversionStatus
        netCommission
        utmContent
        orders {
          orderId
          orderStatus
          items {
            itemId
            itemName
            itemPrice
            qty
            shopId
            shopName
            itemTotalCommission
            globalCategoryLv1Name
            globalCategoryLv2Name
          }
        }
      }
      pageInfo { scrollId hasNextPage }
    `.replace(/\s+/g, " ")
    const scrollFilter = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : ""
    // orderStatus la enum DisplayOrderStatus → truyen literal khong quote.
    // Whitelist chong injection (enum hop le).
    const okStatus = ["ALL", "UNPAID", "PENDING", "COMPLETED", "CANCELLED"]
    const statusLiteral = okStatus.includes(orderStatus.toUpperCase()) ? orderStatus.toUpperCase() : "ALL"
    const query = `
      query {
        conversionReport(purchaseTimeStart: ${startTime}, purchaseTimeEnd: ${endTime}, orderStatus: ${statusLiteral}${scrollFilter}) {
          ${queryFields}
        }
      }
    `.replace(/\s+/g, " ")
    const payload = JSON.stringify({ query })
    const { authHeader } = signRequest(appId, appSecret, payload)
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: payload,
    })
    const data: any = await r.json().catch(() => ({}))
    if (data?.errors) {
      console.error("[Shopee conversionReport] error:", JSON.stringify(data.errors))
      throw new Error("Shopee API: " + JSON.stringify(data.errors).slice(0, 300))
    }
    const report = data?.data?.conversionReport
    if (!report) {
      console.warn("[Shopee conversionReport] empty response:", JSON.stringify(data).slice(0, 200))
      break
    }
    const nodes: any[] = report.nodes || []
    for (const n of nodes) {
      // Parse subIds tu utmContent format "s1-s2-s3-s4-s5"
      const subParts = String(n.utmContent || "").split("-")
      // Mỗi Conversion có thể có nhiều orders (cùng click → nhiều shop) → split thành nhiều ShopeeConversion row
      const orders: any[] = Array.isArray(n.orders) ? n.orders : (n.orders ? [n.orders] : [])
      for (const o of orders) {
        const items: ShopeeOrderItem[] = (o.items || []).map((it: any) => ({
          itemId: String(it.itemId || ""),
          itemName: String(it.itemName || ""),
          price: Number(it.itemPrice || 0), // String → Number
          quantity: Number(it.qty || 1),    // was orderCount
          shopId: String(it.shopId || ""),
          shopName: String(it.shopName || ""),
          globalCategoryLevel1Name: it.globalCategoryLv1Name || undefined, // Lv1 thay vi Level1
          globalCategoryLevel2Name: it.globalCategoryLv2Name || undefined,
        }))
        // Commission cua order nay = sum itemTotalCommission cua items trong order
        const orderCommission = (o.items || []).reduce((s: number, it: any) => s + Number(it.itemTotalCommission || 0), 0)
        all.push({
          orderId: String(o.orderId || ""),
          purchaseTime: Number(n.purchaseTime || 0),
          clickTime: Number(n.clickTime || 0),
          conversionStatus: String(o.orderStatus || n.conversionStatus || "PENDING"),
          totalNetCommission: orderCommission,
          items,
          subId1: subParts[0] || undefined,
          subId2: subParts[1] || undefined,
          subId3: subParts[2] || undefined,
          subId4: subParts[3] || undefined,
          subId5: subParts[4] || undefined,
        })
      }
    }
    if (!report.pageInfo?.hasNextPage) break
    scrollId = String(report.pageInfo.scrollId || "")
    if (!scrollId) break
    safetyCounter++
  }

  return all
}

