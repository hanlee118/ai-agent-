# 项目全流程复测与修复报告（2026-03-31）

## 目标
以“新建项目”方式对项目全链路进行逐步骤检查：
创建 -> 分析 -> 推进 -> 阶段审批 -> 最终产物 -> 验收完成。

## 复测结论
- 结论：✅ 已跑通
- 运行模式：真实模型（openai-compatible）
- 全链路状态：`completed`
- 最终阶段：`ACCEPT`
- 最终产物检查：`readyForAcceptance=true`，`missingRequired=[]`
- 官网产物接口：`200`，返回 URL：`/generated/ai-collab-official-OCC-20260331-004.html`

## 发现的问题与修复

### 问题1：推进错误态误判
- 现象：`/api/projects/:id/advance` 在并发推进场景下出现 `PROJECT_ADVANCE_FAILED`，错误内容是 `PROJECT_ADVANCE_IN_PROGRESS`。
- 根因：后台手动推进任务遇到锁竞争时，将 `PROJECT_ADVANCE_IN_PROGRESS` 误写入失败缓存（`projectAdvanceJobErrors`），下一次调用被误当作失败。
- 修复：
  1. `apps/api/src/index.ts`
     - `ensureManualAdvanceJob` 捕获到 `PROJECT_ADVANCE_IN_PROGRESS` 时不再写入失败缓存。
  2. `apps/api/src/routes/projects.ts`
     - 读取到历史错误为 `PROJECT_ADVANCE_IN_PROGRESS` 时，统一返回 in-progress，不再返回 failed。

### 问题2：轮询提示不充分，巡检脚本易误报
- 现象：真实模型模式下阶段耗时较长，脚本默认阈值过低导致“假失败”。
- 修复：
  1. `apps/api/src/routes/projects.ts`
     - `PROJECT_ADVANCE_IN_PROGRESS` 响应增加 `pollAfterMs: 2000`。
  2. `scripts/audit-project-lifecycle.mjs`
     - 默认 `MAX_ROUNDS` 从 24 调整为 180。
     - 轮询等待改为读取接口返回 `pollAfterMs`（并设置上下限 600~5000ms）。

## 关键验证结果

### 代码质量与回归
1. `pnpm --filter @occ/api build` ✅
2. `pnpm --filter @occ/api test:routes` ✅（17/17）
3. `pnpm health:check` ✅（8/8）

### 新建项目全流程审计（默认参数）
摘要：
- `ok: true`
- `totalChecks: 191`
- `totalWarnings: 7`（均为“推进中等待”提示，不是失败）
- `detail_final.project.status: completed`
- `detail_final.project.currentStage: ACCEPT`
- `final_artifacts.summary.readyForAcceptance: true`
- `official_site.status: 200`

## 变更文件
1. `apps/api/src/index.ts`
2. `apps/api/src/routes/projects.ts`
3. `scripts/audit-project-lifecycle.mjs`

## 备注
本次复测脚本会在结束时自动清理测试项目（DELETE），避免污染项目列表；生成的官网产物文件仍保留在 `public/generated` 可访问目录中。
