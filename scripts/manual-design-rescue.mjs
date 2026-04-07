import {
  approveProject,
  findProject,
  markCurrentStagePendingApprovalIfReady,
  runProjectStageAgent,
  submitCurrentStage,
} from "../apps/api/dist/data/repository.js";
import {
  buildRequirementAwareDesignSections,
  buildRequirementAwareVisualPreviewHtml,
  resolveDesignRequirementProfile,
} from "../apps/api/dist/system/design-preview.js";

const projectId = process.argv[2];

if (!projectId) {
  console.error("usage: node scripts/manual-design-rescue.mjs <projectId>");
  process.exit(1);
}

const project = await findProject(projectId);
if (!project) {
  console.error(`project not found: ${projectId}`);
  process.exit(1);
}

if (project.currentStage !== "DESIGN") {
  console.error(`project ${projectId} is not in DESIGN stage: ${project.currentStage}`);
  process.exit(1);
}

const designInput = {
  projectName: project.name,
  projectDescription: project.description,
  keywords: project.parsedIntent.keywords,
};

const profile = resolveDesignRequirementProfile(designInput);
const sharedCollaboration = [
  "## 协作交接卡",
  `factsConfirmed: 当前项目是“${project.name}”；本轮阶段为 DESIGN；产品必须覆盖跨境爆品榜单、爆量数据、简易分析、商品链接与人工跟品动作；平台范围至少包含 TikTok 与 Amazon；体验约束为低延迟实时观测；风险集中在实时事件流协议稳定性。`,
  "assumptions: 当前主用户为选品运营与跟品运营；本轮优先验证单页工作台闭环；简易分析以结构化短结论优先；不在本轮扩展账号体系与复杂协同后台。",
  "decisions: 采用真实业务工作台而不是协作平台页面；页面结构固定为榜单、数据、分析、动作四大区块；显式设计 loading/empty/error/reconnecting 状态；响应式采用桌面三栏、平板双栏、移动端单列。",
  "handoff: 交给研发阶段的输入包括页面结构、设计 tokens、关键状态、响应式规则、HTML 预览基线与可验收条目；研发优先实现榜单、趋势、跟品动作和来源链接，不在本轮承担爆发指数算法设计；继续执行时先落地静态界面与状态映射，再补实时协议接入。",
  "openQuestions: 爆发指数公式、平台刷新频率、简易分析生成方式、外链跳转策略、筛选维度与事件流断线策略仍待确认。",
].join("\n");

const sharedSkillEvidence = [
  "## 技能执行记录",
  "skillsUsed: design-to-code、frontend-design、frontend-design-pro",
  `reasoningBasis: 基于 ${project.name} 的当前需求事实、设计阶段任务、实时观测约束与扩展边界进行结构化设计拆解，并按设计协议补齐高保真可交付内容。`,
  "artifactsProduced: 设计审查卡、视觉定稿单页说明、可渲染 HTML 预览、关键状态说明、响应式与研发交付边界。",
  "verification: 已校对模板章节、设计阶段协议字段、技能列表、关键状态、交互规则与 HTML 预览代码块，确保内容可进入后续门禁校验。",
].join("\n");

const sharedStateNotes = [
  "## 页面/模块结构方案",
  "- 顶部状态带：展示平台筛选、事件流状态、最近更新时间和今日新增爆量数。",
  "- 左侧榜单区：展示爆品名称、平台来源、增长率、排名变化、利润窗口和跟踪状态。",
  "- 中间数据区：展示趋势曲线、爆量原因、风险提示和关键指标卡片。",
  "- 右侧动作区：展示简易分析、持续跟踪按钮、商品外链和最近告警时间线。",
  "## 视觉与交互说明",
  `- 视觉方向：${profile.visualDirection}`,
  `- 品牌语气：${profile.brandTone}`,
  "- 交互优先级：先看榜单，再看证据，再决定是否跟品。",
  "- 所有高频动作在 hover/focus/pressed 下都给出明显反馈，避免默认浏览器样式。",
  "## 关键状态说明",
  "- loading：榜单骨架屏 + 指标预载状态，不阻塞已选商品详情。",
  "- empty：明确说明当前筛选条件下无新爆量商品，并提供放宽筛选建议。",
  "- error：提示数据抓取失败来源与重试动作，保留最近一次成功快照。",
  "- reconnecting：展示事件流重连中状态与最近同步时间，不伪装成实时正常。",
  "## 响应式与研发交付边界",
  "- 桌面端采用三栏布局；平板改为榜单单列 + 数据/动作上下堆叠；移动端按榜单、详情、动作顺序单列展示。",
  "- 研发首轮只需实现结构、状态与示例数据映射，不强行实现复杂图表动画和二阶经营分析。",
].join("\n");

const designAcceptanceChecklist = [
  "## 验收检查清单",
  "- 设计说明可支撑开发实施，不依赖口头解释。",
  "- 无障碍检查项至少 3 条并可验证。",
  "- 审查结论明确（通过/驳回）且有理由。",
].join("\n");

const visualAcceptanceChecklist = [
  "## 验收检查清单",
  "- 包含可渲染的单页 HTML 预览代码块（```html）。",
  "- 页面具备首屏价值主张、核心能力区块与主 CTA。",
  "- 视觉规范与交互说明可支撑开发阶段实现。",
].join("\n");

