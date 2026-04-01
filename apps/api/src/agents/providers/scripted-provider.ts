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
  model: string;
  title: string;
  body: string;
  thinkingSummary: string;
}

export async function runScriptedAgent(context: AgentRunContext): Promise<AgentRunResult> {
  const keywords = context.parsedIntent.keywords.join(" / ") || "信息未提供";
  const constraints = context.parsedIntent.constraints.join("；") || "信息未提供";
  const risks = context.parsedIntent.risks.join("；") || "信息未提供";

  const stageBodyByType: Record<StageType, string[]> = {
    INIT: [
      "## 项目背景与目标",
      `- 项目名称: ${context.projectName}`,
      `- 目标摘要: ${context.summary ?? context.projectDescription}`,
      "## 范围定义（In Scope / Out of Scope）",
      "- In Scope: 围绕当前需求建立可执行闭环。",
      "- Out of Scope: 与本轮需求无关的横向扩张。",
      "## 角色分工与责任",
      "- 需求分析角色负责需求固定与边界识别。",
      "- 设计/研发/测试角色按阶段接力并沉淀交付物。",
      "## 风险与应急预案",
      `- 关键约束: ${constraints}`,
      `- 主要风险: ${risks}`
    ],
    ANALYSIS: [
      "## 业务背景与问题定义",
      `- 需求来源: ${context.projectDescription}`,
      `- 核心关键词: ${keywords}`,
      "## 用户场景与关键旅程",
      "- 场景1: 用户输入需求后，系统自动完成团队分配与问题澄清。",
      "- 场景2: 用户确认澄清结果后，系统生成可执行任务并推进阶段。",
      "- 场景3: 验收后结果回填产品说明文档并形成下次输入。",
      "## PRD 功能清单（MVP / 增强）",
      "- MVP: 需求固定、阶段推进、验收回填。",
      "- 增强: 冲突检测、模板策略、自动优化建议。",
      "## 验收标准与指标",
      "- 需求目标可追溯到交付物。",
      "- 每阶段至少产出一份可查阅文档。",
      "- 最终产物包含演示入口与回填记录。",
      "## 风险与依赖",
      `- 约束: ${constraints}`,
      `- 风险: ${risks}`
    ],
    DESIGN: [
      "## 视觉策略",
      "- 视觉主题: 信息可读、层级明确、聚焦闭环。",
      "- 品牌语气: 专业、直接、可执行。",
      "## 页面信息架构",
      "- 首屏: 价值主张 + 关键 CTA。",
      "- 中段: 阶段流程 + 角色协作 + 实时监控。",
      "- 末段: 验收证据 + 预约演示入口。",
      "## 组件规范",
      "- Hero、能力卡、流程链路、证据卡、CTA。",
      "- 交互反馈需要包含进行中/成功/失败状态。",
      "## 设计审查卡",
      "- UX 原则: 主链路优先、反馈及时、低认知负担。",
      "- 可访问性: 对比度、语义结构、键盘可达。",
      "- 审查结论: 通过（可进入开发）。"
    ],
    DEV: [
      "## 技术方案概览",
      "- 范围: 项目创建、推进、确认、验收、回填主链路。",
      "- 目标: 保证流程可执行、可追溯、可恢复。",
      "## 数据与接口契约",
      "- 核心实体: Project / Stage / Task / Deliverable / Timeline。",
      "- 核心接口: 创建项目、推进阶段、审批驳回、拉取交付物。",
      "## 开发任务拆解",
      "- Task1: 阶段推进与锁机制。",
      "- Task2: 交付物模板生成与质量检查。",
      "- Task3: 前端项目详情与验收视图联动。",
      "## 测试用例草案",
      "- 功能: 创建→推进→审批→完成。",
      "- 回归: 交付物重建、项目恢复、删除清理。",
      "- 异常: 无模型配置、阶段冲突、审批状态缺失。",
      "## 发布与回滚策略",
      "- 先灰度验证核心流程，再全量。",
      "- 若关键接口异常，回滚到前一稳定版本。"
    ],
    ACCEPT: [
      "## 测试范围与执行环境",
      "- 范围: 项目全链路、交付物质量、验收回填。",
      "- 环境: 本地 API + Web 构建产物。",
      "## 测试用例矩阵",
      "- 功能用例: 阶段推进与审批联动。",
      "- 回归用例: 重建交付物、历史项目清理。",
      "- 异常用例: 模型失败降级、用户中断恢复。",
      "## 执行结果与缺陷摘要",
      "- 结果: 主链路可跑通，交付物可查阅。",
      "- 缺陷: 长耗时步骤需异步化优化。",
      "## 需求一致性验证",
      "- 结论: 与需求目标总体一致，待持续优化体验细节。",
      "## 产品文档回填建议",
      "- 记录新增能力、版本号、验收结论与时间戳。",
      "- 标注潜在冲突并要求用户确认。"
    ]
  };

  const body = [
    `## ${STAGE_LABELS[context.stageType]}阶段执行纪要`,
    "",
    `当前执行角色：${ROLE_LABELS[context.role]}`,
    `项目名称：${context.projectName}`,
    "",
    ...stageBodyByType[context.stageType],
    "",
    "## 项目摘要",
    context.summary ?? context.projectDescription,
    "",
    "## 下一步",
    "- 基于当前阶段结论推进下一阶段或触发用户确认。",
    "- 若信息缺失，优先引导用户补充关键字段。"
  ].join("\n");

  return {
    provider: "scripted",
    model: "scripted-agent",
    title: `${ROLE_LABELS[context.role]}正在推进${STAGE_LABELS[context.stageType]}阶段`,
    body,
    thinkingSummary: `${ROLE_LABELS[context.role]} 已完成当前阶段的结构化推演，正在准备正式输出。`
  };
}
