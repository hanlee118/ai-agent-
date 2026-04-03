import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTerminalStageExecutionMessage,
  getStageCompanionRoles,
  getProjectStageExecutionStrategy,
  getStageRealModelGateRoles,
  validateTerminalSkillEvidence
} from "./project-stage-execution.js";

test("design stage uses terminal agent with strongest design models", () => {
  const strategy = getProjectStageExecutionStrategy("DESIGN", "ROLE_DESIGN");
  assert.equal(strategy.mode, "terminal_agent");
  assert.equal(strategy.openClawAgentId, "jeremy");
  assert.equal(strategy.allowDirectModelFallback, false);
  assert.deepEqual(strategy.requiredSkills, ["design-to-code", "frontend-design", "frontend-design-pro"]);
  assert.equal(strategy.skillProtocol.length, 3);
  assert.equal(strategy.memoryEnabled, true);
  assert.equal(strategy.memoryPolicy, "current_project_or_high_relevance_only");
  assert.equal(strategy.preferredModels[0], "anthropic/claude-opus-4-20250514");
});

test("analysis stage stays on direct model execution", () => {
  const strategy = getProjectStageExecutionStrategy("ANALYSIS", "ROLE_ANALYST");
  assert.equal(strategy.mode, "direct_model");
  assert.equal(strategy.openClawAgentId, undefined);
  assert.equal(strategy.allowDirectModelFallback, true);
  assert.deepEqual(strategy.requiredSkills, []);
  assert.equal(strategy.preferredModels[0], "openai/gpt-5.4");
});

test("analysis stage adds product companion for collaborative planning", () => {
  assert.deepEqual(getStageCompanionRoles("ANALYSIS", "ROLE_ANALYST"), ["ROLE_PRODUCT"]);
  assert.deepEqual(getStageCompanionRoles("DEV", "ROLE_ARCH"), []);
});

test("real model gate covers analysis, design and dev critical roles", () => {
  assert.deepEqual(getStageRealModelGateRoles("ANALYSIS"), ["ROLE_ANALYST", "ROLE_PRODUCT"]);
  assert.deepEqual(getStageRealModelGateRoles("DESIGN"), ["ROLE_PRODUCT", "ROLE_DESIGN"]);
  assert.deepEqual(getStageRealModelGateRoles("DEV"), ["ROLE_ARCH", "ROLE_DEV"]);
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
    summary: "输出新的视觉与交互方向"
  });

  assert.equal(message.includes("\n"), false);
  assert.equal(message.includes(";"), false);
  assert.equal(message.includes("&"), false);
  assert.equal(message.includes("|"), false);
  assert.equal(message.includes("<"), false);
  assert.equal(message.includes(">"), false);
  assert.equal(message.includes("允许参考长期记忆"), true);
  assert.equal(message.includes("高度相关"), true);
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
    summary: "完成代码实现与验证"
  });

  assert.equal(message.includes("coding-agent"), true);
  assert.equal(message.includes("必须通过终端工具链完成代码修改"), true);
  assert.equal(message.includes("如果 requiredSkills 或终端工具不可用"), true);
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
