# Agent Collaboration Workbench / OCC 平台全景事实文档

> 文档生成时间：2026-05-07  
> 仓库：`https://github.com/hanlee118/ai-agent-`  
> 本地 API 端口：`http://127.0.0.1:8787`  
> 文档依据：当前本地仓库代码、仓库内既有文档、`8787` 端口的未登录运行态响应  
> 重要原则：本文只描述当前代码和可验证运行态中能够确认的事实；凡是未完成登录态实测但能从代码明确看出的能力，会标注为“代码可见，未完成本轮登录态实测”；凡是仅存在于文档愿景而没有在代码中落实的内容，不视为已实现。

## 1. 项目概述

### 1.1 项目名称与定位

- 仓库和 README 的正式名称是 `Agent Collaboration Workbench`。
- 代码和文档里大量使用 `OCC` 作为内部简称。
- “Aegis OS” 不是当前仓库的正式产品名；本轮核对中只在前端欢迎语里发现一次文案“`Aegis OS 已全面运行`”，不能据此把整个平台正式命名为 Aegis OS。

一句话定位：

这是一个面向多 Agent 项目协作的工程化工作台，用来把项目从立项、分析、设计、开发到验收的全过程，变成可推进、可门禁、可追溯、可与外部工作区和 GitLab 协同的执行系统。

### 1.2 核心问题

项目试图解决的不是“和模型聊天”，而是下面这些工程问题：

- 多角色 Agent 协作时，任务如何被阶段化推进，而不是停留在对话层。
- 模型是否真的被调用、是否走了允许的模型链路，如何被验证。
- 阶段产物是否真实、是否达到门禁要求，如何阻止“模板稿假通过”。
- 外部执行环境、工作区、Issue 系统如何和平台联动，而不是人工双写。
- 项目为什么卡住、卡在哪一关、下一步该由谁处理，如何被明确暴露。

### 1.3 目标用户与核心价值

从当前代码和页面结构看，目标用户主要不是普通终端用户，而是使用 Agent 进行项目推进的内部操盘者或交付团队成员，包括：

- 平台管理员：初始化系统、配置运行时、管理用户、查看系统健康。
- 项目负责人 / PM：创建项目、推进阶段、审批或驳回阶段、处理卡点。
- 设计 / 开发 / 测试协作者：围绕任务、交付物、评审和验收参与流程。
- Agent 运维者：配置 Agent、模型、工具白名单、记忆与工作区联动。

平台提供的核心价值：

- 把“项目推进”做成状态机，而不是自由文本协作。
- 把“Agent 执行”纳入治理，包括模型策略、技能证据、协作交接和降级阻断。
- 把“外部工作区”和“外部工单系统”接进来，形成闭环。
- 把“健康检查、审计、可观测性、修复动作”内建到平台本身。

### 1.4 当前开发阶段

基于 README、现有脚本、测试和路由情况，这个项目不是原型空壳，也不是单页演示，已经处于“可运行、可验证、仍在快速演进”的工程化阶段。

更准确地说，它具备：

- 完整前后端工程结构。
- Prisma 数据模型和多轮迁移记录。
- 大量 API 路由。
- 自动化校验、健康检查、闭环验收和 UI E2E 自检脚本。
- 与 OpenClaw、Hermes MCP、GitLab 的集成代码。

但它也仍处于持续开发中，证据包括：

- `apps/api/src/routes/projects.ts` 顶部明确标注“V1 维护模式”，新功能转向 `workflow-v2`。
- 工作区当前存在未提交改动。
- 仓库中仍同时保留 V1 项目流和 V2 workflow 路径。

### 1.5 技术栈概览

前端：

- React 18
- Vite 6
- TypeScript
- 自定义页面壳而非传统多路由 SPA
- `recharts`、`lucide-react`、`framer-motion` / `motion`

后端：

- Express 4
- TypeScript
- Prisma
- PostgreSQL
- `zod` 参数校验
- `helmet`、`cors`、`express-rate-limit`、`compression`

知识与文件处理：

- `multer` 文件上传
- `pdf-parse` 解析 PDF
- `mammoth` 解析 DOCX

AI / 运行时集成：

- `scripted` 本地脚本化执行模式
- `openai-compatible` 网关模式
- Anthropic-compatible provider 代码
- Hermes MCP 集成
- OpenClaw 工作区集成
- Google Stitch SDK

运维与交付：

- GitHub Actions
- GitHub Pages
- GitLab Harness / webhook
- Docker / docker-compose
- 本地 daemon 启停脚本

## 2. 用户使用流程

### 2.1 用户如何进入平台

当前入口可以分为两类：

- 本地 Web 控制台。
- 本地 API。

从仓库默认配置看：

- Web 开发地址通常是 `http://localhost:5173`
- API 地址通常是 `http://localhost:8787`

当前这次会话中，`8787` 端口确实有服务在响应；未登录直接访问：

- `GET /api/system/health`
- `GET /api/projects`

都会返回 `{"message":"authentication required"}`。

