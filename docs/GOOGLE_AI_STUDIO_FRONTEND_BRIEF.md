# Google AI Studio 前端设计需求文档完整版

## 1. 文档定位

这是一份专门提供给 Google AI Studio 的前端设计需求文档，用于让其基于真实产品目标，输出一套完整、专业、现代、可落地的 Agent 协作工作台前端设计方案。

这份文档的目标不是让它设计一个普通后台页面，而是让它围绕“Agent 团队协作平台”这一核心命题，设计出一套面向 2026 年 SaaS 管理平台风格、强调可观测、可指挥、可确认、可运维的完整前端体验。

## 2. 项目背景

我们正在打造一个 Agent 协作工作台，底层真实连接 OpenClaw 工作区。这个平台不是聊天机器人页面，而是一个能管理项目、Agent、任务、交付物、模型、SOUL、SOP、运行状态和确认机制的 AI 工作台。

平台的目标用户是独立开发者、AI 产品负责人、创始人、项目经理，以及希望把多个 Agent 作为数字团队来协作管理的人。

平台当前已经具备以下方向：

- 已有真实 OpenClaw 项目数据接入能力
- 已有项目、Agent、系统页面基础
- 已支持中英文切换
- 已支持展示真实项目文档、任务、状态
- 已支持编辑 SOUL / SOP
- 已支持运行监控和审计能力

但是我们希望 Google AI Studio 帮我们进一步完成更高质量的前端页面设计与交互补强，使整个系统达到真正专业 SaaS 平台的产品表现。

## 3. 设计目标

需要 Google AI Studio 输出的不是“单页好看界面”，而是“完整的前端工作台设计方案”。

设计目标如下：

- 让平台看起来像专业 SaaS 管理工作台，而不是 demo
- 让用户能快速看懂项目、任务、Agent、风险和交付状态
- 让用户能在单个 Agent 页面上进行模型切换、任务下达、确认执行和持续跟进
- 让系统在复杂信息下仍然清晰、可扫读、可操作
- 让页面结构适合桌面端，也兼顾平板与手机查看
- 让视觉风格具备 2026 年先进软件产品的质感

## 4. 产品一句话定义

一个基于真实 Agent 团队协作的 AI 项目作战与运营平台。

## 5. 核心产品原则

- 不是聊天工具，而是团队协作运营平台
- 不是普通任务板，而是项目与 Agent 的联合作战中台
- 不是黑盒自动执行，而是“先理解、后执行、关键节点确认”
- 不是纯展示，而是支持真实管理、指挥、配置与回写
- 少填空，多选择，多确认卡，多结构化交互

## 6. 目标用户

### 6.1 核心用户

- 独立开发者
- AI 产品经理
- 项目负责人
- 创始人
- 小型 AI 团队管理者

### 6.2 用户核心诉求

- 看到当前有哪些项目在跑
- 知道每个项目进度与风险
- 知道每个 Agent 当前做什么
- 能向某个 Agent 单独下达任务
- 能在执行前查看 Agent 是否理解正确
- 能修改 Agent 的模型、人格和 SOP
- 能在平台上进行监控与管理，而不是只看对话

## 7. 信息架构

请围绕以下一级导航模块进行设计：

- Dashboard 仪表盘
- Projects 项目中心
- OpenClaw Workspace 工作区
- Agents Agent 中心
- Agent Commander 单独 Agent 指挥页
- Project Room 项目作战室
- System 系统运行中心
- Audit 审计日志
- Settings 设置

建议采用标准 SaaS 结构：

- 左侧固定导航栏
- 顶部工作区标题栏
- 中间主内容区
- 局部详情抽屉 / 右侧信息面板

## 8. 页面设计范围

### 8.1 登录页

要体现：

- 安全、克制、专业
- 支持管理员登录
- 支持品牌欢迎语
- 支持系统状态提示

### 8.2 Dashboard 仪表盘

需要展示：

- 平台整体运行概览
- 项目总数、活跃项目、阻塞项目、待确认事项、活跃 Agent、系统异常
- 活跃项目列表
- 最近交付动态
- 待确认卡片
- 团队工作负载总览
- 快速入口区

### 8.3 Projects 项目中心

需要展示：

