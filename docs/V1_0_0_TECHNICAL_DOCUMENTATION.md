# Agent 协作工作台 v1.0.0 技术文档

## 1. 文档信息

- 文档名称：Agent 协作工作台 v1.0.0 技术文档
- 文档日期：2026-03-26
- 文档用途：面向研发、部署、联调、运维与后续版本扩展
- 技术基线：以当前仓库实际代码实现为准

## 2. 技术架构概览

v1.0.0 采用 Monorepo 架构，前后端分离开发、单服务集成发布：

```text
apps/
  api/        Express + Prisma + SQLite + OpenClaw integration
  web/        React + Vite frontend
packages/
  shared/     Shared types and contracts
docs/         Product, requirement, operation, release docs
aistudio/     Google AI Studio exported frontend reference
scripts/      Build, release, verify, backup, daemon scripts
```

核心特点：

- 前端和后端共享一套 TypeScript 数据契约
- API 可在生产模式下直接托管前端静态构建产物
- 数据库负责平台主数据与治理数据
- OpenClaw 工作区负责真实 Agent 与项目协作数据
- 运行层同时支持脚本模式和 OpenAI 兼容模式

## 3. 技术栈

### 3.1 前端

- React 18
- TypeScript
- React Router 6
- Vite 6
- 原生 CSS 设计系统

### 3.2 后端

- Node.js
- Express 4
- TypeScript
- Prisma 6
- SQLite

### 3.3 工程与构建

- pnpm workspace
- Monorepo
- `tsc` 编译
- 本地脚本化发布、验证、备份和守护运行

## 4. 运行架构

### 4.1 前端运行

- 开发态：`pnpm dev:web`
- 默认 Vite 端口：`5173`
- 开发态 API 默认指向：`http://localhost:8787`
- 生产态：由 `apps/api` 提供静态资源托管

### 4.2 后端运行

- 开发态：`pnpm dev:api`
- 生产态：`node apps/api/dist/index.js`
- 默认端口：`8787`
- 健康检查：`/health`
- 就绪检查：`/ready`

### 4.3 运行模式

- `scripted`
  - 适合无外部模型依赖的本地演示与联调
- `openai-compatible`
  - 适合对接兼容 OpenAI API 的模型服务

## 5. 主要源码模块

### 5.1 前端

- `/Users/dalongxia/Documents/Playground/apps/web/src/App.tsx`
  - 全局路由、布局壳层、鉴权入口、语言切换
- `/Users/dalongxia/Documents/Playground/apps/web/src/lib/api.ts`
  - 前端 API 请求层
- `/Users/dalongxia/Documents/Playground/apps/web/src/lib/locale.tsx`
  - 国际化状态管理
- `/Users/dalongxia/Documents/Playground/apps/web/src/pages/DashboardPage.tsx`
  - 总控首页
- `/Users/dalongxia/Documents/Playground/apps/web/src/pages/ProjectsPage.tsx`
  - 项目组合页
- `/Users/dalongxia/Documents/Playground/apps/web/src/pages/ProjectRoomPage.tsx`
  - 项目作战室
- `/Users/dalongxia/Documents/Playground/apps/web/src/pages/OpenClawPage.tsx`
  - 团队工作区
- `/Users/dalongxia/Documents/Playground/apps/web/src/pages/AgentsPage.tsx`
  - Agent 列表
- `/Users/dalongxia/Documents/Playground/apps/web/src/pages/AgentCommanderPage.tsx`
  - Agent 指挥页
- `/Users/dalongxia/Documents/Playground/apps/web/src/pages/SystemPage.tsx`
  - 系统运营与就绪度
- `/Users/dalongxia/Documents/Playground/apps/web/src/pages/AuditPage.tsx`
  - 审计轨迹

### 5.2 后端

- `/Users/dalongxia/Documents/Playground/apps/api/src/index.ts`
  - API 入口、路由、静态资源托管、认证中间件
- `/Users/dalongxia/Documents/Playground/apps/api/src/data/repository.ts`
  - 平台项目、任务、阶段、交付物主数据仓储
- `/Users/dalongxia/Documents/Playground/apps/api/src/openclaw/workspace.ts`
  - OpenClaw 工作区读取、Agent 与项目联动、任务回写
- `/Users/dalongxia/Documents/Playground/apps/api/src/agents/runtime.ts`
  - 当前运行模式与状态解析
- `/Users/dalongxia/Documents/Playground/apps/api/src/system/runtime-config.ts`
  - 运行配置持久化和校验
- `/Users/dalongxia/Documents/Playground/apps/api/src/system/readiness.ts`
  - 系统就绪度检查
- `/Users/dalongxia/Documents/Playground/apps/api/src/system/audit-log.ts`
  - 审计日志写入与查询
- `/Users/dalongxia/Documents/Playground/apps/api/src/security/auth.ts`
  - 管理员初始化、登录、会话校验
- `/Users/dalongxia/Documents/Playground/apps/api/src/security/secret-store.ts`
  - 本地密钥与敏感配置保护
- `/Users/dalongxia/Documents/Playground/apps/api/src/db.ts`
  - Prisma 客户端与 SQLite 路径归一化

### 5.3 共享契约

- `/Users/dalongxia/Documents/Playground/packages/shared/src/index.ts`
  - 所有共享类型、枚举、接口定义

## 6. 数据架构

数据库位于：

- `apps/api/prisma/dev.db`

Prisma Schema 位于：

- `/Users/dalongxia/Documents/Playground/apps/api/prisma/schema.prisma`

### 6.1 核心数据模型

- `Project`
  - 平台项目主表
