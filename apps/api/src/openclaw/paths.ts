import os from "node:os";
import path from "node:path";

const DEFAULT_OPENCLAW_ROOT = path.join(os.homedir(), ".openclaw");

export const OPENCLAW_ROOT = resolvePath(
  process.env.OPENCLAW_ROOT,
  DEFAULT_OPENCLAW_ROOT
);

export const OPENCLAW_CONFIG_PATH = resolvePath(
  process.env.OPENCLAW_CONFIG_PATH,
  path.join(OPENCLAW_ROOT, "openclaw.json")
);

export const OPENCLAW_WORKSPACE_ROOT = resolvePath(
  process.env.OPENCLAW_WORKSPACE_ROOT,
  path.join(OPENCLAW_ROOT, "workspace")
);

function resolvePath(value: string | undefined, fallback: string) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return fallback;
  }

  if (path.isAbsolute(raw)) {
    return raw;
  }

  return path.resolve(raw);
}
