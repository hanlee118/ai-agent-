import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type IssueSourceType =
  | "text"
  | "meeting_notes"
  | "journey"
  | "competitor"
  | "file_import"
  | "prd";
export type IssueStatus = "draft" | "confirmed" | "cancelled";
export type ConflictSeverity = "critical" | "warning" | "info";
export type RequirementValidationStatus = "pending" | "matched" | "mismatch";

export interface RequirementContract {
  objective: string;
  inScope: string[];
  outOfScope: string[];
  acceptanceCriteria: string[];
  artifacts: string[];
  designTheme?: string;
  valueNarrative?: string;
}

export interface ProductContext {
  id: "default";
  productName: string;
  background: string;
  mission: string;
  executionEngines: string[];
  executionPriority: string[];
  gitlabGovernance: string[];
  hermesUpgradeLoop: string[];
  goals: string[];
  principles: string[];
  constraints: string[];
  forbiddenKeywords: string[];
  requiredKeywords: string[];
  requirementHistory: RequirementBackfillItem[];
  updatedAt: string;
  createdAt: string;
}

export interface RequirementBackfillItem {
  id: string;
  issueId: string;
  projectId: string;
  title: string;
  refinedRequirement: string;
  status: "planned" | "in_progress" | "done";
  validationStatus: RequirementValidationStatus;
  validationNote?: string;
  implementationSummary?: string;
  requirementContract?: RequirementContract;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface IssueConflict {
  id: string;
  severity: ConflictSeverity;
  title: string;
  detail: string;
  suggestion?: string;
}

export interface IssueQuestion {
  id: string;
  question: string;
  required: boolean;
  placeholder?: string;
}

export interface IssueContextAlignment {
  productName: string;
  missionAnchor: string;
  matchedGoals: string[];
  matchedPrinciples: string[];
  contextNotes: string[];
}

export interface IssueDesignBlueprint {
  designTheme: string;
  valueNarrative: string;
  targetUsers: string[];
  coreScenarios: string[];
  proposedMilestones: string[];
}

export interface IssueSuggestedAnswer {
  questionId: string;
  answer: string;
  reason: string;
}

export type IssueDebateTaskStatus = "queued" | "running" | "completed" | "failed";

export interface IssueDebateOpinion {
  id: string;
  roleId: string;
  roleLabel: string;
  focus: string;
  concern: string;
  proposal: string;
  provider: string;
  model: string;
  elapsedMs: number;
  mode: "model" | "scripted" | "fallback";
  rawPreview: string;
}

export interface IssueDebateResult {
  mode: "model" | "fallback";
  generatedAt: string;
  consensus: string[];
  divergences: string[];
  opinions: IssueDebateOpinion[];
  note?: string;
}

export interface IssueDiscussionItem {
  id: string;
  roleId: string;
  roleLabel: string;
  focus: string;
  concern: string;
  proposal: string;
}

export interface IssueAnalysisGateCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface IssueAnalysisGate {
  canProceed: boolean;
  blockers: string[];
  checks: IssueAnalysisGateCheck[];
  runtimeMode: string;
  requestedRuntimeMode: string;
}

export interface IssueHistoryReference {
  id: string;
  issueId: string;
  projectId: string;
  title: string;
  status: "planned" | "in_progress" | "done";
  validationStatus: RequirementValidationStatus;
  relevance: number;
  hint: string;
}

export interface IssueRecord {
  id: string;
  title: string;
  sourceType: IssueSourceType;
  rawInput: string;
  industryCode: string;
  summary: string;
  recommendedRoleIds: string[];
  soulRoleId: string;
  conflicts: IssueConflict[];
  questions: IssueQuestion[];
  refinement?: {
    problemStatement: string;
    expectedOutcome: string;
    inScopeDraft: string[];
    outOfScopeDraft: string[];
    acceptanceDraft: string[];
  };
  contextAlignment?: IssueContextAlignment;
  designBlueprint?: IssueDesignBlueprint;
  suggestedAnswers?: IssueSuggestedAnswer[];
  relatedHistory?: IssueHistoryReference[];
  requirementContract?: RequirementContract;
  discussion?: IssueDiscussionItem[];
  discussionDraft?: IssueDiscussionItem[];
  debate?: IssueDebateResult | null;
  debateStatus?: IssueDebateTaskStatus;
  debateTaskId?: string;
  debateError?: string;
  debateUpdatedAt?: string;
  clarificationAnswers: Record<string, string>;
  conflictResolution?: string;
  status: IssueStatus;
  createdProjectId?: string;
  createdAt: string;
  updatedAt: string;
}

interface StoreSchema {
  productContext: ProductContext;
  issues: IssueRecord[];
}

const STORE_FILENAME = "v1-methodology-store.json";
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