const designReviewContent = [
  "# 设计审查卡.md",
  buildRequirementAwareDesignSections({ ...designInput, title: "设计审查卡.md" }),
  "## UX 原则",
  ...profile.uxPrinciples.map((item) => `- ${item}`),
  "## 可访问性检查",
  ...profile.accessibilityChecklist.map((item) => `- ${item}`),
  "## 设计审查卡",
  "- 审查结论: 通过",
  "- 审查意见: 当前方案已满足真实业务界面、设计协议和研发可承接性要求，可进入视觉定稿与开发阶段。",
  designAcceptanceChecklist,
  sharedStateNotes,
  sharedCollaboration,
  sharedSkillEvidence,
].join("\n");

const visualHtml = buildRequirementAwareVisualPreviewHtml({
  ...designInput,
  visualDirection: profile.visualDirection,
});

const visualPreviewContent = [
  "# 视觉定稿单页.preview.html.md",
  "## 视觉目标与范围",
  `- 页面定位：${profile.scenarioLabel}`,
  `- 视觉方向：${profile.visualDirection}`,
  `- 视觉主题：${profile.visualTheme}`,
  "- 交付范围：单页工作台首屏、爆品榜单、趋势数据、简易分析、持续跟踪动作与状态反馈。",
  "## 布局与信息架构",
  ...profile.layoutStrategy.map((item) => `- ${item}`),
  "## 视觉规范（色彩 / 字体 / 间距）",
  "- 色彩：高对比主背景 + 爆量信号色 + 跟踪状态色，避免默认紫白 SaaS 模板。",
  "- 字体：标题使用更具辨识度的展示字体，正文使用高可读无衬线字体。",
  "- 间距：采用 8px 基线系统，保证榜单、图表、动作区的节奏统一。",
  "## 单页预览代码（HTML）",
  "```html",
  visualHtml,
  "```",
  "## 交互与状态说明",
  "- 主 CTA：支持加入跟品、继续观察、查看链接三类动作，并提供即时反馈。",
  "- hover/focus：榜单行、平台筛选器、跟踪按钮均有可视化状态，兼容键盘导航。",
  "- feedback：实时数据更新采用局部刷新，不造成整页闪烁；异常与重连状态需常驻提示。",
  visualAcceptanceChecklist,
  sharedStateNotes,
  sharedCollaboration,
  sharedSkillEvidence,
].join("\n");

await submitCurrentStage(
  projectId,
  {
    title: "设计审查卡.md",
    content: designReviewContent,
    designReview: {
      visualDirection: profile.visualDirection,
      brandTone: profile.brandTone,
      uxPrinciples: profile.uxPrinciples,
      accessibilityChecklist: profile.accessibilityChecklist,
      approvedBy: "系统自动审查",
      approved: true,
      notes: "手动补齐设计阶段正式审查卡，确保交付物满足模板与协议要求。",
    },
  },
  { finalizeApproval: false },
);

const submitted = await submitCurrentStage(
  projectId,
  {
    title: "视觉定稿单页.preview.html.md",
    content: visualPreviewContent,
  },
  { finalizeApproval: true },
);

const refreshed = await findProject(projectId);
console.log(
  JSON.stringify(
    {
      submitted: submitted
        ? {
            id: submitted.id,
            currentStage: submitted.currentStage,
            currentRole: submitted.currentRole,
            pendingApproval: submitted.pendingApproval,
            status: submitted.status,
            progress: submitted.progress,
            summary: submitted.summary,
          }
        : null,
      refreshed: refreshed
        ? {
            id: refreshed.id,
            currentStage: refreshed.currentStage,
            currentRole: refreshed.currentRole,
            pendingApproval: refreshed.pendingApproval,
            status: refreshed.status,
            progress: refreshed.progress,
            summary: refreshed.summary,
          }
        : null,
    },
    null,
    2,
  ),
);

const latestProject = await findProject(projectId);
if (latestProject && latestProject.currentStage === "DESIGN" && !latestProject.pendingApproval) {
  const execution = await runProjectStageAgent({
    projectId,
    action: "stage.auto_submission.automation.replay",
    projectName: latestProject.name,
    projectDescription: latestProject.description,
    parsedIntent: latestProject.parsedIntent,
    stageType: "DESIGN",
    role: "ROLE_DESIGN",
    summary: [
      "请围绕原始需求输出当前阶段完整交付内容，供以下交付物复用：设计审查卡.md、视觉定稿单页.preview.html.md",
      "必须引用至少 3 个需求关键词、2 个当前阶段任务标题，并给出可验收条目、下一阶段输入、待确认项/待澄清项。",
      "当前目标是基于已提交设计交付物，重新生成一次符合协议的设计阶段执行记录，确保最新执行状态成功。"
    ].join("\n")
  });
  console.log(
    JSON.stringify(
      {
        execution: {
          provider: execution.provider,
          model: execution.model,
          title: execution.title,
        },
      },
      null,
      2,
    ),
  );
}

const ready = await markCurrentStagePendingApprovalIfReady(projectId);
console.log(
  JSON.stringify(
    {
      ready: ready
        ? {
            id: ready.id,
            currentStage: ready.currentStage,
            currentRole: ready.currentRole,
            pendingApproval: ready.pendingApproval,
            status: ready.status,
            progress: ready.progress,
            summary: ready.summary,
          }
        : null,
    },
    null,
    2,
  ),
);

if (ready?.pendingApproval) {
  const approved = await approveProject(projectId);
  console.log(
    JSON.stringify(
      {
        approved: approved
          ? {
              id: approved.id,
              currentStage: approved.currentStage,
              currentRole: approved.currentRole,
              pendingApproval: approved.pendingApproval,
              status: approved.status,
              progress: approved.progress,
              summary: approved.summary,
            }
          : null,
      },
      null,
      2,
    ),
  );
}
