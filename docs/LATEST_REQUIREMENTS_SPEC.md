# 最新需求文档

文档版本：Latest  
更新时间：2026-04-02

## 1. 文档目标

定义 Agent 协作平台在 2026-04-01 的**可发布需求基线**，覆盖：
- 多角色协作执行工作流
- 真实模型强门禁
- 阶段推进收敛与故障恢复
- GitLab Harness 外部任务闭环
- 健康检查与可重复验收
- 新建项目预填与需求对齐链路
- 非阻塞审批返工链路
- 本地实时入口与静态交付物预览边界

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
- 手动推进单轮默认超时需支持慢模型场景（默认 `180000ms`，可由 `MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS` 覆盖）。

验收标准：
- 出现推进风暴时返回 `pollAfterMs` 与 `recoveryAttempted`。
- 可恢复故障不直接终止流程，能自动进入恢复重试。

### FR-011 新建项目需求预填（核心）

- `/api/issues/preview` 必须基于用户输入生成结构化预览：
  - `matchedGoals`
  - `matchedPrinciples`
  - `missionAnchor`
  - `requirementContract`
- 当产品上下文中的 `goals/principles` 为空时，不得返回空白；必须基于当前需求语义自动生成初始建议。
- 返回结果必须通过前端映射到新建项目弹窗的可编辑草稿。

验收标准：
- 空产品上下文下，`matchedGoals/matchedPrinciples` 非空。
- `contextNotes` 明确标注这些建议为“基于本次需求自动生成”，避免误导为既有产品基线。

### FR-012 审批驳回即时返回（核心）

- `POST /api/projects/:id/reject` 必须优先完成状态回写，而不是同步等待模型返工说明。
- 驳回后阶段任务状态必须立即切回可返工状态：
  - `pendingApproval=false`
  - 当前阶段首任务恢复 `in_progress`
  - 其余任务按规则回退/阻塞
- 返工说明允许异步补写到 `liveSession` 和 `timeline`。

验收标准：
- `reject` 接口应快速返回 `200`。
- 驳回后用户可立即重新编辑并再次提交阶段交付物。

### FR-013 本地入口一致性（重要）

- 本地人工验收默认入口必须固定为：
  - 前端：`http://127.0.0.1:5173`
  - API：`http://127.0.0.1:8787`
- `apps/web/public/generated/*.html` 仅作为静态交付物预览，不得替代实时前端状态判断。
- 若存在 `4173/3001` 等其他本机服务，文档与验收说明必须明确其不属于当前 OCC 实时验收入口。

验收标准：
- 人工验收说明中明确区分“实时页面”和“静态交付物预览”。
- 遇到页面不一致时，以 `5173` 页面和 `8787` API 返回为准。

### FR-014 验收脚本契约一致性（重要）

- 项目流验收脚本必须兼容当前平台的：
  - 鉴权会话
  - API 端口约定
  - 阶段交付模板校验
  - `PROJECT_ADVANCE_IN_PROGRESS` 轮询契约
- 固定项目验收脚本在目标项目不存在时，必须自动创建 fallback 项目继续执行，而不是直接 404 退出。
- 自检脚本若临时切换运行时配置，必须在退出前恢复原配置，不得污染后续真实模型验收环境。
- 脚本不允许因过期端口、旧请求体或简化模板而误报平台故障。

验收标准：
- `scripts/smoke-project-flow.mjs` 可直接命中当前 API。
- `scripts/smoke-project-flow.mjs` 在连续 `PROJECT_ADVANCE_IN_PROGRESS` 场景下必须有限退出并返回可诊断错误。
- `scripts/verify-repeatable-018.mjs` 在固定项目缺失时可自动创建 fallback 项目并继续推进，且在慢路径下必须有限退出。
- `verify:closure` 的提交/驳回/重提断言与当前接口行为一致。
- `verify:closure` 执行结束后，运行时模式仍保持执行前配置。

### FR-015 前端本地托管与可达性（重要）

- 必须提供前端 dev server 的标准化 daemon 脚本，避免临时启动后自动退出导致“页面打不开”误判。
- 托管脚本必须支持：
  - stale PID 自动清理
  - 端口监听 PID 领养
  - 启动健康检查与日志提示
- 人工验收前必须同时确认 `5173`（web）和 `8787`（api）可达。

验收标准：
- `pnpm web:daemon:start` 后 `http://127.0.0.1:5173` 返回 `200`。
- `pnpm web:daemon:status` 输出可反映真实健康状态。
- `pnpm web:daemon:stop` 后前端端口不再监听。

### FR-016 设计交付物业务对齐门禁（重要）

- `DESIGN` 阶段的视觉稿不能只满足“有 HTML 预览”这一弱条件，必须与项目真实业务场景对齐。
- 若需求属于电商/商品/榜单/监控/告警/跟踪/TikTok/Amazon/Temu 等场景，视觉稿必须直接展示：
  - 业务对象本身
  - 核心数据或榜单
  - 平台来源
  - 主动作（如跟踪/查看链接/继续观察）
- 禁止把设计稿伪装成“需求输入 / 多 Agent 协作 / 执行证据回写 / 阶段验收回填”这类平台运转页面后通过 DESIGN 阶段。

验收标准：
- 视觉定稿单页若命中上述业务场景，却缺少业务信号，应在模板校验和自动质检中直接失败。
- 设计阶段 required actions 应将“缺少真实可确认视觉稿”识别为未完成，而不是仅检查 HTML 代码块存在。
- 针对跨境爆品监控类需求，视觉稿需能体现榜单、平台标签、爆量指标、商品链接与跟品动作。

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
pnpm web:daemon:status
node scripts/smoke-project-flow.mjs
pnpm verify:closure
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
- API daemon 已趋于稳定；前端入口需通过 `web:daemon:*` 统一托管，避免临时命令导致端口失活。
- 静态交付物预览与实时项目前端的入口区分还可继续增强，以降低误判成本。

## 9. 2026-04-02 实机复核快照

- `node scripts/verify-closure.mjs`：`ok=true`，总耗时约 `200s`。
- 覆盖通过：预览、创建、消息、介入、恢复、提交、驳回、重提、审批、任务更新、runtime 恢复。
- OpenClaw 单条消息调用仍可能返回 `stopReason=error`（warning），当前不阻断主闭环验收。
- `scripts/smoke-project-flow.mjs` 已加入慢路径重试上限，避免无上限轮询。
- `scripts/verify-repeatable-018.mjs` 已补齐“固定项目不存在自动创建 fallback”与“有限重试退出”。
- DESIGN 阶段已新增“业务化视觉稿”门禁：通用协作平台模板不再能冒充业务设计稿通过。
