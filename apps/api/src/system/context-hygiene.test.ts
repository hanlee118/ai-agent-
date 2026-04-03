import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyAgentMemoryEntryForCleanup,
  classifyPromptTemplateForCleanup
} from "./context-hygiene.js";

test("classifies orphan memory for cleanup", () => {
  const result = classifyAgentMemoryEntryForCleanup({
    projectExists: false,
    projectId: "missing-project",
    importance: 80,
    summary: "旧项目残留",
    content: "无效内容",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });

  assert.equal(result, "orphan_project_memory");
});

test("classifies stale template-like memory for cleanup", () => {
  const result = classifyAgentMemoryEntryForCleanup({
    projectExists: true,
    projectId: "project-1",
    importance: 10,
    summary: "官网演示模板",
    content: "沿用上一项目默认视觉",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });

  assert.equal(result, "template_like_memory");
});

test("classifies stale project-scoped template for cleanup", () => {
  const result = classifyPromptTemplateForCleanup({
    scope: "project",
    projectExists: true,
    projectId: "project-1",
    usageCount: 0,
    title: "视觉定稿单页模板",
    content: "复用旧项目风格",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });

  assert.equal(result, "stale_unused_template");
});