  // Fallback for local dev and tests: apps/api/src/system -> workspace root.
  return path.resolve(startDir, "../../../../");
}

const workspaceRoot = process.env.OCC_WORKSPACE_ROOT?.trim() || findWorkspaceRoot(moduleDir);
const PRIMARY_STORE_PATH =
  process.env.OCC_V1_METHOD_STORE_PATH?.trim() || path.join(workspaceRoot, ".runtime", STORE_FILENAME);
const LEGACY_STORE_PATHS = Array.from(
  new Set(
    [
      path.join(process.cwd(), ".runtime", STORE_FILENAME),
      path.join(workspaceRoot, "apps", "api", ".runtime", STORE_FILENAME)
    ].filter((value) => value !== PRIMARY_STORE_PATH)
  )
);

const DEFAULT_CONTEXT: ProductContext = {
  id: "default",
  productName: "Aegis OS",
  background: "",
  mission: "",
  executionEngines: [],
  executionPriority: [],
  gitlabGovernance: [],
  hermesUpgradeLoop: [],
  goals: [],
  principles: [],
  constraints: [],
  forbiddenKeywords: [],
  requiredKeywords: [],
  requirementHistory: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

function nowIso() {
  return new Date().toISOString();
}

async function ensureStoreDir() {
  await mkdir(path.dirname(PRIMARY_STORE_PATH), { recursive: true });
}

function normalizeStore(parsed: Partial<StoreSchema> | undefined): StoreSchema {
  const context = parsed?.productContext ?? DEFAULT_CONTEXT;
  return {
    productContext: {
      ...DEFAULT_CONTEXT,
      ...context,
      executionEngines: normalizeStringArray((context as Partial<ProductContext>).executionEngines ?? []),
      executionPriority: normalizeStringArray((context as Partial<ProductContext>).executionPriority ?? []),
      gitlabGovernance: normalizeStringArray((context as Partial<ProductContext>).gitlabGovernance ?? []),
      hermesUpgradeLoop: normalizeStringArray((context as Partial<ProductContext>).hermesUpgradeLoop ?? []),
      requirementHistory: Array.isArray((context as Partial<ProductContext>).requirementHistory)
        ? ((context as Partial<ProductContext>).requirementHistory as RequirementBackfillItem[]).map((item) => ({
            ...item,
            validationStatus: item.validationStatus ?? "pending",
            updatedAt: item.updatedAt ?? item.createdAt ?? nowIso()
          }))
        : []
    },
    issues: Array.isArray(parsed?.issues) ? parsed.issues : []
  };
}

async function readStoreFile(filePath: string): Promise<StoreSchema | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreSchema>;
    return normalizeStore(parsed);
  } catch {
    return null;
  }
}

async function loadStore(): Promise<StoreSchema> {
  const primary = await readStoreFile(PRIMARY_STORE_PATH);
  if (primary) {
    return primary;
  }

  for (const legacyPath of LEGACY_STORE_PATHS) {
    const legacy = await readStoreFile(legacyPath);
    if (legacy) {
      await saveStore(legacy);
      return legacy;
    }
  }

  return {
    productContext: DEFAULT_CONTEXT,
    issues: []
  };
}