- 项目列表
- 项目状态
- 当前阶段
- 当前负责人
- 进度条
- 风险标签
- 更新时间
- 搜索和筛选

### 8.4 Project Room 项目作战室

这是项目维度的核心详情页，需要展示：

- 项目头部摘要
- 项目阶段进度
- 当前焦点
- 相关 Agent
- 任务板
- 交付物区
- 时间线
- 审批与确认区
- 项目广播区

页面要让用户像进入一个项目控制室，而不是只是看到列表。

### 8.5 OpenClaw Workspace 工作区页

这是连接真实 OpenClaw 工作区的页面，需要展示：

- 真实项目列表
- 项目路径
- 项目状态
- 任务数
- 阻塞数
- Agent 数
- 心跳或 SLA 状态
- 未挂项目的 Agent
- 文档与任务回写能力入口

### 8.6 Agents Agent 中心

需要展示所有 Agent 的概况：

- 名称
- 角色
- 介绍
- 当前状态
- 负载
- 活跃任务数
- 技能评分
- 风格标签
- 最近亮点
- 当前模型

这个页面更像“团队画像和资源调度台”。

### 8.7 Agent Commander 单独 Agent 指挥页

这是本平台最关键的新增设计页面，必须重点设计。

这个页面是用户进入某一个 Agent 后的专属操作台，用于：

- 查看这个 Agent 的完整信息
- 为其切换模型
- 向其下达任务
- 在执行前查看其理解与计划
- 确认是否执行
- 在需要时开启“直接由你决定”模式
- 查看该 Agent 当前任务、历史任务、会话记录与执行结果
- 编辑 SOUL 与 SOP

#### 页面必须包含以下模块

- Agent 头部卡
- 角色与介绍信息
- 当前模型与可切换模型区
- 执行策略区
- 指令输入与快捷指令区
- 理解确认卡区
- 当前任务区
- 历史任务区
- 最近对话 / 会话区
- 最近回复与结论区
- SOUL 编辑器
- SOP 编辑器
- 执行日志 / 状态区

#### 需要特别体现的交互

##### A. 模型选择与切换

用户可以：

- 查看当前模型
- 切换模型
- 查看推荐模型
- 查看模型标签，例如推理强、响应快、成本低、多模态
- 设置默认模型和备用模型

视觉上需要体现：

- 当前生效模型
- 候选模型列表
- 切换反馈
- 异常状态

##### B. 指令下达机制

用户可以：

- 通过专门的输入面板向 Agent 下达任务
- 使用快捷操作，例如“请分析”“请拆解”“请执行”“请汇报”“请修复”“请设计”
- 添加补充说明

##### C. 执行前理解确认

在 Agent 真正开始执行前，必须先生成理解确认卡。

理解确认卡包含：

- 我理解你的目标
- 我准备如何执行
- 我会拆成哪些步骤
- 我识别到的风险
- 我建议的方案
- 我需要你确认的点

确认操作要以按钮和选择项为主：

- 确认并执行
- 修改后再理解
- 仅分析不执行
- 更换模型后重试
- 转交其他 Agent
- 取消任务

##### D. “直接由你决定”模式

用户可以勾选一个明确的策略开关：

- 默认：执行前必须确认
- 自主：Agent 自主判断并持续执行

开启自主模式后：

- Agent 不再频繁打断用户
- 仅在重大风险、权限不足、依赖缺失、冲突和成本超限时才请求确认
- 页面要强提示当前处于自主执行模式

##### E. SOUL / SOP 编辑

用户可以直接在单独 Agent 页面编辑：

- SOUL：人格、风格、原则、表达方式
- SOP：标准流程、交付规范、质量检查、升级机制

页面需要把“内容编辑”和“运行配置”很好地结合在一起。

### 8.8 System 系统运行中心

需要展示：

- 运行模式
- 当前默认模型
- API 健康状态
- 服务健康
- 最近校验时间
- 最近错误
- 关键告警

### 8.9 Audit 审计日志页

需要展示：

- 登录记录
- 配置修改
- 模型切换
- Agent 指令下达
- 项目操作
- 任务回写
- SOUL / SOP 修改

## 9. 视觉风格要求

### 9.1 整体风格

请采用 2026 年专业 SaaS 管理产品的视觉风格，要求：