这说明当前运行态不是匿名开放，而是默认启用了认证保护。

### 2.2 注册 / 初始化 / 登录机制

从 `apps/api/src/index.ts` 与 `apps/api/src/security/auth.ts` 可确认：

- `GET /api/auth/status`：返回系统是否完成初始化、当前会话是否已认证。
- `POST /api/auth/setup`：首次设置管理员密码并直接创建会话。
- `POST /api/auth/login`：支持仅密码管理员登录；如果请求体带 `email`，则走普通用户邮箱登录。
- `POST /api/auth/register`：需要管理员会话才能创建用户。
- `POST /api/auth/logout`：清除会话。

登录态通过 `occ_session` Cookie 维持，特征包括：

- `HttpOnly`
- `SameSite=Strict`
- 有效期 14 天

前端首次启动流程如下：

1. `App.tsx` 启动后先调用 `authApi.getStatus()`。
2. 如果系统未初始化，展示初始化流程，要求设置管理员密码。
3. 如果系统已初始化但未登录，展示登录流程。
4. 登录或初始化成功后，前端再拉取 `/api/users/me` 或直接使用 `/api/auth/status` 中的用户对象。
5. 登录态结果会缓存到 `sessionStorage`，减少刷新时的闪烁。

### 2.3 从进入平台到完成典型任务的主路径

下面按当前代码能确认的真实主路径描述。

#### 场景 A：首次接入平台

1. 访问前端。
2. 前端调用 `/api/auth/status`。
3. 如果系统还没初始化，用户输入管理员密码，调用 `/api/auth/setup`。
4. 后端会：
   - 校验密码强度。
   - 在 `SystemConfig` 中写入管理员密码 hash 和 salt。
   - 创建管理员用户与会话。
   - 设置 `occ_session` Cookie。
5. 前端进入已登录状态，加载主应用壳。

界面反馈：

- 初始化成功时，前端 toast 显示“系统初始化完成”。
- 登录成功时，toast 显示“登录成功，欢迎指挥官”。

#### 场景 B：创建并推进项目

代码可见的主链路是：

1. 用户打开 `Projects` 页或通过 `NewProjectModal` 发起新项目。
2. 前端调用项目相关 API 创建项目。
3. 后端在 `Project`、`Stage`、`Task` 等表中建立基础记录。
4. 之后可进入 `Project Room` 查看：
   - 任务
   - 阶段
   - 交付物
   - 时间线
5. 用户可以进行项目动作：
   - 暂停
   - 恢复
   - 手动推进
   - 关闭
   - 删除
6. 推进阶段时，后端会执行门禁判断、交付物校验、必要的 Agent 运行和后续状态切换。

用户能看到的反馈从前端代码可确认包括：

- 推进中 toast：“正在推进项目阶段，可能需要 1-3 分钟，请稍候...”
- 若需人工干预，会显示待处理事项。
- 若项目已在后台推进，会提示稍后刷新。
- 若缺少 Issue 绑定，会明确提示。

#### 场景 C：进入项目作战室处理预备与交付

`ProjectRoomPage.impl.tsx` 说明这是平台最重的页面之一，承载了：

- 项目任务详情
- 阶段视图
- 交付物侧栏
- 时间线
- 设计评审表单
- post-create prep 讨论、分析、回填和确认视图
- 任务委派与协作状态面板

从页面类型定义可确认，项目作战室至少能呈现：

- `requiredActions`
- `postCreatePrep`
- 交付物与 Stitch 产物
- 任务依赖
- GitLab 关联信息
- 委派摘要
- 协议失败提示

这意味着平台不是简单看板，而是把阶段推进前后的人工补充、评审、回填和协作证据都放到同一页面里。

#### 场景 D：Agent 指挥

`AgentCommanderPage.tsx` 可确认的用户流程：

1. 用户选中某个 Agent。
2. 页面会同时拉取：
   - 平台管理的 Agent 模板
   - OpenClaw Agent 列表
   - 具体 Agent 详情
3. 页面把平台 Agent 身份和 OpenClaw Agent 身份做绑定解析。
4. 用户可以查看或操作：
   - 当前模型
   - token 限额
   - SOUL
   - SOP
   - 记忆摘要
   - 项目任务
   - 任务委派状态
5. 用户可以向 Agent 下发命令，前端支持“命令理解确认卡”。

这个页面的实际定位更像“Agent 运维与控制台”，不是普通聊天窗口。

#### 场景 E：知识库管理

`KnowledgeHubPage.tsx` 和 `knowledge-v2` 路由说明用户可以：

1. 按作用域过滤知识：
   - 全局
   - 项目
   - Agent
   - 模板
2. 通过上传文件或直接文本写入知识。
3. 搜索、查看、编辑、删除知识。
4. 触发整理、预览整理结果、执行整理。
5. 查看历史操作并回滚。
6. 与 Hermes 同步记忆。

### 2.4 功能完整度说明

基于当前代码，可以按下面方式区分成熟度：

