# Agent Collaboration Workbench

[![CI](https://github.com/hanlee118/ai-agent-/actions/workflows/ci.yml/badge.svg)](https://github.com/hanlee118/ai-agent-/actions/workflows/ci.yml)
[![Pages](https://github.com/hanlee118/ai-agent-/actions/workflows/pages.yml/badge.svg)](https://github.com/hanlee118/ai-agent-/actions/workflows/pages.yml)
[![Version](https://img.shields.io/badge/version-1.0.3-0f172a.svg)](https://github.com/hanlee118/ai-agent-/releases)

一个面向多 Agent 项目协作、执行治理、模型治理和 OpenClaw 工作区联动的工程化工作台。

它不是单聊天窗口，也不是只展示状态的 Demo 页，而是一个把项目推进、Agent 配置、运行时路由、审批门禁、长期记忆、审计日志和 GitLab Harness 串起来的可运行平台。

- 在线主页: [https://hanlee118.github.io/ai-agent-/](https://hanlee118.github.io/ai-agent-/)
- GitHub 仓库: [https://github.com/hanlee118/ai-agent-](https://github.com/hanlee118/ai-agent-)

## 当前状态

当前仓库的主线能力已经收敛到以下几类：

- 项目创建与项目推进
- Agent 管理与 Agent 指挥
- Runtime 配置与真实模型校验
- OpenClaw 工作区数据读取与任务回写
- GitLab Harness 联动与验收闭环
- 系统健康检查、审计追踪与本地守护脚本

当前本地已验证的运行模式包括：

- `scripted`
- `openai-compatible`

当前代码已支持阶段协议、真实模型门禁、最佳模型门禁、协作交接卡和技能执行记录等关键约束，避免把模板稿、降级结果或残留静态页面误判成真实交付。

最新稳定性更新（2026-04-24）：

- 统一修复超时封装，避免超时后晚到异常导致 API 进程退出。
- Stitch 配额耗尽场景会自动降级为 `pending/degraded`，不中断主流程推进。
- 增强项目预备与阶段推进链路的错误吸收与日志可观测性，降低“流程卡住”概率。
- Hermes MCP 接入默认启用并打通单项目全流程验收，`acceptance-real-3modes-v2` 已可稳定识别 Hermes 与 OpenClaw 双参与。

## 核心能力

### 1. 项目与协议治理

- 自然语言创建项目，并生成理解确认卡
- 支持 `INIT -> ANALYSIS -> DESIGN -> DEV -> ACCEPT` 阶段推进
- 支持提交、审批、驳回、介入、恢复、关闭等动作
- 强制执行阶段交付物、协作交接卡、技能执行记录和真实模型门禁

### 2. Agent 工作台

- 查看 Agent 列表、状态、负载、会话和最近活动
- 在 Agent Commander 中单独配置模型、执行模式、协作白名单、工具白名单和 Token 限额
- 支持创建新 Agent，并同步写入 OpenClaw 工作区配置
- 支持长期记忆与用量日志沉淀

### 3. Runtime 与模型治理

- 支持 `scripted` 与 `openai-compatible` 两类运行模式
- 支持保存 API Base URL、API Key、模型名并做联通校验
- 支持设计模型策略、最佳模型门禁和故障回退约束
- 支持从 UI 观察当前运行状态、最后校验结果和配置来源

### 4. OpenClaw / GitLab 联动

- 读取真实 `~/.openclaw` 或自定义工作区中的项目、Agent、任务、文档和会话
- 支持 OpenClaw 项目报告、任务更新、批量任务更新、消息下发和记忆写入
- 支持 GitLab Harness：项目执行动作可同步为 Issue，并接收 webhook 回写
- 支持本地 GitLab 协作和主干保护流程

GitLab webhook 运维注意：

- 如果 GitLab 运行在 Docker 容器内，project webhook 不能指向 `http://127.0.0.1:8787`
- 这类场景应改为容器可回调宿主机的地址，例如 `http://host.docker.internal:8787/api/gitlab/webhook`
- webhook token 必须与 `GITLAB_WEBHOOK_SECRET` 保持一致，否则 OCC 会返回 `403`
- 当前本地链路已验证：GitLab issue `closed -> OCC task done`，GitLab issue `opened/reopen -> OCC task in_progress`

## 技术栈

- Frontend: React 18 + Vite 6 + TypeScript
- Backend: Express 4 + TypeScript
- Data: Prisma + PostgreSQL
- Shared contract: `packages/shared`
- Runtime: OpenClaw workspace integration + OpenAI-compatible gateway
- Delivery: GitHub Actions + GitHub Pages + GitLab CI

## 仓库结构

```text
apps/
  api/        Express API、Prisma、运行时治理、OpenClaw / GitLab 集成
  web/        React + Vite 前端工作台
packages/
  shared/     共享类型、接口契约、运行时模型定义
docs/         产品、需求、架构、部署、治理与操作文档
scripts/      守护、验证、发布、备份、恢复脚本
site/         GitHub Pages 对外主页
```

## 架构概览

```mermaid
flowchart LR
  U["User / Admin"] --> W["Web App"]
  W --> A["OCC API"]
  A --> D["Prisma + PostgreSQL"]
  A --> O["OpenClaw Workspace"]
  A --> G["GitLab Harness"]
  A --> R["Runtime Provider"]
  R --> M["Scripted / OpenAI-compatible Model Gateway"]
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 初始化数据库（PostgreSQL）

```bash
pnpm --filter @occ/api db:generate
pnpm --filter @occ/api exec prisma migrate deploy
pnpm --filter @occ/api db:seed
```

### 3. 本地开发

```bash
pnpm dev:api
pnpm dev:web
```

默认地址：

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

### 4. 守护方式启动

```bash
pnpm daemon:start
pnpm web:daemon:start
pnpm daemon:status
pnpm web:daemon:status
```

### 5. 快速启动（生产环境）

```bash
docker-compose up -d
```

健康检查：

```bash
curl http://localhost:8787/api/health
```

数据库迁移（本机 PostgreSQL）：

```bash
DATABASE_URL="postgresql://occ:occ@127.0.0.1:5432/occ?schema=public" pnpm --filter @occ/api exec prisma migrate dev
```

### 6. 构建与自检

```bash
pnpm build
pnpm typecheck
pnpm --filter @occ/api test:routes
pnpm health:check
pnpm verify:local
pnpm verify:smoke
```

预检体系文档：

- `scripts/lib/README-preflight.md`
- 说明了 DB/API/Hermes 自愈模块、`preflight-runner` 用法、环境变量和排障建议。

单项目严格真验收（推荐固定一个项目 ID 反复验证）：

```bash
PROJECT_ID=OCC-20260424-001 pnpm audit:single-project:strict
```

单项目全量验收（健康检查 + 严格审计）：

```bash
PROJECT_ID=OCC-20260424-001 pnpm verify:single-project:full
```

闭环验收（项目创建/提交/驳回/重提/审批/OpenClaw 集成）：

```bash
# 默认（等同 fast 模式）
pnpm verify:closure

# 快速模式：优先验证主链路可用性与回归稳定性（推荐日常）
pnpm verify:closure:fast

# 全量模式：开启重型检查，做发布前深度验收（耗时更长）
pnpm verify:closure:full
```

闭环模式相关环境变量：

- `CLOSURE_FAST_PROJECT_FLOW_SCRIPTED=true|false`：是否在项目流阶段临时切换 `scripted` 加速验证
- `CLOSURE_ENABLE_OPTIONAL_HEAVY_CHECKS=true|false`：是否启用高耗时的可选重型检查（如创建后预备强检查）
- `OPTIONAL_PROJECT_REQUEST_TIMEOUT_MS=12000`：项目流可降级接口超时
- `OPTIONAL_OPENCLAW_REQUEST_TIMEOUT_MS=10000`：OpenClaw 可降级接口超时

可选参数：

- `AUDIT_REQUIRE_HERMES=false`：临时关闭 Hermes 必须参与门禁
- `AUDIT_REQUIRE_NON_SCRIPTED=false`：临时关闭 scripted-like=0 门禁
- `AUDIT_OUT=/abs/path/report.json`：自定义审计报告输出路径

GitLab webhook 检查与自愈：

```bash
pnpm gitlab:webhook:check
pnpm gitlab:webhook:fix
```

这两个命令会检查 GitLab project webhook 是否存在、URL 是否正确、`issues_events` 是否开启，以及本地 Docker GitLab 是否能真实回调 OCC API。

如果当前环境已配置 `GITLAB_TOKEN`，则：

- `pnpm health:check` 会自动纳入 GitLab webhook 真链路检查
- `./scripts/release-local.sh` 会在发布烟测阶段阻塞校验 GitLab webhook 真链路

健康检查管理员会话注入：

- 匿名模式：`pnpm health:check`
- 带管理员会话：`HEALTHCHECK_SESSION_COOKIE='occ_session=...' pnpm health:check`
- 带管理员密码自动登录：`HEALTHCHECK_ADMIN_PASSWORD='...' pnpm health:check`

烟测管理员会话注入：

- 复用现有管理员会话：`VERIFY_SMOKE_SESSION_COOKIE='occ_session=...' pnpm verify:smoke`
- 用管理员密码自动登录：`VERIFY_SMOKE_ADMIN_PASSWORD='...' pnpm verify:smoke`
- 未提供时会回退到临时会话，仅用于本地烟测兜底

知识库搜索（`/api/v1/knowledge`）命令注意事项：

- 查询参数包含中文等非 ASCII 字符时，必须使用 URL 编码写法，否则可能在 HTTP 解析层直接返回 `400 Bad Request`（未进入业务路由）
- 推荐命令：

```bash
curl -b cookies.txt --get --data-urlencode "search=测试" "http://localhost:8787/api/v1/knowledge"
```

- 预期响应（无结果时）：

```json
{"success":true,"data":{"total":0,"items":[]}}
```

## 环境变量

示例文件：[`apps/api/.env.example`](apps/api/.env.example)

关键变量：

- `DATABASE_URL`
- `MODEL_PROVIDER`
- `MODEL_API_BASE_URL`
- `MODEL_API_KEY`
- `MODEL_NAME`
- `OPENCLAW_ROOT`
- `OPENCLAW_CONFIG_PATH`
- `OPENCLAW_WORKSPACE_ROOT`
- `CODEX_SESSIONS_ROOT`
- `CLAUDE_PROJECTS_ROOT`
- `OPENCLAW_AGENT_ROOT`
- `APP_SECRET`
- `PORT`
- `HOST`
- `ALLOWED_ORIGINS`
- `GITLAB_BASE_URL`
- `GITLAB_TOKEN`
- `GITLAB_DEFAULT_PROJECT`
- `GITLAB_WEBHOOK_SECRET`
- `WORKFLOW_V2_HERMES_ENABLED`
- `WORKFLOW_V2_HERMES_STAGE_MATCH`
- `WORKFLOW_V2_HERMES_ENDPOINT`
- `WORKFLOW_V2_HERMES_REQUIRED`
- `PROJECT_STAGE_HERMES_REQUIRED`

说明：

- 未显式配置 `OPENCLAW_ROOT` 时，默认使用 `~/.openclaw`
- 当 `MODEL_PROVIDER=openai-compatible` 时，必须同时提供 `MODEL_API_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME`
- 生产模式必须配置 `ALLOWED_ORIGINS`，不能使用通配符
- 当 GitLab 部署在 Docker 中时，project webhook 需使用宿主机可达地址，例如 `http://host.docker.internal:8787/api/gitlab/webhook`
- `WORKFLOW_V2_HERMES_ENDPOINT` 可直接填基础地址（如 `http://127.0.0.1:3001`），服务端会自动归一化到 `/mcp/execute`
- `WORKFLOW_V2_HERMES_REQUIRED=true` 时，workflow-v2 阶段强制走 Hermes，Hermes 不可用会直接失败（fail-closed）
- `PROJECT_STAGE_HERMES_REQUIRED=true` 时，项目阶段执行链也会对 Hermes 不可用执行阻断（fail-closed）
- 两个 `*_REQUIRED` 为 `false` 时，Hermes 不可用会记录 fallback 证据后回退到常规执行链（fail-open）

## 数据与治理模型

当前数据库中已经落地的核心治理表包括：

- `SystemConfig`
- `ManagedAgentConfig`
- `AgentMemoryEntry`
- `AgentUsageLog`
- 项目、任务、交付物、审计与运行态相关主数据表

这些数据共同支撑：

- Runtime 配置与验证结果
- Agent 默认模型、回退模型、Token 限额、执行模式
- 长期记忆、调用日志和使用量汇总
- 项目执行协议、交付物与阶段推进状态

## Git 与协作约定

- `main` 只保留可发布代码
- 日常开发统一在 `codex/*` 分支进行
- 通过 PR / MR 合并，不直接向 `main` 推送功能改动
- `main` 已启用保护规则、审批规则、Code Owners 审批与会话评论收敛要求
- 本地运行缓存、数据库、日志、构建产物和 `.runtime/` 不入库

详细规则见：[`docs/REPOSITORY_GOVERNANCE.md`](docs/REPOSITORY_GOVERNANCE.md)

## 部署与发布

当前仓库已保留以下发布资产：

- [`Dockerfile`](Dockerfile)
- [`render.yaml`](render.yaml)
- [`scripts/start-render.sh`](scripts/start-render.sh)
- [GitHub Pages 站点](https://hanlee118.github.io/ai-agent-/)

部署说明见：[`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md)

## 文档入口

建议优先阅读以下文档：

- [`docs/PRODUCT_DOCUMENTATION.md`](docs/PRODUCT_DOCUMENTATION.md)
- [`docs/LATEST_REQUIREMENTS_SPEC.md`](docs/LATEST_REQUIREMENTS_SPEC.md)
- [`docs/LATEST_TECHNICAL_DOCUMENTATION.md`](docs/LATEST_TECHNICAL_DOCUMENTATION.md)
- [`docs/AGENT_TEAM_EXECUTION_PROTOCOL.md`](docs/AGENT_TEAM_EXECUTION_PROTOCOL.md)
- [`docs/AGENT_TEAM_INIT_PROTOCOL.md`](docs/AGENT_TEAM_INIT_PROTOCOL.md)
- [`docs/AGENT_TEAM_DELIVERY_PROTOCOL.md`](docs/AGENT_TEAM_DELIVERY_PROTOCOL.md)
- [`docs/DESIGN_MODEL_POLICY.md`](docs/DESIGN_MODEL_POLICY.md)
- [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md)
- [`docs/OPERATION_MANUAL.md`](docs/OPERATION_MANUAL.md)

## 当前仓库定位

这个仓库当前更接近一个“Agent 团队协作底座”，而不是单一行业垂直站点。

如果你要继续在这个仓库里落地具体业务场景，例如跨境电商爆品选品 / 跟品平台，推荐做法是：

1. 保持当前治理底座不被破坏
2. 以独立业务项目或独立页面模块形式推进场景实现
3. 让业务场景复用现有的项目协议、运行时治理、Agent 协作和验收闭环

## License

当前仓库未单独声明开源许可证。如需公开分发，请先补充正式 License 文件。
