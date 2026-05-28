const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const token = await p.fbToken.findFirst();
  const pages = await p.fanPage.findMany({ take: 3 });
  console.log("Token:", token?.longToken?.slice(0,30));
  console.log("Pages:", JSON.stringify(pages.map(pg => ({ id: pg.id, name: pg.name, pageId: pg.pageId }))));
  
  // Test lay posts tu page dau tien
  if (pages.length && token) {
    const url = `https://graph.facebook.com/v19.0/${pages[0].pageId}/posts?fields=id,message,created_time,permalink_url&limit=5&access_token=${token.longToken}`;
    const res = await fetch(url);
    const data = await res.json();
    console.log("Posts from FB:", JSON.stringify(data).slice(0, 500));
  }
  await p.$disconnect();
}
main().catch(console.error);