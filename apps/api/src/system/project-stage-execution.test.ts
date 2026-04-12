import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTerminalStageExecutionMessage,
  getDesignStitchMode,
  getPreferredStageModels,
  getStageCompanionRoles,
  getProjectStageExecutionStrategy,
  getStageRealModelGateRoles,
  isDesignStitchEvidenceRequired,
  validateDesignStitchEvidence,
  validateTerminalSkillEvidence
} from "./project-stage-execution.js";

test("design stage uses terminal agent with strongest design models", () => {
  const prev = process.env.DESIGN_STITCH_MODE;
  delete process.env.DESIGN_STITCH_MODE;
  const strategy = getProjectStageExecutionStrategy("DESIGN", "ROLE_DESIGN");
  assert.equal(strategy.mode, "terminal_agent");
  assert.equal(strategy.openClawAgentId, "jeremy");
  assert.equal(strategy.allowDirectModelFallback, false);
  assert.deepEqual(strategy.requiredSkills, ["design-to-code", "frontend-design", "frontend-design-pro"]);
  assert.equal(strategy.skillProtocol.length >= 4, true);
  assert.equal(strategy.memoryEnabled, true);
  assert.equal(strategy.memoryPolicy, "current_project_or_high_relevance_only");
  const expectedPreferred = getPreferredStageModels("DESIGN", "ROLE_DESIGN");
  assert.equal(strategy.preferredModels[0], expectedPreferred[0]);
  assert.equal(strategy.preferredModels.includes("qwen3-max-2026-01-23"), true);
  if (typeof prev === "undefined") {
    delete process.env.DESIGN_STITCH_MODE;
  } else {
    process.env.DESIGN_STITCH_MODE = prev;
  }
});

test("design stage preferred models exclude blocked claude-opus-4-6 route", () => {
  const strategy = getProjectStageExecutionStrategy("DESIGN", "ROLE_DESIGN");
  assert.equal(
    strategy.preferredModels.some((item) => /(^|[/:])claude-opus-4-6($|[\s@])/i.test(item)),
    false
  );
});

test("analysis stage uses terminal execution for analyst with strongest analysis models", () => {
  const strategy = getProjectStageExecutionStrategy("ANALYSIS", "ROLE_ANALYST");
  assert.equal(strategy.mode, "terminal_agent");
  assert.equal(strategy.openClawAgentId, "requirements_analyst");
  assert.equal(strategy.allowDirectModelFallback, false);
  assert.deepEqual(strategy.requiredSkills, []);
  assert.equal(strategy.memoryPolicy, "current_project_or_high_relevance_only");
  const expectedPreferred = getPreferredStageModels("ANALYSIS", "ROLE_ANALYST");
  assert.equal(strategy.preferredModels[0], expectedPreferred[0]);
  assert.equal(strategy.preferredModels.includes("qwen3-max-2026-01-23"), true);
});

test("pm still stays on direct model execution during analysis stage", () => {
  const strategy = getProjectStageExecutionStrategy("ANALYSIS", "ROLE_PM");
  assert.equal(strategy.mode, "direct_model");
  assert.equal(strategy.allowDirectModelFallback, true);
  assert.equal(strategy.memoryEnabled, true);
  assert.equal(strategy.memoryPolicy, "current_project_or_high_relevance_only");
  assert.equal(strategy.reason.includes("高关联经验"), true);
});

test("analysis stage adds product companion for collaborative planning", () => {
  assert.deepEqual(getStageCompanionRoles("ANALYSIS", "ROLE_ANALYST"), ["ROLE_PRODUCT"]);
  assert.deepEqual(getStageCompanionRoles("ANALYSIS", "ROLE_PRODUCT"), ["ROLE_ANALYST"]);
  assert.deepEqual(getStageCompanionRoles("DESIGN", "ROLE_DESIGN"), ["ROLE_ANALYST", "ROLE_PRODUCT"]);
  assert.deepEqual(getStageCompanionRoles("DEV", "ROLE_DEV"), ["ROLE_ANALYST", "ROLE_ARCH"]);
  assert.deepEqual(getStageCompanionRoles("ACCEPT", "ROLE_QA"), ["ROLE_ANALYST"]);
});

test("real model gate covers analysis, design and dev critical roles", () => {
  assert.deepEqual(getStageRealModelGateRoles("INIT"), ["ROLE_ANALYST", "ROLE_PM"]);
  assert.deepEqual(getStageRealModelGateRoles("ANALYSIS"), ["ROLE_ANALYST", "ROLE_PRODUCT"]);
  assert.deepEqual(getStageRealModelGateRoles("DESIGN"), ["ROLE_ANALYST", "ROLE_DESIGN"]);
  assert.deepEqual(getStageRealModelGateRoles("DEV"), ["ROLE_ANALYST", "ROLE_DEV"]);
  assert.deepEqual(getStageRealModelGateRoles("ACCEPT"), ["ROLE_ANALYST", "ROLE_QA"]);
});

