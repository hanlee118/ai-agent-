import { randomUUID } from "node:crypto";
import {
  ROLE_LABELS,
  STAGE_LABELS,
  type AgentProfile,
  type Deliverable,
  type ParsedIntent,
  type ProjectDetail,
  type RoleType,
  type RuntimeMode,
  type Stage,
  type StageType,
  type Task,
  type TimelineEvent
} from "@occ/shared";
import { previewRequirement } from "../utils/project-parser.js";

const baseDate = new Date("2026-03-25T10:30:00+08:00");

export const roleOrder: RoleType[] = [
  "ROLE_PM",
  "ROLE_ANALYST",
  "ROLE_PRODUCT",
  "ROLE_DESIGN",
  "ROLE_ARCH",
  "ROLE_DEV",
  "ROLE_QA",
  "ROLE_HR"
];

export const stageAssignees: Record<StageType, RoleType> = {
  INIT: "ROLE_PM",
  ANALYSIS: "ROLE_ANALYST",
  DESIGN: "ROLE_PRODUCT",
  DEV: "ROLE_DEV",
  ACCEPT: "ROLE_QA"
};

export const seedAgents: AgentProfile[] = [
  {
    roleId: "ROLE_ASSISTANT",
    name: "总助理",
    tagline: "系统级协调与风险升级",
    description: "负责跨项目健康监控、异常升级和知识沉淀。",
    status: "working",
    workload: 62,
    styles: ["系统性", "冷静", "全局观"],
    skills: { professional: 94, collaboration: 97, learning: 88, stability: 95, innovation: 78 },
    recentHighlights: ["连续 3 个项目提前发现阻塞", "自动生成系统健康摘要"]
  },
  {
    roleId: "ROLE_PM",
    name: "项目经理",
    tagline: "统一入口与阶段推进器",
    description: "负责创建项目、维护阶段闸门、协调团队推进。",
    status: "working",
    workload: 71,
    styles: ["高效", "有节奏", "结果导向"],
    skills: { professional: 92, collaboration: 95, learning: 84, stability: 91, innovation: 72 },
    recentHighlights: ["本周 4 个项目无遗漏推进", "审批节奏稳定"]
  },
  {
    roleId: "ROLE_ANALYST",
    name: "需求分析师",
    tagline: "把模糊需求变成结构化目标",
    description: "负责需求拆解、约束识别和方案边界定义。",
    status: "idle",
    workload: 38,
    styles: ["细致", "逻辑化", "善于澄清"],
    skills: { professional: 93, collaboration: 84, learning: 88, stability: 90, innovation: 76 },
    recentHighlights: ["生成高质量用户故事地图", "主动识别范围风险"]
  },
  {
    roleId: "ROLE_PRODUCT",
    name: "产品总监",
    tagline: "把需求变成可执行产品方案",
    description: "负责信息架构、PRD 和关键交互设计。",
    status: "working",
    workload: 66,
    styles: ["用户导向", "审美敏感", "创新"],
    skills: { professional: 91, collaboration: 88, learning: 86, stability: 87, innovation: 93 },
    recentHighlights: ["补齐 2 个关键流程", "输出可执行页面结构"]
  },
  {
    roleId: "ROLE_DESIGN",
    name: "视觉设计总监",
    tagline: "把抽象需求落成高辨识度体验",
    description: "负责视觉方向、品牌语气、组件规范和可访问性设计审查。",
    status: "working",
    workload: 64,
    styles: ["前卫", "一致性", "注重细节"],
    skills: { professional: 94, collaboration: 86, learning: 88, stability: 85, innovation: 96 },
    recentHighlights: ["完成官网视觉升级", "沉淀设计审查卡模板"]
  },
  {
    roleId: "ROLE_ARCH",
    name: "研发总监",
    tagline: "定义技术边界与演进路线",
    description: "负责技术选型、架构设计和风险控制。",
    status: "idle",
    workload: 44,
    styles: ["务实", "深度", "前瞻"],
    skills: { professional: 96, collaboration: 82, learning: 91, stability: 92, innovation: 84 },
    recentHighlights: ["给出本地部署路径", "识别实时流协议风险"]
  },
  {
    roleId: "ROLE_DEV",
    name: "研发经理",
    tagline: "推动代码实现与交付",
    description: "负责任务拆解、代码开发、联调和交付。",
    status: "working",
    workload: 73,
    styles: ["高效", "工程化", "可维护"],
    skills: { professional: 93, collaboration: 85, learning: 89, stability: 90, innovation: 79 },
    recentHighlights: ["完成原型骨架", "联通关键 API"]
  },
  {
    roleId: "ROLE_QA",
    name: "测试工程师",
    tagline: "质量门禁与验收决策",
    description: "负责测试策略、验收标准和风险暴露。",
    status: "idle",
    workload: 31,
    styles: ["严谨", "系统性", "挑剔"],
    skills: { professional: 91, collaboration: 79, learning: 84, stability: 93, innovation: 69 },
    recentHighlights: ["补充验收标准", "发现审批链路遗漏"]
  },
  {
    roleId: "ROLE_HR",
    name: "HR总监",
    tagline: "复盘沉淀与团队优化",
    description: "负责绩效评估、组织知识库与协作优化。",
    status: "idle",
    workload: 27,
    styles: ["洞察", "公正", "发展导向"],
    skills: { professional: 87, collaboration: 92, learning: 85, stability: 90, innovation: 75 },
    recentHighlights: ["提炼成功模式", "输出团队改进建议"]
  }
];

