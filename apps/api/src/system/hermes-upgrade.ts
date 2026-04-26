import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type HermesUpgradeEventType = 'knowledge_sync' | 'skill_import';

type HermesUpgradeSuggestionStatus = 'pending' | 'applied' | 'dismissed';

export interface HermesUpgradeSuggestion {
  id: string;
  title: string;
  detail: string;
  source: HermesUpgradeEventType;
  status: HermesUpgradeSuggestionStatus;
  createdAt: string;
  appliedAt?: string;
  dismissedAt?: string;
}

export interface HermesUpgradeConfig {
  enabled: boolean;
  autoApply: boolean;
  minKnowledgeSyncForSuggestion: number;
  minSkillImportForSuggestion: number;
}

export interface HermesUpgradeState {
  config: HermesUpgradeConfig;
  counters: {
    knowledgeSyncEvents: number;
    skillImportEvents: number;
  };
  lastEventAt?: string;
  lastEvaluatedAt?: string;
  lastAppliedAt?: string;
  pendingSuggestions: HermesUpgradeSuggestion[];
  history: HermesUpgradeSuggestion[];
  updatedAt: string;
}

const STORE_FILENAME = 'hermes-upgrade-state.json';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(startDir: string) {
  let current = startDir;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(startDir, '../../../../');
}

const workspaceRoot = process.env.OCC_WORKSPACE_ROOT?.trim() || findWorkspaceRoot(moduleDir);
const STORE_PATH = process.env.OCC_HERMES_UPGRADE_STORE_PATH?.trim()
  || path.join(workspaceRoot, '.runtime', STORE_FILENAME);

function nowIso() {
  return new Date().toISOString();
}

const DEFAULT_STATE: HermesUpgradeState = {
  config: {
    enabled: true,
    autoApply: false,
    minKnowledgeSyncForSuggestion: 3,
    minSkillImportForSuggestion: 1,
  },
  counters: {
    knowledgeSyncEvents: 0,
    skillImportEvents: 0,
  },
  pendingSuggestions: [],
  history: [],
  updatedAt: new Date(0).toISOString(),
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function ensureStoreDir() {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
}

function normalizeState(input: Partial<HermesUpgradeState> | undefined): HermesUpgradeState {
  const config = (input?.config || {}) as Partial<HermesUpgradeConfig>;
  const counters = (input?.counters || {}) as Partial<HermesUpgradeState["counters"]>;
  const pendingSuggestions = Array.isArray(input?.pendingSuggestions) ? input?.pendingSuggestions : [];
  const history = Array.isArray(input?.history) ? input?.history : [];

  return {
    config: {
      enabled: config.enabled === undefined ? DEFAULT_STATE.config.enabled : Boolean(config.enabled),
      autoApply: config.autoApply === undefined ? DEFAULT_STATE.config.autoApply : Boolean(config.autoApply),
      minKnowledgeSyncForSuggestion: Math.max(1, Number(config.minKnowledgeSyncForSuggestion ?? DEFAULT_STATE.config.minKnowledgeSyncForSuggestion)),
      minSkillImportForSuggestion: Math.max(1, Number(config.minSkillImportForSuggestion ?? DEFAULT_STATE.config.minSkillImportForSuggestion)),
    },
    counters: {
      knowledgeSyncEvents: Math.max(0, Math.floor(Number(counters.knowledgeSyncEvents ?? 0))),
      skillImportEvents: Math.max(0, Math.floor(Number(counters.skillImportEvents ?? 0))),
    },
    lastEventAt: input?.lastEventAt,
    lastEvaluatedAt: input?.lastEvaluatedAt,
    lastAppliedAt: input?.lastAppliedAt,
    pendingSuggestions: pendingSuggestions
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: String(item.id || randomUUID()),
        title: String(item.title || '').trim(),
        detail: String(item.detail || '').trim(),
        source: (item.source === 'skill_import' ? 'skill_import' : 'knowledge_sync') as HermesUpgradeEventType,
        status: (item.status === 'applied' || item.status === 'dismissed' ? item.status : 'pending') as HermesUpgradeSuggestionStatus,
        createdAt: String(item.createdAt || nowIso()),
        appliedAt: item.appliedAt ? String(item.appliedAt) : undefined,
        dismissedAt: item.dismissedAt ? String(item.dismissedAt) : undefined,
      }))
      .filter((item) => item.title && item.detail),
    history: history
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: String(item.id || randomUUID()),
        title: String(item.title || '').trim(),
        detail: String(item.detail || '').trim(),
        source: (item.source === 'skill_import' ? 'skill_import' : 'knowledge_sync') as HermesUpgradeEventType,
        status: (item.status === 'applied' || item.status === 'dismissed' ? item.status : 'pending') as HermesUpgradeSuggestionStatus,
        createdAt: String(item.createdAt || nowIso()),
        appliedAt: item.appliedAt ? String(item.appliedAt) : undefined,
        dismissedAt: item.dismissedAt ? String(item.dismissedAt) : undefined,
      }))
      .filter((item) => item.title && item.detail)
      .slice(-200),
    updatedAt: String(input?.updatedAt || nowIso()),
  };
}

async function readState(): Promise<HermesUpgradeState> {
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    return normalizeState(JSON.parse(raw) as Partial<HermesUpgradeState>);
  } catch {
    return deepClone(DEFAULT_STATE);
  }
}

