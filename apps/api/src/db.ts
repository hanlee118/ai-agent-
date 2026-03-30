import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

const appRootUrl = new URL("../", import.meta.url);
const schemaRootUrl = new URL("../prisma/", import.meta.url);
const defaultDatabasePath = fileURLToPath(new URL("./dev.db", schemaRootUrl));
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

process.env.DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL) || `file:${defaultDatabasePath}`;
process.env.MODEL_PROVIDER ||= "scripted";

declare global {
  // eslint-disable-next-line no-var
  var __occPrisma__: PrismaClientInstance | undefined;
}

export const prisma =
  globalThis.__occPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
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

  const resolveBase = filePath.startsWith("./prisma/") || filePath.startsWith("prisma/")
    ? appRootUrl
    : schemaRootUrl;

  return `file:${fileURLToPath(new URL(filePath, resolveBase))}`;
}
