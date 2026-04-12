import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function loadDotEnv(cwd: string) {
  const envPath = path.join(cwd, ".env");
  if (!existsSync(envPath)) {
    return;
  }
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function resolveSqlitePath(cwd: string) {
  const raw = String(process.env.DATABASE_URL ?? "").trim() || "file:./prisma/dev.db";
  if (!raw.startsWith("file:")) {
    throw new Error(`Only sqlite file: DATABASE_URL is supported by sqlite-migrate.ts, got: ${raw}`);
  }
  const target = raw.slice("file:".length);
  // Keep path resolution aligned with Prisma runtime in src/db.ts:
  // relative file: URLs are resolved against apps/api/prisma/.
  const schemaRootUrl = pathToFileURL(path.join(cwd, "prisma") + path.sep);
  const resolved = path.isAbsolute(target)
    ? target
    : fileURLToPath(new URL(target || "./dev.db", schemaRootUrl));
  const parent = path.dirname(resolved);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  return resolved;
}

function runSql(dbPath: string, sql: string) {
  execFileSync("sqlite3", [dbPath], {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8"
  });
}

function runSqlFile(dbPath: string, sqlPath: string) {
  const sql = readFileSync(sqlPath, "utf-8");
  runSql(dbPath, sql);
}

function isIdempotentSqliteMigrationError(message: string) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("already exists")
    || normalized.includes("duplicate column name")
    || normalized.includes("has no column named")
  );
}

function queryRows(dbPath: string, sql: string) {
  const out = execFileSync("sqlite3", [dbPath, "-tabs", sql], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"]
  }).trim();
  if (!out) {
    return [] as string[];
  }
  return out.split(/\r?\n/).filter(Boolean);
}

type MigrationFile = {
  id: string;
  sqlPath: string;
  checksum: string;
};

function listMigrationFiles(cwd: string): MigrationFile[] {
  const base = path.join(cwd, "prisma", "migrations");
  const dirs = readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const files: MigrationFile[] = [];
  for (const id of dirs) {
    const sqlPath = path.join(base, id, "migration.sql");
    if (!existsSync(sqlPath)) {
      continue;
    }
    const sql = readFileSync(sqlPath, "utf-8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    files.push({ id, sqlPath, checksum });
  }
  return files;
}

function ensureTrackerTable(dbPath: string) {
  runSql(
    dbPath,
    [
      'CREATE TABLE IF NOT EXISTS "_occ_migrations" (',
      '  "id" TEXT PRIMARY KEY,',
      '  "checksum" TEXT NOT NULL,',
      '  "appliedAt" TEXT NOT NULL',
      ');'
    ].join("\n")
  );
}

function readAppliedMap(dbPath: string) {
  const rows = queryRows(dbPath, 'SELECT id || "\t" || checksum FROM "_occ_migrations" ORDER BY id;');
  const map = new Map<string, string>();
  for (const row of rows) {
    const [id, checksum] = row.split("\t");
    if (id && checksum) {
      map.set(id, checksum);
    }
  }
  return map;
}

function applyPending(cwd: string, dbPath: string) {
  ensureTrackerTable(dbPath);
  const files = listMigrationFiles(cwd);
  const applied = readAppliedMap(dbPath);
  const pending: MigrationFile[] = [];

  for (const file of files) {
    const existing = applied.get(file.id);
    if (!existing) {
      pending.push(file);
      continue;
    }
    if (existing !== file.checksum) {
      throw new Error(`Migration checksum mismatch for ${file.id}; expected ${existing}, current ${file.checksum}`);
    }
  }

  for (const file of pending) {
    try {
      runSqlFile(dbPath, file.sqlPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isIdempotentSqliteMigrationError(message)) {
        throw error;
      }
      console.log(`migration already reflected by schema, mark as applied: ${file.id}`);
    }
    runSql(
      dbPath,
      `INSERT INTO "_occ_migrations" (id, checksum, appliedAt) VALUES (${JSON.stringify(file.id)}, ${JSON.stringify(file.checksum)}, datetime('now'));`
    );
    console.log(`applied migration: ${file.id}`);
  }

  console.log(`migration deploy complete. applied=${pending.length}, total=${files.length}`);
}

function printStatus(cwd: string, dbPath: string) {
  ensureTrackerTable(dbPath);
  const files = listMigrationFiles(cwd);
  const applied = readAppliedMap(dbPath);
  const pending = files.filter((item) => !applied.has(item.id));

  console.log(`database: ${dbPath}`);
  console.log(`migrations total=${files.length}, applied=${applied.size}, pending=${pending.length}`);
  if (pending.length > 0) {
    for (const item of pending) {
      console.log(`pending: ${item.id}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("all migrations applied");
}

function main() {
  const cwd = process.cwd();
  loadDotEnv(cwd);
  const mode = String(process.argv[2] ?? "deploy").trim().toLowerCase();
  const dbPath = resolveSqlitePath(cwd);

  if (mode === "status") {
    printStatus(cwd, dbPath);
    return;
  }
  if (mode === "deploy") {
    applyPending(cwd, dbPath);
    return;
  }
  throw new Error(`Unknown mode: ${mode}. Use deploy|status`);
}

main();
