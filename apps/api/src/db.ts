import { Prisma, PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

const schemaRootUrl = new URL("../prisma/", import.meta.url);
const defaultDatabasePath = fileURLToPath(new URL("./dev.db", schemaRootUrl));
const defaultPostgresUrl = "postgresql://occ:occ@127.0.0.1:5432/occ?schema=public";
const defaultTestPostgresUrl = "postgresql://occ:occ@127.0.0.1:5432/occ?schema=api_test";
type PrismaClientInstance = InstanceType<typeof PrismaClient>;
const SLOW_QUERY_THRESHOLD_MS = Number(process.env.PRISMA_SLOW_QUERY_THRESHOLD_MS ?? 200);
const PRISMA_QUERY_RETRY_ENABLED = toBoolean(process.env.PRISMA_QUERY_RETRY_ENABLED, true);
const PRISMA_QUERY_RETRY_DELAY_MS = toPositiveInt(process.env.PRISMA_QUERY_RETRY_DELAY_MS, 1000);
const PRISMA_QUERY_RETRY_MAX_ATTEMPTS = Math.max(1, toPositiveInt(process.env.PRISMA_QUERY_RETRY_MAX_ATTEMPTS, 2));
const DATABASE_CONNECTION_LIMIT = toPositiveInt(process.env.DATABASE_CONNECTION_LIMIT, 20);
const DATABASE_POOL_TIMEOUT_SECONDS = toPositiveInt(process.env.DATABASE_POOL_TIMEOUT_SECONDS, 20);
const DATABASE_CONNECT_TIMEOUT_SECONDS = toPositiveInt(process.env.DATABASE_CONNECT_TIMEOUT_SECONDS, 10);
const READ_QUERY_ACTIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy"
]);

const normalizedDatabaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
const allowSqliteUrlInTests = process.env.NODE_ENV === "test"
  && String(process.env.ALLOW_SQLITE_URL_IN_TESTS ?? "false").trim().toLowerCase() === "true";
const resolvedDatabaseUrl =
  normalizedDatabaseUrl
  && (!normalizedDatabaseUrl.startsWith("file:") || allowSqliteUrlInTests)
    ? normalizedDatabaseUrl
    : "";
process.env.DATABASE_URL = withPostgresPoolConfig(
  resolvedDatabaseUrl
  || (
    process.env.NODE_ENV === "test"
      ? (String(process.env.TEST_DATABASE_URL ?? "").trim() || defaultTestPostgresUrl)
      : defaultPostgresUrl
  )
);
process.env.MODEL_PROVIDER ||= "scripted";

declare global {
  // eslint-disable-next-line no-var
  var __occPrisma__: PrismaClientInstance | undefined;
}

export const prisma =
  globalThis.__occPrisma__ ??
  new PrismaClient({
    log: [
      { level: "query", emit: "event" },
      { level: "warn", emit: "stdout" },
      { level: "error", emit: "stdout" }
    ]
  });

prisma.$on("query", (event) => {
  const queryEvent = event as unknown as Prisma.QueryEvent;
  if (queryEvent.duration < SLOW_QUERY_THRESHOLD_MS) {
    return;
  }

  const payload = {
    slowQuery: true,
    thresholdMs: SLOW_QUERY_THRESHOLD_MS,
    durationMs: queryEvent.duration,
    target: queryEvent.target,
    query: queryEvent.query,
    params: queryEvent.params
  };
  console.warn("[SLOW_QUERY]", JSON.stringify(payload));
});

if (process.env.NODE_ENV !== "production") {
  globalThis.__occPrisma__ = prisma;
}

export async function withPrismaReadRetry<T>(operation: string, task: () => Promise<T>) {
  const normalized = String(operation || "").trim();
  const shouldRetry = PRISMA_QUERY_RETRY_ENABLED && READ_QUERY_ACTIONS.has(normalized);
  if (!shouldRetry) {
    return task();
  }

  let attempt = 0;
  while (true) {
    try {
      return await task();
    } catch (error) {
      attempt += 1;
      if (attempt >= PRISMA_QUERY_RETRY_MAX_ATTEMPTS || !isRetryablePrismaConnectionError(error)) {
        throw error;
      }
      console.warn(`[PRISMA_RETRY] ${normalized} retry ${attempt}/${PRISMA_QUERY_RETRY_MAX_ATTEMPTS} after ${PRISMA_QUERY_RETRY_DELAY_MS}ms`);
      await sleep(PRISMA_QUERY_RETRY_DELAY_MS);
    }
  }
}

function normalizeDatabaseUrl(value?: string) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  if (!raw.startsWith("file:")) {
    return raw;
  }

  const filePath = raw.slice("file:".length);
  if (!filePath) {
    return `file:${defaultDatabasePath}`;
  }

  if (filePath.startsWith("/")) {
    return raw;
  }

  return `file:${fileURLToPath(new URL(filePath, schemaRootUrl))}`;
}

function withPostgresPoolConfig(url: string) {
  const raw = String(url || "").trim();
  if (!/^postgres(?:ql)?:\/\//i.test(raw)) {
    return raw;
  }
  try {
    const parsed = new URL(raw);
    if (!parsed.searchParams.has("connection_limit")) {
      parsed.searchParams.set("connection_limit", String(DATABASE_CONNECTION_LIMIT));
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", String(DATABASE_POOL_TIMEOUT_SECONDS));
    }
    if (!parsed.searchParams.has("connect_timeout")) {
      parsed.searchParams.set("connect_timeout", String(DATABASE_CONNECT_TIMEOUT_SECONDS));
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function isRetryablePrismaConnectionError(error: unknown) {
  if (!error) {
    return false;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P1001" || error.code === "P1002" || error.code === "P2024";
  }

  const message = String((error as { message?: unknown })?.message ?? error).toLowerCase();
  return (
    message.includes("can't reach database server")
    || message.includes("timed out")
    || message.includes("pool timeout")
    || message.includes("too many connections")
    || message.includes("connection terminated unexpectedly")
    || message.includes("connection reset")
  );
}

function toBoolean(value: unknown, fallback: boolean) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function toPositiveInt(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
