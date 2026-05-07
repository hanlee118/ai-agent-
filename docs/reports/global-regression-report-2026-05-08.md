# 全局回归测试报告（2026-05-08）

## 1. 执行范围
- 后端接口与权限：`verify:smoke`
- 端到端闭环：`verify:closure`
- UI 三轮稳定性回归：`verify:ui:e2e:3rounds`
- 重点能力：上传/编辑、项目创建与推进、Agent 调度、多 Agent 接入与可见性

## 2. 最终结论
- 当前回归结果：**通过**
- 关键链路状态：
  - `verify:smoke`：通过
  - `verify:closure`：通过
  - `verify:ui:e2e:3rounds`：3/3 轮通过
- 可以进入下一步发布评审，但仍建议保留一个“非 fast-mode”的夜间重回归任务。

## 3. 真实问题与修复记录

### 问题 A：UI 三轮回归脚本端口冲突，导致假失败
- 现象：`EADDRINUSE 127.0.0.1:8787`
- 根因：脚本每轮强制拉起 API，与已有进程冲突
- 修复：`scripts/verify-ui-e2e-3rounds.mjs`
  - 优先复用已运行 API
  - API 健康检查加入短窗口重试
  - 默认按 existing API 路径执行
- 结果：端口冲突类失败清零

### 问题 B：E2E 创建项目参数与后端模式约束不一致
- 现象：`workflowTemplateKey must be standard_software_development or none when projectType=complete`
- 根因：单阶段模板未同步切换 `projectType`
- 修复：`scripts/e2e/helpers/project-create.ts`
  - 增加 `inferProjectType()` 自动推断策略
- 结果：项目创建失败消失

### 问题 C：E2E 会话依赖直连 Prisma，DB 抖动导致不稳定
- 现象：`PrismaClientInitializationError / can't reach database`
- 根因：测试通过 DB 直写 session，不是用户真实登录路径
- 修复：
  - `scripts/e2e/helpers/project-create.ts` 增加 `loginAsAdminToken()`
  - 用例改为真实 `/api/auth/login` 获取 cookie
  - 登录增加重试退避
- 结果：会话建立稳定性提升

### 问题 D：模板选择用例与真实 UI 流程不一致
- 现象：找不到“视觉设计阶段”控件
- 根因：当前产品需先切到“单阶段交付”模式后才显示该模板
- 修复：
  - `scripts/e2e/ui-workflow-template.spec.ts`
  - `scripts/e2e/ui-visual-hermes-prefer.spec.ts`
  - 用例改为真实流程：先选“单阶段交付”，再选“视觉设计阶段”
- 结果：两条关键用例单测通过，三轮全量通过

### 问题 E：文案差异导致入口定位失败
- 现象：用例找“新建项目”，实际界面在项目页为“创建项目”
- 修复：用例入口定位兼容 `新建项目|创建项目`
- 结果：入口定位稳定

## 4. 回归结果摘要

### 4.1 UI 三轮回归
- 命令：`pnpm verify:ui:e2e:3rounds`
- 结果：`passed=3, failed=0`
- 报告：
  - `docs/reports/ui-e2e-selfcheck-3rounds-latest.json`

### 4.2 Smoke
- 命令：`pnpm verify:smoke`
- 结果：通过
- 验证点：公共端点、受保护接口、local monitor SSE

### 4.3 Closure
- 命令：`pnpm verify:closure`
- 结果：通过
- 核心覆盖：
  - OpenClaw agents/projects/workspace
  - 项目创建、提交、驳回、任务 patch
  - runtime config / validate / restore
  - OpenClaw agent 配置、记忆、报告

## 5. 关于“多 Agent 连接与可用性”
- 当前验证结果：已通过 `verify:closure` 中 OpenClaw 相关真实接口检查
  - `/api/openclaw/agents`
  - `/api/openclaw/projects`
  - `/api/openclaw/workspace`
- 报告显示：`openclawWorkspace = 12 projects / 14 agents`
- 结论：多 Agent 可连接、可见、可调度路径在当前环境可用

## 6. 剩余风险（非阻断）
- `verify:closure` 当前为 fast-mode，部分 live message 检查是 `warning(skipped-fast-mode)`
- 建议：在夜间或预发增加一次“full-mode（非 scripted fast path）”回归，重点检查单 agent / batch message 的实时返回稳定性

## 7. 发布建议
- 当前可进入发布评审
- 发布前建议附带：
  1. `ui-e2e-selfcheck-3rounds-latest.json`
  2. `verify:closure` 最新输出摘要
  3. 本报告
