import { prisma } from "../db.js";

type WorkflowV2SchemaStatus = {
  ready: boolean;
  checkedAt: number;
  reason?: string;
  missingCoreTables?: string[];
  missingOptionalTables?: string[];
  optionalReady?: boolean;
};

const KNOWLEDGE_CORE_TABLES = [
  "KnowledgeItem"
] as const;

const KNOWLEDGE_OPTIONAL_TABLES = [
  "KnowledgeRelation",
  "AgentKnowledgePreference",
  "KnowledgeOperationLog"
] as const;

const WORKFLOW_REQUIRED_TABLES = [
  "WorkflowTemplate",
  "Workflow",
  "WorkflowStage",
  "WorkflowTransition",
  "ProjectInput",
  "StageRelayRelation"
] as const;

const SKILL_REQUIRED_TABLES = [
  "HermesSkill"
] as const;

const CACHE_TTL_MS = Math.max(5_000, Number(process.env.WORKFLOW_V2_SCHEMA_CACHE_TTL_MS ?? 20_000));
const cachedStatusByScope = new Map<string, WorkflowV2SchemaStatus>();

function isCacheValid(scope: string) {
  const status = cachedStatusByScope.get(scope);
  if (!status) {
    return false;
  }
  return Date.now() - status.checkedAt < CACHE_TTL_MS;
}

function resolveDatabaseDialect() {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim().toLowerCase();
  if (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")) {
    return "postgres";
  }
  return "sqlite";
}

async function listSqliteTables() {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );
  return new Set(rows.map((item) => String(item.name ?? "")));
}

async function listPostgresTables() {
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = current_schema()"
  );
  return new Set(rows.map((item) => String(item.tablename ?? "")));
}

async function listDatabaseTables() {
  if (resolveDatabaseDialect() === "postgres") {
    return listPostgresTables();
  }
  return listSqliteTables();
}

async function checkSchemaTables(input: {
  scope: "knowledge" | "workflow" | "skills";
  requiredTables: readonly string[];
  optionalTables?: readonly string[];
  forceRefresh?: boolean;
}) {
  const forceRefresh = input.forceRefresh === true;
  if (!forceRefresh && isCacheValid(input.scope)) {
    return cachedStatusByScope.get(input.scope) as WorkflowV2SchemaStatus;
  }

  try {
    const tables = await listDatabaseTables();
    const missingCore = input.requiredTables.filter((name) => !tables.has(name));
    const optionalTables = Array.isArray(input.optionalTables) ? input.optionalTables : [];
    const missingOptional = optionalTables.filter((name) => !tables.has(name));
    const ready = missingCore.length === 0;
    const optionalReady = missingOptional.length === 0;
    const reason = ready
      ? (optionalReady ? undefined : `optional tables missing: ${missingOptional.join(", ")}`)
      : `missing tables: ${missingCore.join(", ")}`;
    const status = {
      ready,
      optionalReady,
      checkedAt: Date.now(),
      reason,
      missingCoreTables: missingCore,
      missingOptionalTables: missingOptional
    };
    cachedStatusByScope.set(input.scope, status);
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = {
      ready: false,
      checkedAt: Date.now(),
      reason: message
    };
    cachedStatusByScope.set(input.scope, status);
    return status;
  }
}

export async function getKnowledgeV2SchemaStatus(forceRefresh = false): Promise<WorkflowV2SchemaStatus> {
  return checkSchemaTables({
    scope: "knowledge",
    requiredTables: KNOWLEDGE_CORE_TABLES,
    optionalTables: KNOWLEDGE_OPTIONAL_TABLES,
    forceRefresh
  });
}

export async function getWorkflowV2SchemaStatus(forceRefresh = false): Promise<WorkflowV2SchemaStatus> {
  return checkSchemaTables({
    scope: "workflow",
    requiredTables: [...KNOWLEDGE_CORE_TABLES, ...WORKFLOW_REQUIRED_TABLES],
    optionalTables: KNOWLEDGE_OPTIONAL_TABLES,
    forceRefresh
  });
}

export async function getSkillsV2SchemaStatus(forceRefresh = false): Promise<WorkflowV2SchemaStatus> {
  return checkSchemaTables({
    scope: "skills",
    requiredTables: SKILL_REQUIRED_TABLES,
    forceRefresh
  });
}

export async function isWorkflowV2SchemaReady(forceRefresh = false) {
  const status = await getWorkflowV2SchemaStatus(forceRefresh);
  return status.ready;
}

export function clearWorkflowV2SchemaCache() {
  cachedStatusByScope.clear();
}
