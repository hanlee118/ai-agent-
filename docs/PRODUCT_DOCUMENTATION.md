# AI 协作工作台 产品文档（基于当前实现）

> 文档版本：v2.0（实现对齐版）  
> 更新时间：2026-03-28  
> 适用代码基线：`/tmp/ai-agent-check` 当前工作区

## 1. 产品定位

AI 协作工作台（Aegis OS）面向“多 Agent 项目协作与运营治理”，核心目标是把任务指挥、项目推进、模型治理、系统审计统一到一个控制台中，并连接 OpenClaw 工作区进行真实数据同步。

当前版本属于 **MVP+（可运行、可演示、部分生产流程可闭环）**。

## 2. 当前信息架构（前端菜单）

来自 `Sidebar` 的 9 个一级菜单：

1. 概览（Dashboard）
2. 项目组合（Projects）
3. Agent 名册（Agents）
4. 模型中心（Model Nexus）
5. 实时监控（Monitoring）
6. 工作区（Workspace）
7. 系统运行（System Operations）
8. 审计追踪（Audit）
9. 设置（Settings）

同时存在二级工作页/弹窗：

- 项目作战室（Project Room）
- Agent 指挥（Agent Commander）
- 新建项目、关键决策中心、部署 Agent、配置 Agent、团队拓扑、接入新模型

## 3. 技术与数据架构

### 3.1 前端

- React + TypeScript + Vite
- `App.tsx` 负责认证、导航编排、懒加载页面与弹窗调度（当前约 442 行）
- 数据入口：`useRealData()`
  - 拉取 `/api/openclaw/*`、`/api/system/runtime`
  - 订阅 `/api/openclaw/events` SSE
- 页面层主要通过 `runtimeCollections` 读取当前快照

### 3.2 后端

- Node.js + Express
- Prisma ORM（模型管理、Agent 配置、团队拓扑等新路由已接入）
- 路由分层：
  - 新增标准化路由：`/api/models`, `/api/agents`, `/api/team`
  - 既有业务路由：`/api/projects`, `/api/openclaw/*`, `/api/system/*`, `/api/notifications` 等

### 3.3 实时机制

- 前端：`useSSE` 带重连（5 次、3 秒间隔）
- 后端：`/api/openclaw/events` 已可连接，但当前事件源以开发模拟为主（详见缺陷）

## 4. 功能实现清单（按“真实可用度”）

### 4.1 已形成业务闭环（可真实调用后端）

1. 认证流程：初始化、登录、退出
2. 项目创建（自然语言输入 -> 理解确认卡 -> 创建）
3. 项目干预与恢复（Project Room 调 `projectsApi.intervene/resume`）
4. Agent 指挥发送（发送前确认卡 -> 调用 `sendAgentMessage`）
5. 模型接入（创建模型、健康检查、日志拉取）
6. Agent 部署（创建 Agent）
7. Agent 配置（切模型、SOUL、SOP）
8. 审计日志查询（远端审计 + 本地回退）
9. 运行时配置（provider/model/baseUrl/apiKey）保存与校验

### 4.2 部分可用（有 UI，但闭环不完整）

1. 项目组合筛选：UI 有下拉，但未真正筛选数据
2. 团队拓扑：已动态绘图，但未接后端 `/api/team/topology`
3. 系统运行页“优化策略”：有加载与建议卡，但“应用建议”仅提示，不触发后端动作
4. 工作区“近期报告”：来自会话切片，维度偏弱

### 4.3 主要为展示态（需进一步产品化）

1. 系统运行页部分图表使用随机数据生成
2. 项目作战室页签（任务/阶段/交付物/时间线）仅首个页签生效
3. 若干按钮仅提示（例如导出报告、查看历史）

## 5. 前后端接口覆盖现状

### 5.1 已接入并在前端使用

- `/api/auth/*`
- `/api/models/*`（含 `/logs`、`/metrics`、`/health-check`）
- `/api/agents/*`
- `/api/projects/*`（create/get/tasks/intervene/resume 等）
- `/api/system/runtime*`、`/api/system/audit-logs`
- `/api/openclaw/agents`、`/api/openclaw/projects`、`/api/openclaw/workspace`、`/api/openclaw/events`
- `/api/notifications*`

### 5.2 已有后端接口但前端尚未充分利用

- `/api/team/topology`（前端有 `teamApi`，但拓扑弹窗未调用）
- `/api/system/local-agent-monitor/live`（SSE，前端未接）

## 6. 自查：逻辑缺失与功能缺失（重点）

以下为基于当前代码的“实现偏差/缺口”清单。

### P0（优先修复）

1. SSE 事件并非真实业务事件，导致“实时更新”可信度不足  
位置：`/tmp/ai-agent-check/apps/api/src/index.ts:1115` 开始，使用 `Math.random()` 生成事件类型。  
影响：前端刷新被触发，但事件本身不携带真实变更语义。