| 功能 | 当前状态 | 依据 |
| --- | --- | --- |
| 认证初始化与登录 | 已实现 | 有完整 API、Cookie 会话、前端状态流 |
| 项目列表与项目动作 | 已实现 | 前端页与项目 API 大量存在 |
| Project Room | 已实现，且复杂度高 | 页面体量大，类型和交互完备 |
| Agent 管理 / 指挥 | 已实现 | 前端页、Agent 路由、OpenClaw 绑定逻辑存在 |
| 运行时与系统治理 | 已实现 | `system` 路由完整、页面存在 |
| 知识库 v2 | 已实现 | `knowledge-v2` 路由较完整 |
| workflow-v2 | 已实现但仍在演进 | 独立路由和 orchestrator 存在；V1 仍保留 |
| Hermes 集成 | 已实现代码路径，需结合环境验证 | 有运行时状态、探测、执行逻辑 |
| GitLab Harness | 已实现代码路径，需结合环境验证 | README、路由、同步逻辑存在 |
| Stitch 设计链路 | 已实现集成代码，运行稳定性依赖外部条件 | 有 SDK 依赖、runtime-check 和相关逻辑 |

## 3. 平台核心功能与实现细节

### 3.1 认证与用户体系

#### 功能作用

控制谁能访问平台、谁能创建用户、谁能执行管理动作。

#### 用户如何使用

- 首次部署后先初始化管理员密码。
- 之后管理员可登录。
- 管理员可创建普通用户。
- 已登录用户通过 Cookie 保持会话。

#### 前端呈现

- `App.tsx` 在应用级别处理认证壳。
- 未初始化时显示初始化流。
- 未登录时显示登录流。
- 登录后才进入主应用。

#### 后端支撑

核心代码：

- `apps/api/src/index.ts`
- `apps/api/src/security/auth.ts`
- `apps/api/prisma/schema.prisma`

关键数据表：

- `SystemConfig`
- `AuthSession`
- `UserProfile`

#### 数据流

1. 用户输入密码。
2. 前端请求 `/api/auth/setup` 或 `/api/auth/login`。
3. 后端校验密码、查找或创建用户。
4. 生成随机 session token，保存 hash 到 `AuthSession`。
5. 把明文 token 通过 `Set-Cookie` 回给浏览器。
6. 后续请求通过 Cookie 识别用户。

#### 关键实现逻辑

- 会话只在数据库保存 hash，而不保存明文 token。
- 普通用户注册必须由管理员完成。
- 登录和初始化都有审计日志写入。

### 3.2 项目与阶段推进

#### 功能作用

围绕项目建立阶段、任务、交付物和审批状态，驱动项目进入下一个阶段。

#### 用户如何使用

用户在 `Projects` 页和 `Project Room` 中进行：

- 创建项目
- 查看项目状态
- 暂停 / 恢复 / 推进 / 关闭 / 删除
- 提交阶段
- 审批或驳回
- 查看任务与交付物

#### 前端呈现

- `ProjectsPage.tsx`：项目列表和高层动作入口。
- `ProjectRoomPage.impl.tsx`：项目细节、阶段、交付、时间线和协作面板。

#### 后端支撑

主要代码：

- `apps/api/src/routes/projects.ts`
- `apps/api/src/data/repository.ts`
- `apps/api/src/system/post-create-prep.ts`
- `apps/api/src/system/project-stage-execution.ts`

关键数据库实体：

- `Project`
- `Stage`
- `Task`
- `Deliverable`
- `TimelineEvent`
- `ProjectExecution`

#### 数据流

1. 用户在前端发起项目创建或推进动作。
2. API 路由接收请求并做参数校验。
3. repository 层更新项目、阶段、任务和执行记录。
4. 必要时触发 Agent 执行、Issue 同步、交付物校验。
5. 返回最新项目状态给前端。
6. 前端刷新并在 Project Room 中显示变化。

#### 关键实现逻辑

- 阶段被建模为明确状态，而不是任意文本。
- 有 `pendingApproval` 和人工介入逻辑。
- 推进过程中会返回 `requiredActions`，避免“失败但原因不明”。
- 存在 post-create prep 草稿与确认机制，说明项目创建后并不立即盲目推进。

### 3.3 workflow-v2 编排

#### 功能作用

提供相对 V1 更结构化的工作流编排能力，包括图结构、阶段输入契约、协作产物和门禁。

#### 用户如何使用

前端已有 `workflowsApi`，能读取：

- 项目 workflow 概览
- Hermes runtime 状态

后端暴露了：

- 模板创建和列表
- 项目 workflow 初始化
- workflow 启动
- stage 输入 / 输出
- stage 转移
- 项目 workflow 状态与概览

#### 前端呈现

前端已有 API 封装，但不是所有 workflow-v2 入口都已经单独做成显式页面。当前更像是 Project Room 和系统页中的底层能力支撑。

#### 后端支撑

主要代码：

- `apps/api/src/routes/workflows-v2.ts`
- `apps/api/src/workflow-v2/workflow-orchestrator.ts`
- `apps/api/src/workflow-v2/project-modes.ts`
- `apps/api/src/workflow-v2/quality-gate.ts`
- `apps/api/src/workflow-v2/knowledge-service.ts`

