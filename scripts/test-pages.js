const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const pages = await p.fanPage.findMany();
  console.log("All pages:", JSON.stringify(pages.map(pg => ({ name: pg.name, pageId: pg.pageId })), null, 2));
  await p.$disconnect();
}
main().catch(console.error);