const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const token = await p.fbToken.findFirst();
  const pageId = "100036315983179797"; // Tong Kho Ly Ngo - kiem tra lai ID
  const pageId2 = "1000363159831797"; // Thu ID ngan hon
  
  console.log("Testing page token for Tong Kho Ly Ngo...");
  
  // Thu lay page token
  for (const pid of [pageId, pageId2]) {
    const res = await fetch(`https://graph.facebook.com/v19.0/${pid}?fields=id,name,access_token&access_token=${token.longToken}`);
    const data = await res.json();
    console.log(`\nPage ID ${pid}:`, JSON.stringify(data));
  }
  
  await p.$disconnect();
}
main().catch(console.error);