import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(startDir: string) {
  let current = startDir;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(startDir, "../../../../");
}

const workspaceRoot = process.env.OCC_WORKSPACE_ROOT?.trim() || findWorkspaceRoot(moduleDir);
const runtimeRoot = path.join(workspaceRoot, ".runtime");

const requiredRuntimeFiles = [
  "v1-methodology-store.json",
  "industry-role-sets.json",
  "ui-preferences.json",
  "agent-role-templates.json",
] as const;

export function getRuntimeStoreHealth() {
  const rootExists = existsSync(runtimeRoot);

  const files = requiredRuntimeFiles.map((name) => {
    const filePath = path.join(runtimeRoot, name);
    const exists = existsSync(filePath);
    return {
      name,
      path: filePath,
      exists,
      sizeBytes: exists ? statSync(filePath).size : 0,
    };
  });

  const existing = files.filter((item) => item.exists).length;
  const missing = files.filter((item) => !item.exists).map((item) => item.name);

  return {
    rootPath: runtimeRoot,
    rootExists,
    files,
    summary: {
      total: requiredRuntimeFiles.length,
      existing,
      missing,
    },
  };
}