#### 数据流

1. 项目绑定或创建 workflow。
2. workflow 使用 stage graph 表达节点与边。
3. 某阶段启动时，系统会：
   - 校验输入契约
   - 分配 Agent
   - 组装上下文与知识
   - 运行 Agent / Hermes / Stitch
   - 写回产物和状态
4. 阶段转移前执行 gate 检查。
5. 满足条件后推进到下一节点。

#### 关键实现逻辑

- `defaultGraphForTemplate()` 根据模板生成阶段图。
- 存在自动修复输入契约的逻辑，比如缺少 `rawRequirements` 时自动回填。
- 支持知识自动组织和阶段产物入库。
- 支持 Hermes 与常规执行链的混合。

### 3.4 Agent 管理与指挥

#### 功能作用

为平台中的 Agent 提供配置、身份绑定、文档维护、消息投递、委派协同和用量观察能力。

#### 用户如何使用

用户可以：

- 查看 Agent 列表
- 创建 Agent
- 修改 Agent 模型和配置
- 查看 / 编辑 SOUL 与 SOP
- 给 Agent 发消息
- 观察任务与会话
- 查看记忆

#### 前端呈现

核心页面：

- `AgentCommanderPage.tsx`
- `AgentsPage.tsx`

#### 后端支撑

核心路由：

- `/api/agents`
- `/api/openclaw/agents`

关键表：

- `ManagedAgentConfig`
- `AgentMemoryEntry`
- `AgentUsageLog`

#### 数据流

1. 前端拉取平台托管 Agent 列表。
2. 同时拉取 OpenClaw Agent 列表与详情。
3. 前端进行身份归并，构造“平台 Agent + OpenClaw Agent”的统一视图。
4. 用户执行配置更新或命令下发。
5. 后端写数据库、写 OpenClaw 工作区、或直接调用 OpenClaw CLI / 数据文件。

#### 关键实现逻辑

- 平台内部 Agent ID 和 OpenClaw Agent ID 不是天然一致的，需要绑定映射。
- SOUL / SOP 被视为可编辑文档而不是静态提示词。
- 有工具白名单、协作白名单、Token 限额等治理字段。

### 3.5 OpenClaw 工作区集成

#### 功能作用

把平台内项目和 Agent 与外部 OpenClaw 工作区连接起来，读取真实数据并写回任务、消息、文档和记忆。

#### 用户如何使用

用户通常不会直接操作文件系统，而是通过平台页面完成：

- 查看工作区状态
- 查看 OpenClaw 项目和 Agent
- 更新任务
- 给 Agent 发消息
- 修改 Agent 文档
- 写入记忆

#### 前端呈现

- `WorkspacePage.tsx`
- `AgentCommanderPage.tsx`
- `useRealData()` 会把 OpenClaw 辅助数据并入平台视图

#### 后端支撑

核心代码：

- `apps/api/src/openclaw/workspace.ts`
- `apps/api/src/routes/openclaw.ts`

#### 数据流

1. API 调用 OpenClaw 相关读写函数。
2. 后端定位 OpenClaw 根目录、配置文件、工作区路径。
3. 读取项目文档、任务清单、Agent 配置、会话记录。
4. 必要时执行 OpenClaw 命令行或直接改写工作区文件。
5. 返回结构化 JSON 给前端。

#### 关键实现逻辑

- 会自动解析 OpenClaw 可执行文件路径。
- 维护非可删除核心 Agent 列表。
- 对设计模型远端失败和模型路由失败有冷却期控制。
- 允许构建项目报告、更新单任务和批量任务。

### 3.6 运行时与模型治理

#### 功能作用

统一管理平台调用模型的方式、路由、可用性和门禁，不让“配置存在但不可用”的状态长期潜伏。

#### 用户如何使用

用户可以在系统设置或系统运维页中：

- 查看当前运行模式
- 修改 provider、API Base URL、模型名、API Key
- 校验运行时是否可用
- 查看阶段模型策略
- 执行模型路由自检 / 自愈

#### 前端呈现

- `SystemOpsPage.tsx`
- `ModelNexusPage.tsx`
- Settings 相关页面

#### 后端支撑

核心代码：

- `apps/api/src/system/runtime-config.ts`
- `apps/api/src/agents/runtime.ts`
- `apps/api/src/routes/system.ts`
- `apps/api/src/utils/openai-compatible-headers.ts`

#### 数据流

1. 用户修改 runtime 配置。
2. 后端写入 `SystemConfig`。
3. 用户触发 `/api/system/runtime/validate` 之类的校验接口。
4. 后端尝试实际访问模型网关或读取可解析路由。
5. 把最近验证状态写回系统配置。
6. 前端展示成功、失败、错误信息和策略预览。

#### 关键实现逻辑