- 高级感
- 克制但不无聊
- 信息密度高但不乱
- 强调层级和系统感
- 适合长期工作使用

避免以下问题：

- 像传统企业后台
- 像简单聊天框
- 像大面积空白的营销页
- 像 AI demo 页面
- 颜色廉价、卡片堆砌粗糙、布局松散

### 9.2 设计关键词

- SaaS
- Command Center
- Operator Console
- Intelligence Dashboard
- Structured Collaboration
- Professional
- Premium
- Calm
- Clear

### 9.3 建议视觉方向

- 深色高级中台风或浅色高端运营台二选一，但整体必须统一
- 使用高质量卡片、细腻边框、微妙层次阴影
- 使用清晰的状态色系统
- 字体系统要有明显识别度
- 支持数据卡、日志流、步骤条、状态条、标签、对比卡、确认卡

### 9.4 颜色建议

可以参考如下方向，但允许更优方案：

- 背景主色：深海蓝、石墨灰、冷白、浅雾灰等高级基底
- 强调色：青蓝、钴蓝、暖金、珊瑚橙中的一组主强调
- 成功色：绿色系
- 风险色：琥珀色
- 危险色：红色系

注意：

- 避免俗气紫色默认 AI 配色
- 避免高饱和大面积堆叠
- 避免花哨霓虹风压过可读性

### 9.5 字体建议

- 中文正文可偏现代几何风格
- 英文标题可以更有品牌感
- 数字与日志建议使用等宽字体

## 10. 交互设计原则

- 少填空，多选择
- 重要动作有确认
- 当前状态一眼可读
- 所有异步动作有反馈
- 无数据、错误、加载、空状态都要精心设计
- 用户不要被复杂流程压住，而是被引导

## 11. 中英文切换要求

必须支持中英文切换：

- 顶部或全局显眼位置有语言切换
- 所有主要页面和按钮都需要双语文案设计
- 文案长度变化时布局不能崩
- 中英文都要自然，不只是直译

## 12. 响应式要求

### 12.1 桌面端

- 以主工作场景为核心
- 优先保证信息密度与操作效率
- Dashboard / Project Room / Agent Commander 允许复杂布局

### 12.2 平板端

- 导航可折叠
- 次要右栏可以抽屉化
- 卡片可以从多列改为双列

### 12.3 手机端

- 保留最重要查看能力
- 能查看项目状态、Agent 状态、任务、确认卡
- 能完成关键确认操作
- 能切换语言

## 13. 关键组件清单

请围绕以下组件体系设计：

- AppShell
- SidebarNav
- WorkspaceHeader
- GlobalSearch
- MetricCard
- ProjectCard
- ProjectStageRail
- DeliverableCard
- TimelineFeed
- TaskBoard
- AgentProfileCard
- AgentLoadCard
- AgentCommanderHeader
- ModelSwitcher
- StrategyToggle
- CommandComposer
- QuickCommandBar
- UnderstandingConfirmCard
- SessionLogPanel
- SoulEditor
- SopEditor
- RuntimeStatusCard
- AuditTable

## 14. 页面状态设计要求

所有核心页面都需要考虑：

- Loading
- Empty
- Error
- Success
- Partial data
- Waiting for confirmation
- Autonomous mode enabled
- Agent offline
- Model unavailable
- Task blocked

## 15. 示例业务数据要求

请在设计稿和页面示例中，不要只用 placeholder，而是尽量使用真实感更强的业务数据。

至少需要包含以下演示对象：

### 15.1 演示项目

- 项目名：test SaaS管理工作台演示
- 项目简介：一个用于演示 Agent 团队从需求、设计、架构、研发到测试闭环的真实示例项目
- 关联 Agent：requirements_analyst、jeremy、rd_manager、qa_engineer
- 交付物：README、requirements、prototype、architecture、demo、test report

### 15.2 演示 Agent

- requirements_analyst：负责需求拆解与目标澄清
- jeremy：设计总监，负责体验方向、界面设计、交互与视觉判断
- rd_manager：研发负责人，负责任务拆解、开发推进和技术协调
- qa_engineer：测试工程师，负责验证闭环、风险检查与测试报告

### 15.3 演示确认卡

示例：

