import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

const schemaRootUrl = new URL("../prisma/", import.meta.url);
const defaultDatabasePath = fileURLToPath(new URL("./dev.db", schemaRootUrl));
const defaultPostgresUrl = "postgresql://occ:occ@127.0.0.1:5432/occ?schema=public";
const defaultTestPostgresUrl = "postgresql://occ:occ@127.0.0.1:5432/occ?schema=api_test";
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

const normalizedDatabaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
const allowSqliteUrlInTests = process.env.NODE_ENV === "test"
  && String(process.env.ALLOW_SQLITE_URL_IN_TESTS ?? "false").trim().toLowerCase() === "true";
const resolvedDatabaseUrl =
  normalizedDatabaseUrl
  && (!normalizedDatabaseUrl.startsWith("file:") || allowSqliteUrlInTests)
    ? normalizedDatabaseUrl
    : "";
process.env.DATABASE_URL = resolvedDatabaseUrl
  || (
    process.env.NODE_ENV === "test"
      ? (String(process.env.TEST_DATABASE_URL ?? "").trim() || defaultTestPostgresUrl)
      : defaultPostgresUrl
  );
process.env.MODEL_PROVIDER ||= "scripted";

declare global {
  // eslint-disable-next-line no-var
  var __occPrisma__: PrismaClientInstance | undefined;
}

export const prisma =
  globalThis.__occPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__occPrisma__ = prisma;
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
