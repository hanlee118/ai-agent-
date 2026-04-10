import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { OPENCLAW_WORKSPACE_ROOT } from "../openclaw/paths.js";

export interface UiPreferencesSettings {
  language: "zh" | "en";
  workspacePath: string;
  autoSync: boolean;
  apiProtection: boolean;
  autonomousMode: boolean;
  usageAlert: boolean;
  usageAlertThresholdPercent: number;
}

export interface UiPreferencesSnapshot extends UiPreferencesSettings {
  source: "default" | "file";
  updatedAt?: string;
}

export interface UiPreferencesInput {
  language?: unknown;
  workspacePath?: unknown;
  autoSync?: unknown;
  apiProtection?: unknown;
  autonomousMode?: unknown;
  usageAlert?: unknown;
  usageAlertThresholdPercent?: unknown;
}

const DEFAULT_UI_PREFERENCES: UiPreferencesSettings = {
  language: "zh",
  workspacePath: OPENCLAW_WORKSPACE_ROOT,
  autoSync: true,
  apiProtection: true,
  autonomousMode: false,
  usageAlert: true,
  usageAlertThresholdPercent: 80
};

const UI_PREFERENCES_PATH = resolveUiPreferencesPath();

function resolveUiPreferencesPath() {
  const raw = String(process.env.OCC_UI_PREFERENCES_PATH ?? "").trim();
  if (raw) {
    return path.resolve(raw);
  }

  const workspaceRoot = resolveWorkspaceRoot();
  return path.join(workspaceRoot, ".runtime", "ui-preferences.json");
}

function resolveWorkspaceRoot() {
  const envRoot = String(process.env.OCC_WORKSPACE_ROOT ?? "").trim();
  if (envRoot) {
    return path.resolve(envRoot);
  }

  let current = process.cwd();
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

function toBoolean(input: unknown, fallback: boolean) {
  if (input === undefined || input === null) {
    return fallback;
  }
  return Boolean(input);
}

function normalizePreferences(input: Partial<UiPreferencesInput | UiPreferencesSettings> | undefined): UiPreferencesSettings {
  const thresholdRaw = Number(input?.usageAlertThresholdPercent);
  const usageAlertThresholdPercent = Number.isFinite(thresholdRaw)
    ? Math.max(50, Math.min(95, Math.round(thresholdRaw)))
    : DEFAULT_UI_PREFERENCES.usageAlertThresholdPercent;
  return {
    language: String(input?.language ?? "").trim().toLowerCase() === "en" ? "en" : "zh",
    workspacePath: String(input?.workspacePath ?? "").trim() || DEFAULT_UI_PREFERENCES.workspacePath,
    autoSync: toBoolean(input?.autoSync, DEFAULT_UI_PREFERENCES.autoSync),
    apiProtection: toBoolean(input?.apiProtection, DEFAULT_UI_PREFERENCES.apiProtection),
    autonomousMode: toBoolean(input?.autonomousMode, DEFAULT_UI_PREFERENCES.autonomousMode),
    usageAlert: toBoolean(input?.usageAlert, DEFAULT_UI_PREFERENCES.usageAlert),
    usageAlertThresholdPercent
  };
}

type PersistedUiPreferences = {
  settings?: Partial<UiPreferencesSettings> | null;
  updatedAt?: string | null;
} & Partial<UiPreferencesSettings>;

async function readPersistedUiPreferences() {
  if (!existsSync(UI_PREFERENCES_PATH)) {
    return null;
  }

  try {
    const raw = await readFile(UI_PREFERENCES_PATH, "utf8");
    const parsed = JSON.parse(raw) as PersistedUiPreferences;
    const settingsInput =
      parsed && typeof parsed === "object" && parsed.settings && typeof parsed.settings === "object"
        ? parsed.settings
        : parsed;
    const normalized = normalizePreferences(settingsInput);
    const updatedAt = String(parsed?.updatedAt ?? "").trim();
    return {
      settings: normalized,
      updatedAt: updatedAt || undefined
    };
  } catch {
    return null;
  }
}

async function writePersistedUiPreferences(settings: UiPreferencesSettings) {
  const directoryPath = path.dirname(UI_PREFERENCES_PATH);
  await mkdir(directoryPath, { recursive: true });
  const updatedAt = new Date().toISOString();
  await writeFile(
    UI_PREFERENCES_PATH,
    JSON.stringify(
      {
        settings,
        updatedAt
      },
      null,
      2
    ),
    "utf8"
  );
  return updatedAt;
}

export async function getUiPreferences(): Promise<UiPreferencesSnapshot> {
  const persisted = await readPersistedUiPreferences();
  if (!persisted) {
    return {
      ...DEFAULT_UI_PREFERENCES,
      source: "default"
    };
  }

  return {
    ...persisted.settings,
    source: "file",
    updatedAt: persisted.updatedAt
  };
}

export async function updateUiPreferences(input: UiPreferencesInput): Promise<UiPreferencesSnapshot> {
  const current = await getUiPreferences();
  const nextSettings = normalizePreferences({
    ...current,
    ...input
  });
  const updatedAt = await writePersistedUiPreferences(nextSettings);
  return {
    ...nextSettings,
    source: "file",
    updatedAt
  };
}
