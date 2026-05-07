# Agent 协作平台未实现/未完全实现模块排查与升级计划

> 排查时间：2026-05-07  
> 排查范围：`apps/api`、`apps/web`、`packages/shared`、`docs`、`scripts`、当前 `8787` 未登录运行态  
> 结论口径：本文只列当前代码与文档可核查的缺口；测试 mock、输入框 placeholder、正常 fallback 机制不直接等同于未实现。

## 1. 总体判断

当前平台不是“模块大量未实现”的状态，主线能力已经具备真实代码闭环：认证、项目推进、Project Room、Agent 管理、OpenClaw 集成、模型运行时、知识库、workflow-v2、系统治理都有实现。

当前主要问题集中在“有框架但产品化不完整”：

- 部分外部集成已有代码，但需要登录态和真实环境验证后才能算可运营。
- 部分前端页面仍存在只刷新/提示、不真正执行后端动作的按钮。
- 部分运维数据仍是派生估算或弱维度展示，不适合直接作为生产运营判断。
- V1 项目流与 workflow-v2 并存，尚未统一主链路。

## 2. 仍存在未完全实现的模块

### P0：真实运行可信度与验收闭环

#### 2.1 外部集成缺少统一的登录态实测报告

当前状态：

- OpenClaw、Hermes MCP、GitLab Harness、Stitch 都有真实集成代码。
- 本轮未完成登录态下的逐项接口实测。
- `8787` 未登录访问 `/api/system/health` 和 `/api/projects` 返回 `authentication required`，说明需要管理员会话才能继续验证。

风险：

- 容易把“代码已接入”误判为“当前环境已跑通”。
- 发布、汇报或交接时会留下可信度缺口。

升级建议：

- 建立 `integration-readiness` 实测脚本或文档，逐项输出 OpenClaw/Hermes/GitLab/Stitch 的连接状态、关键接口、失败原因和修复建议。
- 健康检查报告中区分 `code_available`、`configured`、`reachable`、`validated` 四种状态。

验收标准：

- 登录态下可生成一份机器可读 JSON 和人类可读 Markdown 报告。
- 每个外部集成至少包含一个读接口和一个关键写/执行接口的验证结果。

#### 2.2 workflow-v2 已有后端能力，但前端产品入口仍不完整

当前状态：

- 后端已有 `/api/v1/workflows` 路由、模板、stage input/output/transition、project overview。
- 前端已有 `workflowsApi.getProjectOverview()` 和 Hermes 状态查询。
- Project Room 中有部分 workflow-v2 信息，但没有形成完整“工作流控制台”体验。
- V1 `projects.ts` 和 `issues.ts` 仍标注为维护模式。

风险：

- 用户仍主要通过 V1 项目流操作，workflow-v2 的图结构、输入契约、阶段流转优势没有完全产品化。
- 两条链路并存会增加测试、排障和文档成本。

升级建议：

- 在 Project Room 增加 workflow-v2 专区：阶段图、节点状态、输入契约、输出产物、门禁违规、下一步动作。
- 明确新项目默认是否进入 workflow-v2。
- 制定 V1 到 V2 的迁移/兼容策略。

验收标准：

- 用户可以在一个页面看到 workflow 图、当前节点、阻断原因和可执行动作。
- 新创建项目的主路径与 workflow-v2 状态一致。

### P1：前端功能闭环缺口

#### 2.3 System Ops 部分按钮只是提示或前端计算

当前状态：

- “导出报告”按钮只触发 toast。
- “优化策略”会生成建议卡，但“应用建议”只提示已采纳，没有调用后端执行。
- “运行全面诊断”主要基于前端已有数据和固定状态判断。
- 就绪检查里环境变量、数据库连接等部分是前端固定结果，不是全部来自 `/api/system/readiness` 或健康检查。

风险：

- 用户会以为已经触发真实诊断或真实优化。
- 运维页面可看性强，但操作可信度不足。

升级建议：

- `导出报告` 接入后端 observability/readiness/audit 汇总，生成 Markdown 或 JSON。
- `运行全面诊断` 调用统一后端诊断接口，并展示检查项级别结果。
- `应用建议` 改为可执行动作：例如跳转到 Agent 配置、打开 Runtime 修复、触发模型路由自愈，而不是只 toast。

