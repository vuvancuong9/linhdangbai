const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const token = await p.fbToken.findFirst();
  const pages = await p.fanPage.findMany({ take: 3 });
  
  for (const pg of pages) {
    // Lay page access token
    const pageTokenRes = await fetch(`https://graph.facebook.com/v19.0/${pg.pageId}?fields=access_token&access_token=${token.longToken}`);
    const pageTokenData = await pageTokenRes.json();
    console.log(`Page ${pg.name} token:`, pageTokenData.access_token ? "OK" : JSON.stringify(pageTokenData.error));
    
    if (pageTokenData.access_token) {
      // Dung page token de lay posts
      const postsRes = await fetch(`https://graph.facebook.com/v19.0/${pg.pageId}/feed?fields=id,message,created_time,permalink_url&limit=3&access_token=${pageTokenData.access_token}`);
      const postsData = await postsRes.json();
      console.log(`Posts:`, JSON.stringify(postsData).slice(0, 300));
    }
  }
  await p.$disconnect();
}
main().catch(console.error);