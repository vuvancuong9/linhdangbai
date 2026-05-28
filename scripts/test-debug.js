const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const token = await p.fbToken.findFirst();
  const pages = await p.fanPage.findMany({ take: 2 });
  const sinceTs = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const untilTs = Math.floor(Date.now() / 1000);

  for (const page of pages) {
    console.log("\n=== Page:", page.name, page.pageId);
    
    // Lay page token
    const ptRes = await fetch(`https://graph.facebook.com/v19.0/${page.pageId}?fields=access_token&access_token=${token.longToken}`);
    const ptData = await ptRes.json();
    const pageToken = ptData.access_token || token.longToken;
    console.log("Page token:", ptData.access_token ? "OK (page token)" : "FAILED - dung user token");
    if (ptData.error) console.log("Page token error:", ptData.error.message);

    // Lay posts
    const url = `https://graph.facebook.com/v19.0/${page.pageId}/posts?fields=id,message,story,created_time&since=${sinceTs}&until=${untilTs}&limit=5&access_token=${pageToken}`;
    const postsRes = await fetch(url);
    const postsData = await postsRes.json();
    console.log("Posts response:", JSON.stringify(postsData).slice(0, 400));
  }
  await p.$disconnect();
}
main().catch(console.error);