验收标准：

- 每个运维按钮要么执行真实动作，要么明确标记为“分析预览”。
- 诊断结果可被复制或归档。

#### 2.4 Monitoring 页面刷新按钮未重新拉取观测摘要

当前状态：

- 页面加载时会调用 `systemApi.getObservabilitySummary()`。
- “刷新”按钮只显示 toast，没有重新调用接口。
- “查看历史”按钮没有行为。

风险：

- 用户认为监控已刷新，实际摘要可能仍是旧数据。

升级建议：

- 抽出 `loadSummary()`，刷新按钮复用。
- “查看历史”接入审计日志、会话历史或 local-agent-monitor 历史快照。

验收标准：

- 点击刷新后 `generatedAt` 改变或显示后端最新缓存时间。
- 查看历史能跳转或打开可用面板。

#### 2.5 Agent Commander 中模型/Token 调整仍是本地观察态

当前状态：

- 切换模型提示“当前不会持久化到后端”。
- Token 限额调整提示“当前不会持久化到后端”。
- 真正持久化配置需要打开 Agent 配置弹窗。

风险：

- 指挥页和配置页之间存在心理模型断裂。
- 用户可能误以为已修改 Agent 配置。

升级建议：

- 将模型和 Token 控件改为“预览/观察态”样式，或直接接入 Agent 配置保存接口。
- 若保持观察态，按钮文案改为“本地预览”并提供“保存到配置”动作。

验收标准：

- 用户在 Agent Commander 修改模型/Token 后，能明确知道是否已持久化。
- 刷新页面后配置一致。

#### 2.6 Workspace 页面“近期报告”维度偏弱

当前状态：

- 工作区项目来自平台项目集合。
- “近期报告”来自 `sessions.slice(0, 4)`，本质是会话活动，不是 OpenClaw 项目报告。

风险：

- 工作区页面不能充分体现真实文件系统、交付物、项目文档和 OpenClaw 报告。

升级建议：

- 接入 `/api/openclaw/projects/:projectId/report`。
- 增加工作区文件、文档、任务、交付物的真实摘要。

验收标准：

- 每个工作区项目可打开真实报告。
- 报告中包含项目文档、任务状态、最近会话和关键证据文件。

### P2：治理、路由与体验一致性

#### 2.7 通知中心深链仍有边界问题

当前状态：

- 后端通知会生成 `to: "/notifications"`。
- 前端有通知中心弹层，但主 tab 列表中没有独立 `notifications` tab。
- 其他通知路径如 `/projects/:id`、`/agents/:id` 需要依赖前端解析映射。

风险：

- 点击某些通知可能无法落到用户期望的位置。

升级建议：

- 统一通知 target schema：`{ tab, projectId, agentId, modal }`，减少字符串路径解析。
- `/notifications` 目标映射为打开通知中心弹层。

验收标准：

- 每种通知类型点击后都能到达正确页面或弹层。

#### 2.8 本地实时事件已不再是随机 mock，但语义仍偏 snapshot

当前状态：

- 旧文档提到 SSE 用随机事件；当前代码已改为订阅 `local-agent-monitor` snapshot。
- `/api/openclaw/events` 当前发送的是 snapshot 和 heartbeat，不是细粒度业务事件。

风险：

- 前端能刷新，但无法根据事件类型做精准更新。
- 对“任务变更”“项目推进”“Agent 状态变化”的语义表达仍不足。

升级建议：

- 引入事件总线或统一 domain event：`task.updated`、`project.progressed`、`agent.status_changed`、`runtime.changed`。
- snapshot 保留为兜底，业务事件用于精准刷新。

验收标准：

- 项目推进、任务状态变更、Agent 状态变更都能发出对应事件。
- 前端按事件类型局部刷新，而不是全部重新拉取。

#### 2.9 API 响应格式仍存在裸 JSON 与 envelope 并存

当前状态：

- 前端请求层兼容 `{ success, data/error }` 和裸 JSON。
- 后端有 `routes/utils.ts` 的统一封装，但大量路由仍直接 `res.json(...)`。

风险：

