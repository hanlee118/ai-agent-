import { getRuntimeStatus } from "../src/agents/runtime.js";
import { prisma } from "../src/db.js";
import { ensureSeedData } from "../src/data/repository.js";

async function main() {
  await ensureSeedData((await getRuntimeStatus()).mode);
  console.log("Database seeded");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