export function createSeedProjects(provider: RuntimeMode): ProjectDetail[] {
  return [
    createSeedProject(
      {
        id: "OCC-20260325-001",
        name: "AI 协作工作台 MVP",
        description: "设计并研发一个可观测、可审批、可干预的 AI 协作工作台。",
        currentStage: "DESIGN",
        progress: 46,
        pendingApproval: false,
        currentRole: "ROLE_PRODUCT",
        updatedAt: "2026-03-25T10:18:00+08:00",
        parsedIntent: previewRequirement("设计并研发一个可观测、可审批、可干预的 AI 协作工作台。"),
        summary: "产品总监正在基于需求分析文档输出 PRD，并将视觉范围与交互约束交接给设计角色。"
      },
      provider
    ),
    createSeedProject(
      {
        id: "OCC-20260324-002",
        name: "本地部署方案收敛",
        description: "收敛 Mac Mini 本地部署方案，并决定 MVP 的基础设施边界。",
        currentStage: "ANALYSIS",
        progress: 28,
        pendingApproval: true,
        currentRole: "ROLE_PM",
        updatedAt: "2026-03-25T09:42:00+08:00",
        parsedIntent: previewRequirement("收敛 Mac Mini 本地部署方案，并决定 MVP 的基础设施边界。"),
        summary: "需求分析阶段已完成，当前等待你批准是否进入设计阶段。"
      },
      provider
    ),
    createSeedProject(
      {
        id: "OCC-20260323-003",
        name: "团队知识沉淀机制",
        description: "设计项目复盘和知识沉淀机制。",
        currentStage: "ACCEPT",
        progress: 100,
        pendingApproval: false,
        currentRole: "ROLE_HR",
        updatedAt: "2026-03-24T18:20:00+08:00",
        parsedIntent: previewRequirement("设计项目复盘和知识沉淀机制。"),
        summary: "项目已归档，可用于后续模板复用。"
      },
      provider
    )
  ];
}

export function createSeedProject(
  input: {
    id: string;
    name: string;
    description: string;
    parsedIntent: ParsedIntent;
    currentStage: StageType;
    progress: number;
    pendingApproval: boolean;
    currentRole: RoleType;
    updatedAt: string;
    summary: string;
  },
  provider: RuntimeMode
): ProjectDetail {
  const stages = buildStages(input.currentStage, input.pendingApproval);
  const deliverables = buildDeliverables(input.currentStage, input.id);
  const tasks = buildTasks(input.id, input.currentStage, input.pendingApproval);
  const timeline = buildTimeline(input.id, input.currentStage, input.pendingApproval);
  const liveSession = buildStageLiveSession({
    currentStage: input.currentStage,
    currentRole: input.currentRole,
    summary: input.summary,
    projectName: input.name,
    provider,
    pendingApproval: input.pendingApproval
  });

  return {
    id: input.id,
    name: input.name,
    description: input.description,
    parsedIntent: input.parsedIntent,
    team: roleOrder,
    currentStage: input.currentStage,
    currentRole: input.currentRole,
    progress: input.progress,
    updatedAt: input.updatedAt,
    status: input.progress === 100 ? "completed" : "active",
    pendingApproval: input.pendingApproval,
    summary: input.summary,
    openTaskCount: tasks.filter((task) => task.status !== "done").length,
    stages,
    tasks,
    deliverables,
    timeline,
    liveSession: {
      ...liveSession,
      startedAt: input.updatedAt
    }
  };
}

