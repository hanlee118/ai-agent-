# Agent Collaboration Workbench

1.0.0 版本。一个面向真实 OpenClaw 团队协作的 AI 工作台仓库，已经具备项目、Agent、运行配置、审计、长期记忆和 OpenClaw 工作区联动能力，可作为本地生产部署版本使用。

## 已实现能力

- 自然语言创建项目，并生成理解确认卡
- 统一查看 `Dashboard`、`Projects`、`Project Room`、`OpenClaw Workspace`、`Agents`、`Agent Commander`、`System`、`Audit`、`Settings`
- 读取真实 `~/.openclaw` 工作区中的项目、Agent、任务、文档、会话和最近消息
- 进入单个 Agent 的 `Agent Commander` 页面，独立切换模型、切换执行策略、预览理解确认卡、下发任务
- 支持 `confirm_first` / `autonomous` 两种执行模式
- 支持为每个 Agent 配置 Token 限额：
  - 单次输入上限
  - 单次输出上限
  - 每日 Token 总量上限
- 支持为每个 Agent 配置治理信息：
  - 显示名称与职位
  - Agent 介绍与职责
  - 允许协作的 Agent 列表
  - 允许使用的工具白名单
- 支持为每个 Agent 持久化长期记忆，并保存在数据库中
- 支持记录每个 Agent 的调用日志与当日 Token 使用摘要
- 支持通过平台创建新的 OpenClaw Agent，并同步写入真实 `~/.openclaw/openclaw.json`
- 系统记录关键审计日志，并支持运行配置保存与模型连通性校验
- `System` 页面新增平台就绪度检查，可直接核对数据库文件、OpenClaw 配置、工作区路径与风险告警
- 首次启动可初始化管理员密码，后续通过登录鉴权进入系统

## 目录结构

```text
apps/
  api/        Express API + Prisma + OpenClaw integration
  web/        React + Vite frontend
packages/
  shared/     共享类型与枚举
docs/         产品、UI、架构与 AI Studio 设计文档
aistudio/     Google AI Studio 导出的前端参考实现
```

## 启动方式

```bash
pnpm install
pnpm --filter @occ/api db:generate
pnpm --filter @occ/api db:push
pnpm dev:api
pnpm dev:web
```

默认前端使用 `http://localhost:8787` 作为 API 地址。

数据库路径：

- `apps/api/prisma/dev.db`
- `apps/api/.env.example` 已改为与运行时一致的 `file:./prisma/dev.db`
- 如果本地 Prisma SQLite `db:push` 出现 schema engine 异常，可先执行 `pnpm --filter @occ/api db:bootstrap` 初始化基础表，再执行 `pnpm --filter @occ/api db:seed`

## 单服务发布

```bash
pnpm build
node apps/api/dist/index.js
```

当 `apps/web/dist` 存在时，API 会同时提供前端页面和后端接口。

## 当前数据库设计

当前数据库除原有项目主链路外，已经增加以下关键模型：

- `ManagedAgentConfig`
  - 每个 Agent 的当前模型、默认模型、备用模型
  - 执行模式、确认策略、Token 限额、长期记忆开关
  - 显示名称、职位、介绍、职责
  - 协作 Agent 白名单、工具白名单
- `AgentMemoryEntry`
  - 每个 Agent 的长期记忆
  - 支持类型、摘要、正文、重要度、标签、来源
- `AgentUsageLog`
  - 每个 Agent 的调用记录
  - 支持输入 Token、输出 Token、总量、状态、调用类型

这意味着平台已经具备继续扩展以下能力的数据库基础：

- 成本控制
- 预算审计
- 记忆检索
- 长期行为画像
- 多 Agent 运行治理

## 关键接口

基础平台接口：

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `GET /api/projects/:id/tasks`
- `GET /api/tasks`
- `PATCH /api/tasks/:taskId`
- `GET /api/system/runtime`
- `GET /api/system/runtime/config`
- `PUT /api/system/runtime/config`
- `POST /api/system/runtime/validate`
- `GET /api/system/health`
- `GET /api/system/readiness`
- `GET /api/system/audit-logs`
- `GET /api/auth/status`
- `POST /api/auth/setup`
- `POST /api/auth/login`
- `POST /api/auth/logout`

