import { prisma } from "../db.js";

type WorkflowV2SchemaStatus = {
  ready: boolean;
  checkedAt: number;
  reason?: string;
};

const REQUIRED_TABLES = [
  "KnowledgeItem",
  "KnowledgeRelation",
  "AgentKnowledgePreference",
  "WorkflowTemplate",
  "Workflow",
  "WorkflowStage",
  "WorkflowTransition"
] as const;

const CACHE_TTL_MS = Math.max(5_000, Number(process.env.WORKFLOW_V2_SCHEMA_CACHE_TTL_MS ?? 20_000));
let cachedStatus: WorkflowV2SchemaStatus | null = null;

function isCacheValid() {
  if (!cachedStatus) {
    return false;
  }
  return Date.now() - cachedStatus.checkedAt < CACHE_TTL_MS;
}

async function listSqliteTables() {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );
  return new Set(rows.map((item) => String(item.name ?? "")));
}

export async function getWorkflowV2SchemaStatus(forceRefresh = false): Promise<WorkflowV2SchemaStatus> {
  if (!forceRefresh && isCacheValid()) {
    return cachedStatus as WorkflowV2SchemaStatus;
  }

  try {
    const tables = await listSqliteTables();
    const missing = REQUIRED_TABLES.filter((name) => !tables.has(name));
    const ready = missing.length === 0;
    cachedStatus = {
      ready,
      checkedAt: Date.now(),
      reason: ready ? undefined : `missing tables: ${missing.join(", ")}`
    };
    return cachedStatus;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cachedStatus = {
      ready: false,
      checkedAt: Date.now(),
      reason: message
    };
    return cachedStatus;
  }
}

export async function isWorkflowV2SchemaReady(forceRefresh = false) {
  const status = await getWorkflowV2SchemaStatus(forceRefresh);
  return status.ready;
}

export function clearWorkflowV2SchemaCache() {
  cachedStatus = null;
}