export function buildStages(currentStage: StageType, pendingApproval: boolean): Stage[] {
  const order: StageType[] = ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];
  const currentIndex = order.indexOf(currentStage);

  return order.map((stage, index) => {
    let status: Stage["status"] = "pending";

    if (index < currentIndex) {
      status = "completed";
    } else if (index === currentIndex) {
      status = currentStage === "ACCEPT" && !pendingApproval ? "completed" : "active";
    }

    return {
      type: stage,
      label: STAGE_LABELS[stage],
      assignee: stageAssignees[stage],
      status,
      progress: status === "completed" ? 100 : status === "active" ? 48 : 0,
      startedAt: new Date(baseDate.getTime() - (5 - index) * 60 * 60 * 1000).toISOString()
    };
  });
}

export function buildDeliverables(currentStage: StageType, projectId: string): Deliverable[] {
  const order = stageOrder();
  const currentStageIndex = order.indexOf(currentStage);
  const hasReached = (stage: StageType) => currentStageIndex >= order.indexOf(stage);

  const all: Deliverable[] = [
    {
      id: randomUUID(),
      name: "项目章程.md",
      type: "markdown",
      content: `# 项目章程\n\n项目 ${projectId} 已创建，正在进入正式推进阶段。`,
      version: 1,
      status: "approved",
      stageType: "INIT",
      createdBy: "ROLE_PM",
      updatedAt: baseDate.toISOString()
    }
  ];

  if (hasReached("ANALYSIS")) {
    all.push({
      id: randomUUID(),
      name: "需求分析文档.md",
      type: "markdown",
      content: "# 需求分析\n\n已识别关键约束、风险和团队配置建议。",
      version: 1,
      status: "approved",
      stageType: "ANALYSIS",
      createdBy: "ROLE_ANALYST",
      updatedAt: baseDate.toISOString()
    });
    all.push({
      id: randomUUID(),
      name: "项目排期方案.md",
      type: "markdown",
      content: "# 项目排期\n\n已形成里程碑、依赖、负责人和风险缓冲策略。",
      version: 1,
      status: currentStage === "ANALYSIS" ? "submitted" : "approved",
      stageType: "ANALYSIS",
      createdBy: "ROLE_PM",
      updatedAt: baseDate.toISOString()
    });
  }

  if (hasReached("DESIGN")) {
    all.push({
      id: randomUUID(),
      name: "产品需求文档(PRD).md",
      type: "markdown",
      content: "# 产品需求文档（PRD）\n\n基于需求分析文档，已明确用户旅程、功能范围、验收标准与非目标边界。",
      version: 1,
      status: currentStage === "ANALYSIS" ? "draft" : currentStage === "DESIGN" ? "submitted" : "approved",
      stageType: "DESIGN",
      createdBy: "ROLE_PRODUCT",
      updatedAt: baseDate.toISOString()
    });
    all.push({
      id: randomUUID(),
      name: "设计审查卡.md",
      type: "markdown",
      content:
        "# 设计审查卡\n\n- 视觉方向: 科技感 + 高可信度\n- 品牌语气: 专业、直接、可执行\n- UX 原则: 强主线、少打断、强反馈\n- 可访问性: 对比度>=4.5、键盘可达、语义结构完整\n- 审查结论: 通过",
      version: 1,
      status: currentStage === "ANALYSIS" ? "draft" : currentStage === "DESIGN" ? "submitted" : "approved",
      stageType: "DESIGN",
      createdBy: "ROLE_DESIGN",
      updatedAt: baseDate.toISOString()
    });
    all.push({
      id: randomUUID(),
      name: "视觉定稿单页.preview.html.md",
      type: "markdown",
      content: [
        "# 视觉定稿单页.preview.html.md",
        "",
        "## 视觉目标与范围",
        "- 用于业务确认设计结果，避免纯文字沟通误差。",
        "",
        "## 单页预览代码（HTML）",
        "```html",
        "<!doctype html><html><head><meta charset=\"UTF-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/><title>视觉定稿预览</title><style>body{font-family:Segoe UI,PingFang SC,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px}.card{border:1px solid #334155;border-radius:16px;padding:20px;max-width:980px;margin:0 auto;background:#111827}h1{margin:0 0 10px}p{color:#94a3b8}</style></head><body><section class=\"card\"><h1>设计阶段视觉预览</h1><p>用于确认视觉方向与主链路布局，确认后进入开发实现。</p></section></body></html>",
        "```",
        "",
        "## 验收检查清单",
        "- 包含可渲染的单页 HTML 预览代码块（```html）。",
        "- 页面具备首屏价值主张、核心能力区块与主 CTA。",
        "- 视觉规范与交互说明可支撑开发阶段实现。"
      ].join("\n"),
      version: 1,
      status: currentStage === "ANALYSIS" ? "draft" : currentStage === "DESIGN" ? "submitted" : "approved",
      stageType: "DESIGN",
      createdBy: "ROLE_DESIGN",
      updatedAt: baseDate.toISOString()
    });
  }

  if (hasReached("DEV")) {
    all.push({
      id: randomUUID(),
      name: "技术方案与选型.md",
      type: "markdown",
      content: "# 技术方案与选型\n\n明确架构边界、关键技术选型、权衡与风险缓解策略。",
      version: 1,
      status: currentStage === "DEV" ? "submitted" : "approved",
      stageType: "DEV",
      createdBy: "ROLE_DEV",
      updatedAt: baseDate.toISOString()
    });
    all.push({
      id: randomUUID(),
      name: "研发任务拆解.md",
      type: "markdown",
      content: "# 开发任务\n\n前端、后端、共享模型拆分完成。",
      version: 1,
      status:
        currentStage === "ANALYSIS" || currentStage === "DESIGN"
          ? "draft"
          : currentStage === "DEV"
            ? "submitted"
            : "approved",
      stageType: "DEV",
      createdBy: "ROLE_DEV",
      updatedAt: baseDate.toISOString()
    });
  }

  if (hasReached("ACCEPT")) {
    all.push({
      id: randomUUID(),
      name: "测试报告.md",
      type: "markdown",
      content: "# 测试报告\n\n主流程已走通，建议进入归档。",
      version: 1,
      status: "approved",
      stageType: "ACCEPT",
      createdBy: "ROLE_QA",
      updatedAt: baseDate.toISOString()
    });
    all.push({
      id: randomUUID(),
      name: "产品说明文档回填.md",
      type: "markdown",
      content: "# 回填记录\n\n已校验实施结果与需求目标一致，并完成产品说明文档回填。",
      version: 1,
      status: "approved",
      stageType: "ACCEPT",
      createdBy: "ROLE_ASSISTANT",
      updatedAt: baseDate.toISOString()
    });
  }

  return all;
}

