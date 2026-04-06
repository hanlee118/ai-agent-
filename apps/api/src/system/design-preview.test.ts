import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRequirementAwareVisualPreviewHtml,
  evaluateVisualDesignRequirementAlignment
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
});
