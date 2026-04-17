import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const LEGACY_PROJECT_NAME_PATTERN =
  /(命题验收|真实设计验收|阶段接力|单阶段|全流程|冒烟|复测|巡检|tmp|sandbox)/i;

function normalizeNameForGrouping(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]【】]/g, "")
    .replace(/[-_](\d{8,})$/i, "")
    .replace(/\d{12,}$/i, "");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const dbPath = path.resolve(scriptDir, "../apps/api/prisma/dev.db");
    process.env.DATABASE_URL = `file:${dbPath}`;
  }
  const prisma = new PrismaClient();
  const apply = process.argv.includes("--apply");
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      currentStage: true,
      updatedAt: true
    },
    orderBy: { updatedAt: "desc" }
  });

  const grouped = new Map<string, typeof projects>();
  for (const project of projects) {
    const key = normalizeNameForGrouping(project.name);
    const rows = grouped.get(key) || [];
    rows.push(project);
    grouped.set(key, rows);
  }

  const duplicateIds = new Set<string>();
  for (const [, rows] of grouped) {
    if (rows.length <= 1) continue;
    const sorted = [...rows].sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
    for (const item of sorted.slice(1)) {
      duplicateIds.add(item.id);
    }
  }

  const candidates = projects.filter((project) =>
    LEGACY_PROJECT_NAME_PATTERN.test(project.name) || duplicateIds.has(project.id)
  );

  console.log(`[cleanup] total projects=${projects.length}, candidates=${candidates.length}, mode=${apply ? "apply" : "dry-run"}`);
  for (const item of candidates) {
    const reasons = [
      LEGACY_PROJECT_NAME_PATTERN.test(item.name) ? "name_pattern" : "",
      duplicateIds.has(item.id) ? "duplicate" : ""
    ].filter(Boolean).join(",");
    console.log(`- ${item.id} | ${item.name} | ${item.status} | ${item.currentStage} | ${reasons}`);
  }

  if (!apply) {
    console.log("[cleanup] dry-run only. Re-run with --apply to delete.");
    await prisma.$disconnect();
    return;
  }

  let deleted = 0;
  for (const item of candidates) {
    try {
      const result = await prisma.project.deleteMany({
        where: { id: item.id }
      });
      if (result.count > 0) {
        deleted += 1;
        console.log(`[deleted] ${item.id} ${item.name}`);
      } else {
        console.log(`[skip] ${item.id} not found`);
      }
    } catch (error) {
      console.error(`[failed] ${item.id} ${item.name}:`, error);
    }
  }
  await prisma.$disconnect();
  console.log(`[cleanup] done. deleted=${deleted}`);
}

main().catch((error) => {
  console.error("[cleanup] fatal:", error);
  process.exitCode = 1;
});