export function buildTasks(
  projectId: string,
  currentStage: StageType,
  pendingApproval: boolean
): Task[] {
  const templates: Record<StageType, Array<{ title: string; description: string; assignee?: RoleType }>> = {
    INIT: [
      { title: "整理项目章程", description: "把原始需求整理为正式立项信息。", assignee: "ROLE_PM" },
      { title: "初始化团队分工", description: "明确当前项目的角色接力顺序。", assignee: "ROLE_PM" }
    ],
    ANALYSIS: [
      { title: "提炼目标与边界", description: "从原始需求中抽出目标、约束与风险。", assignee: "ROLE_ANALYST" },
      { title: "输出需求分析文档", description: "形成分析阶段正式交付并沉淀风险与验收口径。", assignee: "ROLE_ANALYST" },
      { title: "输出项目排期", description: "由项目经理形成里程碑、依赖关系和负责人计划。", assignee: "ROLE_PM" },
      { title: "输出产品需求文档(PRD)", description: "由产品角色基于分析文档完成用户旅程、功能清单与验收标准。", assignee: "ROLE_PRODUCT" },
      { title: "定义页面与结构", description: "固定核心页面、布局与交互顺序并给出信息架构。", assignee: "ROLE_PRODUCT" }
    ],
    DESIGN: [
      { title: "完成设计审查卡", description: "由设计角色确认视觉方向、品牌语气、可访问性与审查结论。", assignee: "ROLE_DESIGN" },
      { title: "输出视觉定稿单页", description: "生成可视化确认稿（静态图或单页 HTML），供业务确认后再开发。", assignee: "ROLE_DESIGN" }
    ],
    DEV: [
      { title: "输出技术方案与选型", description: "明确系统架构、技术选型、取舍理由和风险缓解策略。", assignee: "ROLE_ARCH" },
      { title: "打通主链路", description: "基于技术方案完成创建、审批、返工、观测四条主链路实现。", assignee: "ROLE_DEV" },
      { title: "补齐实现结果说明", description: "沉淀真实页面、接口、代码改动与验证证据。", assignee: "ROLE_DEV" },
      { title: "补全仓储与接口", description: "让任务、交付物和时间轴全部落库。", assignee: "ROLE_DEV" }
    ],
    ACCEPT: [
      { title: "执行验收检查", description: "验证关键 API 和页面交互是否可用。", assignee: "ROLE_QA" },
      { title: "回填产品说明文档", description: "核对实施结果与需求目标并完成文档回填。", assignee: "ROLE_QA" },
      { title: "整理复盘结论", description: "输出风险、改进项和复用建议。", assignee: "ROLE_PM" }
    ]
  };

  return stageOrder().flatMap((stageType, stageIndex) =>
    templates[stageType].map((template, taskIndex) => {
      const isBeforeStage = stageIndex < stageOrder().indexOf(currentStage);
      const isCurrentStage = stageType === currentStage;

      let status: Task["status"] = "todo";
      if (isBeforeStage) {
        status = "done";
      } else if (isCurrentStage) {
        status = pendingApproval ? "done" : taskIndex === 0 ? "in_progress" : "todo";
      }

      return {
        id: randomUUID(),
        projectId,
        stageType,
        title: template.title,
        description: template.description,
        assignee: template.assignee ?? stageAssignees[stageType],
        status,
        priority: isCurrentStage && taskIndex === 0 ? "high" : "normal",
        updatedAt: baseDate.toISOString()
      };
    })
  );
}