test("terminal stage message removes dangerous shell characters", () => {
  const message = buildTerminalStageExecutionMessage({
    projectName: "TrendHunter",
    projectDescription: "需要避免复用旧模板;\n请重新思考<$bad>",
    parsedIntent: {
      keywords: ["跨境", "爆品"],
      constraints: ["不能沿用旧项目&旧视觉"],
      risks: ["模板污染|幻觉"],
      suggestedTeam: ["ROLE_ANALYST", "ROLE_DESIGN"],
      summary: "重新设计"
    },
    stageType: "DESIGN",
    role: "ROLE_DESIGN",
    summary: "输出新的视觉与交互方向",
    projectWorkspacePath: "/tmp/occ-projects/trendhunter",
    stageTaskTitles: ["视觉探索", "交互定稿"],
    expectedDeliverables: ["设计审查卡.md", "视觉定稿单页.preview.html.md"]
  });

  assert.equal(message.includes("\n"), false);
  assert.equal(message.includes(";"), false);
  assert.equal(message.includes("&"), false);
  assert.equal(message.includes("|"), false);
  assert.equal(message.includes("<"), false);
  assert.equal(message.includes(">"), false);
  assert.equal(message.includes("允许参考长期记忆"), true);
  assert.equal(message.includes("高度相关"), true);
  assert.equal(message.includes("项目工作区绝对路径 /tmp/occ-projects/trendhunter"), true);
  assert.equal(message.includes("当前阶段任务 视觉探索、交互定稿"), true);
  assert.equal(message.includes("design-to-code"), true);
  assert.equal(message.includes("frontend-design"), true);
  assert.equal(message.includes("requiredSkills"), true);
  assert.equal(message.includes("如果任一 requiredSkills 缺失"), true);
  assert.equal(message.includes("skillsUsed"), true);
  assert.equal(message.includes("reasoningBasis"), true);
  assert.equal(message.includes("artifactsProduced"), true);
  assert.equal(message.includes("verification"), true);
});

test("dev terminal stage message enforces tool-driven execution", () => {
  const message = buildTerminalStageExecutionMessage({
    projectName: "TrendHunter",
    projectDescription: "实现真实后端与前端联调",
    parsedIntent: {
      keywords: ["Next.js", "Prisma"],
      constraints: ["禁止只给建议不落代码"],
      risks: ["回归风险"],
      suggestedTeam: ["ROLE_ARCH", "ROLE_DEV"],
      summary: "进入研发执行"
    },
    stageType: "DEV",
    role: "ROLE_DEV",
    summary: "完成代码实现与验证",
    projectWorkspacePath: "/tmp/occ-projects/trendhunter",
    stageTaskTitles: ["代码实现", "终端验证与回归检查"],
    expectedDeliverables: ["技术方案与选型.md", "实现结果说明.md", "运行地址与部署说明.md"]
  });

  assert.equal(message.includes("coding-agent"), true);
  assert.equal(message.includes("必须通过终端工具链完成代码修改"), true);
  assert.equal(message.includes("如果 requiredSkills 或终端工具不可用"), true);
  assert.equal(message.includes("如果项目工作区当前缺少源码或运行骨架"), true);
  assert.equal(message.includes("目标交付物 技术方案与选型.md、实现结果说明.md、运行地址与部署说明.md"), true);
});

test("skill evidence validator requires structured evidence fields and all required skills", () => {
  const valid = validateTerminalSkillEvidence(
    [
      "## 技能执行记录",
      "- skillsUsed: design-to-code, frontend-design, frontend-design-pro",
      "- reasoningBasis: 基于 design-to-code 做结构拆解，并通过 frontend-design / frontend-design-pro 完成视觉和交互收敛。",
      "- artifactsProduced: 已输出视觉方案、组件规范与最终交付稿。",
      "- verification: 已完成人工审查和终端预览校验。"
    ].join("\n"),
    ["design-to-code", "frontend-design", "frontend-design-pro"]
  );
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.missingSkills, []);
  assert.deepEqual(valid.missingFields, []);
  assert.deepEqual(valid.parsedEvidence?.skillsUsed, ["design-to-code", "frontend-design", "frontend-design-pro"]);

  const missing = validateTerminalSkillEvidence(
    [
      "## 技能执行记录",
      "- skillsUsed: design-to-code, frontend-design",
      "- reasoningBasis: 只做了部分设计探索。",
      "- verification: 仅完成了文本检查。"
    ].join("\n"),
    ["design-to-code", "frontend-design", "frontend-design-pro"]
  );
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missingSkills, ["frontend-design-pro"]);
  assert.deepEqual(missing.missingFields, ["artifactsProduced"]);
});