2. API 契约未完全统一为 `{ success, data/error }`  
位置：`/tmp/ai-agent-check/apps/api/src/routes/utils.ts:13` 定义了统一封装；但 `index.ts` 大量 `res.json(...)` 仍返回裸对象，例如 `projects` 路由：`/tmp/ai-agent-check/apps/api/src/index.ts:569`。  
影响：前端需兼容双格式，接口治理成本高。

### P1（高优先）

1. 项目筛选只有提示，无真实过滤  
位置：`/tmp/ai-agent-check/apps/web/src/pages/ProjectsPage.tsx:35`。  
影响：用户认为筛选生效，实际数据不变。

2. 团队拓扑未使用真实拓扑 API  
位置：拓扑弹窗直接基于 `runtimeCollections.agents` 绘图：`/tmp/ai-agent-check/apps/web/src/pages/modals/TeamTopologyModal.tsx:108`。  
对比：已有 `teamApi.getTopology`：`/tmp/ai-agent-check/apps/web/src/lib/api/teamApi.ts:4`。  
影响：无法展示后端计算出的节点与连接关系。

3. 部分关键统计在数据更新后不刷新（依赖遗漏）  
- Monitoring：`filteredSessions` 未依赖 `sessions`（`/tmp/ai-agent-check/apps/web/src/pages/MonitoringPage.tsx:15`），`stats` 仅首次计算（`:20`）。  
- Model Nexus：`stats` 仅首次计算（`/tmp/ai-agent-check/apps/web/src/pages/ModelNexusPage.tsx:17`）。  
- Workspace：`recentReports` 仅首次计算（`/tmp/ai-agent-check/apps/web/src/pages/WorkspacePage.tsx:31`）。  
- System Ops：多处 `useMemo(..., [])` 固定快照（`/tmp/ai-agent-check/apps/web/src/pages/SystemOpsPage.tsx:207`、`:216`、`:226`、`:232`）。

4. 通知目标路由存在断点  
后端会生成 `to: "/notifications"`：`/tmp/ai-agent-check/apps/api/src/system/notifications.ts:234`。  
前端通知跳转未处理该路径，落回 Dashboard：`/tmp/ai-agent-check/apps/web/src/App.tsx:238`。  
影响：点击通知“进入通知中心”无法到达对应页面。

5. 系统运行页面含随机数据，无法用于真实运营判断  
位置：`/tmp/ai-agent-check/apps/web/src/pages/SystemOpsPage.tsx:99`、`:156`、`:157`。  
影响：图表看起来“实时”，但不是生产数据。

### P2（中优先）

1. Project Room 页签仅展示样式，缺少切换逻辑  
位置：`/tmp/ai-agent-check/apps/web/src/pages/ProjectRoomPage.tsx:305`。  
影响：阶段/交付物/时间线不能独立浏览。

2. Project Room “指派 Agent”按钮无行为  
位置：`/tmp/ai-agent-check/apps/web/src/pages/ProjectRoomPage.tsx:438`。  
影响：成员编排不完整。

3. Agent Commander 中“切模型/改 Token 限额”仅本地状态+提示，未持久化  
位置：`/tmp/ai-agent-check/apps/web/src/pages/AgentCommanderPage.tsx:215`、`:225`。  
影响：刷新即丢失，且与后端配置不一致。

4. 设置项（语言、自动同步、自治模式等）仅本地 localStorage  
位置：`/tmp/ai-agent-check/apps/web/src/features/settings/useSettings.ts:35`、`:61`。  
影响：跨端/多用户不一致，缺少后端配置中心（当前仅 runtime 配置走后端）。

5. 开发环境默认放开 `/api/openclaw/*` 认证  
位置：`/tmp/ai-agent-check/apps/api/src/index.ts:262`。  
影响：联调便利，但存在越权访问风险（尤其共享开发环境）。

## 7. 结论（当前版本可用性评估）

- 结论：**项目已具备“可运行 + 关键流程可闭环”的产品雏形，但尚未达到“全模块真实可运营”的完整度。**
- 关键短板集中在：
  1. 真实实时事件（SSE 语义）
  2. 统计/筛选等交互闭环
  3. 接口契约统一与路由一致性
  4. 配置持久化一致性

建议下一轮按顺序推进：

1. 先修 P0（SSE 真实性 + API 契约统一）  
2. 再修 P1（筛选、拓扑 API 接入、依赖修复、通知路由）  
3. 最后补 P2（页签行为、指派 Agent、设置后端化）

---

## 附录：本次文档的核对范围

- 前端核心编排：`App.tsx`
- 页面与弹窗：`apps/web/src/pages/*`
- 前端数据层：`useRealData`、`hooks/useSSE`、`lib/api/*`、`lib/adapters.ts`
- 后端主路由：`apps/api/src/index.ts`
- 新增路由：`apps/api/src/routes/models.ts`、`agents.ts`、`team.ts`
