import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const userId = (user as any).userId
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json()
    const { postIds, config } = body

    const posts = await prisma.post.findMany({
      where: { userId, id: { in: postIds } },
      include: { page: true, campaign: true }
    })

    if (!posts.length) return NextResponse.json({ error: "Khong tim thay bai post" }, { status: 400 })

    const HEADER = [
      "Campaign ID","Creation Package Config ID","Campaign Name","Special Ad Categories",
      "Special Ad Category Country","Campaign Status","Campaign Objective","Buying Type",
      "Campaign Spend Limit","Campaign Daily Budget","Campaign Lifetime Budget",
      "Campaign Bid Strategy","Tags","Campaign Is Using L3 Schedule","Campaign Start Time",
      "Campaign Stop Time","Product Catalog ID","Campaign Page ID","New Objective",
      "Buy With Prime Type","Is Budget Scheduling Enabled For Campaign","Campaign High Demand Periods",
      "Buy With Integration Partner","Ad Set ID","Ad Set Run Status","Ad Set Lifetime Impressions",
      "Ad Set Name","Ad Set Time Start","Ad Set Time Stop","Ad Set Daily Budget","Destination Type",
      "Ad Set Lifetime Budget","Rate Card","Ad Set Schedule","Use Accelerated Delivery",
      "Frequency Control","Ad Set Minimum Spend Limit","Ad Set Maximum Spend Limit",
      "Is Budget Scheduling Enabled For Ad Set","Ad Set High Demand Periods","Link Object ID",
      "Optimized Conversion Tracking Pixels","Optimized Custom Conversion ID","Optimized Pixel Rule",
      "Optimized Event","Custom Event Name","Link","Application ID","Product Set ID",
      "Place Page Set ID","Object Store URL","Offer ID","Offline Event Data Set ID",
      "Countries","Cities","Regions","Electoral Districts","Zip","Addresses",
      "Geo Markets (DMA)","Global Regions","Large Geo Areas","Medium Geo Areas","Small Geo Areas",
      "Metro Areas","Neighborhoods","Subneighborhoods","Subcities","Location Types",
      "Location Cluster IDs","Location Set IDs","Excluded Countries","Excluded Cities",
      "Excluded Large Geo Areas","Excluded Medium Geo Areas","Excluded Metro Areas",
      "Excluded Small Geo Areas","Excluded Subcities","Excluded Neighborhoods",
      "Excluded Subneighborhoods","Excluded Regions","Excluded Electoral Districts",
      "Excluded Zip","Excluded Addresses","Excluded Geo Markets (DMA)","Excluded Global Regions",
      "Excluded Location Cluster IDs","Gender","Age Min","Age Max","Education Status",
      "Fields of Study","Education Schools","Work Job Titles","Work Employers",
      "College Start Year","College End Year","Interested In","Relationship","Family Statuses",
      "Industries","Life Events","Income","Multicultural Affinity","Household Composition",
      "Behaviors","Connections","Excluded Connections","Friends of Connections","Locales",
      "Site Category","Unified Interests","Excluded User AdClusters","Broad Category Clusters",
      "Targeting Categories - ALL OF","Custom Audiences","Excluded Custom Audiences",
      "Flexible Inclusions","Flexible Exclusions","Advantage Audience","Individual Setting",
      "Age Range","Targeting Optimization","Targeting Relaxation","Product Audience Specs",
      "Excluded Product Audience Specs","Targeted Business Locations","Dynamic Audiences",
      "Excluded Dynamic Audiences","Beneficiary","Payer","Publisher Platforms",
      "Facebook Positions","Instagram Positions","Audience Network Positions",
      "Messenger Positions","WhatsApp Positions","Oculus Positions","Device Platforms",
      "User Device","Excluded User Device","User Operating System","User OS Version",
      "Wireless Carrier","Excluded Publisher Categories","Brand Safety Inventory Filtering Levels",
      "Optimization Goal","Attribution Spec","Billing Event","Bid Amount","Ad Set Bid Strategy",
      "Regional Regulated Categories","Advertiser (financial ads in Australia)",
      "Payer (financial ads in Australia)","Beneficiary (financial ads in Taiwan)",
      "Payer (financial ads in Taiwan)","Advertiser (Taiwan)","Payer (Taiwan)",
      "Advertiser (Singapore)","Payer (Singapore)","Advertiser (securities ads in India)",
      "Payer (securities ads in India)","Beneficiary (selected locations)",
      "Payer (selected locations)","Story ID","Ad ID","Ad Status","Preview Link",
      "Instagram Preview Link","Ad Name","Title","Body","Display Link","Link Description",
      "Optimize text per person","Retailer IDs","Post Click Item Headline",
      "Post Click Item Description","Conversion Tracking Pixels","Optimized Ad Creative",
      "Image Hash","Image File Name","Image Crops","Video Thumbnail URL",
      "Instagram Platform Image Hash","Instagram Platform Image Crops",
      "Instagram Platform Image URL","Carousel Delivery Mode","Creative Type","URL Tags",
      "Event ID","Video ID","Video File Name","Instagram Account ID","Instagram Account ID (New)",
      "Mobile App Deep Link","Product Link","App Link Destination",
      "Call Extension Phone Data ID","Call to Action","Additional Call To Action 5",
      "Additional Call To Action 6","Additional Call To Action 7","Additional Call To Action 8",
      "Additional Call To Action 9","Call to Action Link","Call to Action WhatsApp Number",
      "Degrees of Freedom Type"
    ]

    const now = new Date()
    const startTime = config.startDate
      ? new Date(config.startDate).toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).replace(",", "")
      : `${String(now.getMonth()+1).padStart(2,"0")}/${String(now.getDate()).padStart(2,"0")}/${now.getFullYear()} 00:00:00`

    const pageOId = config.pageId ? `o:${config.pageId}` : ""
    const fbPositions = "feed, facebook_reels, facebook_reels_overlay, profile_feed, notification, instream_video, marketplace, story, search"
    const igPositions = "stream, ig_search, profile_reels, story, reels, explore_home, profile_feed"

    const rows = posts.map(post => {
      // Lấy tên campaign từ relation, fallback về tên post
      const campName = ((post as any).campaign?.name || post.name || `Camp_${post.id.slice(-6)}`).slice(0, 50)
      const postFbId = post.fbId || ""
      const postLink = post.link || ""

      const isVideo = postFbId.startsWith("v:") || postFbId.includes("reel")
      const videoId = isVideo ? `v:${postFbId.replace("v:", "")}` : ""
      // Story ID format: pageId_postId (lay tu fbId neu co dang pageId_postId)
      const storyId = postFbId.includes("_") ? postFbId.split("_")[1] : postFbId
 

      const row: Record<string, string> = {}

      // Campaign level
      row["Campaign Name"] = campName
      row["Special Ad Categories"] = ""
      row["Campaign Status"] = config.status || "ACTIVE"
      row["Campaign Objective"] = config.objective || "Traffic"
      row["Buying Type"] = config.buyType || "AUCTION"
      row["Campaign Daily Budget"] = String(config.budget || 100000)
      row["Campaign Bid Strategy"] = config.bidStrategy || "Cost per result goal"
      row["Campaign Is Using L3 Schedule"] = "false"
      row["Campaign Start Time"] = startTime
      row["Is Budget Scheduling Enabled For Campaign"] = "No"
      row["Campaign High Demand Periods"] = "[]"
      row["Buy With Integration Partner"] = "NONE"

      // Ad Set level
      row["Ad Set Run Status"] = "ACTIVE"
      row["Ad Set Lifetime Impressions"] = "0"
      row["Ad Set Name"] = campName
      row["Ad Set Time Start"] = startTime
      row["Ad Set Daily Budget"] = "UNDEFINED"
      row["Use Accelerated Delivery"] = "No"
      row["Is Budget Scheduling Enabled For Ad Set"] = "No"
      row["Ad Set High Demand Periods"] = "[]"
      row["Link Object ID"] = pageOId
      row["Link"] = postLink
      row["Countries"] = config.country || "VN"
      row["Age Min"] = String(config.ageMin || 20)
      row["Age Max"] = String(config.ageMax || 44)
      row["Publisher Platforms"] = "facebook"
      row["Facebook Positions"] = fbPositions
      row["Instagram Positions"] = igPositions
      row["Device Platforms"] = "mobile, desktop"
      row["Brand Safety Inventory Filtering Levels"] = "FACEBOOK_RELAXED, AN_RELAXED"
      row["Optimization Goal"] = config.optimizationGoal || "LINK_CLICKS"
      row["Attribution Spec"] = '[{"event_type":"CLICK_THROUGH","window_days":1}]'
      row["Billing Event"] = config.billingEvent || "IMPRESSIONS"
      row["Bid Amount"] = String(config.bid || 450)
      row["Ad Set Bid Strategy"] = ""
      row["Regional Regulated Categories"] = "VOLUNTARY_VERIFICATION"

      // Ad level
      row["Story ID"] = storyId
      row["Ad Status"] = "ACTIVE"
      row["Ad Name"] = campName
      row["Body"] = post.name || ""
      row["Optimize text per person"] = "No"
      row["Optimized Ad Creative"] = "No"
      row["Creative Type"] = "Page Post Ad"
      row["Video ID"] = videoId
    

      return HEADER.map(h => {
        const val = row[h] || ""
        return val.includes("\t") || val.includes("\n") ? `"${val}"` : val
      }).join("\t")
    })

    const csv = [HEADER.join("\t"), ...rows].join("\n")

// Danh dau da xuat
await prisma.post.updateMany({
  where: { userId, id: { in: postIds } },
  data: { exported: true, exportedAt: new Date() }
})

return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/tab-separated-values;charset=utf-8",
        "Content-Disposition": `attachment; filename="fb_campaigns_${Date.now()}.csv"`
      }
    })
  } catch (e: any) {
    console.error("[export-csv]", e.message)
    if (e.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return safeError(e, "fb/export-csv")
  }
}