const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const token = await p.fbToken.findFirst();
  console.log("userId in token:", token.userId);
  
  const user = await p.user.findUnique({ where: { id: token.userId } });
  console.log("user:", user?.name, user?.email);
  
  const pages = await p.fanPage.findMany({ where: { userId: token.userId } });
  console.log("pages for this user:", pages.length);
  pages.forEach(pg => console.log(" -", pg.name, pg.pageId));
  
  await p.$disconnect();
}
main().catch(console.error);