const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const deleted = await p.post.deleteMany({});
  console.log("Deleted posts:", deleted.count);
  await p.$disconnect();
}
main().catch(console.error);