async function saveStore(next: StoreSchema) {
  await ensureStoreDir();
  const tempPath = `${PRIMARY_STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(next, null, 2), "utf8");
    await rename(tempPath, PRIMARY_STORE_PATH);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function loadStoreOrDefault(): Promise<StoreSchema> {
  try {
    return await loadStore();
  } catch {
    return {
      productContext: DEFAULT_CONTEXT,
      issues: []
    };
  }
}

function normalizeStringArray(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as string[];
  }
  return input
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

export async function getProductContext() {
  const store = await loadStoreOrDefault();
  return store.productContext;
}

export async function updateProductContext(input: Partial<ProductContext>) {
  const store = await loadStoreOrDefault();
  const previous = store.productContext;
  const now = nowIso();

  const updated: ProductContext = {
    id: "default",
    productName: String(input.productName ?? previous.productName ?? "").trim(),
    background: String(input.background ?? previous.background ?? "").trim(),
    mission: String(input.mission ?? previous.mission ?? "").trim(),
    executionEngines: normalizeStringArray(input.executionEngines ?? previous.executionEngines),
    executionPriority: normalizeStringArray(input.executionPriority ?? previous.executionPriority),
    gitlabGovernance: normalizeStringArray(input.gitlabGovernance ?? previous.gitlabGovernance),
    hermesUpgradeLoop: normalizeStringArray(input.hermesUpgradeLoop ?? previous.hermesUpgradeLoop),
    goals: normalizeStringArray(input.goals ?? previous.goals),
    principles: normalizeStringArray(input.principles ?? previous.principles),
    constraints: normalizeStringArray(input.constraints ?? previous.constraints),
    forbiddenKeywords: normalizeStringArray(input.forbiddenKeywords ?? previous.forbiddenKeywords),
    requiredKeywords: normalizeStringArray(input.requiredKeywords ?? previous.requiredKeywords),
    requirementHistory: Array.isArray(previous.requirementHistory) ? previous.requirementHistory : [],
    createdAt: previous.createdAt && previous.createdAt !== new Date(0).toISOString() ? previous.createdAt : now,
    updatedAt: now
  };

  const next: StoreSchema = {
    ...store,
    productContext: updated
  };
  await saveStore(next);
  return updated;
}

export async function appendRequirementBackfill(input: {
  issueId: string;
  projectId: string;
  title: string;
  refinedRequirement: string;
  status?: "planned" | "in_progress" | "done";
  validationStatus?: RequirementValidationStatus;
  requirementContract?: RequirementContract;
}) {
  const store = await loadStoreOrDefault();
  const context = store.productContext;
  const now = nowIso();

  const nextItem: RequirementBackfillItem = {
    id: randomUUID(),
    issueId: input.issueId,
    projectId: input.projectId,
    title: input.title,
    refinedRequirement: input.refinedRequirement,
    status: input.status ?? "planned",
    validationStatus: input.validationStatus ?? "pending",
    createdAt: now,
    updatedAt: now,
    requirementContract: input.requirementContract
  };

  const nextContext: ProductContext = {
    ...context,
    requirementHistory: [nextItem, ...(context.requirementHistory ?? [])].slice(0, 100),
    updatedAt: nowIso()
  };

  await saveStore({
    ...store,
    productContext: nextContext
  });

  return nextItem;
}

export async function removeRequirementBackfill(historyId: string) {
  const normalizedId = String(historyId ?? "").trim();
  if (!normalizedId) {
    return { removed: false } as const;
  }

  const store = await loadStoreOrDefault();
  const context = store.productContext;
  const currentHistory = context.requirementHistory ?? [];
  const target = currentHistory.find((item) => item.id === normalizedId)
    ?? currentHistory.find((item) => item.issueId === normalizedId)
    ?? currentHistory.find((item) => item.projectId === normalizedId);

  if (!target) {
    return { removed: false } as const;
  }
  const nextHistory = currentHistory.filter((item) => item.id !== target.id);

  const nextContext: ProductContext = {
    ...context,
    requirementHistory: nextHistory,
    updatedAt: nowIso()
  };

  await saveStore({
    ...store,
    productContext: nextContext
  });

  return {
    removed: true,
    historyId: target.id
  } as const;
}

export async function removeRequirementBackfills(historyIds: string[]) {
  const normalized = Array.from(
    new Set(
      (Array.isArray(historyIds) ? historyIds : [])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  );

  if (normalized.length === 0) {
    return { removedCount: 0, removedHistoryIds: [] as string[] } as const;
  }

  const store = await loadStoreOrDefault();
  const context = store.productContext;
  const currentHistory = context.requirementHistory ?? [];
  const matchedIds = new Set<string>();

  for (const identifier of normalized) {
    const target = currentHistory.find((item) =>
      item.id === identifier || item.issueId === identifier || item.projectId === identifier
    );
    if (target) {
      matchedIds.add(target.id);
    }
  }

  if (matchedIds.size === 0) {
    return { removedCount: 0, removedHistoryIds: [] as string[] } as const;
  }

  const nextHistory = currentHistory.filter((item) => !matchedIds.has(item.id));
  const nextContext: ProductContext = {
    ...context,
    requirementHistory: nextHistory,
    updatedAt: nowIso()
  };

  await saveStore({
    ...store,
    productContext: nextContext
  });

  return {
    removedCount: matchedIds.size,
    removedHistoryIds: Array.from(matchedIds)
  } as const;
}

export async function listIssues(status?: IssueStatus) {
  const store = await loadStoreOrDefault();
  const data = status ? store.issues.filter((item) => item.status === status) : store.issues;
  return data.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listIssueCreatedProjectIdsByPrefix(prefix: string) {
  const normalizedPrefix = String(prefix ?? "").trim();
  if (!normalizedPrefix) {
    return [] as string[];
  }
  const store = await loadStoreOrDefault();
  const ids = new Set<string>();
  for (const issue of store.issues) {
    const projectId = String(issue.createdProjectId ?? "").trim();
    if (projectId.startsWith(normalizedPrefix)) {
      ids.add(projectId);
    }
  }
  return Array.from(ids);
}

export async function getIssue(issueId: string) {
  const store = await loadStoreOrDefault();
  return store.issues.find((item) => item.id === issueId) ?? null;
}

export async function getIssueByProjectId(projectId: string) {
  const store = await loadStoreOrDefault();
  return store.issues.find((item) => item.createdProjectId === projectId) ?? null;
}

export async function clearIssueProjectBinding(projectId: string) {
  const normalizedProjectId = String(projectId ?? "").trim();
  if (!normalizedProjectId) {
    return 0;
  }

  const store = await loadStoreOrDefault();
  let changed = 0;
  const nextIssues = store.issues.map((issue) => {
    if (issue.createdProjectId !== normalizedProjectId) {
      return issue;
    }
    changed += 1;
    return {
      ...issue,
      createdProjectId: undefined,
      updatedAt: nowIso()
    };
  });

  if (changed > 0) {
    await saveStore({
      ...store,
      issues: nextIssues
    });
  }

  return changed;
}

export async function createIssueDraft(input: {
  title: string;
  sourceType: IssueSourceType;
  rawInput: string;
  industryCode: string;
  summary: string;
  recommendedRoleIds: string[];
  soulRoleId: string;
  conflicts: IssueConflict[];
  questions: IssueQuestion[];
  refinement?: IssueRecord["refinement"];
  contextAlignment?: IssueContextAlignment;
  designBlueprint?: IssueDesignBlueprint;
  suggestedAnswers?: IssueSuggestedAnswer[];
  relatedHistory?: IssueHistoryReference[];
  requirementContract?: RequirementContract;
  discussion?: IssueDiscussionItem[];
  discussionDraft?: IssueDiscussionItem[];
  debate?: IssueDebateResult | null;
  debateStatus?: IssueDebateTaskStatus;
  debateTaskId?: string;
  debateError?: string;
  debateUpdatedAt?: string;
}) {
  const store = await loadStoreOrDefault();
  const now = nowIso();
  const issue: IssueRecord = {
    id: randomUUID(),
    title: input.title,
    sourceType: input.sourceType,
    rawInput: input.rawInput,
    industryCode: input.industryCode,
    summary: input.summary,
    recommendedRoleIds: input.recommendedRoleIds,
    soulRoleId: input.soulRoleId,
    conflicts: input.conflicts,
    questions: input.questions,
    refinement: input.refinement,
    contextAlignment: input.contextAlignment,
    designBlueprint: input.designBlueprint,
    suggestedAnswers: input.suggestedAnswers,
    relatedHistory: input.relatedHistory,
    requirementContract: input.requirementContract,
    discussion: input.discussion,
    discussionDraft: input.discussionDraft,
    debate: input.debate,
    debateStatus: input.debateStatus,
    debateTaskId: input.debateTaskId,
    debateError: input.debateError,
    debateUpdatedAt: input.debateUpdatedAt,
    clarificationAnswers: {},
    conflictResolution: "",
    status: "draft",
    createdAt: now,
    updatedAt: now
  };

  const next: StoreSchema = {
    ...store,
    issues: [issue, ...store.issues].slice(0, 200)
  };
  await saveStore(next);
  return issue;
}

export async function updateIssue(
  issueId: string,
  updater: (issue: IssueRecord) => IssueRecord
) {
  const store = await loadStoreOrDefault();
  const index = store.issues.findIndex((item) => item.id === issueId);
  if (index < 0) {
    return null;
  }

  const current = store.issues[index];
  const nextIssue = updater(current);
  const nextIssues = [...store.issues];
  nextIssues[index] = {
    ...nextIssue,
    updatedAt: nowIso()
  };

  await saveStore({
    ...store,
    issues: nextIssues
  });

  return nextIssues[index];
}

export async function finalizeRequirementBackfill(input: {
  issueId: string;
  projectId: string;
  title: string;
  refinedRequirement: string;
  implementationSummary: string;
  validationStatus: RequirementValidationStatus;
  validationNote: string;
  requirementContract?: RequirementContract;
}) {
  const store = await loadStoreOrDefault();
  const context = store.productContext;
  const now = nowIso();
  const nextStatus: RequirementBackfillItem["status"] = input.validationStatus === "matched" ? "done" : "in_progress";
  const completedAt = input.validationStatus === "matched" ? now : undefined;

  const currentHistory = context.requirementHistory ?? [];
  const index = currentHistory.findIndex((item) => item.projectId === input.projectId || item.issueId === input.issueId);

  let nextHistory: RequirementBackfillItem[];
  if (index >= 0) {
    nextHistory = [...currentHistory];
    const current = nextHistory[index];
    nextHistory[index] = {
      ...current,
      title: input.title || current.title,
      refinedRequirement: input.refinedRequirement || current.refinedRequirement,
      status: nextStatus,
      validationStatus: input.validationStatus,
      validationNote: input.validationNote,
      implementationSummary: input.implementationSummary,
      requirementContract: input.requirementContract ?? current.requirementContract,
      updatedAt: now,
      completedAt
    };
  } else {
    nextHistory = [
      {
        id: randomUUID(),
        issueId: input.issueId,
        projectId: input.projectId,
        title: input.title,
        refinedRequirement: input.refinedRequirement,
        status: nextStatus,
        validationStatus: input.validationStatus,
        validationNote: input.validationNote,
        implementationSummary: input.implementationSummary,
        requirementContract: input.requirementContract,
        createdAt: now,
        updatedAt: now,
        completedAt
      },
      ...currentHistory
    ];
  }

  const nextContext: ProductContext = {
    ...context,
    requirementHistory: nextHistory.slice(0, 100),
    updatedAt: now
  };

  await saveStore({
    ...store,
    productContext: nextContext
  });

  return nextContext.requirementHistory.find((item) => item.projectId === input.projectId) ?? null;
}

export async function resolveRequirementMismatches(input: {
  resolution: string;
  limit?: number;
}) {
  const store = await loadStoreOrDefault();
  const context = store.productContext;
  const now = nowIso();
  const limit = Math.max(1, Math.min(20, input.limit ?? 3));
  let updatedCount = 0;

  const nextHistory = (context.requirementHistory ?? []).map((item) => {
    if (item.validationStatus !== "mismatch" || updatedCount >= limit) {
      return item;
    }
    updatedCount += 1;
    return {
      ...item,
      status: "in_progress" as RequirementBackfillItem["status"],
      validationStatus: "pending" as RequirementValidationStatus,
      validationNote: `已登记冲突解决方案: ${input.resolution}`,
      updatedAt: now,
      completedAt: undefined
    };
  });

  if (updatedCount === 0) {
    return { updatedCount: 0 };
  }

  const nextContext: ProductContext = {
    ...context,
    requirementHistory: nextHistory,
    updatedAt: now
  };

  await saveStore({
    ...store,
    productContext: nextContext
  });

  return { updatedCount };
}