export function buildTimeline(
  projectId: string,
  currentStage: StageType,
  pendingApproval: boolean
): TimelineEvent[] {
  const items: TimelineEvent[] = [
    {
      id: randomUUID(),
      timestamp: new Date(baseDate.getTime() - 6 * 60 * 60 * 1000).toISOString(),
      agentId: "ROLE_PM",
      type: "project_created",
      title: "项目已创建",
      content: `${projectId} 已由项目经理立项并开始推进。`,
      priority: "normal"
    },
    {
      id: randomUUID(),
      timestamp: new Date(baseDate.getTime() - 5 * 60 * 60 * 1000).toISOString(),
      agentId: stageAssignees[currentStage],
      type: "stage_started",
      title: `${STAGE_LABELS[currentStage]}阶段启动`,
      content: `${ROLE_LABELS[stageAssignees[currentStage]]} 已接手当前阶段。`,
      priority: "normal"
    }
  ];

  if (pendingApproval) {
    items.unshift({
      id: randomUUID(),
      timestamp: new Date(baseDate.getTime() - 30 * 60 * 1000).toISOString(),
      agentId: "ROLE_PM",
      type: "approval_required",
      title: "等待你的阶段审批",
      content: "当前阶段交付物已提交，请决定是否进入下一阶段。",
      priority: "high"
    });
  } else {
    items.unshift({
      id: randomUUID(),
      timestamp: new Date(baseDate.getTime() - 10 * 60 * 1000).toISOString(),
      agentId: stageAssignees[currentStage],
      type: "thinking",
      title: "阶段推进中",
      content: `${ROLE_LABELS[stageAssignees[currentStage]]} 正在输出阶段内容。`,
      priority: "normal"
    });
  }

  return items;
}

export function buildStageLiveSession(input: {
  currentStage: StageType;
  currentRole: RoleType;
  summary: string;
  projectName: string;
  provider: RuntimeMode;
  pendingApproval?: boolean;
}) {
  const script: Record<StageType, string> = {
    INIT: `## 项目立项\n\n- 整理需求原文\n- 生成项目编号\n- 初始化阶段与团队配置\n- 准备进入分析阶段`,
    ANALYSIS: `## 需求分析\n\n- 提炼项目目标与核心用户场景\n- 识别隐含约束与时间风险\n- 收敛 MVP 边界，避免范围失控\n- 输出需求分析文档等待审批\n\n### 当前项目\n${input.projectName}`,
    DESIGN: `## 视觉设计\n\n- 以已确认 PRD 作为唯一输入，不允许反向补需求\n- 设计角色输出设计审查卡（含可访问性清单）\n- 交付视觉定稿单页并为开发阶段准备设计交接边界\n\n### 当前聚焦\n${input.summary}`,
    DEV: `## 开发阶段\n\n- 先输出技术方案与关键选型（架构、依赖、权衡、风险）\n- 建立前后端目录与共享类型\n- 接入数据库和持久化仓储\n- 接入 Agent 运行抽象与实时流\n- 完成主要页面与操作链路`,
    ACCEPT: `## 验收阶段\n\n- 校验创建、审批、干预、恢复主路径\n- 检查时间轴与交付物展示\n- 汇总结论并准备归档复盘`
  };

  const title = input.pendingApproval
    ? "项目经理正在等待你的阶段决策"
    : `${ROLE_LABELS[input.currentRole]}正在推进${STAGE_LABELS[input.currentStage]}阶段`;

  return {
    activeRole: input.currentRole,
    title,
    body: script[input.currentStage],
    provider: input.provider
  };
}

function stageOrder(): StageType[] {
  return ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];
}
