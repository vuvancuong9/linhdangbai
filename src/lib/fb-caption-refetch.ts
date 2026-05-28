// Helper: fetch FULL caption cua 1 FB Reel/post, nhieu strategy:
//  1. FB Graph API /{video_id}?fields=description (uu tien - tra caption day du, khong truncate)
//  2. Fetch HTML → parse JSON state "message":{"text":"..."} (FB embed full caption)
//  3. og:description meta (FALLBACK - thuong bi truncate ~155 char cho SEO preview)
//  4. twitter:description fallback
//
// Dung tu server side - cho ca single refetch va bulk refetch endpoints.

import { getFbToken } from "./token-store"

export type RefetchResult = {
  caption: string
  source: "graph_api" | "html_json" | "og_description" | "twitter_description" | "none"
  error?: string
}

const FB_GRAPH = "https://graph.facebook.com/v21.0"

export async function refetchCaption(opts: {
  userId: string
  sourceFbId: string | null
  sourceUrl: string
}): Promise<RefetchResult> {
  const { userId, sourceFbId, sourceUrl } = opts

  // === Strategy 1: FB Graph API (best - full description) ===
  if (sourceFbId) {
    try {
      const token = await getFbToken(userId)
      if (token?.longToken) {
        const r = await fetch(`${FB_GRAPH}/${sourceFbId}?fields=description`, {
          headers: { Authorization: `Bearer ${token.longToken}` },
        })
        const data = await r.json()
        if (r.ok && typeof data?.description === "string" && data.description.trim().length > 0) {
          return { caption: data.description.slice(0, 5000), source: "graph_api" }
        }
      }
    } catch (e: any) {
      // Continue to fallback
      console.warn("[fb-caption-refetch] Graph API fail:", e?.message)
    }
  }

  // === Strategy 2-4: Fetch HTML ===
  let html = ""
  try {
    const r = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi,en-US;q=0.7,en;q=0.3",
      },
      redirect: "follow",
    })
    if (!r.ok) {
      return { caption: "", source: "none", error: `Fetch HTML fail: HTTP ${r.status}` }
    }
    html = await r.text()
  } catch (e: any) {
    return { caption: "", source: "none", error: `Fetch HTML exception: ${e?.message}` }
  }

  // === Strategy 2: JSON state in HTML — FB embed full caption ===
  // Multiple patterns FB has used: "message":{"text":"..."}, "caption_with_entities":{"text":"..."}, "video_description":"..."
  const jsonPatterns = [
    /"message"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)+)"/,
    /"caption"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)+)"/,
    /"caption_with_entities"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)+)"/,
    /"video_description"\s*:\s*"((?:[^"\\]|\\.)+)"/,
    /"description"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)+)"/,
  ]
  for (const re of jsonPatterns) {
    const m = html.match(re)
    if (m) {
      try {
        const decoded = JSON.parse('"' + m[1] + '"')
        if (decoded && decoded.length > 3) {
          return { caption: decoded.slice(0, 5000), source: "html_json" }
        }
      } catch {}
    }
  }

  // Fallback: "text":"..." cap cao (some pages use this for caption)
  // Chi dung neu co URL hoac dai (chac chan la caption marketing)
  const textMatches = Array.from(html.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.){50,})"/g))
  if (textMatches.length > 0) {
    let longestDecoded = ""
    for (const m of textMatches) {
      try {
        const decoded = JSON.parse('"' + m[1] + '"')
        if (typeof decoded === "string" && decoded.length > longestDecoded.length && decoded.length < 5000) {
          if (!/^[<{[]/.test(decoded) && !/^https?:\/\/\S+$/i.test(decoded)) {
            longestDecoded = decoded
          }
        }
      } catch {}
    }
    if (longestDecoded.length > 100) {
      return { caption: longestDecoded.slice(0, 5000), source: "html_json" }
    }
  }

  // === Strategy 3: og:description ===
  const ogMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:description["']/i)
  if (ogMatch) {
    return { caption: decodeHtmlEntities(ogMatch[1]).slice(0, 5000), source: "og_description" }
  }

  // === Strategy 4: twitter:description ===
  const twMatch = html.match(/<meta\s+name=["']twitter:description["']\s+content=["']([^"']+)["']/i)
  if (twMatch) {
    return { caption: decodeHtmlEntities(twMatch[1]).slice(0, 5000), source: "twitter_description" }
  }

  return { caption: "", source: "none", error: "Khong tim thay caption trong moi strategy" }
}

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
}
