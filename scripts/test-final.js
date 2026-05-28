const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const token = await p.fbToken.findFirst();
  const pageId = "1000363159831797";
  
  // Lay page token
  const ptRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=access_token,name&access_token=${token.longToken}`);
  const ptData = await ptRes.json();
  console.log("Page token response:", JSON.stringify(ptData));
  
  const pageToken = ptData.access_token || token.longToken;
  const sinceTs = Math.floor(Date.now()/1000) - 30*24*60*60; // 30 ngay
  const untilTs = Math.floor(Date.now()/1000);
  
  // Test /posts
  const r1 = await fetch(`https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,message,created_time&since=${sinceTs}&until=${untilTs}&limit=3&access_token=${pageToken}`);
  const d1 = await r1.json();
  console.log("\n/posts:", JSON.stringify(d1).slice(0, 400));
  
  // Test /feed
  const r2 = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed?fields=id,message,created_time&since=${sinceTs}&until=${untilTs}&limit=3&access_token=${pageToken}`);
  const d2 = await r2.json();
  console.log("\n/feed:", JSON.stringify(d2).slice(0, 400));
  
  await p.$disconnect();
}
main().catch(console.error);