// Manual trigger Shopee sync cho user Quy. Bypass Railway (đang Limited Access).
// Chạy: npx ts-node scripts/sync-shopee-now.ts [daysBack=14]
import { prisma } from "../src/lib/prisma"
import { syncShopeeAffForUser } from "../src/lib/shopee-aff-sync"

;(async () => {
  try {
    const daysBack = Number(process.argv[2]) || 14
    const user = await prisma.user.findFirst({ where: { name: { contains: "Quy" } }, select: { id: true, name: true } })
    if (!user) { console.error("User Quy không tồn tại"); process.exit(1) }
    console.log(`Syncing Shopee cho user ${user.name} (${user.id}) — daysBack=${daysBack}`)
    const results = await syncShopeeAffForUser(user.id, daysBack)
    console.log("\n=== Per token ===")
    for (const r of results) {
      const status = r.ok ? "✅" : "❌"
      console.log(`${status} ${r.tokenName}: ${r.conversionsFetched} conversions, ${r.ordersUpserted} orders upserted, ${r.dailyAggregateUpserted} daily-agg ${r.error ? "| ERROR: " + r.error : ""}`)
    }
    const total = results.reduce((s, r) => ({
      conv: s.conv + r.conversionsFetched,
      ord: s.ord + r.ordersUpserted,
      agg: s.agg + r.dailyAggregateUpserted,
      fail: s.fail + (r.ok ? 0 : 1),
    }), { conv: 0, ord: 0, agg: 0, fail: 0 })
    console.log(`\nTOTAL: ${total.conv} conversions, ${total.ord} orders, ${total.agg} daily-agg, ${total.fail} fail`)
  } catch (e: any) {
    console.error("ERR:", e?.message || e)
  } finally {
    await prisma.$disconnect()
  }
})()
