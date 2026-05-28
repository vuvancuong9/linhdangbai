const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Simulate sync cho user cu the
  const userId = "cmon8mpc20000uq1jz56sdxl5";
  const token = await p.fbToken.findUnique({ where: { userId } });
  const pages = await p.fanPage.findMany({ where: { userId } });
  
  console.log("Token found:", !!token);
  console.log("Pages:", pages.length);
  
  const sinceTs = Math.floor(Date.now()/1000) - 7*24*60*60;
  const untilTs = Math.floor(Date.now()/1000);
  
  for (const page of pages.slice(0,2)) {
    console.log("\nTesting page:", page.name, page.pageId);
    const ptRes = await fetch(`https://graph.facebook.com/v19.0/${page.pageId}?fields=access_token&access_token=${token.longToken}`);
    const ptData = await ptRes.json();
    const pageToken = ptData.access_token || token.longToken;
    console.log("Page token:", ptData.access_token ? "OK" : "using user token");
    
    const postsRes = await fetch(`https://graph.facebook.com/v19.0/${page.pageId}/posts?fields=id,message,story,created_time&since=${sinceTs}&until=${untilTs}&limit=5&access_token=${pageToken}`);
    const postsData = await postsRes.json();
    const posts = postsData.data || [];
    console.log("Posts count:", posts.length, postsData.error ? "ERROR: "+postsData.error.message : "");
    
    // Check shopee links
    let shopeeCount = 0;
    for (const post of posts) {
      const text = post.message || post.story || "";
      if (text.match(/https?:\/\/(s\.shopee\.vn|shope\.ee|shopee\.vn)/i)) shopeeCount++;
    }
    console.log("Posts with shopee link:", shopeeCount);
  }
  await p.$disconnect();
}
main().catch(console.error);