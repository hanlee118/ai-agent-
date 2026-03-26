# 最新技术文档

文档版本：Latest  
更新时间：2026-03-26

## 1. 技术目标

本技术文档描述 Agent 协作工作台当前最新版本的技术实现方式、模块边界、核心数据对象、运行架构与验证方案。

## 2. 技术架构总览

当前系统采用 Monorepo 结构：

```text
apps/
  api/        Express API + Prisma + SQLite + OpenClaw 集成
  web/        React + Vite 前端
packages/
  shared/     前后端共享类型与契约
scripts/      验证、启动、发布、守护脚本
docs/         文档
```

## 3. 架构分层

## 3.1 前端层

技术栈：

- React
- React Router
- Vite
- TypeScript
- CSS 自定义样式系统

职责：

- 提供工作台壳层
- 承载各模块页面
- 通过 `api.ts` 调用后端
- 承担基础国际化切换

## 3.2 接口层

技术栈：

- Express
- TypeScript

职责：

- 鉴权
- 项目接口
- OpenClaw 接口
- Agent 治理接口
- 系统治理接口
- SSE 实时推送接口

## 3.3 数据层

技术栈：

- Prisma
- SQLite

职责：

- 存储管理员配置
- 存储 Agent 治理配置
- 存储长期记忆
- 存储使用日志
- 存储运行配置
- 存储审计日志

## 3.4 外部集成层

- OpenClaw 工作区
- OpenAI-compatible Runtime
- 本地多工具会话源
  - Codex
  - Claude Code
  - OpenClaw

## 4. 当前核心模块实现

## 4.1 前端页面

### 已实现页面

- `DashboardPage.tsx`
- `ProjectsPage.tsx`
- `ProjectRoomPage.tsx`
- `OpenClawPage.tsx`
- `AgentsPage.tsx`
- `AgentCommanderPage.tsx`
- `SystemPage.tsx`
- `AuditPage.tsx`
- `SettingsPage.tsx`
- `AuthPage.tsx`

### 本轮重点更新页面

- [apps/web/src/pages/ProjectsPage.tsx](/Users/dalongxia/.codex/worktrees/efad/Playground/apps/web/src/pages/ProjectsPage.tsx)
- [apps/web/src/pages/AgentsPage.tsx](/Users/dalongxia/.codex/worktrees/efad/Playground/apps/web/src/pages/AgentsPage.tsx)
- [apps/web/src/pages/AgentCommanderPage.tsx](/Users/dalongxia/.codex/worktrees/efad/Playground/apps/web/src/pages/AgentCommanderPage.tsx)
- [apps/web/src/styles.css](/Users/dalongxia/.codex/worktrees/efad/Playground/apps/web/src/styles.css)

### 本轮前端变化

- Projects 页从列表型布局升级为 SaaS 指挥型布局
- Agents 页从名册列表升级为可筛选卡片团队视图
- Agent Commander 增加结构化理解确认选项
- 样式层补充新的工作台指挥中心组件

## 4.2 API 模块

主要模块：

- 认证模块
- 项目模块
- OpenClaw 工作区模块
- Agent 指挥模块
- 系统治理模块
- 审计模块

关键 API：

- `/api/auth/*`
- `/api/projects/*`
- `/api/tasks/*`
- `/api/openclaw/*`
- `/api/system/*`

## 4.3 本地实时监控

当前系统已支持：

- 本地多工具会话聚合
- SSE 实时快照推送
- 工具维度用量聚合
- 成本治理摘要

关键接口：

- `GET /api/system/local-agent-monitor`
- `GET /api/system/local-agent-monitor/live`

## 5. 数据模型

## 5.1 平台治理数据

数据库内至少包含以下核心治理对象：

- `SystemConfig`
- `AuthSession`
- `ManagedAgentConfig`
- `AgentMemoryEntry`
- `AgentUsageLog`
- `AuditLog`

## 5.2 共享契约

共享类型位于：

- [packages/shared/src/index.ts](/Users/dalongxia/.codex/worktrees/efad/Playground/packages/shared/src/index.ts)

