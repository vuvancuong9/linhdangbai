const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
Promise.all([p.adAccount.findMany(), p.fanPage.findMany()])
.then(([accs, pages]) => {
  console.log("Ad Accounts:", accs.length);
  console.log("Pages:", pages.length);
  if(accs.length) console.log("Sample acc:", JSON.stringify(accs[0]));
  if(pages.length) console.log("Sample page:", JSON.stringify(pages[0]));
  return p.$disconnect();
});