- 用户要求 jeremy 设计一个 Agent 平台首页
- jeremy 先返回理解卡，说明他理解的目标、页面组成、设计方向、风险
- 用户可以点击“确认并执行”或“修改后再理解”

## 16. 输出要求

请让 Google AI Studio 输出以下内容：

### 16.1 设计策略

- 视觉方向说明
- 信息架构说明
- 交互原则说明

### 16.2 页面级方案

逐页输出：

- 页面目标
- 页面布局
- 主要模块
- 关键组件
- 用户操作路径

### 16.3 高保真设计建议

- 页面结构建议
- 栅格与间距建议
- 颜色与字体建议
- 卡片、标签、按钮、表格、日志流的风格建议

### 16.4 Agent Commander 专项设计

重点展开：

- 模型切换区
- 指令区
- 理解确认区
- 自主模式区
- SOUL / SOP 编辑区
- 当前任务区
- 会话与执行日志区

### 16.5 前端实现建议

请补充：

- 哪些区域适合卡片化
- 哪些区域适合分栏
- 哪些区域适合抽屉
- 哪些区域适合 tab
- 哪些区域需要固定操作区

### 16.6 最终交付形式

优先希望得到：

- 页面级说明
- 可视化布局草图描述
- 设计系统建议
- 每个页面的组件结构建议
- 可以直接转前端实现的说明

## 17. 不希望出现的问题

- 太像传统 ERP 或 OA
- 太像聊天机器人
- 太像 Notion 面板
- 太像黑客风 demo
- 太像营销官网
- 页面层级不清晰
- 卡片过多过乱
- Agent 页面没有体现“指挥”感
- 缺少确认交互的设计表达
- 没有把项目、Agent、任务、模型、SOUL/SOP 连成一个整体

## 18. Google AI Studio 投喂建议

为了让 Google AI Studio 更稳定地产出高质量结果，建议分两轮输入，而不是一次性只扔一句需求。

### 18.1 第一轮输入材料

建议一起提供：

- 产品 PRD：`docs/product-requirements.md`
- 前端设计 Brief：`docs/GOOGLE_AI_STUDIO_FRONTEND_BRIEF.md`

并明确告诉它：

- 先输出完整前端设计方案
- 暂时不要写前端代码
- 优先输出页面结构、组件关系、交互逻辑和视觉系统
- 输出内容要足够详细，能够继续交给前端工程师实现

### 18.2 第二轮追问目标

当它完成第一轮方案后，再继续追问：

- 继续展开成逐页高保真页面说明
- 继续输出更偏 React + Vite 落地的组件树和布局建议
- 继续补充中英文双语文案建议
- 继续补充 Agent Commander 页面所有状态流转
- 继续补充移动端适配策略

## 19. 更适合 Google AI Studio 的最终中文版 Prompt

以下是优化后的主 Prompt，重点增强了角色设定、输出结构、交付要求和避免泛泛而谈的约束，更适合 Google AI Studio：