- 当前 README 明确主线验证模式是 `scripted` 和 `openai-compatible`。
- `runtime.ts` 内置不同阶段和不同角色的模型偏好链。
- 存在 route cooldown，防止不可用模型路由被高频重复打爆。
- 存在 real model gate，可在生产或启用开关时阻断“非真实模型”通过。

### 3.7 知识库 v2

#### 功能作用

沉淀项目、Agent、模板和全局层面的知识，并供阶段执行时取回上下文。

#### 用户如何使用

用户可以：

- 上传文件入库
- 粘贴文本入库
- 按作用域搜索和查看知识
- 更新知识项
- 删除知识项
- 批量整理知识
- 回滚整理操作
- 从 Hermes 同步记忆

#### 前端呈现

- `KnowledgeHubPage.tsx`
- `HermesSyncPanel`

#### 后端支撑

核心代码：

- `apps/api/src/routes/knowledge-v2.ts`
- `apps/api/src/workflow-v2/knowledge-service.ts`

#### 数据流

1. 用户上传文档或文本。
2. 后端按扩展名提取文本。
3. 构造成知识项并存库。
4. 根据配置可自动做知识整理。
5. 阶段执行时，通过 `retrieveKnowledgeForContext()` 取回相关知识拼装上下文。

#### 关键实现逻辑

- 支持 `global / project / agent / template` 作用域。
- PDF 和 DOCX 不是简单存文件，而是会做文本抽取。
- 支持知识整理 preview 和 apply 两段式流程。
- 支持知识历史和 rollback。

### 3.8 系统治理、审计与可观测性

#### 功能作用

给操盘者提供系统健康、审计日志、上下文卫生、Agent 监控和协议配置。

#### 用户如何使用

用户可查看或操作：

- 系统健康
- runtime 状态
- execution protocol 配置
- UI 偏好
- model routing 自检 / 自愈
- readiness
- observability summary
- context hygiene
- audit logs
- prompt templates
- design model policy health
- stage model policy
- local agent monitor
- Hermes upgrade 建议

#### 前端呈现

- `SystemOpsPage.tsx`
- Audit / Settings / Dashboard 相关页面

#### 后端支撑

- `apps/api/src/routes/system.ts`
- 多个 `apps/api/src/system/*.ts` 模块

#### 关键实现逻辑

- `getObservabilitySummarySnapshot()` 会聚合 runtime、readiness、数据库计数和 local agent monitor。
- execution protocol 可配置但有锁定字段，说明某些治理策略不希望被前端任意改坏。
- context hygiene 提供清理接口，表示上下文膨胀是被显式治理的问题。

## 4. Agent 的角色与工作机制

### 4.1 这里的 Agent 是什么

在这个项目里，Agent 不是单一含义，而是三层叠加：

- 平台中的“角色型执行单元”，例如 PM、分析师、设计、开发、QA。
- OpenClaw 工作区中的具体 Agent 实体。
- 某些 workflow 阶段中的执行者抽象，可以由常规 Agent、Hermes、人工或混合方式承担。

因此，Agent 不是单纯聊天机器人，而是“可被调度、可被约束、可写产物”的执行角色。

### 4.2 Agent 在平台里的角色

从代码可确认的平台角色包括：

- `ROLE_PM`
- `ROLE_ANALYST`
- `ROLE_PRODUCT`
- `ROLE_DESIGN`
- `ROLE_ARCH`
- `ROLE_DEV`
- `ROLE_QA`
- `ROLE_HR`

他们在不同阶段承担不同职责，并且和 stage model policy、execution protocol、task delegation 绑定。

### 4.3 Agent 的触发方式

当前可以确认的触发方式有：

- 用户主动触发：在项目推进、阶段提交、Agent 指挥时触发。
- 自动推进触发：项目自动推进循环会驱动阶段执行。
- workflow-v2 阶段触发：某阶段启动或转移时执行。
- 事件驱动刷新：前端通过 SSE 监听 `/api/openclaw/events`，收到 `task_update`、`project_progress`、`agent_status` 等事件后刷新。

本轮没有在代码中直接看到“定时 cron 任务独立触发 Agent”的完整产品化入口，因此不能把“定时任务 Agent”写成既成事实。

### 4.4 Agent 内部工作流

基于 `runtime.ts`、`workflow-orchestrator.ts`、`openclaw/workspace.ts`，典型工作流是：

1. 平台根据阶段和角色决定应该由谁执行。
2. 组装输入：
   - 项目描述
   - 阶段上下文
   - 知识库上下文
   - 协作要求
   - 技能要求
3. 根据 runtime 策略选模型链。
4. 尝试执行：
   - `scripted`
   - `openai-compatible`
   - Anthropic-compatible
   - Hermes MCP
   - OpenClaw 工作区联动
5. 收集结果：
   - 主体文本输出
   - 产物
   - 协作证据
   - 技能证据
   - 路由与模型尝试 trace
6. 写回：
   - `ProjectExecution`
   - 交付物
   - Timeline
   - Knowledge
   - OpenClaw 文档或任务
7. 进入质量门禁，决定是否推进、回退、阻断或等待人工。

### 4.5 Agent 的状态管理

可确认的状态管理包括：