- `Stage`
  - 项目阶段
- `Task`
  - 平台任务
- `Deliverable`
  - 项目交付物
- `TimelineEvent`
  - 项目时间线

### 6.2 Agent 治理模型

- `ManagedAgentConfig`
  - Agent 的模型、执行模式、确认策略、Token 限额、介绍、职责、协作白名单、工具白名单
- `AgentMemoryEntry`
  - Agent 长期记忆
- `AgentUsageLog`
  - Agent 调用日志与 Token 用量

### 6.3 系统模型

- `SystemConfig`
  - 运行提供方、模型、API 地址、管理员密码哈希、最近校验状态
- `AuthSession`
  - 登录会话
- `AuditLog`
  - 审计日志
- `AgentProfile`
  - 平台内置 Agent 画像信息

## 7. OpenClaw 集成设计

平台采用“数据库主数据 + OpenClaw 实时工作区”的双源模型：

- 平台数据库保存治理信息和平台主链路数据
- OpenClaw 工作区提供真实 Agent、项目、任务、文档和会话数据

集成能力包括：

- 读取工作区项目列表
- 读取项目文档摘要与项目报告
- 读取 Agent 配置、SOUL、SOP、会话和最近消息
- 向工作区创建 Agent
- 更新工作区任务状态
- 为 Agent 写入长期记忆
- 向 Agent 发送消息或批量发送消息

## 8. 接口设计

### 8.1 认证接口

- `GET /api/auth/status`
- `POST /api/auth/setup`
- `POST /api/auth/login`
- `POST /api/auth/logout`

### 8.2 平台项目接口

- `POST /api/projects/preview`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `GET /api/projects/:id/tasks`
- `GET /api/tasks`
- `POST /api/projects/:id/approve`
- `POST /api/projects/:id/reject`
- `POST /api/projects/:id/intervene`
- `POST /api/projects/:id/resume`
- `POST /api/projects/:id/stages/submit`
- `POST /api/projects/:id/messages`
- `PATCH /api/tasks/:taskId`
- `GET /api/projects/:id/live`

### 8.3 系统接口

- `GET /api/system/runtime`
- `GET /api/system/runtime/config`
- `PUT /api/system/runtime/config`
- `POST /api/system/runtime/validate`
- `GET /api/system/health`
- `GET /api/system/readiness`
- `GET /api/system/audit-logs`

### 8.4 OpenClaw 接口

- `GET /api/openclaw/workspace`
- `GET /api/openclaw/status`
- `GET /api/openclaw/projects`
- `GET /api/openclaw/projects/:projectId`
- `PATCH /api/openclaw/projects/:projectId/tasks/:taskId`
- `PATCH /api/openclaw/projects/:projectId/tasks`
- `GET /api/openclaw/projects/:projectId/report`
- `GET /api/openclaw/agents`
- `POST /api/openclaw/agents`
- `GET /api/openclaw/agents/:agentId`
- `PUT /api/openclaw/agents/:agentId/settings`
- `POST /api/openclaw/agents/:agentId/preview`
- `PUT /api/openclaw/agents/:agentId/soul`
- `PUT /api/openclaw/agents/:agentId/sop`
- `POST /api/openclaw/agents/:agentId/message`
- `POST /api/openclaw/agents/batch-message`
- `POST /api/openclaw/agents/:agentId/memory`
- `GET /api/openclaw/sla`

## 9. 安全设计

- 管理员密码以哈希和盐值形式保存在 `SystemConfig`
- 登录后通过 Cookie 会话访问受保护接口
- 非认证请求无法访问业务 API
- 运行配置中的敏感信息通过本地密钥机制保护
- `.env`、`.occ-secret`、数据库文件和构建缓存已在 `.gitignore` 中排除

## 10. 国际化设计

- 前端支持 `zh-CN` 与 `en-US`
- 当前采用前端本地状态管理和静态文案切换
- 语言偏好保存在浏览器 `localStorage`

## 11. 发布与运维

### 11.1 常用命令

```bash
pnpm install
pnpm build
pnpm start:prod
pnpm verify:local
```

### 11.2 数据库初始化

```bash
pnpm --filter @occ/api db:generate
pnpm --filter @occ/api db:push
pnpm --filter @occ/api db:seed
```

当本机 Prisma SQLite `db:push` 出现异常时，可使用兜底方案：

```bash
pnpm --filter @occ/api db:bootstrap
pnpm --filter @occ/api db:seed
```

### 11.3 本地运维脚本

- `pnpm release:local`
- `pnpm backup:local`
- `pnpm daemon:start`
- `pnpm daemon:status`
- `pnpm daemon:stop`

## 12. 验证结果

当前版本已完成以下本地验证：

- `pnpm typecheck`
- `pnpm build`
- `pnpm verify:local`

已验证内容包括：

- 构建产物存在
- API 健康检查可用
- 系统就绪度可用
- SQLite 数据库路径正确且文件存在
- OpenClaw 配置文件与工作区存在
- 真实 `jeremy` Agent 可读取

## 13. 已知技术边界

- 当前数据库为 SQLite，适合单机部署
- 当前未引入消息队列和缓存层
- 当前公网演示可通过 Cloudflare Quick Tunnel 完成，但正式生产应替换为命名隧道或反向代理
- 当前外部模型接入以 OpenAI 兼容协议为主

## 14. 后续演进建议

- 升级到 PostgreSQL + Redis
- 增加多用户和组织权限
- 引入任务队列与异步作业系统
- 增加外部通知和代码平台集成
- 建立正式生产部署架构与长期域名方案
