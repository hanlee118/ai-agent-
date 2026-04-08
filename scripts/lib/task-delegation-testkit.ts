import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, '../..');
export const apiRoot = path.join(repoRoot, 'apps', 'api');
export const prismaRoot = path.join(apiRoot, 'prisma');
export const schemaPath = path.join(prismaRoot, 'schema.prisma');
export const schemaCliPath = 'prisma/schema.prisma';
export const baselineMigrationName = '20260331000000_baseline';

export const migrationSequence = [
  baselineMigrationName,
  '20260331123000_add_gitlab_sync',
  '20260407145000_task_delegation_hybrid',
  '20260407162000_add_project_execution'
] as const;

export function makeTempDbPath(name: string) {
  const dir = mkdtempSync(path.join(tmpdir(), `occ-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, `${name}.db`)
  };
}

export function databaseUrlFor(dbPath: string) {
  return `file:${dbPath}`;
}

export function runCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      ...options.env
    },
    input: options.input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

export function runShellCommand(script: string, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return execFileSync('/bin/zsh', ['-lc', script], {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      ...options.env
    },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

export function sqliteExec(dbPath: string, sql: string) {
  return runCommand('sqlite3', [dbPath], { input: sql });
}

export function sqliteApplyFile(dbPath: string, filePath: string) {
  return runCommand('sqlite3', [dbPath], { input: readFileSync(filePath, 'utf8') });
}

export function sqliteQuery(dbPath: string, sql: string) {
  return runCommand('sqlite3', ['-json', dbPath, sql]).trim();
}

export function sqliteQueryRows<T = Record<string, unknown>>(dbPath: string, sql: string): T[] {
  const raw = sqliteQuery(dbPath, sql);
  return raw ? JSON.parse(raw) as T[] : [];
}

export function bootstrapLegacyDb(dbPath: string) {
  sqliteApplyFile(dbPath, path.join(prismaRoot, 'bootstrap.sql'));
}

export function applyPostBaselineMigrations(dbPath: string) {
  for (const migrationName of migrationSequence.slice(1)) {
    sqliteApplyFile(dbPath, path.join(prismaRoot, 'migrations', migrationName, 'migration.sql'));
  }
}

export function applyAllMigrationsFromFiles(dbPath: string) {
  for (const migrationName of migrationSequence) {
    sqliteApplyFile(dbPath, path.join(prismaRoot, 'migrations', migrationName, 'migration.sql'));
  }
  return migrationSequence.slice();
}

export function applyLegacyUpgradeFromFiles(dbPath: string) {
  applyPostBaselineMigrations(dbPath);
  return migrationSequence.slice(1);
}

export function migrateEmptyDbWithPrisma(dbPath: string) {
  const env = {
    DATABASE_URL: databaseUrlFor(dbPath)
  };
  return runShellCommand(`${path.join(repoRoot, 'scripts', 'prisma-migrate-sqlite.sh')} deploy`, {
    cwd: repoRoot,
    env
  });
}

export function migrateLegacyDbWithPrisma(dbPath: string) {
  const env = {
    DATABASE_URL: databaseUrlFor(dbPath)
  };
  runShellCommand(
    `${path.join(repoRoot, 'scripts', 'prisma-migrate-sqlite.sh')} resolve --applied ${baselineMigrationName}`,
    {
      cwd: repoRoot,
      env
    }
  );
  return runShellCommand(`${path.join(repoRoot, 'scripts', 'prisma-migrate-sqlite.sh')} deploy`, {
    cwd: repoRoot,
    env
  });
}

export function seedLegacyProjectData(dbPath: string, projectId: string, taskId: string) {
  const sql = `
INSERT INTO "Project" (
  "id", "name", "description", "parsedKeywords", "parsedConstraints", "parsedRisks", "parsedSuggestedTeam",
  "parsedSummary", "status", "currentStage", "progress", "pendingApproval", "currentRole", "team", "summary",
  "liveTitle", "liveBody", "liveStartedAt", "liveProvider", "createdAt", "updatedAt"
) VALUES (
  '${projectId}',
  'Legacy Project',
  'legacy project before migration',
  json('["delegation"]'),
  json('[]'),
  json('[]'),
  json('["ROLE_PM","ROLE_DEV"]'),
  'legacy summary',
  'active',
  'DEV',
  40,
  0,
  'ROLE_DEV',
  json('["ROLE_PM","ROLE_DEV"]'),
  'legacy summary',
  'legacy live',
  'legacy live body',
  '2026-04-07T00:00:00.000Z',
  'scripted',
  '2026-04-07T00:00:00.000Z',
  '2026-04-07T00:00:00.000Z'
);
INSERT INTO "Task" (
  "id", "projectId", "stageType", "title", "description", "assignee", "status", "priority", "sortOrder", "createdAt", "updatedAt"
) VALUES (
  '${taskId}',
  '${projectId}',
  'DEV',
  'Legacy task',
  'task row created before delegation migration',
  'ROLE_DEV',
  'in_progress',
  'high',
  1,
  '2026-04-07T00:00:00.000Z',
  '2026-04-07T00:00:00.000Z'
);
`;
  sqliteExec(dbPath, sql);
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function ensureFileMissing(filePath: string) {
  if (existsSync(filePath)) {
    throw new Error(`Expected file to be absent: ${filePath}`);
  }
}