test("skill evidence validator rejects outputs without structured section", () => {
  const invalid = validateTerminalSkillEvidence(
    "已使用技能 design-to-code, frontend-design, frontend-design-pro，并做了验证。",
    ["design-to-code", "frontend-design", "frontend-design-pro"]
  );

  assert.equal(invalid.ok, false);
  assert.equal(invalid.hasEvidenceSection, false);
  assert.deepEqual(invalid.missingFields, [
    "skillsUsed",
    "reasoningBasis",
    "artifactsProduced",
    "verification"
  ]);
});

test("skill evidence validator still requires structured fields when no required skills are configured", () => {
  const invalid = validateTerminalSkillEvidence(
    "普通输出正文，没有结构化证据。",
    []
  );
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.missingFields, [
    "skillsUsed",
    "reasoningBasis",
    "artifactsProduced",
    "verification"
  ]);

  const valid = validateTerminalSkillEvidence(
    [
      "## 技能执行记录",
      "- skillsUsed: analysis-evidence",
      "- reasoningBasis: 基于需求原文、约束和风险做边界澄清。",
      "- artifactsProduced: 已产出需求分析结论和待确认问题列表。",
      "- verification: 已完成结构校验与人工复核。"
    ].join("\n"),
    []
  );
  assert.equal(valid.ok, true);
});

test("skill evidence validator prefers the latest structured section when fallback appends corrected evidence", () => {
  const result = validateTerminalSkillEvidence(
    [
      "## 技能执行记录",
      "skillsUsed: 1) `design-to-code`；2) `frontend-design`；3) `frontend-design-pro`",
      "reasoningBasis: 早期输出使用了带编号的技能列表。",
      "artifactsProduced: 初稿。",
      "verification: 初稿自检。",
      "",
      "## 技能执行记录",
      "skillsUsed: design-to-code、frontend-design、frontend-design-pro",
      "reasoningBasis: 已由系统补齐规范化技能记录。",
      "artifactsProduced: 设计审查卡母稿、视觉定稿母稿。",
      "verification: 协议字段与技能列表均已标准化。"
    ].join("\n"),
    ["design-to-code", "frontend-design", "frontend-design-pro"]
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.missingSkills, []);
  assert.deepEqual(result.parsedEvidence?.skillsUsed, [
    "design-to-code",
    "frontend-design",
    "frontend-design-pro"
  ]);
});

test("design stitch mode supports off/preferred/required and strategy injection", () => {
  const prev = process.env.DESIGN_STITCH_MODE;

  delete process.env.DESIGN_STITCH_MODE;
  assert.equal(getDesignStitchMode(), "off");
  assert.equal(isDesignStitchEvidenceRequired("DESIGN", "ROLE_DESIGN"), false);
  assert.deepEqual(
    getProjectStageExecutionStrategy("DESIGN", "ROLE_DESIGN").requiredSkills,
    ["design-to-code", "frontend-design", "frontend-design-pro"]
  );

  process.env.DESIGN_STITCH_MODE = "preferred";
  assert.equal(getDesignStitchMode(), "preferred");
  assert.equal(isDesignStitchEvidenceRequired("DESIGN", "ROLE_DESIGN"), false);
  assert.equal(
    getProjectStageExecutionStrategy("DESIGN", "ROLE_DESIGN").skillProtocol.some((item) => item.includes("stitch")),
    true
  );

  process.env.DESIGN_STITCH_MODE = "required";
  assert.equal(getDesignStitchMode(), "required");
  assert.equal(isDesignStitchEvidenceRequired("DESIGN", "ROLE_DESIGN"), true);
  assert.deepEqual(
    getProjectStageExecutionStrategy("DESIGN", "ROLE_DESIGN").requiredSkills,
    ["design-to-code", "frontend-design", "frontend-design-pro", "stitch"]
  );

  if (typeof prev === "undefined") {
    delete process.env.DESIGN_STITCH_MODE;
  } else {
    process.env.DESIGN_STITCH_MODE = prev;
  }
});

test("design stitch evidence validator enforces section and references in required mode", () => {
  const prev = process.env.DESIGN_STITCH_MODE;
  process.env.DESIGN_STITCH_MODE = "required";

  const missing = validateDesignStitchEvidence("普通设计说明，没有 stitch 产物。");
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ["missing_stitch_section", "missing_stitch_reference"]);

  const valid = validateDesignStitchEvidence([
    "## Stitch 设计产物",
    "- 链接: https://stitch.example.com/project/abc",
    "- 对应页面: 首页与数据看板"
  ].join("\n"));
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.missing, []);

  if (typeof prev === "undefined") {
    delete process.env.DESIGN_STITCH_MODE;
  } else {
    process.env.DESIGN_STITCH_MODE = prev;
  }
});