```text
你现在是一位顶级的 B2B SaaS 产品设计师、AI 工作平台体验架构师、企业级前端信息架构设计师。

我需要你为一个“Agent 协作工作台”输出完整、系统、专业、可落地的前端设计方案。

这不是聊天机器人页面，不是普通任务看板，不是营销官网，也不是粗糙 demo。
它是一个真正用于管理 AI Agent 团队协作的 SaaS 平台，底层连接真实 OpenClaw 工作区。用户会在这个平台中管理：
- 项目
- Agent
- 任务
- 交付物
- 模型
- SOUL
- SOP
- 审批与确认机制
- 运行状态
- 审计日志

请你把它理解为：
一个面向 2026 年的专业 AI Agent Team Operating System / Command Center。

你的任务不是只给我一些设计建议，而是输出一份可以直接指导前端设计和前端研发落地的完整方案。

请严格遵守以下理解：
1. 这是一个 SaaS 管理工作台，不是聊天应用。
2. 用户管理的是“Agent 团队”，而不是单个对话。
3. 页面必须能体现项目管理、Agent 指挥、任务推进、交付追踪、模型管理、运行监控。
4. 平台必须支持中英文切换。
5. 平台要强调“先理解、后执行、关键节点确认”的机制。
6. 平台要支持“直接由你决定”的 Agent 自主模式。
7. 页面必须具有生产级产品质感，而不是演示感。

请围绕以下核心目标设计：
1. 用户进入平台后，10 秒内能看懂当前有哪些项目在跑、风险在哪、哪些 Agent 忙、哪些事情待确认。
2. 用户进入项目后，能清楚看到项目进度、任务、交付物、相关 Agent、时间线和阻塞点。
3. 用户进入某个 Agent 后，能对该 Agent 切换模型、下达任务、查看会话、编辑 SOUL 和 SOP。
4. 用户给 Agent 下达任务后，Agent 必须先返回“理解确认卡”，不能直接盲目执行。
5. 用户可以通过“确认并执行”“修改后再理解”“仅分析不执行”等选择式交互推进流程，而不是大量填空。
6. 如果用户勾选“直接由你决定”，则 Agent 可以持续自主推进，仅在重大风险时请求确认。

请为以下页面输出完整设计方案：
- Login 登录页
- Dashboard 仪表盘
- Projects 项目中心
- Project Room 项目作战室
- OpenClaw Workspace 工作区
- Agents Agent 中心
- Agent Commander 单独 Agent 指挥页
- System 系统运行中心
- Audit 审计日志
- Settings 设置

其中请把 Agent Commander 作为重点页面深入展开，它必须包含：
- Agent 头部信息区
- 角色与介绍信息
- 当前模型与可切换模型列表
- 模型标签，例如推理强、速度快、成本低、多模态
- 默认模型与备用模型概念
- 执行策略开关
- 指令输入区
- 快捷指令按钮，例如“请分析”“请拆解”“请执行”“请汇报”“请修复”“请设计”
- 理解确认卡区
- 当前任务区
- 历史任务区
- 最近会话区
- 最近回复与结论区
- 执行日志区
- SOUL 编辑器
- SOP 编辑器

请重点设计以下交互：

A. 模型切换
- 用户可以查看当前模型、候选模型、推荐模型、默认模型、备用模型
- 要体现模型切换前后的状态
- 要体现模型不可用时的禁用态和错误态

B. 执行前理解确认
- Agent 在执行前，必须先返回一张理解确认卡
- 卡内必须包含：
  - 我理解你的目标是什么
  - 我准备怎么做
  - 我会拆成哪些步骤
  - 我识别到了哪些风险
  - 我建议的执行路径
  - 我需要你确认哪些点

C. 选择式确认交互
- 确认并执行
- 修改后再理解
- 仅分析不执行
- 更换模型后重试
- 转交其他 Agent
- 取消任务

D. 自主执行模式
- 默认模式：执行前必须确认
- 自主模式：直接由你决定
- 当处于自主模式时，页面必须明显展示 Agent 正在自主推进
- 仅在重大风险、权限不足、依赖缺失、成本超限、冲突时再请求确认

请采用专业 SaaS 平台布局：
- 左侧固定导航
- 顶部工作区栏
- 中间主内容区
- 右侧详情面板或抽屉

请采用 2026 年高级 SaaS 产品风格，要求：
- 专业
- 高级
- 克制
- 清晰
- 有秩序
- 长时间使用不疲劳

请明确避免：
- 像聊天机器人
- 像普通企业后台
- 像营销官网
- 像 ERP 表单堆砌
- 像黑客风 AI demo
- 卡片混乱无主次

请考虑以下 UX 要求：
- 信息密度高但不乱
- 状态一眼可读
- 用户少填空，多选择
- 所有异步动作必须有反馈
- 所有核心页面都要考虑 Loading / Empty / Error / Success / Waiting for confirmation / Autonomous mode / Agent offline / Model unavailable / Task blocked
- 中英文切换后布局不能崩
- 桌面端优先，平板和手机也要给出合理适配策略

请使用更真实的业务示例，不要只用 placeholder：

示例项目：
- 项目名：test SaaS管理工作台演示
- 项目简介：用于演示 Agent 团队从需求、设计、架构、研发到测试闭环的真实项目
- 关联 Agent：requirements_analyst、jeremy、rd_manager、qa_engineer
- 交付物：README、requirements、prototype、architecture、demo、test report

示例 Agent：
- requirements_analyst：负责需求拆解与目标澄清
- jeremy：设计总监，负责体验方向、界面设计、交互与视觉判断
- rd_manager：研发负责人，负责任务拆解、开发推进和技术协调
- qa_engineer：测试工程师，负责验证闭环、风险检查与测试报告

请按以下固定结构输出，不要省略：

1. 项目理解与设计定位
2. 信息架构与导航结构
3. 视觉风格方向
4. 设计系统建议
5. 页面级方案
6. Agent Commander 专项深度设计
7. 关键交互流程说明
8. 页面状态设计
9. 响应式策略
10. 组件体系与职责
11. 适合 React + Vite 落地的前端结构建议
12. 中英文双语文案设计建议

在“页面级方案”部分，请逐页按下面格式输出：
- 页面目标
- 页面布局结构
- 页面主要模块
- 页面关键组件
- 页面核心用户路径
- 页面需要覆盖的状态

在“Agent Commander 专项深度设计”部分，请额外输出：
- 推荐线框结构描述
- 推荐分栏方式
- 理解确认卡结构
- 自主模式的视觉表达
- SOUL / SOP 编辑区布局建议
- 当前任务 / 历史任务 / 会话日志三者的关系处理

在“设计系统建议”部分，请明确给出：
- 颜色系统
- 字体系统
- 间距系统
- 圆角系统
- 边框与阴影系统
- 状态色系统
- 标签、按钮、卡片、表格、日志流、确认卡的风格原则

如果你认为有必要，可以补充：
- 低保真线框描述
- 页面区域层级说明
- 更适合 B2B SaaS 的两种视觉方向对比
- 更适合实现的组件拆分方式

请输出完整、深入、结构化、可直接执行的方案，不要给泛泛建议，不要只写几段概述。
```

