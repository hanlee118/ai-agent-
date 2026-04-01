# 最新需求文档

文档版本：Latest  
更新时间：2026-04-01

## 1. 文档目标

定义 Agent 协作平台在 2026-04-01 的**可发布需求基线**，覆盖：
- 多角色协作执行工作流
- 真实模型强门禁
- 阶段推进收敛与故障恢复
- GitLab Harness 外部任务闭环
- 健康检查与可重复验收

## 2. 产品目标

- 把“能跑流程”升级为“可收敛、可恢复、可验收”的协作系统。
- 保证关键阶段（DESIGN/DEV/ACCEPT）必须来自真实模型链路，禁止 scripted/degraded 假通过。
- 让项目推进、审查、外部工单同步和验收报告形成一体化闭环。

## 3. 版本范围（2026-04-01）

### 3.1 本版本必须覆盖

- 项目生命周期：`INIT -> ANALYSIS -> DESIGN -> DEV -> ACCEPT`
- 阶段推进：手动 `/advance` + 自动 ticker 双路径
- 阶段审批：`approve/reject/intervene/resume`
- 真实模型门禁：`ENFORCE_REAL_MODEL_GATE=true` 时严格拦截
- 角色级门禁：`ROLE_PM/ROLE_DESIGN/ROLE_ARCH/ROLE_DEV/ROLE_QA`
- GitLab Harness：Issue 同步、Webhook 回写、完成自动关单
- 一键体检：`pnpm health:check`
- 可重复验收：`pnpm verify:repeatable:018`

### 3.2 本版本不强制

- 多租户组织管理
- 企业级 SSO / RBAC 细粒度权限
- 云原生分布式调度
- 财务结算与成本中心

## 4. 核心对象

### 4.1 Project

必须包含：
- 项目基本信息（ID/名称/描述/状态/阶段/进度）
- 审批状态（`pendingApproval`）
- 阶段交付物、执行证据、最终产物状态
- requiredActions / recoveryPlan（可执行修复链）

### 4.2 StageExecution（新增关键对象）

必须记录：
- `role`
- `provider`
- `model`
- `status`
- `metadata.degraded`
- `attempts`（多模型尝试轨迹）

用于支持真实模型门禁、角色白名单命中和审计追踪。

### 4.3 GitLab Harness Sync

必须包含：
- `OCC_PROJECT_ID` 与 `OCC_TASK_ID` 机器标记
- 项目级 / 阶段级 / 任务级标签
- GitLab issue iid 与状态映射

## 5. 功能需求

### FR-001 认证与会话

- 必须支持管理员初始化、登录、受保护路由鉴权。

验收标准：
- 未登录访问受保护接口返回 `401`。
- 登录后可正常执行项目推进与系统配置接口。

### FR-010 项目推进收敛（核心）

- `/api/projects/:id/advance` 必须支持 in-progress 轮询提示。
- 必须具备风暴检测与软恢复机制，避免无限 `PROJECT_ADVANCE_IN_PROGRESS`。
- 必须支持可恢复错误自动重试（超时/网络抖动/模板校验失败等）。

验收标准：
- 出现推进风暴时返回 `pollAfterMs` 与 `recoveryAttempted`。
- 可恢复故障不直接终止流程，能自动进入恢复重试。

### FR-020 真实模型强门禁（核心）

- 当 `ENFORCE_REAL_MODEL_GATE=true`：
  - 必须为 `openai-compatible` 且 runtime 配置完整。
  - 当前阶段必须有可验证成功执行证据。
  - 禁止 scripted provider 通过。
  - 禁止 degraded 输出通过。

验收标准：
- 门禁失败时返回 `REAL_MODEL_GATE_FAILED`。
- 返回的失败原因可解释、可定位、可修复。

### FR-030 角色门禁与模型白名单（核心）

- `ROLE_PM` 必须满足最小成功执行次数门禁。
- `ROLE_DESIGN/ROLE_ARCH/ROLE_DEV/ROLE_QA` 必须满足：
  - 最小成功次数
  - 模型白名单命中

验收标准：
- 任一角色证据不足或白名单未命中时，阶段验收必须失败并给出具体角色/次数/模型信息。

### FR-040 门禁失败修复动作链

- `REAL_MODEL_GATE_FAILED` 不得只返回单一步骤。
- 必须返回有序 `recoveryPlan`（如 refresh_runtime、补交付、重建、设计审查、处理阻塞、重新验收）。
- 必须保持 `requiredActions` 向后兼容。

验收标准：
- 前端能直接按步骤执行修复动作并回到验收流程。

### FR-050 GitLab Harness 外部闭环

- DEV/ACCEPT 阶段必须支持同步任务到 GitLab Issue。
- 支持通过 webhook 回写 issue 状态到 OCC task。
- 项目完成/关闭时支持 `closeOnComplete` 自动关单。

验收标准：
- 可追踪项目与任务标记。
- issue 状态变化可回写任务状态。

### FR-060 健康检查与一键修复指引

- `pnpm health:check` 必须输出：
  - DB/表结构/关键路由检查
  - runtime 真实模型自检
  - 一键修复步骤（command + expected）
  - latest 报告快照

验收标准：
- 输出 `docs/reports/system-health-check-latest.json`。
- 报告中含 `runtimeRepair.realModelSelfCheck` 与 `repairGuide`。

### FR-070 可重复验收脚本

- 提供固定项目路径验收脚本（OCC-20260401-018）
- 支持自动处理 requiredActions 与暂时性传输失败。

验收标准：
- `pnpm verify:repeatable:018` 可输出 `ok=true` 报告。

## 6. 非功能需求

### NFR-001 稳定性

- `pnpm --filter @occ/api typecheck` 通过
- `pnpm --filter @occ/api test:routes` 通过
- `pnpm test:smoke` 通过

### NFR-002 可观测性

- 必须输出结构化报告到 `docs/reports/`
- 关键推进与同步失败必须可追踪

### NFR-003 可治理性

- 模型配置、门禁开关、角色最小成功次数、白名单必须可配置

### NFR-004 可恢复性

- 对超时/网络故障/门禁失败应优先提供恢复路径而非直接中断

## 7. 验收基线

建议验收命令顺序：

```bash
pnpm --filter @occ/api typecheck
pnpm --filter @occ/api test:routes
pnpm test:smoke
pnpm health:check
pnpm verify:repeatable:018
```

真实模型全绿验收（启用门禁）前提：
- `MODEL_PROVIDER=openai-compatible`
- `MODEL_API_BASE_URL` 已配置
- `MODEL_API_KEY` 已配置
- `MODEL_NAME` 已配置
- `ENFORCE_REAL_MODEL_GATE=true`

## 8. 当前风险与后续需求

- 若外部模型路由不稳定，仍可能出现阶段推进延迟；需持续优化 route prewarm 与 cooldown 策略。
- 真实模型门禁已收敛为单点前置条件：运行时配置未完成时，Round2 会按预期阻断。
