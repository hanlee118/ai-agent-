import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { AGENT_ROLE_TEMPLATES, ROLE_LABELS, type RoleType } from "@occ/shared";
import { prisma } from "../apps/api/src/db.js";
import {
  findOpenClawAgent,
  listOpenClawAgents,
  updateOpenClawAgentDocument
} from "../apps/api/src/openclaw/workspace.js";

type AgentGovernanceSyncItem = {
  source: "openclaw" | "managed_only";
  agentId: string;
  name: string;
  roleId: RoleType;
  roleLabel: string;
  soul: "kept" | "updated";
  sop: "kept" | "updated";
  reason: string[];
};

type ManagedProfile = {
  agentId: string;
  name: string;
  title: string;
  intro: string;
  roleId: RoleType;
};

const TEMPLATE_BY_ROLE = new Map(
  AGENT_ROLE_TEMPLATES.map((item) => [item.roleId, item] as const)
);

const COMMON_GOVERNANCE_STEPS = [
  "执行顺序必须遵循：工具优先 > 技能优先 > 最佳模型；禁止跳过可用工具/技能直接编造结论。",
  "所有阶段输出必须基于真实执行证据，禁止使用假数据、占位结论或未执行即声称完成。",
  "遇到阻塞时先给出可执行替代方案与影响评估，再发起人工确认，不得静默中断。",
  "每次交付需包含：变更摘要、验证结果、风险与下一步，确保可追溯和可复盘。"
];
const WAIT = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeText(input: string | undefined) {
  return String(input ?? "").replace(/\r\n/g, "\n").trim();
}