## 20. 英文版 Prompt

如果你希望 Google AI Studio 更偏英文语境理解，也可以直接使用下面这个英文版 Prompt：

```text
Act as a world-class B2B SaaS product designer, AI workspace UX architect, and enterprise frontend information architect.

Design a complete frontend experience for an “Agent Collaboration Workbench”.

This is not a chatbot UI, not a simple kanban board, and not a marketing website. It is a production-grade SaaS platform for managing an AI agent team connected to a real OpenClaw workspace. Users manage:
- projects
- agents
- tasks
- deliverables
- models
- SOUL
- SOP
- approval and confirmation flows
- runtime status
- audit logs

Treat this product as a 2026-grade AI Agent Team Operating System / Command Center.

Your task is not to provide a few generic ideas. Your task is to produce a complete, structured, implementation-oriented frontend design plan that can directly guide UI design and frontend engineering.

Please follow these principles:
1. This is a SaaS management platform, not a chat app.
2. Users manage an agent team, not a single conversation.
3. The product must express project operations, agent command, task progress, deliverable tracking, model management, and runtime observability.
4. The platform must support bilingual Chinese and English UI.
5. The experience must reflect “understand first, execute later, confirm at key moments”.
6. The platform must support an autonomous “decide for me” mode for each agent.
7. The final UI must feel production-ready, premium, and operationally credible.

Design the following pages:
- Login
- Dashboard
- Projects
- Project Room
- OpenClaw Workspace
- Agents
- Agent Commander
- System
- Audit
- Settings

The most important page is Agent Commander. It must include:
- agent header
- role and introduction
- current model and switchable model list
- model labels such as reasoning-focused, speed-focused, low-cost, multimodal
- default model and fallback model concepts
- execution strategy toggle
- command input area
- quick actions like Analyze, Break Down, Execute, Report, Fix, Design
- understanding confirmation card
- current tasks
- task history
- recent sessions
- latest replies and conclusions
- execution logs
- SOUL editor
- SOP editor

The design must explicitly support:

A. Model switching
- current model
- candidate models
- recommended model
- default and fallback model
- state before/after switching
- unavailable/error states

B. Pre-execution understanding confirmation
- before execution, the agent must return a confirmation card
- the card must include:
  - what I understand your goal to be
  - how I plan to execute
  - how I would break it down
  - risks I identified
  - recommended execution path
  - what needs your confirmation

C. Choice-first confirmation interactions
- Confirm and Execute
- Revise and Re-understand
- Analyze Only
- Retry with Another Model
- Reassign to Another Agent
- Cancel Task

D. Autonomous mode
- default mode: confirmation required before execution
- autonomous mode: decide for me
- when autonomous mode is on, the UI must clearly show that the agent is operating autonomously
- only request human confirmation on major risk, missing dependency, permission limitation, cost threshold, or conflict

Use a professional SaaS layout:
- fixed left sidebar
- top workspace header
- central main content area
- right-side details panel or drawer where appropriate

Use a premium 2026 SaaS visual language:
- professional
- premium
- restrained
- clear
- orderly
- suitable for long-duration use

Avoid:
- chatbot-like layouts
- generic enterprise admin dashboards
- marketing-site aesthetics
- ERP-style form overload
- hacker-style AI demo visuals
- messy card grids with weak hierarchy

UX requirements:
- high information density without chaos
- instantly scannable states
- fewer freeform inputs, more structured choices
- explicit feedback for all async actions
- all core pages must consider Loading / Empty / Error / Success / Waiting for confirmation / Autonomous mode / Agent offline / Model unavailable / Task blocked
- bilingual layout must remain stable in both Chinese and English
- desktop-first, but include tablet and mobile adaptation strategy

Use realistic example data instead of placeholders:

Demo project:
- name: test SaaS management workbench demo
- description: a real example project demonstrating an end-to-end agent workflow from requirements, design, architecture, implementation, to QA
- related agents: requirements_analyst, jeremy, rd_manager, qa_engineer
- deliverables: README, requirements, prototype, architecture, demo, test report

Demo agents:
- requirements_analyst: requirement decomposition and goal clarification
- jeremy: design director responsible for experience direction, UI design, interaction logic, and visual quality
- rd_manager: engineering lead responsible for task decomposition, development coordination, and delivery progress
- qa_engineer: QA specialist responsible for validation, risk checks, and test reporting

Please output in this exact structure:
1. Product understanding and design positioning
2. Information architecture and navigation structure
3. Visual direction
4. Design system recommendations
5. Page-by-page design plan
6. Deep dive on Agent Commander
7. Key interaction flows
8. Page state design
9. Responsive strategy
10. Component system and responsibilities
11. Frontend structure recommendations suitable for React + Vite
12. Bilingual copywriting guidance

For each page in the page-by-page section, include:
- page goal
- layout structure
- main modules
- key components
- core user path
- required states

Do not provide a shallow summary. Produce a complete, deeply structured, implementation-oriented frontend design plan.
```

