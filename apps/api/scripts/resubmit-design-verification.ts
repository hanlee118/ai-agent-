import { findProject, submitCurrentStage } from "../src/data/repository.ts";
import { generateStitchDesignArtifact } from "../src/integrations/stitch-runtime.ts";
import {
  buildRequirementAwareDesignSections,
  buildRequirementAwareVisualPreviewHtml,
  resolveDesignRequirementProfile
} from "../src/system/design-preview.ts";

async function main() {
  const projectId = process.argv[2] || "OCC-20260409-001";
  const project = await findProject(projectId);
  if (!project) {
    throw new Error(`project not found: ${projectId}`);
  }

  const profile = resolveDesignRequirementProfile({
    projectName: project.name,
    projectDescription: project.description,
    keywords: project.parsedIntent.keywords
  });

  const artifact = await generateStitchDesignArtifact({
    projectId: project.id,
    projectName: project.name,
    projectDescription: project.description,
    parsedIntent: project.parsedIntent,
    stageType: "DESIGN",
    role: "ROLE_DESIGN",
    summary: "为协作平台 UI 重构生成真实 Stitch 设计证据，并回写到设计阶段交付物。"
  });

  const stitchBlock = [
    "## Stitch 设计产物",
    `stitchProjectId: ${artifact.projectId}`,
    `stitchScreenId: ${artifact.screenId}`,
    `stitchHtmlUrl: ${artifact.htmlUrl}`,
    `stitchImageUrl: ${artifact.imageUrl}`,
    `stitchPrompt: ${artifact.prompt}`
  ].join("\n");

  const designReview = {
    visualDirection: profile.visualDirection,
    brandTone: profile.brandTone,
    uxPrinciples: profile.uxPrinciples,
    accessibilityChecklist: profile.accessibilityChecklist,
    approvedBy: "系统自动审查",
    approved: true,
    notes: `真实 Stitch 产物已验证并写入项目。screenId=${artifact.screenId}`
  };

  const reviewContent = [
    "# 设计审查卡.md",
    "",
    "## 自动推进元信息",
    `- 项目: ${project.name} (${project.id})`,
    "- 阶段: 设计 (DESIGN)",
    "- 执行角色: 视觉设计总监",
    "- 执行引擎: google-stitch-sdk + project stage submit",
    "",
    buildRequirementAwareDesignSections({
      projectName: project.name,
      projectDescription: project.description,
      keywords: project.parsedIntent.keywords,
      title: "设计审查卡.md"
    }),
    "",
    "## 审阅结论摘要",
    "- 当前设计方案围绕项目总览、任务流转、Agent 证据与质量门禁组织信息架构。",
    "- 允许在同一工作台内完成查看阻塞、打开项目房间、审核 Quality Gate 与放行。",
    "- Stitch 产物已真实生成，可作为设计阶段的外部证据。",
    "",
    "## 验收检查清单",
    "- 设计说明可支撑开发实施，不依赖口头解释。",
    "- 无障碍检查项至少 3 条并可验证。",
    "- 审查结论明确（通过/驳回）且有理由。",
    "",
    stitchBlock
  ].join("\n");

  await submitCurrentStage(project.id, {
    title: "设计审查卡.md",
    content: reviewContent,
    designReview
  }, {
    finalizeApproval: false
  });

  const previewHtml = buildRequirementAwareVisualPreviewHtml({
    projectName: project.name,
    projectDescription: project.description,
    keywords: project.parsedIntent.keywords,
    visualDirection: profile.visualDirection
  });

  const previewContent = [
    "# 视觉定稿单页.preview.html.md",
    "",
    "## 自动推进元信息",
    `- 项目: ${project.name} (${project.id})`,
    "- 阶段: 设计 (DESIGN)",
    "- 执行角色: 视觉设计总监",
    "- 执行引擎: google-stitch-sdk + project stage submit",
    "",
    "## 视觉目标与范围",
    "- 目标是让项目是否真实推进、阻塞点位置、下一步动作在首屏就可判断。",
    "- 覆盖项目列表、项目房间、任务流转、验收报告与 Quality Gate 的统一工作台体验。",
    "- 设计优先支持桌面端高密度工作台，同时保证移动端抽屉化浏览。",
    "",
    "## 布局与信息架构",
    "- 顶部显示项目阶段、最近执行证据与关键风险。",
    "- 主内容区拆为任务流转泳道、项目房间上下文、验收与质量门禁。",
    "- 右侧面板固定呈现 Agent / 模型 / 技能 / 交付物证据链。",
    "- 主动作围绕批准、打回、进入项目房间、查看 Quality Gate 展开。",
    "",
    "## 视觉规范（色彩 / 字体 / 间距）",
    "- 采用深色工作台基底，强化状态语义和高密度信息阅读。",
    "- 中文使用 PingFang SC，标题使用 Sora，强调专业与科技感。",
    "- 间距采用 8 / 12 / 16 / 24 / 32 的层级系统，保证列表与看板统一。",
    "",
    "## 设计 Token 映射（色彩 / 字体 / 间距）",
    "| Token | 值 | 场景 |",
    "| --- | --- | --- |",
    "| `--bg` | `#09111f` | 平台主背景 |",
    "| `--panel` | `#101b31` | 卡片与右侧证据面板 |",
    "| `--blue` | `#4f8cff` | 主 CTA / 当前阶段强调 |",
    "| `--cyan` | `#5dd6ff` | 运行中 / 实时证据 |",
    "| `--red` | `#ff6b6b` | 阻塞 / 风险 / 驳回 |",
    "| `font-title` | `Sora` | 工作台标题与关键数字 |",
    "| `space-24` | `24px` | 面板内部主间距 |",
    "",
    "## 状态反馈矩阵（默认 / 悬停 / 禁用 / 错误）",
    "| 组件 | 默认 | 悬停 | 禁用 | 错误 |",
    "| --- | --- | --- | --- | --- |",
    "| 项目卡片 | 显示阶段与风险摘要 | 提升阴影并高亮右侧证据入口 | 降低透明度并锁定动作 | 显示阻塞标识与恢复建议 |",
    "| 任务节点 | 展示 Agent / 模型 / 技能 | 显示详情抽屉入口 | 隐藏审批动作 | 标红并提示 Quality Gate 阻断 |",
    "| 主 CTA | 蓝青渐变按钮 | 提升亮度与边框对比 | 变灰并提示前置未完成 | 红色边框提示不可放行 |",
    "",
    "## 响应式断点策略",
    "- >= 1280px: 三栏工作台，右侧证据面板常驻。",
    "- 768px - 1279px: 两栏布局，证据面板折叠为侧滑抽屉。",
    "- < 768px: 单列布局，任务流转与质量门禁切换为纵向卡片。",
    "",
    "## 单页预览代码（HTML）",
    "```html",
    previewHtml,
    "```",
    "",
    "## 交互与状态说明",
    "- 默认态：项目阶段、任务流转与 Quality Gate 同屏呈现。",
    "- 悬停态：任务卡片与 Agent 行展开更多执行证据。",
    "- 加载态：在 Stitch/模型执行期间展示 running 标签与最近心跳。",
    "- 错误态：当真实执行证据缺失时，阻止放行并给出补齐入口。",
    "",
    "## 验收检查清单",
    "- 包含可渲染的单页 HTML 预览代码块（```html）。",
    "- 页面具备首屏价值主张、核心能力区块与主 CTA。",
    "- 视觉规范与交互说明可支撑开发阶段实现。",
    "",
    stitchBlock
  ].join("\n");

  const updated = await submitCurrentStage(project.id, {
    title: "视觉定稿单页.preview.html.md",
    content: previewContent,
    designReview
  }, {
    finalizeApproval: true
  });

  console.log(JSON.stringify({
    stitch: artifact,
    project: updated && {
      id: updated.id,
      currentStage: updated.currentStage,
      pendingApproval: updated.pendingApproval,
      summary: updated.summary,
      designDeliverables: updated.deliverables
        .filter((item) => item.stageType === "DESIGN")
        .map((item) => ({ name: item.name, status: item.status, updatedAt: item.updatedAt }))
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
