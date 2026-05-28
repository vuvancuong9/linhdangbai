const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const token = await p.fbToken.findFirst();
  
  // Lay danh sach pages chinh xac tu FB
  const res = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,category,access_token&limit=50&access_token=${token.longToken}`);
  const data = await res.json();
  console.log("FB Pages:", JSON.stringify(data.data?.map((p) => ({ id: p.id, name: p.name })), null, 2));
  
  await p.$disconnect();
}
main().catch(console.error);