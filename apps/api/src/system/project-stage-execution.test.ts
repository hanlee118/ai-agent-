import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTerminalStageExecutionMessage,
  getProjectStageExecutionStrategy
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
