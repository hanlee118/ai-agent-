import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { PrismaClient } from "@prisma/client";

const sqlitePath = resolve(process.env.SQLITE_PATH || "apps/api/prisma/dev.db");
const postgresUrl = String(process.env.DATABASE_URL || "").trim();
const dryRun = process.argv.includes("--dry-run");

if (!postgresUrl) {
  console.error("请先设置 PostgreSQL DATABASE_URL。");
  process.exit(1);
}

if (!existsSync(sqlitePath)) {
  console.error(`未找到 SQLite 文件: ${sqlitePath}`);
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: postgresUrl } } });

const tables = [
  "AgentProfile", "ManagedAgentConfig", "AgentMemoryEntry", "AgentUsageLog",
  "SystemConfig", "AuthSession", "AuditLog", "NotificationState",
  "PromptTemplate", "Project", "Stage", "Task", "TaskParticipant",
  "TaskDependency", "TaskDelegation", "GitLabSyncBinding"
];

function modelDelegateName(modelName) {
  return `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;
}

function castValue(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T?\s?\d{0,2}/.test(value)) {
    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return value;
}

function readTableRows(table) {
  const raw = execFileSync(
    "sqlite3",
    ["-json", sqlitePath, `SELECT * FROM "${table}";`],
    { encoding: "utf8" }
  );
  const parsed = raw.trim() ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed : [];
}

async function migrate() {
  for (const table of tables) {
    const rows = readTableRows(table);
    console.log(`${table}: ${rows.length} 条`);
    if (dryRun || rows.length === 0) {
      continue;
    }

    const delegateName = modelDelegateName(table);
    const delegate = prisma[delegateName];
    if (!delegate?.create) {
      console.warn(`跳过 ${table}: Prisma delegate 不存在 (${delegateName})`);
      continue;
    }

    for (const row of rows) {
      const data = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, castValue(value)])
      );
      try {
        await delegate.create({ data });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${table} 插入失败: ${message}`);
      }
    }
  }
}

migrate()
  .then(async () => {
    await prisma.$disconnect();
    console.log("迁移脚本执行完成。");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