function parseSopSteps(input: string | undefined) {
  return normalizeText(input)
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

function parseStoredSteps(raw: string | null | undefined) {
  if (!raw) {
    return [] as string[];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function isSameSteps(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

function isMissingOrPlaceholderSoul(content: string) {
  const text = normalizeText(content);
  if (!text) {
    return true;
  }
  return /输入 Agent 的核心身份描述|当前 Agent 暂无 SOUL|你是 .*职责是：/iu.test(text);
}

function isMissingOrPlaceholderSop(content: string) {
  const steps = parseSopSteps(content);
  if (steps.length === 0) {
    return true;
  }
  const joined = steps.join(" ");
  if (/当前 Agent 暂无 SOP|每行一步/.test(joined)) {
    return true;
  }
  const genericDefault = [
    "先理解需求",
    "给出执行计划",
    "在关键风险节点请求确认",
    "完成后同步结果"
  ];
  return genericDefault.every((item) => joined.includes(item));
}

function inferRoleId(input: { agentId: string; name: string; title: string; responsibility: string }): RoleType {
  const profile = `${input.agentId} ${input.name} ${input.title} ${input.responsibility}`.toLowerCase();
  const byRoleLiteral = String(input.title || "").trim().toUpperCase();
  if (TEMPLATE_BY_ROLE.has(byRoleLiteral as RoleType)) {
    return byRoleLiteral as RoleType;
  }
  // Keep QA matching ahead of generic "engineer/dev" matching.
  if (/(qa|测试|quality assurance)/i.test(profile)) return "ROLE_QA";
  if (/(assistant|助理)/i.test(profile)) return "ROLE_ASSISTANT";
  if (/(project manager|pm|项目经理)/i.test(profile)) return "ROLE_PM";
  if (/(analyst|需求分析|分析师)/i.test(profile)) return "ROLE_ANALYST";
  if (/(product|prd|产品总监)/i.test(profile)) return "ROLE_PRODUCT";
  if (/(design|视觉|ui|ux|jeremy)/i.test(profile)) return "ROLE_DESIGN";
  if (/(architect|研发总监|架构)/i.test(profile)) return "ROLE_ARCH";
  if (/(dev|研发经理|开发|bolt|software engineer|backend|frontend)/i.test(profile)) return "ROLE_DEV";
  if (/(hr|人力)/i.test(profile)) return "ROLE_HR";
  return "ROLE_ASSISTANT";
}

function buildSoul(name: string, roleId: RoleType) {
  const template = TEMPLATE_BY_ROLE.get(roleId) ?? TEMPLATE_BY_ROLE.get("ROLE_ASSISTANT")!;
  return [
    `# ${name} SOUL`,
    "",
    template.soul,
    "",
    "## 执行治理约束",
    "- 仅基于真实执行结果输出结论，不得伪造数据或跳过步骤。",
    "- 工具优先、技能优先、模型兜底；禁止反向顺序。",
    "- 发现风险立即显式同步，并给出可执行修复路径。",
    "",
    "## 角色标识",
    `- roleId: ${roleId}`,
    `- roleLabel: ${ROLE_LABELS[roleId]}`,
    ""
  ].join("\n");
}

function buildSop(roleId: RoleType) {
  const template = TEMPLATE_BY_ROLE.get(roleId) ?? TEMPLATE_BY_ROLE.get("ROLE_ASSISTANT")!;
  const steps = [...template.sop, ...COMMON_GOVERNANCE_STEPS];
  return [
    "# SOP",
    "",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    ""
  ].join("\n");
}

async function run() {
  const ensureDatabaseReady = async () => {
    const maxAttempts = 12;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await prisma.$queryRawUnsafe("SELECT 1");
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 1) {
          try {
            execFileSync("docker-compose", ["up", "-d", "db"], {
              cwd: process.cwd(),
              stdio: "ignore",
            });
          } catch {}
        }
        await WAIT(1500);
      }
    }
    throw (lastError instanceof Error ? lastError : new Error("database not reachable"));
  };

  await ensureDatabaseReady();
  const managedConfigs = await prisma.managedAgentConfig.findMany({
    select: {
      agentId: true,
      displayName: true,
      title: true,
      intro: true
    }
  });
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(scriptDir, "..");
  const agents = await listOpenClawAgents();
  const managedProfiles: ManagedProfile[] = managedConfigs
    .map((item) => {
      const agentId = String(item.agentId || "").trim();
      if (!agentId) {
        return null;
      }
      const name = String(item.displayName || "").trim() || agentId;
      const title = String(item.title || "").trim();
      const intro = String(item.intro || "").trim();
      const roleId = inferRoleId({
        agentId,
        name,
        title,
        responsibility: intro
      });
      return { agentId, name, title, intro, roleId };
    })
    .filter((item): item is ManagedProfile => Boolean(item));
  const report: AgentGovernanceSyncItem[] = [];
  const processedAgentIds = new Set<string>();

  for (const summary of agents) {
    const detail = await findOpenClawAgent(summary.agentId);
    if (!detail) {
      continue;
    }
    const roleId = inferRoleId({
      agentId: detail.agentId,
      name: detail.name,
      title: detail.title,
      responsibility: detail.responsibility
    });

    const nextSoul = buildSoul(detail.name || detail.agentId, roleId);
    const nextSop = buildSop(roleId);
    const reasons: string[] = [];
    let soulState: "kept" | "updated" = "kept";
    let sopState: "kept" | "updated" = "kept";

    if (isMissingOrPlaceholderSoul(detail.soul?.content)) {
      await updateOpenClawAgentDocument(detail.agentId, "soul", {
        content: nextSoul,
        createIfMissing: true
      });
      soulState = "updated";
      reasons.push("soul_missing_or_placeholder");
    }

    if (isMissingOrPlaceholderSop(detail.sop?.content)) {
      await updateOpenClawAgentDocument(detail.agentId, "sop", {
        content: nextSop,
        createIfMissing: true
      });
      sopState = "updated";
      reasons.push("sop_missing_or_placeholder");
    }

    const finalDetail = await findOpenClawAgent(detail.agentId);
    const finalSoul = normalizeText(finalDetail?.soul?.content || nextSoul);
    const finalSopSteps = parseSopSteps(finalDetail?.sop?.content || nextSop);

    await prisma.agentSoul.upsert({
      where: { agentId: detail.agentId },
      create: {
        agentId: detail.agentId,
        content: finalSoul
      },
      update: {
        content: finalSoul
      }
    });

    await prisma.agentSop.upsert({
      where: { agentId: detail.agentId },
      create: {
        agentId: detail.agentId,
        steps: JSON.stringify(finalSopSteps)
      },
      update: {
        steps: JSON.stringify(finalSopSteps)
      }
    });

    const sameRoleManagedProfiles = managedProfiles.filter((item) => item.roleId === roleId && item.agentId !== detail.agentId);
    for (const managedProfile of sameRoleManagedProfiles) {
      const [existingSoul, existingSop] = await prisma.$transaction([
        prisma.agentSoul.findUnique({ where: { agentId: managedProfile.agentId } }),
        prisma.agentSop.findUnique({ where: { agentId: managedProfile.agentId } }),
      ]);
      const existingSoulText = normalizeText(existingSoul?.content || "");
      const managedNeedsSoul = isMissingOrPlaceholderSoul(existingSoul?.content || "") || existingSoulText !== finalSoul;
      const managedSteps = parseStoredSteps(existingSop?.steps || null);
      const managedNeedsSop = managedSteps.length === 0
        || isMissingOrPlaceholderSop(managedSteps.join("\n"))
        || !isSameSteps(managedSteps, finalSopSteps);
      if (managedNeedsSoul) {
        await prisma.agentSoul.upsert({
          where: { agentId: managedProfile.agentId },
          create: {
            agentId: managedProfile.agentId,
            content: finalSoul
          },
          update: {
            content: finalSoul
          }
        });
      }
      if (managedNeedsSop) {
        await prisma.agentSop.upsert({
          where: { agentId: managedProfile.agentId },
          create: {
            agentId: managedProfile.agentId,
            steps: JSON.stringify(finalSopSteps)
          },
          update: {
            steps: JSON.stringify(finalSopSteps)
          }
        });
      }
    }

    report.push({
      source: "openclaw",
      agentId: detail.agentId,
      name: detail.name,
      roleId,
      roleLabel: ROLE_LABELS[roleId],
      soul: soulState,
      sop: sopState,
      reason: reasons
    });
    processedAgentIds.add(detail.agentId);
  }

  for (const managed of managedProfiles) {
    const agentId = String(managed.agentId || "").trim();
    if (!agentId || processedAgentIds.has(agentId)) {
      continue;
    }
    const roleId = managed.roleId;

    const existingSoul = await prisma.agentSoul.findUnique({ where: { agentId } });
    const existingSop = await prisma.agentSop.findUnique({ where: { agentId } });
    const nextSoul = buildSoul(managed.name || agentId, roleId);
    const nextSop = buildSop(roleId);
    const reasons: string[] = [];
    let soulState: "kept" | "updated" = "kept";
    let sopState: "kept" | "updated" = "kept";

    if (isMissingOrPlaceholderSoul(existingSoul?.content || "")) {
      await prisma.agentSoul.upsert({
        where: { agentId },
        create: { agentId, content: nextSoul },
        update: { content: nextSoul }
      });
      soulState = "updated";
      reasons.push("managed_soul_missing_or_placeholder");
    }

    const existingSopSteps = parseStoredSteps(existingSop?.steps || null);
    if (existingSopSteps.length === 0 || isMissingOrPlaceholderSop(existingSopSteps.join("\n"))) {
      const nextSteps = parseSopSteps(nextSop);
      await prisma.agentSop.upsert({
        where: { agentId },
        create: { agentId, steps: JSON.stringify(nextSteps) },
        update: { steps: JSON.stringify(nextSteps) }
      });
      sopState = "updated";
      reasons.push("managed_sop_missing_or_placeholder");
    }

    report.push({
      source: "managed_only",
      agentId,
      name: managed.name || agentId,
      roleId,
      roleLabel: ROLE_LABELS[roleId],
      soul: soulState,
      sop: sopState,
      reason: reasons
    });
  }

  const updatedSoul = report.filter((item) => item.soul === "updated").length;
  const updatedSop = report.filter((item) => item.sop === "updated").length;
  const payload = {
    generatedAt: new Date().toISOString(),
    totalAgents: report.length,
    updatedSoul,
    updatedSop,
    report
  };

  const outPath = path.resolve(workspaceRoot, "docs/reports/agent-governance-sync-latest.json");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  console.log(`report: ${outPath}`);
}

run()
  .catch((error) => {
    console.error("[sync-agent-governance] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
