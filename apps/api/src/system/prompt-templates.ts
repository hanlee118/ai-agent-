import type { PromptTemplate, PromptTemplateChannel, PromptTemplateUpsertInput } from "@occ/shared";
import { prisma } from "../db.js";

type ListPromptTemplatesInput = {
  channel: PromptTemplateChannel;
  locale: "zh-CN" | "en-US";
  projectId?: string;
};

const BUILTIN_DELIVERABLE_PROMPT_PREFIX = "builtin_prompt_key:";

const BUILTIN_DELIVERABLE_TEMPLATES: Array<{
  key: string;
  title: string;
  content: string;
}> = [
  {
    key: "requirement-analysis",
    title: "需求分析报告",
    content: [
      "你是一个需求分析师。基于项目上下文和历史知识，对以下需求进行分析，输出结构化报告。",
      "",
      "报告必须包含章节：",
      "1. 需求摘要（1-2句）",
      "2. 用户场景与用户故事（≥3个）",
      "3. 功能范围与优先级（P0/P1/P2）",
      "4. 与现有产品或模块的冲突/关联分析",
      "5. 风险评估与缓解建议",
      "6. 需进一步澄清的问题（≥2个）",
      "7. 推荐下一步行动",
      "",
      "格式：Markdown，清晰分段，使用标题层级。"
    ].join("\n")
  },
  {
    key: "prd-generation",
    title: "PRD 生成",
    content: [
      "你是一个资深产品经理。请基于需求分析报告和历史经验，撰写一份产品需求文档。",
      "",
      "PRD 必须包含以下章节：",
      "- 版本历史",
      "- 问题陈述",
      "- 目标用户",
      "- 用户旅程（主路径+分支）",
      "- 功能需求（含交互细节）",
      "- 非功能性需求",
      "- 验收标准（每一条可测试）",
      "- 附录（术语表、竞品参考等）",
      "",
      "语言要求：精确、无歧义。优先使用图表描述流程。"
    ].join("\n")
  },
  {
    key: "design-review",
    title: "设计审查卡",
    content: [
      "你是一个设计评审专家。对设计稿进行审查，输出设计审查卡。",
      "",
      "审查卡必须包含：",
      "- 设计是否满足所有 PRD 功能点（逐一确认）",
      "- 交互路径是否 ≤ 3 步（原则）",
      "- 视觉一致性检查（色彩、字体、间距）",
      "- 边界情况处理（空态、错误态、极限数据）",
      "- 无障碍访问性（对比度、焦点管理、语义化）",
      "- 审查结论（通过/修改后通过/不通过）及修改清单"
    ].join("\n")
  },
  {
    key: "tech-design",
    title: "技术方案与选型",
    content: [
      "你是一个架构师。请撰写技术方案与选型文档，内容必须包括：",
      "- 需求简述及技术目标",
      "- 技术选型对比分析（至少2个方案，含利弊）",
      "- 选定方案的理由",
      "- 系统架构图（ASCII art）",
      "- 关键接口定义（API 或数据结构）",
      "- 部署方案与运维考量",
      "- 安全性、性能、可扩展性自评估"
    ].join("\n")
  },
  {
    key: "test-report",
    title: "测试报告",
    content: [
      "你是一个测试工程师。基于验收标准和测试执行结果，输出测试报告。",
      "",
      "报告必须包含：",
      "- 测试范围与测试策略",
      "- 用例执行统计（通过/失败/阻塞）",
      "- 关键缺陷描述及严重程度",
      "- 性能测试摘要",
      "- 安全测试摘要",
      "- 回归测试结果",
      "- 剩余风险与上线建议"
    ].join("\n")
  }
];

export async function listPromptTemplates(input: ListPromptTemplatesInput): Promise<PromptTemplate[]> {
  const templates = await prisma.promptTemplate.findMany({
    where: {
      channel: input.channel,
      locale: input.locale,
      OR: [
        { scope: "global" },
        { scope: "personal" },
        ...(input.projectId ? [{ scope: "project", projectId: input.projectId }] : [])
      ]
    },
    orderBy: [
      { usageCount: "desc" },
      { updatedAt: "desc" }
    ]
  });

  return templates.map(toPromptTemplate);
}

export async function createPromptTemplate(input: PromptTemplateUpsertInput): Promise<PromptTemplate> {
  const created = await prisma.promptTemplate.create({
    data: {
      title: input.title,
      content: input.content,
      scope: input.scope,
      channel: input.channel,
      locale: input.locale,
      projectId: input.projectId,
      ownerLabel: input.ownerLabel || null
    }
  });

  return toPromptTemplate(created);
}

export async function markPromptTemplateUsed(templateId: string): Promise<PromptTemplate> {
  const updated = await prisma.promptTemplate.update({
    where: { id: templateId },
    data: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date()
    }
  });

  return toPromptTemplate(updated);
}

export async function ensureBuiltinPromptTemplates() {
  for (const template of BUILTIN_DELIVERABLE_TEMPLATES) {
    const ownerLabel = `${BUILTIN_DELIVERABLE_PROMPT_PREFIX}${template.key}`;
    const existing = await prisma.promptTemplate.findFirst({
      where: {
        ownerLabel,
        scope: "global",
        channel: "project_room_deliverable",
        locale: "zh-CN"
      },
      orderBy: { createdAt: "asc" }
    });
    if (existing) {
      await prisma.promptTemplate.update({
        where: { id: existing.id },
        data: {
          title: template.title,
          content: template.content
        }
      });
      continue;
    }
    await prisma.promptTemplate.create({
      data: {
        title: template.title,
        content: template.content,
        scope: "global",
        channel: "project_room_deliverable",
        locale: "zh-CN",
        ownerLabel
      }
    });
  }
}

export async function getBuiltinPromptTemplateByKey(key: string) {
  const ownerLabel = `${BUILTIN_DELIVERABLE_PROMPT_PREFIX}${String(key || "").trim()}`;
  if (!ownerLabel.trim()) {
    return null;
  }
  return prisma.promptTemplate.findFirst({
    where: {
      ownerLabel,
      scope: "global",
      channel: "project_room_deliverable",
      locale: "zh-CN"
    },
    orderBy: { createdAt: "asc" }
  });
}

function toPromptTemplate(template: {
  id: string;
  title: string;
  content: string;
  scope: string;
  channel: string;
  locale: string;
  projectId: string | null;
  ownerLabel: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PromptTemplate {
  return {
    id: template.id,
    title: template.title,
    content: template.content,
    scope: normalizeScope(template.scope),
    channel: normalizeChannel(template.channel),
    locale: template.locale === "en-US" ? "en-US" : "zh-CN",
    projectId: template.projectId ?? undefined,
    ownerLabel: template.ownerLabel ?? undefined,
    usageCount: template.usageCount,
    lastUsedAt: template.lastUsedAt?.toISOString(),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

function normalizeScope(value: string): PromptTemplate["scope"] {
  if (value === "project" || value === "personal") {
    return value;
  }

  return "global";
}

function normalizeChannel(value: string): PromptTemplateChannel {
  const channels: PromptTemplateChannel[] = [
    "project_room_guidance",
    "project_room_emergency",
    "project_room_deliverable",
    "openclaw_agent",
    "openclaw_batch"
  ];
  return channels.includes(value as PromptTemplateChannel) ? (value as PromptTemplateChannel) : "project_room_guidance";
}