- 前端请求层复杂度高。
- 新接口容易出现错误处理不一致。

升级建议：

- 新增接口强制使用 envelope。
- 旧接口分批迁移，同时保留兼容层。

验收标准：

- 新增路由测试统一断言 envelope。
- 前端 API client 不再为新接口维护双格式猜测。

### P3：规划中但本版本不强制的能力

#### 2.10 多租户、企业 SSO、细粒度 RBAC

当前状态：

- 已有管理员、用户、角色、项目成员等基础模型。
- 需求文档明确本版本不强制多租户、企业级 SSO、细粒度 RBAC。

升级建议：

- 暂不作为当前 P0/P1。
- 若要面向多人组织使用，需要进入独立权限治理项目。

#### 2.11 成本中心与财务结算

当前状态：

- Model Nexus 和 Monitoring 有 token/cost 估算。
- 没有完整成本中心、预算审批、账单归集。

升级建议：

- 短期只做“实测/估算来源标注”和预算告警。
- 长期再做成本中心。

#### 2.12 云原生分布式调度

当前状态：

- 当前更偏单体 API + 本地工作区 + daemon 脚本。
- 需求文档明确不强制云原生分布式调度。

升级建议：

- 暂缓，除非平台要支持多租户、多节点、多项目大规模并发。

## 3. 旧缺口复核：已经部分修复的项

以下旧文档中提到过，但当前代码已明显推进，不能继续按原样算未实现：

- 团队拓扑：现在 `TeamTopologyModal` 已调用 `teamApi.getTopology()`，只是仍保留前端 fallback。
- 监控统计依赖：`MonitoringPage` 的 session 过滤和统计已依赖 `sessions`。
- Model Nexus 统计：已依赖 `models`，并接入模型目录同步、设为默认并校验。
- Settings：语言、workspacePath、autoSync、usageAlert 等已接入 `/api/system/ui-preferences` 服务端持久化，同时保留 localStorage 兜底。
- OpenClaw SSE：当前不是随机 Math.random 事件，已改为 local-agent-monitor snapshot。

## 4. 建议升级批次

### 批次 A：可信度补强，建议优先

目标：

- 让平台状态、外部集成、运行时健康都能被实测证明。

任务：

- 建立登录态 integration readiness 报告。
- System Ops 诊断按钮接后端真实诊断。
- Monitoring 刷新按钮接真实刷新。
- 通知目标 schema 统一。

预计收益：

- 降低“看起来可用但无法证明”的风险。
- 给后续验收和交付提供可信凭据。

### 批次 B：workflow-v2 产品化

目标：

- 把 workflow-v2 从后端能力变成用户可操作主路径。

任务：

- Project Room 增加 workflow-v2 阶段图。
- 展示 stage input/output/gate violations。
- 明确新项目默认链路。
- 制定 V1 维护范围和 V2 主线范围。

预计收益：

- 降低 V1/V2 并存带来的理解成本。
- 让阶段编排、门禁、知识上下文真正被用户看见。

### 批次 C：运维与工作区真实操作闭环

目标：

- 把 System Ops、Workspace、Agent Commander 中的弱操作补成真实操作。

任务：

- System Ops 导出报告/应用建议接后端动作。
- Workspace 接 OpenClaw 项目报告。
- Agent Commander 模型/Token 调整支持持久化或明确降级为预览态。

预计收益：

- 减少“按钮只是提示”的体验落差。
- 提升平台作为工作台的可操作性。

### 批次 D：组织级治理，按业务需要推进

目标：

- 面向多人团队和更正式部署。

任务：

- 细粒度 RBAC。
- 多租户边界。
- SSO。
- 成本中心。
- 分布式调度。

预计收益：

- 支撑更大团队使用，但改造面较大，不建议和主链路稳定性工作混在同一批。

## 5. 推荐决策

建议先推进批次 A，再推进批次 B。

原因：

- 批次 A 解决“能否证明当前系统真实可用”的问题。
- 批次 B 解决“未来主线到底是 V1 还是 workflow-v2”的问题。
- 批次 C 可以按你最常用的页面优先选一两个点做，不必整包推进。
- 批次 D 属于组织化/企业化能力，当前不是阻塞主链路的第一优先级。