OpenClaw 工作区接口：

- `GET /api/openclaw/workspace`
- `GET /api/openclaw/status`
- `GET /api/openclaw/projects`
- `GET /api/openclaw/projects/:projectId`
- `GET /api/openclaw/projects/:projectId/report`
- `PATCH /api/openclaw/projects/:projectId/tasks/:taskId`
- `PATCH /api/openclaw/projects/:projectId/tasks`

OpenClaw Agent 接口：

- `GET /api/openclaw/agents`
- `POST /api/openclaw/agents`
- `GET /api/openclaw/agents/:agentId`
- `PUT /api/openclaw/agents/:agentId/settings`
- `POST /api/openclaw/agents/:agentId/preview`
- `POST /api/openclaw/agents/:agentId/memory`
- `PUT /api/openclaw/agents/:agentId/soul`
- `PUT /api/openclaw/agents/:agentId/sop`
- `POST /api/openclaw/agents/:agentId/message`
- `POST /api/openclaw/agents/batch-message`
- `GET /api/openclaw/sla`

## 当前运行说明

当前实现已经具备“本地生产版”的基础能力：

- 数据存储使用 `Prisma + SQLite`
- 实时观测通过 `SSE` 推送阶段执行流
- API 构建产物可直接托管前端 `apps/web/dist`
- Agent 运行层支持 `scripted` 回退模式，并支持持久化 OpenAI 兼容配置
- Agent 长期记忆、Token 限额、执行策略和调用日志已进入数据库层
- Agent 治理配置也已进入数据库层，可在前端页面直接编辑并持久化
- API 提供 `health`、`ready`、请求 ID 和统一错误返回

## 本地发布脚本

```bash
pnpm release:local
pnpm start:prod
pnpm verify:local
```

首次启动后，浏览器会先进入初始化页面，请设置管理员密码。系统会自动生成本地密钥文件 `.occ-secret` 用于加密保存运行配置中的 API Key。

## 备份与守护

```bash
pnpm backup:local
pnpm daemon:start
pnpm daemon:status
pnpm daemon:stop
```

- 备份会输出到 `backups/<timestamp>/`
- 如需恢复，使用 `OCC_FORCE_RESTORE=1 ./scripts/restore-local.sh <backup-dir>`
- 守护模式日志保存在 `.runtime/openclaw.log`

## GitHub 发布建议

当前仓库已经基本满足发布到 GitHub 的工程条件：

- `node_modules`、数据库文件、环境密钥都在 `.gitignore` 中
- 前后端可独立开发，也可单服务发布
- 数据库结构可优先通过 `pnpm --filter @occ/api db:push` 重建，若本机 SQLite Prisma 引擎异常，则可用 `pnpm --filter @occ/api db:bootstrap` 兜底初始化
- 产品需求、AI Studio 设计 Brief、高保真 Prompt 文档均已落在 `docs/`

推送到 GitHub 之前，建议确认：

1. 不要提交真实 `~/.openclaw` 私有配置
2. 不要提交真实模型 API Key
3. 若要公开仓库，建议确认 `aistudio/` 中是否包含不适合公开的设计素材
4. 发布前按 [docs/PRODUCTION_CHECKLIST.md](/Users/dalongxia/Documents/Playground/docs/PRODUCTION_CHECKLIST.md) 逐项核对

## v1.0.0 正式文档

- [产品说明文档](/Users/dalongxia/Documents/Playground/docs/V1_0_0_PRODUCT_OVERVIEW.md)
- [需求文档](/Users/dalongxia/Documents/Playground/docs/V1_0_0_REQUIREMENTS_SPEC.md)
- [技术文档](/Users/dalongxia/Documents/Playground/docs/V1_0_0_TECHNICAL_DOCUMENTATION.md)
