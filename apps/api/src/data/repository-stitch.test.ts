import test from "node:test";
import assert from "node:assert/strict";
import {
  appendStitchArtifactBlock,
  appendStitchFailureNote,
  appendStitchPendingNote
} from "./repository.js";

test("stitch pending block is appended with tracking metadata", () => {
  const body = appendStitchPendingNote("## 设计结论\n已完成主视觉方向。", {
    provider: "google-stitch-mcp",
    requestedAt: "2026-04-10T10:00:00.000Z",
    projectId: "stitch-project-123",
    prompt: "设计协作平台重构界面",
    executor: "direct",
    status: "pending"
  });

  assert.match(body, /## Stitch 设计产物/);
  assert.match(body, /stitchStatus: pending/);
  assert.match(body, /stitchProjectId: stitch-project-123/);
  assert.match(body, /stitchRetryPolicy: background-reconcile/);
});

test("stitch artifact replaces pending block instead of duplicating section", () => {
  const pendingBody = appendStitchPendingNote("## 设计结论\n已完成主视觉方向。", {
    provider: "google-stitch-mcp",
    requestedAt: "2026-04-10T10:00:00.000Z",
    projectId: "stitch-project-123",
    prompt: "设计协作平台重构界面",
    executor: "direct",
    status: "pending"
  });

  const resolvedBody = appendStitchArtifactBlock(`${pendingBody}\n\n## 后续建议\n进入前端实现。`, {
    provider: "google-stitch-mcp",
    generatedAt: "2026-04-10T10:05:00.000Z",
    projectId: "stitch-project-123",
    screenId: "screen-001",
    htmlUrl: "https://example.com/screen.html",
    imageUrl: "https://example.com/screen.png",
    prompt: "设计协作平台重构界面"
  });

  assert.equal((resolvedBody.match(/## Stitch 设计产物/g) || []).length, 1);
  assert.match(resolvedBody, /stitchScreenId: screen-001/);
  assert.doesNotMatch(resolvedBody, /stitchStatus: pending/);
  assert.match(resolvedBody, /## 后续建议/);
});

test("stitch failure note also replaces the latest stitch section", () => {
  const pendingBody = appendStitchPendingNote("## 设计结论\n已完成主视觉方向。", {
    provider: "google-stitch-mcp",
    requestedAt: "2026-04-10T10:00:00.000Z",
    projectId: "stitch-project-123",
    prompt: "设计协作平台重构界面",
    executor: "direct",
    status: "pending"
  });

  const degradedBody = appendStitchFailureNote(pendingBody, "STITCH_RECOVERY_TIMEOUT: project=stitch-project-123");

  assert.equal((degradedBody.match(/## Stitch 设计产物/g) || []).length, 1);
  assert.match(degradedBody, /stitchStatus: degraded/);
  assert.doesNotMatch(degradedBody, /stitchStatus: pending/);
});
