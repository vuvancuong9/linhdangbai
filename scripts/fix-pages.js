const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Fix page ID sai trong DB
  const pages = await p.fanPage.findMany();
  for (const page of pages) {
    // Thu lay page info voi ID hien tai
    const token = await p.fbToken.findFirst();
    const res = await fetch(`https://graph.facebook.com/v19.0/${page.pageId}?fields=id,name&access_token=${token.longToken}`);
    const data = await res.json();
    if (data.error && data.error.code === 100) {
      console.log(`WRONG ID: ${page.name} - ${page.pageId}`);
    } else if (data.id && data.id !== page.pageId) {
      console.log(`FIXING: ${page.name} - ${page.pageId} -> ${data.id}`);
      await p.fanPage.update({ where: { id: page.id }, data: { pageId: data.id } });
    } else if (data.id) {
      console.log(`OK: ${page.name} - ${page.pageId}`);
    }
  }
  
  // Test lay posts voi ID da fix
  const tkln = await p.fanPage.findFirst({ where: { name: { contains: "Tong Kho" } } });
  if (tkln) {
    const token = await p.fbToken.findFirst();
    const ptRes = await fetch(`https://graph.facebook.com/v19.0/${tkln.pageId}?fields=access_token&access_token=${token.longToken}`);
    const ptData = await ptRes.json();
    const pageToken = ptData.access_token || token.longToken;
    const sinceTs = Math.floor(Date.now()/1000) - 7*24*60*60;
    const untilTs = Math.floor(Date.now()/1000);
    const postsRes = await fetch(`https://graph.facebook.com/v19.0/${tkln.pageId}/posts?fields=id,message,story,created_time&since=${sinceTs}&until=${untilTs}&limit=5&access_token=${pageToken}`);
    const postsData = await postsRes.json();
    console.log("\nPosts:", JSON.stringify(postsData).slice(0, 500));
  }
  await p.$disconnect();
}
main().catch(console.error);