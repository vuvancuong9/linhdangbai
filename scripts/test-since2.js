const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const token = await p.fbToken.findFirst();
  const page = await p.fanPage.findFirst();
  console.log("Testing page:", page.name, page.pageId);
  
  const sinceTs = Math.floor(new Date("2026-04-29T00:00:00+07:00").getTime() / 1000);
  const untilTs = Math.floor(Date.now() / 1000);
  
  const ptRes = await fetch(`https://graph.facebook.com/v19.0/${page.pageId}?fields=access_token&access_token=${token.longToken}`);
  const ptData = await ptRes.json();
  const pageToken = ptData.access_token || token.longToken;
  console.log("Page token:", ptData.access_token ? "OK" : "using user token");
  
  const url = `https://graph.facebook.com/v19.0/${page.pageId}/posts?fields=id,message,story,created_time&since=${sinceTs}&until=${untilTs}&limit=10&access_token=${pageToken}`;
  const res = await fetch(url);
  const data = await res.json();
  console.log("Posts count:", data.data?.length || 0);
  if (data.error) console.log("Error:", data.error.message);
  if (data.data) data.data.slice(0,3).forEach(post => console.log(" -", post.created_time, (post.message||"").slice(0,60)));
  await p.$disconnect();
}
main().catch(console.error);