## 21. 继续追问 Google AI Studio 的增强 Prompt

如果 Google AI Studio 第一轮输出还不够细，可以继续追加下面这些追问：

### 21.1 追问一：逐页高保真说明

```text
请继续把上一版方案展开成逐页高保真前端说明。每个页面请增加：
- 更具体的首屏布局描述
- 模块上下关系
- 卡片与分栏的优先级
- 关键按钮位置
- 主操作与次操作层级
- 推荐的视觉节奏

请优先展开 Dashboard、Project Room、Agent Commander、System 四个页面。
```

### 21.2 追问二：更适合前端实现

```text
请继续把方案转换成更适合 React + Vite 落地的前端结构建议。
请输出：
- 页面级组件树
- 通用组件层
- 每页推荐拆分的模块
- 哪些区域适合 tabs、drawer、sticky panel、table、list、timeline、editor
- 哪些状态需要单独组件化
```

### 21.3 追问三：双语文案与状态

```text
请继续补充这套平台的中英文双语文案建议。
请重点输出：
- 左侧导航文案
- 页面标题文案
- 核心按钮文案
- Agent Commander 中的确认动作文案
- 空状态、错误状态、等待确认状态、自主模式状态的中英文文案
```

## 22. 建议使用方式

最推荐的使用顺序如下：

1. 先把 `docs/product-requirements.md` 和本文件一起提供给 Google AI Studio
2. 先使用第 19 节的中文版主 Prompt
3. 如果结果偏浅，再用第 21 节继续追问
4. 如果你发现它更擅长英文理解，再改用第 20 节英文版 Prompt

这样比单次输入一段短 Prompt，更容易得到稳定、完整、可落地的结果。