其中包含：

- Project / Task / Stage 契约
- OpenClaw Project / Agent / Task 契约
- Agent Commander 契约
- Runtime / Health / Readiness 契约
- Local Agent Monitor 契约

## 5.3 Agent Commander 数据能力

单 Agent 指挥页当前依赖以下数据能力：

- `OpenClawAgentDetail`
- `OpenClawInstructionPreview`
- `OpenClawAgentCommanderSettings`
- `OpenClawAgentMemoryEntry`
- `OpenClawAgentUsageLogEntry`

## 6. 指令执行与确认机制

## 6.1 执行模式

当前支持两种：

- `confirm_first`
- `autonomous`

## 6.2 最新确认机制

在 `confirm_first` 模式下：

1. 用户输入任务
2. 前端调用预览接口
3. 后端返回理解确认卡
4. 前端展示结构化确认选项
5. 用户选择继续路径

当前支持的确认选项：

- 确认并执行
- 修改后重来
- 仅分析不执行
- 更换模型后重试

这部分主要由以下文件承载：

- [apps/web/src/pages/AgentCommanderPage.tsx](/Users/dalongxia/.codex/worktrees/efad/Playground/apps/web/src/pages/AgentCommanderPage.tsx)
- [apps/api/src/openclaw/workspace.ts](/Users/dalongxia/.codex/worktrees/efad/Playground/apps/api/src/openclaw/workspace.ts)

## 7. OpenClaw 集成方式

平台不是复制一份 OpenClaw 数据，而是尽量直接读取真实工作区内容。

当前已覆盖：

- 项目读取
- Agent 读取
- 任务读取
- 文档读取
- 会话读取
- 最近消息读取
- 新 Agent 创建
- SOUL / SOP 更新
- 任务消息下发
- 记忆写入

## 8. 样式与前端骨架

核心壳层位于：

- [apps/web/src/App.tsx](/Users/dalongxia/.codex/worktrees/efad/Playground/apps/web/src/App.tsx)
- [apps/web/src/styles.css](/Users/dalongxia/.codex/worktrees/efad/Playground/apps/web/src/styles.css)

当前样式策略：

- 自定义 CSS 变量与组件类
- 统一深色运营台视觉
- 吸收 AI Studio / Slack 启发的管理后台布局
- 通过卡片、侧栏、分栏、筛选器强化“工作台感”

## 9. 部署与运行

## 9.1 本地开发

```bash
pnpm dev:api
pnpm dev:web
```

## 9.2 生产构建

```bash
pnpm build
pnpm start:prod
```

## 9.3 守护启动

```bash
pnpm daemon:start
pnpm daemon:status
pnpm daemon:stop
```

## 9.4 发布脚本

```bash
pnpm release:local
```

## 10. 验证机制

当前项目内置以下验证：

- `pnpm typecheck`
- `pnpm build`
- `pnpm verify:local`
- `pnpm verify:smoke`
- `pnpm verify:closure`
- `pnpm test:smoke`
- `pnpm test:acceptance`

本轮最新迭代已经验证：

- 类型检查通过
- 构建通过
- 在当前代码独立实例上的烟测通过

## 11. 当前技术风险与建议

### 11.1 风险

- 本机若存在旧实例占用同端口，默认烟测可能因会话库不一致而失败
- 部分页面虽然已升级，但仍有进一步统一设计语言的空间
- SQLite 在团队协作和正式多节点部署中存在上限

### 11.2 建议

- 后续引入 PostgreSQL 作为正式生产数据库
- 增加多组织、多用户与 RBAC
- 增加更细的成本分析与告警
- 增加 Agent 批量治理与批量编排接口

## 12. 结论

从技术实现上看，当前版本已经具备以下特征：

- 有真实数据源，不是纯演示
- 有治理能力，不是单对话壳
- 有验证机制，不是不可验收原型
- 有继续产品化演进的前后端边界

因此它已经是一个“可继续正式化、可继续生产化”的 Agent 团队协作平台基础版本。