async function writeState(next: HermesUpgradeState) {
  await ensureStoreDir();
  const tempPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf8');
    await rename(tempPath, STORE_PATH);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function hasPendingSuggestion(state: HermesUpgradeState, title: string) {
  return state.pendingSuggestions.some((item) => item.status === 'pending' && item.title === title);
}

function appendSuggestion(state: HermesUpgradeState, input: Omit<HermesUpgradeSuggestion, 'id' | 'createdAt' | 'status'>) {
  const suggestion: HermesUpgradeSuggestion = {
    id: randomUUID(),
    title: input.title,
    detail: input.detail,
    source: input.source,
    status: 'pending',
    createdAt: nowIso(),
  };
  state.pendingSuggestions = [suggestion, ...state.pendingSuggestions].slice(0, 100);
}

function autoApplyPendingSuggestions(state: HermesUpgradeState) {
  if (!state.config.autoApply) {
    return;
  }
  const now = nowIso();
  const applied: HermesUpgradeSuggestion[] = [];
  const remains: HermesUpgradeSuggestion[] = [];
  for (const item of state.pendingSuggestions) {
    if (item.status !== 'pending') {
      remains.push(item);
      continue;
    }
    const next: HermesUpgradeSuggestion = {
      ...item,
      status: 'applied',
      appliedAt: now,
    };
    applied.push(next);
  }
  if (applied.length > 0) {
    state.pendingSuggestions = remains;
    state.history = [...state.history, ...applied].slice(-200);
    state.lastAppliedAt = now;
  }
}

function evaluateSuggestions(state: HermesUpgradeState) {
  const now = nowIso();
  state.lastEvaluatedAt = now;

  if (!state.config.enabled) {
    return;
  }

  const knowledgeReady = state.counters.knowledgeSyncEvents >= state.config.minKnowledgeSyncForSuggestion;
  if (knowledgeReady) {
    const title = '将 Hermes 记忆沉淀为可复用技能包';
    if (!hasPendingSuggestion(state, title)) {
      appendSuggestion(state, {
        title,
        detail: `知识同步事件累计 ${state.counters.knowledgeSyncEvents} 次，建议自动提炼为技能并进入执行模板库。`,
        source: 'knowledge_sync',
      });
    }
  }

  const skillReady = state.counters.skillImportEvents >= state.config.minSkillImportForSuggestion;
  if (skillReady) {
    const title = '更新 Agent 执行策略以启用 Hermes 新技能';
    if (!hasPendingSuggestion(state, title)) {
      appendSuggestion(state, {
        title,
        detail: `技能导入事件累计 ${state.counters.skillImportEvents} 次，建议刷新角色模板与执行协议中的技能映射。`,
        source: 'skill_import',
      });
    }
  }

  autoApplyPendingSuggestions(state);
}

export async function evaluateHermesUpgradeNow() {
  const state = await readState();
  evaluateSuggestions(state);
  state.updatedAt = nowIso();
  await writeState(state);
  return state;
}

export async function getHermesUpgradeState() {
  const state = await readState();
  return state;
}

export async function updateHermesUpgradeConfig(input: Partial<HermesUpgradeConfig>) {
  const state = await readState();
  if (input.enabled !== undefined) {
    state.config.enabled = Boolean(input.enabled);
  }
  if (input.autoApply !== undefined) {
    state.config.autoApply = Boolean(input.autoApply);
  }
  if (input.minKnowledgeSyncForSuggestion !== undefined) {
    state.config.minKnowledgeSyncForSuggestion = Math.max(1, Math.floor(Number(input.minKnowledgeSyncForSuggestion) || 1));
  }
  if (input.minSkillImportForSuggestion !== undefined) {
    state.config.minSkillImportForSuggestion = Math.max(1, Math.floor(Number(input.minSkillImportForSuggestion) || 1));
  }
  state.updatedAt = nowIso();
  await writeState(state);
  return state;
}

export async function recordHermesUpgradeSignal(input: {
  type: HermesUpgradeEventType;
  projectId?: string;
  note?: string;
}) {
  const state = await readState();
  if (input.type === 'knowledge_sync') {
    state.counters.knowledgeSyncEvents += 1;
  } else if (input.type === 'skill_import') {
    state.counters.skillImportEvents += 1;
  }
  state.lastEventAt = nowIso();
  evaluateSuggestions(state);
  state.updatedAt = nowIso();
  await writeState(state);
  return state;
}

export async function applyHermesUpgradeSuggestion(suggestionId: string) {
  const state = await readState();
  const now = nowIso();
  const target = state.pendingSuggestions.find((item) => item.id === suggestionId && item.status === 'pending');
  if (!target) {
    return { found: false, state };
  }
  const applied: HermesUpgradeSuggestion = {
    ...target,
    status: 'applied',
    appliedAt: now,
  };
  state.pendingSuggestions = state.pendingSuggestions.filter((item) => item.id !== suggestionId);
  state.history = [...state.history, applied].slice(-200);
  state.lastAppliedAt = now;
  state.updatedAt = now;
  await writeState(state);
  return { found: true, state };
}

export async function dismissHermesUpgradeSuggestion(suggestionId: string) {
  const state = await readState();
  const now = nowIso();
  const target = state.pendingSuggestions.find((item) => item.id === suggestionId && item.status === 'pending');
  if (!target) {
    return { found: false, state };
  }
  const dismissed: HermesUpgradeSuggestion = {
    ...target,
    status: 'dismissed',
    dismissedAt: now,
  };
  state.pendingSuggestions = state.pendingSuggestions.filter((item) => item.id !== suggestionId);
  state.history = [...state.history, dismissed].slice(-200);
  state.updatedAt = now;
  await writeState(state);
  return { found: true, state };
}
