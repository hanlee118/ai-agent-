import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStageExecutionProtocolGate } from "./stage-protocol-gates.js";

test("init stage protocol gate blocks missing charter fields and collaboration handoff", () => {
  const result = evaluateStageExecutionProtocolGate({
    stageType: "INIT",
    liveBody: "",
    deliverables: [
      {
        name: "项目章程.md",
        status: "submitted",
        content: [
          "# 项目章程",
          "## 项目目标",
          "- 打通 Agent Team 基础流程"
        ].join("\n")
      }
    ],
    executions: [],
    requireSkillEvidence: true,
    requireCollaborationHandoff: true
  });

  assert.equal(result.passed, false);
  assert.equal(result.skillEvidenceRequired, false);
  assert.equal(result.collaborationSatisfiedBy, "missing");
  assert.equal(result.issues.some((item) => item.includes("协作交接卡")), true);
  assert.equal(result.issues.some((item) => item.includes("范围边界")), true);
  assert.equal(result.issues.some((item) => item.includes("阶段负责人")), true);
});

test("design stage protocol gate accepts metadata-backed skill and collaboration evidence", () => {
  const result = evaluateStageExecutionProtocolGate({
    stageType: "DESIGN",
    liveBody: "",
    deliverables: [
      {
        name: "实施方案说明.word.md",
        status: "submitted",
        content: [
          "## 页面结构",
          "- 首页 Hero 与能力总览",
          "## 视觉说明",
          "- 采用偏编辑器化的信息密度",
          "## 关键状态",
          "- loading / empty / error",
          "## 响应式规则",
          "- 桌面双栏，移动端单栏",
          "## 研发交付边界",
          "- 组件拆成 Hero、SignalGrid、Timeline"
        ].join("\n")
      }
    ],
    executions: [
      {
        role: "ROLE_DESIGN",
        status: "success",
        metadata: {
          terminalSkillEvidence: {
            skillsUsed: ["design-to-code", "frontend-design", "frontend-design-pro"],
            reasoningBasis: "基于当前项目目标收敛视觉方向和组件层级。",
            artifactsProduced: "已输出页面结构、视觉说明和响应式边界。",
            verification: "已完成人工审阅与预览检查。"
          },
          terminalCollaborationEvidence: {
            factsConfirmed: "已确认目标用户和核心页面范围。",
            assumptions: "默认移动端优先但保留桌面密度。",
            decisions: "采用模块化版式以便研发拆分。",
            handoff: "交给研发按模块结构实现，并保留状态页。",
            openQuestions: "品牌插画素材待补齐。"
          }
        }
      }
    ],
    requireSkillEvidence: true,
    requireCollaborationHandoff: true
  });

  assert.equal(result.passed, true);
  assert.equal(result.skillEvidenceSatisfiedBy, "metadata");
  assert.equal(result.collaborationSatisfiedBy, "metadata");
  assert.deepEqual(result.requiredSkills, ["design-to-code", "frontend-design", "frontend-design-pro"]);
});

test("init stage protocol gate accepts collaboration evidence from content when fields are present", () => {
  const result = evaluateStageExecutionProtocolGate({
    stageType: "INIT",
    liveBody: [
      "## 项目目标",
      "- 验证提交到审批链路",
      "## 范围边界",
      "- In Scope: 提交章程并审批",
      "## 角色分工与责任",
      "- 阶段负责人: ROLE_PM",
      "协作交接卡",
      "factsConfirmed: 已确认本轮验证目标与边界",
      "assumptions: 默认 API 与审批链路可访问",
      "decisions: 先完成 INIT 验证再进分析",
      "handoff: 交给分析阶段继续细化",
      "openQuestions: DESIGN 和 DEV 还需后续验证"
    ].join("\n"),
    deliverables: [],
    executions: [],
    requireSkillEvidence: true,
    requireCollaborationHandoff: true
  });

  assert.equal(result.passed, true);
  assert.equal(result.collaborationSatisfiedBy, "content");
  assert.equal(result.protocolChecks.some((item) => item.key === "collaboration" && item.passed === true), true);
});

test("init stage protocol gate accepts charter template headings", () => {
  const result = evaluateStageExecutionProtocolGate({
    stageType: "INIT",
    liveBody: [
      "## 项目背景与目标",
      "- 围绕 ProjectRoom 与 AgentCommander 主链做首轮推进验证",
      "## 范围定义（In Scope / Out of Scope）",
      "- In Scope: 项目创建、首轮推进、交付物与审批链路",
      "- Out of Scope: 新一轮 schema 重构",
      "## 角色分工与责任",
      "- 阶段负责人: ROLE_PM",
      "## 待确认项",
      "- ACCEPT 阶段真实模型证据仍需继续验证",
      "协作交接卡",
      "factsConfirmed: 已确认 INIT 产物可在首轮推进中生成",
      "assumptions: 默认当前 scripted 运行态继续用于本地主链验证",
      "decisions: 先让 INIT 轻执行产物通过当前协议，再继续推进后续阶段",
      "handoff: 交给分析阶段继续细化范围、约束与验收标准",
      "openQuestions: ANALYSIS 到 ACCEPT 的剩余真机链路还需后续回归"
    ].join("\n"),
    deliverables: [],
    executions: [],
    requireSkillEvidence: true,
    requireCollaborationHandoff: true
  });

  assert.equal(result.passed, true);
  assert.equal(result.contentChecks.some((item) => item.key === "goal" && item.passed === true), true);
  assert.equal(result.contentChecks.some((item) => item.key === "scope" && item.passed === true), true);
});

test("accept stage protocol gate requires explicit skill evidence in content for direct-model stages", () => {
  const result = evaluateStageExecutionProtocolGate({
    stageType: "ACCEPT",
    liveBody: [
      "## 测试报告",
      "- 测试范围: 登录、阶段审批、交付物回填",
      "## 验收结论",
      "- 通过",
      "## 产品说明文档回填",
      "- 已补齐回填记录与长期记忆",
      "## 复盘",
      "- 下一轮聚焦自动化治理"
    ].join("\n"),
    deliverables: [],
    executions: [
      {
        role: "ROLE_QA",
        status: "success",
        metadata: {}
      }
    ],
    requireSkillEvidence: true,
    requireCollaborationHandoff: true
  });

  assert.equal(result.passed, false);
  assert.equal(result.skillEvidenceRequired, true);
  assert.equal(result.issues.some((item) => item.includes("技能执行记录")), true);
  assert.equal(result.protocolChecks.some((item) => item.key === "skill_evidence" && item.passed === false), true);
  assert.equal(result.protocolChecks.some((item) => item.key === "collaboration" && item.passed === false), true);
  assert.equal(result.protocolChecks.some((item) => item.key === "decision" && item.passed === true), true);
});