- 管理配置状态：`ManagedAgentConfig`
- 记忆：`AgentMemoryEntry`
- 用量日志：`AgentUsageLog`
- 工作区与会话状态：从 OpenClaw 侧读取
- 执行状态：以 `ProjectExecution` 和 workflow stage status 表达

前端也维护了 Agent 的派生状态字段，例如：

- `status`
- `load`
- `tasks`
- `sessionCount`
- `lastActiveAt`

### 4.6 记忆机制

可以明确确认有短中期记忆能力，但没有看到独立向量数据库实现。

已经实现的记忆相关事实：

- 平台数据库中有 `AgentMemoryEntry`。
- OpenClaw Agent 侧也支持 memory 读写。
- knowledge-v2 可作为项目 / Agent 上下文来源。
- execution protocol 支持内存策略开关和 memory policy。

因此更准确的说法是：

- 已实现数据库级、工作区级和知识库级的记忆沉淀。
- 尚不能从当前代码直接证明已经接入独立向量库或 ANN 检索引擎。

### 4.7 错误处理机制

代码中存在较明显的错误吸收与恢复设计：

- 模型路由 cooldown，避免某个坏路由持续重试。
- Hermes 可根据开关 fail-open 或 fail-closed。
- Stitch 配额或超时在 README 中明确有降级策略。
- 项目推进中会返回 `requiredActions` 与恢复建议，而不是只抛通用错误。
- `useRealData()` 在 OpenClaw 辅助数据失败时会回退到核心项目数据，而不是整个前端空白。

## 5. 模型的应用与作用

### 5.1 项目中用到了哪些模型类型

从当前代码可确认：

- 大语言模型：主线能力。
- 设计阶段特化模型策略：通过模型偏好链实现。
- 没有在当前代码中确认单独接入视觉生成模型服务。
- 没有在当前代码中确认单独接入 embedding 向量库；知识检索存在，但实现更偏结构化存储和服务层检索。

### 5.2 当前明确可见的运行模式

README 把本地已验证运行模式写得很清楚：

- `scripted`
- `openai-compatible`

此外代码里还有：

- `anthropic-compatible-provider.ts`

但“代码存在 provider”不等于“当前主线已稳定启用”。更稳妥的事实表述是：

- 主线文档明确验证的是 `scripted` 与 `openai-compatible`。
- 代码中额外存在 Anthropic-compatible provider 实现。

### 5.3 模型在哪些环节被使用

1. 项目阶段执行  
   不同阶段与角色有不同模型偏好。

2. 设计阶段  
   DESIGN 阶段有更长的模型偏好链，并且可结合 Hermes、Stitch、design model policy。

3. Issue 讨论 / 审议  
   `runtime.ts` 中存在 issue debate 模型偏好链。

4. 知识与上下文辅助  
   知识服务会为阶段上下文提供补充，但本轮未看到独立 embedding provider 配置落地。

### 5.4 为什么选择这些模型

代码里以“阶段目标”和“最佳适配场景”来表达模型选择原因，而不是抽象配置：

- INIT：快速理解需求与初始化。
- ANALYSIS：抽取约束、风险、验收标准。
- DESIGN：强调视觉与交互质量，避免模板化。
- DEV：强调代码可执行性和稳定性。
- ACCEPT：强调验收复核和总结评审。

这不是纯配置项，而是已写进 `runtime.ts` 的明确策略。

### 5.5 模型调用方式

已确认的调用方式：

- OpenAI-compatible HTTP API
- Anthropic-compatible HTTP API
- Hermes MCP HTTP 端点
- scripted 本地逻辑执行

调用前后通常包含：

- provider / route 解析
- API base URL 和 API key 注入
- headers 兼容层处理
- timeout 控制
- 多模型尝试与 fallback

### 5.6 请求与返回结构

虽然不同 provider 细节不同，但平台统一关注的返回结构包括：

- 输出文本
- provider
- model
- attempt traces
- degraded 标记
- skillEvidence
- collaborationEvidence
- workspaceEvidence

这说明平台并不只关心“模型说了什么”，还关心“怎么说出来的、是否合规、是否真的经过协作链”。

### 5.7 参数、温度、提示词工程、RAG

本轮能明确确认的内容：

- 存在 prompt template 系统。
- 存在按阶段、按角色的上下文拼装逻辑。
- 存在 knowledge retrieval。
- 存在 design model policy、stage model policy。

本轮不能负责任确认的内容：

- 各 provider 的温度是否统一、各是多少。
- 是否有正式微调模型。
- 是否已经接入独立向量数据库 RAG。

因此正确表述应为：

- 平台已实现提示模板、角色上下文、知识回填和阶段模型策略。
- 温度、top_p 等细粒度采样参数不是本轮能从当前主代码稳定确认的公开契约。

### 5.8 模型结果的后处理

可以明确看到的后处理包括：

- 写入项目执行记录
- 写为阶段交付物
- 进入知识库
- 提取协作证据与技能证据
- 用于阶段门禁判断
- 必要时继续传给下一个阶段

