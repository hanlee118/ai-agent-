import { prisma } from "../apps/api/src/db.js";
import { ensureWorkflowV2DefaultTemplates } from "../apps/api/src/workflow-v2/default-templates.js";

async function seed() {
  const result = await ensureWorkflowV2DefaultTemplates({ client: prisma });
  for (const key of result.keys) {
    // eslint-disable-next-line no-console
    console.log(`Seeded workflow template: ${key}`);
  }
}

seed()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
