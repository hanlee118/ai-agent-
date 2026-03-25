import type { ParsedIntent, RoleType, RuntimeMode, StageType } from "@occ/shared";
import { ROLE_LABELS, STAGE_LABELS } from "@occ/shared";

export interface AgentRunContext {
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}

export interface AgentRunResult {
  provider: RuntimeMode;
  title: string;
  body: string;
  thinkingSummary: string;
}

export async function runScriptedAgent(context: AgentRunContext): Promise<AgentRunResult> {
  const bullets = {
    ANALYSIS: [
      `目标关键词：${context.parsedIntent.keywords.join(" / ") || "待补充"}`,
      `关键约束：${context.parsedIntent.constraints.join("；")}`,
      `主要风险：${context.parsedIntent.risks.join("；")}`,
      "建议先完成结构化需求与验收标准，再进入详细设计"
    ],
    DESIGN: [
      "固定仪表盘、项目观测室、Agent 中心三大页面",
      "让实时输出始终成为视觉中心",
      "把审批与紧急介入做成明确的强动作",
      "为下一阶段输出组件清单与接口契约"
    ],
    DEV: [
      "优先打通数据库、仓储和实时执行流",
      "实现创建、审批、暂停、恢复四条主链路",
      "把前端页面与持久化数据对齐",
      "确保在无模型密钥时仍可完整演示"
    ],
    ACCEPT: [
      "验证项目创建与需求解析",
      "验证阶段审批是否能推进状态",
      "验证紧急介入和恢复逻辑",
      "验证实时输出与时间轴是否同步"
    ],
    INIT: [
      "整理需求原文并确认命名",
      "初始化阶段与团队成员",
      "为分析阶段准备上下文"
    ]
  } satisfies Record<StageType, string[]>;

  const body = [
    `## ${STAGE_LABELS[context.stageType]}阶段执行纪要`,
    "",
    `当前执行角色：${ROLE_LABELS[context.role]}`,
    `项目名称：${context.projectName}`,
    "",
    ...bullets[context.stageType].map((item) => `- ${item}`),
    "",
    "### 项目摘要",
    context.summary ?? context.projectDescription
  ].join("\n");

  return {
    provider: "scripted",
    title: `${ROLE_LABELS[context.role]}正在推进${STAGE_LABELS[context.stageType]}阶段`,
    body,
    thinkingSummary: `${ROLE_LABELS[context.role]} 已完成当前阶段的结构化推演，正在准备正式输出。`
  };
}

