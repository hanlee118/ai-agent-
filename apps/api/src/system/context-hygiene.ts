import { prisma } from "../db.js";

type CleanupReason =
  | "orphan_project_memory"
  | "template_like_memory"
  | "orphan_project_template"
  | "stale_unused_template";

type ContextHygieneCandidate = {
  kind: "agent_memory" | "prompt_template";
  id: string;
  reason: CleanupReason;
  projectId?: string | null;
  agentId?: string;
  title?: string;
  summary: string;
  createdAt: string;
  importance?: number;
  usageCount?: number;
};

const TEMPLATE_LIKE_PATTERN =
  /(模板|占位|示例|默认视觉|复用旧项目|沿用上一项目|官网演示|视觉定稿单页|客户汇报方案|实施方案说明|TrendHunter)/i;

export function classifyAgentMemoryEntryForCleanup(input: {
  projectExists: boolean;
  projectId?: string | null;
  importance: number;
  summary: string;
  content: string;
  createdAt: Date;
}) {
  if (input.projectId && !input.projectExists) {
    return "orphan_project_memory" satisfies CleanupReason;
  }

  const ageMs = Date.now() - input.createdAt.getTime();
  const staleDays = ageMs / (24 * 60 * 60 * 1000);
  if (input.importance <= 20 && staleDays >= 14 && TEMPLATE_LIKE_PATTERN.test(`${input.summary} ${input.content}`)) {
    return "template_like_memory" satisfies CleanupReason;
  }

  return null;
}

export function classifyPromptTemplateForCleanup(input: {
  scope: string;
  projectExists: boolean;
  projectId?: string | null;
  usageCount: number;
  title: string;
  content: string;
  createdAt: Date;
}) {
  if (input.projectId && !input.projectExists) {
    return "orphan_project_template" satisfies CleanupReason;
  }

  const ageMs = Date.now() - input.createdAt.getTime();
  const staleDays = ageMs / (24 * 60 * 60 * 1000);
  if (input.usageCount === 0 && staleDays >= 21 && input.scope !== "global" && TEMPLATE_LIKE_PATTERN.test(`${input.title} ${input.content}`)) {
    return "stale_unused_template" satisfies CleanupReason;
  }

  return null;
}

export async function getContextHygieneReport() {
  const [projects, memoryEntries, promptTemplates] = await Promise.all([
    prisma.project.findMany({
      select: { id: true }
    }),
    prisma.agentMemoryEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: 400,
      select: {
        id: true,
        agentId: true,
        projectId: true,
        importance: true,
        summary: true,
        content: true,
        createdAt: true
      }
    }),
    prisma.promptTemplate.findMany({
      orderBy: { createdAt: "desc" },
      take: 400,
      select: {
        id: true,
        title: true,
        content: true,
        scope: true,
        projectId: true,
        usageCount: true,
        createdAt: true
      }
    })
  ]);

  const projectIds = new Set(projects.map((item) => item.id));
  const candidates: ContextHygieneCandidate[] = [];

  for (const row of memoryEntries) {
    const reason = classifyAgentMemoryEntryForCleanup({
      projectExists: !row.projectId || projectIds.has(row.projectId),
      projectId: row.projectId,
      importance: row.importance,
      summary: row.summary,
      content: row.content,
      createdAt: row.createdAt
    });
    if (!reason) {
      continue;
    }
    candidates.push({
      kind: "agent_memory",
      id: row.id,
      reason,
      projectId: row.projectId,
      agentId: row.agentId,
      summary: row.summary.slice(0, 120),
      createdAt: row.createdAt.toISOString(),
      importance: row.importance
    });
  }

  for (const row of promptTemplates) {
    const reason = classifyPromptTemplateForCleanup({
      scope: row.scope,
      projectExists: !row.projectId || projectIds.has(row.projectId),
      projectId: row.projectId,
      usageCount: row.usageCount,
      title: row.title,
      content: row.content,
      createdAt: row.createdAt
    });
    if (!reason) {
      continue;
    }
    candidates.push({
      kind: "prompt_template",
      id: row.id,
      reason,
      projectId: row.projectId,
      title: row.title,
      summary: row.title.slice(0, 120),
      createdAt: row.createdAt.toISOString(),
      usageCount: row.usageCount
    });
  }

  const counts = candidates.reduce<Record<CleanupReason, number>>((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {
    orphan_project_memory: 0,
    template_like_memory: 0,
    orphan_project_template: 0,
    stale_unused_template: 0
  });

  return {
    checkedAt: new Date().toISOString(),
    scanned: {
      projects: projects.length,
      agentMemoryEntries: memoryEntries.length,
      promptTemplates: promptTemplates.length
    },
    candidates,
    counts
  };
}

export async function cleanupContextHygiene(input?: {
  apply?: boolean;
  maxDelete?: number;
}) {
  const apply = input?.apply !== false;
  const maxDelete = Math.max(1, Math.min(500, Number(input?.maxDelete ?? 200)));
  const report = await getContextHygieneReport();
  const selected = report.candidates.slice(0, maxDelete);
  const memoryIds = selected.filter((item) => item.kind === "agent_memory").map((item) => item.id);
  const templateIds = selected.filter((item) => item.kind === "prompt_template").map((item) => item.id);

  if (!apply) {
    return {
      ...report,
      apply,
      maxDelete,
      deleted: {
        agentMemoryEntries: 0,
        promptTemplates: 0
      }
    };
  }

  const [deletedMemory, deletedTemplates] = await Promise.all([
    memoryIds.length > 0
      ? prisma.agentMemoryEntry.deleteMany({ where: { id: { in: memoryIds } } })
      : Promise.resolve({ count: 0 }),
    templateIds.length > 0
      ? prisma.promptTemplate.deleteMany({ where: { id: { in: templateIds } } })
      : Promise.resolve({ count: 0 })
  ]);

  return {
    ...report,
    apply,
    maxDelete,
    deleted: {
      agentMemoryEntries: deletedMemory.count,
      promptTemplates: deletedTemplates.count
    }
  };
}
