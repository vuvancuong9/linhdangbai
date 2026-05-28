const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const t = await prisma.fbToken.findFirst();
  if (!t) { console.log("No token found"); return; }
  console.log("Token preview:", t.longToken.slice(0, 40));
  
  const res1 = await fetch("https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_status&limit=50&access_token=" + t.longToken);
  const d1 = await res1.json();
  console.log("=== AD ACCOUNTS ===");
  console.log(JSON.stringify(d1, null, 2));
  
  const res2 = await fetch("https://graph.facebook.com/v19.0/me/accounts?fields=id,name,category&limit=50&access_token=" + t.longToken);
  const d2 = await res2.json();
  console.log("=== PAGES ===");
  console.log(JSON.stringify(d2, null, 2));
  
  await prisma.$disconnect();
}
main().catch(console.error);