## 6. 使用的工具及其集成方式

### 6.1 数据库与 ORM

#### PostgreSQL

用途：

- 作为平台核心业务数据存储。

集成方式：

- `Prisma` 通过 `DATABASE_URL` 接入。

使用程度：

- 深度使用，几乎所有核心业务实体都已落库。

注意事项：

- 测试脚本会依赖单独 schema。
- 仓库有多次 migration，说明结构仍在演进。

#### Prisma

用途：

- 数据模型、查询、迁移和 seed。

集成方式：

- `@prisma/client` + `prisma` CLI。

### 6.2 Web 服务与安全中间件

#### Express

用途：

- API 容器。

#### helmet / cors / express-rate-limit / compression

用途：

- 安全头
- 跨域控制
- 登录限流
- 响应压缩

集成方式：

- 在 `apps/api/src/index.ts` 启动时统一挂载。

### 6.3 OpenClaw

用途：

- 读取和管理外部 Agent 工作区、项目、任务、会话、文档、记忆。

集成方式：

- 通过本地文件系统、配置文件、CLI 可执行文件和工作区目录。

使用程度：

- 深度集成，是平台的重要外部执行面。

注意事项：

- 需要能找到 `openclaw` 可执行文件。
- 对模型路由和设计阶段远端失败有专门冷却逻辑。

### 6.4 Hermes MCP

用途：

- 在 workflow-v2 中承担特定阶段，默认重点面向设计相关阶段。

集成方式：

- HTTP 端点，最终调用 `/mcp/execute`，探活走 `/health`。

使用程度：

- 代码里已深度接入。
- 是否在当前运行环境中可达，取决于环境配置。

注意事项：

- `WORKFLOW_V2_HERMES_ENABLED`
- `WORKFLOW_V2_HERMES_ENDPOINT`
- `WORKFLOW_V2_HERMES_STAGE_MATCH`
- `WORKFLOW_V2_HERMES_TIMEOUT_MS`

### 6.5 Google Stitch SDK

用途：

- 设计阶段相关集成。

集成方式：

- 后端依赖 `@google/stitch-sdk`，并暴露 runtime-check。

使用程度：

- 有正式集成代码。
- 实际可用性依赖外部配额与网络。

### 6.6 GitLab Harness

用途：

- 外部 Issue 协同与状态闭环。

集成方式：

- API 路由 + webhook。

使用程度：

- README 明确给出已验证链路和 webhook 运维注意事项。

注意事项：

- webhook URL 不能在 Docker GitLab 中错误指向 `127.0.0.1`。
- token 需与 `GITLAB_WEBHOOK_SECRET` 一致。

### 6.7 文件处理工具

#### multer

用途：

- 上传知识文件。

#### pdf-parse / mammoth

用途：

- 提取 PDF / DOCX 文本，用于知识入库。

### 6.8 前端数据同步

#### SSE

用途：

- 监听 OpenClaw 事件并驱动前端刷新。

集成方式：

- `useSSE('/api/openclaw/events')`

使用程度：

- 已接入前端主数据刷新链路。

## 7. 平台规则、约束与方法论

### 7.1 用户与数据规则

可以明确确认的规则包括：

- 未认证用户不能访问受保护业务接口。
- 用户注册必须由管理员发起。
- 知识上传有文件大小限制，默认上限来自 `KNOWLEDGE_UPLOAD_MAX_BYTES`，代码默认值约 12MB。
- 知识作用域有绑定约束：
  - `project` 作用域必须带 `projectId`
  - `agent` 作用域必须带 `agentId`

### 7.2 系统内部硬性约束

已确认的约束包括：

- 阶段执行有总超时和单次尝试超时。
- 模型路由失败后进入 cooldown。
- execution protocol 默认要求：
  - `requireSkillEvidence = true`
  - `requireCollaborationHandoff = true`
  - `blockDegradedWrites = true`
- 某些执行协议字段被锁定，前端不能随意改。
- 某些阶段要求真实模型门禁。

### 7.3 开发与架构方法

从当前仓库组织看，项目采用的是“单仓多应用 + 共享包 + 明确治理层”的工程化方式，而不是传统微服务拆散。

可确认的方法论包括：

- Monorepo
- 前后端 TypeScript 共享契约
- 阶段化工作流
- 治理优先，而不是仅功能优先
- 持续回归验证

代码结构特征：

- `apps/api`
- `apps/web`
- `packages/shared`
- `docs`
- `scripts`

### 7.4 测试策略

从脚本和测试文件可确认：

- Typecheck
- Route tests
- workflow-v2 tests
- Smoke tests
- UI E2E tests
- 闭环验收脚本
- 单项目严格审计脚本

这说明测试策略不是单一单元测试，而是“接口 + 工作流 + 实际闭环”的组合。

### 7.5 部署流程

已知部署与运行方式：

- 本地开发：`pnpm dev:api` + `pnpm dev:web`
- 本地 daemon：`daemon:start` / `web:daemon:start`
- Docker：`docker-compose up -d`
- 构建：`pnpm build`

