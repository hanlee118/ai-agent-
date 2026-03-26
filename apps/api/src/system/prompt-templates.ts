import type { PromptTemplate, PromptTemplateChannel, PromptTemplateUpsertInput } from "@occ/shared";
import { prisma } from "../db.js";

type ListPromptTemplatesInput = {
  channel: PromptTemplateChannel;
  locale: "zh-CN" | "en-US";
  projectId?: string;
};

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
