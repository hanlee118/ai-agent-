import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRequirementAwareVisualPreviewHtml,
  evaluateVisualDesignRequirementAlignment,
  resolveDesignRequirementProfile
} from "./design-preview.js";

describe("design preview alignment", () => {
  it("builds cross-border ecommerce preview with business-specific signals", () => {
    const html = buildRequirementAwareVisualPreviewHtml({
      projectName: "跨境爆品选品跟品机器人",
      projectDescription: "监控 TikTok 和亚马逊爆量商品，展示榜单、商品链接和跟品动作",
      keywords: ["跨境", "爆品", "TikTok", "亚马逊", "跟品"]
    });

    assert.match(html, /TikTok|Amazon/);
    assert.match(html, /爆品榜单|今日爆品榜单/);
    assert.match(html, /加入跟品|查看链接|继续观察/);
    assert.match(html, /商品链接|查看今日爆品榜/);
  });

  it("rejects generic collaboration-flow preview for ecommerce design deliverables", () => {
    const genericPreview = [
      "## 单页预览代码（HTML）",
      "```html",
      "<main><section><h1>跨境爆品平台</h1><div>需求输入</div><div>多 Agent 协作</div><div>执行证据回写</div><div>阶段验收与回填</div></section></main>",
      "```"
    ].join("\n");

    const result = evaluateVisualDesignRequirementAlignment({
      projectName: "跨境爆品选品跟品机器人",
      projectDescription: "监控 TikTok 和亚马逊爆量商品，展示榜单、商品链接和跟品动作",
      keywords: ["跨境", "爆品", "TikTok", "亚马逊", "跟品"],
      content: genericPreview
    });

    assert.equal(result.pass, false);
    assert.ok(result.issues.some((item) => item.includes("业务")));
  });

  it("recognizes collaboration-platform redesign requirements", () => {
    const profile = resolveDesignRequirementProfile({
      projectName: "协作平台 UI 重构",
      projectDescription: "重构项目房间、任务流转、agent 名册、验收报告和 quality gate",
      keywords: ["协作平台", "任务流转", "项目房间", "agent", "quality gate"]
    });

    assert.equal(profile.scenarioId, "collaboration_platform");
    assert.match(profile.visualDirection, /项目|任务|质量门禁|agent/i);
  });

  it("recognizes collaboration platform intent from workflow-oriented business wording", () => {
    const profile = resolveDesignRequirementProfile({
      projectName: "smoke-1776928418443",
      projectDescription: "请做一个AI协作平台官网，突出需求到研发闭环、角色协作、实时监控，并提供预约演示入口",
      keywords: ["协作", "研发"]
    });

    assert.equal(profile.scenarioId, "collaboration_platform");
  });

  it("keeps collaboration-platform profile even when description contains noisy fan-site leftovers", () => {
    const profile = resolveDesignRequirementProfile({
      projectName: "smoke-1776928418443",
      projectDescription:
        "请做一个AI协作平台官网，突出需求到研发闭环、角色协作、实时监控，并提供预约演示入口。附注：历史讨论里出现过动漫介绍网站等噪声文本。",
      keywords: ["协作", "研发"]
    });

    assert.equal(profile.scenarioId, "collaboration_platform");
  });

  it("builds collaboration-platform preview with project and quality signals", () => {
    const html = buildRequirementAwareVisualPreviewHtml({
      projectName: "协作平台 UI 重构",
      projectDescription: "提升项目推进透明度，展示 agent 执行证据、任务流转与质量门禁",
      keywords: ["协作平台", "项目房间", "任务流转", "验收报告", "quality gate"]
    });

    assert.match(html, /任务流转|项目房间|Quality Gate/);
    assert.match(html, /Jeremy|Kuhn|Feynman/);
    assert.match(html, /Agent: Jeremy|执行证据|模型/);
  });

  it("requires collaboration-platform signals for collaboration-platform preview alignment", () => {
    const result = evaluateVisualDesignRequirementAlignment({
      projectName: "协作平台 UI 重构",
      projectDescription: "展示项目状态、Agent 证据和验收门禁",
      keywords: ["协作平台", "任务流转", "agent", "质量门禁"],
      content: [
        "## 单页预览代码（HTML）",
        "```html",
        "<main><section><h1>协作平台 UI 重构</h1><div>项目房间</div><div>任务流转</div><div>Agent 执行证据</div><div>Quality Gate</div><button>批准放行</button></section></main>",
        "```"
      ].join("\n")
    });

    assert.equal(result.pass, true);
    assert.equal(result.issues.length, 0);
  });

  it("keeps generic fan-site requirements out of cross-border mode even when constraints mention ecommerce as out-of-scope", () => {
    const profile = resolveDesignRequirementProfile({
      projectName: "蜡笔小新粉丝介绍网站",
      projectDescription:
        "打造角色介绍与作品世界观展示站点，首期不纳入登录、评论、社区互动和电商能力。",
      keywords: ["粉丝站", "展示官网", "角色介绍", "世界观"]
    });

    assert.equal(profile.scenarioId, "generic_business_ui");
  });

  it("rejects collaboration template output when project is a fan-site", () => {
    const result = evaluateVisualDesignRequirementAlignment({
      projectName: "蜡笔小新粉丝介绍网站",
      projectDescription: "围绕角色、世界观和经典剧情做沉浸式介绍站点",
      keywords: ["蜡笔小新", "角色介绍", "世界观"],
      content: [
        "## 单页预览代码（HTML）",
        "```html",
        "<main><h1>项目协作平台视觉定稿</h1><button>立即进入执行看板</button><div>创建项目并选择阶段模板</div></main>",
        "```"
      ].join("\n")
    });

    assert.equal(result.pass, false);
    assert.ok(result.issues.some((item) => item.includes("模板")));
  });
});