### 7.6 监控与报警

可以确认存在可观测性与健康检查，但没有在本轮代码抽样中看到独立第三方报警平台接入。

已实现的监控能力包括：

- `health:check`
- readiness
- observability summary
- local agent monitor
- audit logs
- runtime validation

因此正确表述是：

- 已有平台内建监控、健康检查与审计。
- 本轮未确认外部告警平台如 Sentry、Datadog、Prometheus Alertmanager 已正式接入。

### 7.7 安全与隐私设计

明确可见的安全设计：

- Cookie 为 HttpOnly。
- SameSite=Strict。
- 登录相关有 rate limit。
- 管理动作和认证动作有审计日志。
- API 默认 no-store / no-cache。

本轮未能确认但不能臆测的内容：

- 是否有静态数据加密。
- 是否有租户级隔离。
- 是否有正式的敏感词或 PII 检测链。

## 8. 当前开发状态与路线图

### 8.1 已完成或已具备主线能力的模块

从当前代码和 README 看，以下模块属于“已经存在真实实现”的范畴：

- 认证与管理员初始化
- 用户注册与会话管理
- 项目、阶段、任务、交付物基础模型
- Project Room
- Agent Commander
- OpenClaw 工作区集成
- system runtime / protocol / audit / observability 系列路由
- knowledge-v2
- workflow-v2 核心编排代码
- 健康检查、Smoke、Closure、单项目审计脚本

### 8.2 接近完成或处于深化中的模块

- workflow-v2 作为未来主线正在深化，V1 仍保留。
- Hermes、Stitch、GitLab 等外部能力已有正式集成代码，但其稳定性仍受环境与外部服务影响。
- 前端已经拆分为更清晰的 page / feature 结构，但 `App.tsx` 仍承担大量 orchestration。

### 8.3 正在攻坚或仍有明显复杂性的区域

从代码结构和 README 侧重点推测，但不夸大为未证实事实：

- 真实模型门禁与路由稳定性。
- 阶段推进的收敛性与恢复策略。
- 设计阶段链路，尤其是 Hermes / Stitch / 设计模型策略协同。
- V1 到 workflow-v2 的演进统一。

这里之所以可以写，是因为这些主题已经直接出现在 README、system 模块和 workflow-v2 模块中，而不是凭空猜测。

### 8.4 已知技术债务与瓶颈

基于当前仓库可直接确认的技术债务：

1. V1 与 V2 并存  
   `projects.ts` 已标“V1 维护模式”，说明系统正在迁移，但仍需维持兼容。

2. 前端全局壳仍较重  
   虽然已有前端重构文档，但 `App.tsx` 仍是强 orchestrator。

3. 外部依赖波动会直接影响平台稳定性  
   这不是假设，因为代码里已经写了大量 cooldown、fallback、self-heal 和 probe 逻辑。

4. 工作区与平台双数据面增加复杂度  
   前端 `useRealData()` 需要合并 managed agents、OpenClaw 数据和 core project data，并处理回退。

### 8.5 下一步里程碑

基于仓库内 `LATEST_PRODUCT_PROPOSAL.md`，可合理确认的近期方向包括：

- 强化真实模型链路稳定性
- 提升多项目并发推进下的公平性和限流
- 补齐组织级权限与团队治理能力

这里要特别说明：

- 这些内容在仓库文档中明确写成“近期路线”，因此可以写作“规划中”。
- 不能把它们表述成“已经完成”。

## 9. 本轮核对结论

### 9.1 可以确定的结论

- 这是一个真实工程化平台，不是静态演示页。
- 当前正式产品名称仍应以 `Agent Collaboration Workbench` / `OCC` 为准。
- `8787` 端口服务已运行，并且当前受认证保护。
- 平台主线能力已经覆盖认证、项目推进、Agent 管理、OpenClaw 集成、系统治理、知识库和 workflow-v2。
- Hermes、Stitch、GitLab 都不是“PPT 概念”，而是已经在代码中落了正式集成点。

### 9.2 本轮不能越界声称的内容

- 不能声称当前环境下所有外部集成都已在线可用，因为本轮未完成登录态下的逐项实测。
- 不能声称 Aegis OS 是正式项目名。
- 不能声称平台已使用独立向量数据库或成熟 RAG 基础设施，因为本轮未发现明确证据。
- 不能声称所有前端入口都已把 workflow-v2 单独完整显式化，因为目前更多是底层支撑与局部调用。

### 9.3 推荐对外描述方式

如果要对外或对新同事介绍，最稳妥的说法是：

> Agent Collaboration Workbench（OCC）是一个面向多 Agent 项目交付的工程化协作平台。它已经实现了认证、项目阶段推进、Agent 指挥、运行时治理、知识沉淀、OpenClaw 工作区联动，以及 workflow-v2 编排主链路；同时保留了对 Hermes、GitLab 和 Stitch 的正式集成能力。当前系统已具备真实可运行基础，但部分外部能力的最终效果仍依赖具体环境配置与登录态实测。

