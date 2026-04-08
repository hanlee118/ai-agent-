# QA Mainchain Hardening Report

日期：2026-04-08
范围：ProjectRoom / AgentCommander 升级后的主链 QA，重点覆盖项目创建、任务项目隔离、首轮推进可解释性与 issue-first 协作链。
关联 issue：
- #28 QA 验收总单
- #29 主链硬化执行单
- #39 INIT 首轮推进轻执行收口
- #43 INIT 轻执行产物与阶段协议 / 自动质检对齐

## 已完成修复

1. 收掉 `/api/tasks?projectId=` 与前端调用契约失配
- 后端 `/api/tasks` 已支持 `projectId/status/assignee` 过滤
- 前端 `tasksApi.list({ projectId })` 在纯项目场景下改为显式走 `/api/projects/:id/tasks`
- 复测结果：`/api/tasks?projectId=OCC-20260408-005` 返回 `count=16`、`foreign=0`

2. 收掉 OpenClaw 非 JSON 失败文本未识别问题
- `OpenClaw` 纯文本错误（如 `session file locked`、`FallbackSummaryError`）现在会被错误提取逻辑识别
- 这避免了此前被统一误判为 `OpenClaw command returned no JSON payload` 的恢复失效

3. 项目创建不再同步等待 warmup 完成
- `POST /api/projects` 已改为异步触发 warmup，不阻塞响应
- 实测创建耗时从约 `160.5s` 降到 `5.33s`，进一步收口后降到 `2.73s`

4. 关闭默认后台自动推进
- `PROJECT_AUTO_ADVANCE` 改为默认关闭，需显式开启
- 目的：避免后台自动 ticker 抢占用户第一手推进控制权，导致 `advance` 一上来就进入不可解释的 in-progress

5. 关闭默认创建后 warmup
- `PROJECT_WARMUP` 改为默认关闭，需显式开启
- 目的：避免项目刚创建就先跑一轮高成本 terminal-agent，和用户首次手动推进互相抢锁/抢资源

6. 收紧手动推进单轮超时
- `MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS` 默认值从 `180000ms` 降到 `60000ms`
- `PROJECT_ADVANCE_STALE_JOB_MS` 默认值从 `90000ms` 降到 `45000ms`
- 目的：即使推进失败，也能更快暴露状态，而不是长时间“假活跃”

## 复测结果

### 1. 项目创建
- `QA Create Speed / OCC-20260408-004`：创建耗时 `5.330892s`
- `QA Manual Flow / OCC-20260408-005`：创建耗时 `2.728629s`
- `QA Final Flow / OCC-20260408-006`：创建耗时 `7.987901s`
- `QA Init Final 4 / OCC-20260408-011`：创建耗时 `1.879076s`

结论：项目创建已从分钟级阻塞恢复到秒级，可用于演示。

### 2. 任务项目隔离
- `GET /api/projects/:id/tasks` 返回 `16`
- `GET /api/tasks?projectId=<id>` 返回 `16`
- `foreign=0`

结论：ProjectRoom / AgentCommander 的项目任务隔离主链已恢复可信。

### 3. 首轮手动推进
复测项目：`OCC-20260408-011`
- 自动推进：`enabled=false`
- 创建后立即手动调用 `POST /api/projects/:id/advance`
- 35 秒后：
  - `deliverables=[项目章程.md]`
  - `pendingApproval=true`
  - `summary=立项阶段交付物已提交，等待你的审批。`
  - `自动质检结论: 通过`
  - `tasks?projectId=<id>` 返回 `count=16`、`foreign=0`

结论：`INIT` 阶段“创建 -> 首轮推进 -> 交付出现 -> 待审批可见”主链已恢复到可演示水平。

## 当前剩余风险

### P1：后续阶段尚未做同等深度的真实主链回归
现状：
- 当前已确认 `INIT` 阶段可在 scripted 本地运行态下顺滑进入审批
- 但 `ANALYSIS / DESIGN / DEV / ACCEPT` 仍主要依赖更严格的真实模型 / terminal evidence 规则
- 本轮未继续做整条从 `INIT` 审批通过到 `ACCEPT` 完成的长链回归

影响：
- 当前版本已经足够支撑演示可信度
- 但还不能把“全阶段完全稳定”作为结论

## QA 视角的流程价值判断

### 已明显提升价值的步骤
- 先自动建 GitLab issue 再执行：有价值，减少执行漂移
- ProjectRoom / AgentCommander 共享 task 语义：有价值，减少双口径
- 项目级 task 过滤恢复：有价值，直接提升页面可信度

### 当前价值偏低或不合理的步骤
- 默认后台自动推进：价值低于成本，已收口为默认关闭
- 默认创建后 warmup：价值低于成本，已收口为默认关闭
- 在 INIT 阶段直接走重 terminal-agent 全链路：当前看价值与耗时不匹配，已被直接模型轻执行替代
- 在 INIT 轻执行已允许的前提下，自动质检仍继续按“必须真实模型”判失败：价值低且造成错误阻断，现已对齐收口

## 结论
- ProjectRoom 单事实实现：已完成并可继续作为前端主链基线
- AgentCommander 复用 ProjectRoom task/delegation 语义：已完成到可继续推进的程度
- Agent Team + Delegated Sub-Agent 混合架构：框架级与首段真实主链已落地，当前已实现“项目创建 -> 首轮推进 -> 交付物出现 -> 待审批可见”的演示级闭环
- 当前最值得继续投入的点不是再补 INIT，而是按同样 QA 标准继续验证 ANALYSIS -> ACCEPT 的长链稳定性，以及继续控制 ProjectRoom 大文件维护风险
