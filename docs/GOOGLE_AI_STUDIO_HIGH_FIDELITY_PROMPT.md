# Google AI Studio 高保真页面方案超强 Prompt

## 1. 文档用途

这份文档用于直接提供给 Google AI Studio，让它优先输出“高保真页面方案”，而不是泛泛的产品建议或抽象设计思路。

适用场景：

- 你已经有产品需求文档
- 你希望 Google AI Studio 直接开始做页面级设计
- 你希望它输出更接近高保真页面说明、线框描述、布局结构、组件层级和视觉系统
- 你希望它围绕 Agent 协作工作台，而不是误解成聊天工具或普通后台

## 2. 推荐搭配材料

建议一起提供给 Google AI Studio：

- 产品 PRD：`docs/product-requirements.md`
- 前端设计 Brief：`docs/GOOGLE_AI_STUDIO_FRONTEND_BRIEF.md`
- 本文档：`docs/GOOGLE_AI_STUDIO_HIGH_FIDELITY_PROMPT.md`

## 3. 使用目标

通过这份 Prompt，希望 Google AI Studio 直接输出：

- 高保真页面方案
- 逐页结构描述
- 页面模块层级
- 关键组件设计
- 设计系统建议
- 视觉方向建议
- 双语文案建议
- 可直接交给前端工程师继续落地的页面说明

## 4. 超强中文版 Prompt

以下 Prompt 可直接复制给 Google AI Studio：

```text
你现在不是普通问答助手，而是一位顶级的企业级 SaaS 产品设计总监、前端体验架构师、B2B 工作台设计专家。

你的任务不是给我简短建议，而是直接为我产出一套“高保真页面方案级别”的前端设计输出。

请把自己当成正在为一个即将发布生产环境的 SaaS 产品做主视觉和页面架构设计。你的输出要足够细，细到前端设计师、UI 设计师、前端工程师都能继续往下实现。

我要做的产品叫：
Agent 协作工作台

它是一个基于真实 OpenClaw 工作区的 AI Agent 团队协作平台。
用户不是在这里和单个 AI 聊天，而是在这里管理：
- 项目
- Agent 团队
- 任务
- 交付物
- 模型
- SOUL
- SOP
- 审批与确认
- 运行状态
- 审计日志

请把这个产品理解为：
一个面向 2026 年的专业 AI Agent Team Operating System / SaaS Command Center。

请严格遵守以下前提：
1. 这不是聊天机器人产品。
2. 这不是普通任务管理后台。
3. 这不是营销官网。
4. 这不是演示性质的 AI 面板。
5. 这是一个真实、专业、可生产发布的 Agent 团队协作工作台。

我希望你这次不要只输出策略，而是直接输出“高保真页面方案”。

请把输出目标理解为：
- 逐页页面结构已经非常清晰
- 页面模块分布已经非常明确
- 视觉风格已经有明确方向
- 关键组件已经具备明确表现形式
- 前端工程团队可以直接参考实现

产品核心要求如下：

1. 用户进入平台后，第一眼能快速看懂：
- 当前有哪些项目在运行
- 哪些项目有风险
- 哪些 Agent 忙
- 哪些任务阻塞
- 哪些事项等待确认

2. 用户必须能够进入项目维度查看：
- 项目阶段
- 任务分配
- 交付物
- 时间线
- 项目相关 Agent
- 风险与阻塞

3. 用户必须能够进入单个 Agent 页面，对 Agent 进行：
- 模型选择和切换
- 下达任务
- 查看最近会话和执行结果
- 编辑 SOUL
- 编辑 SOP
- 选择执行策略

4. Agent 在执行任务前，必须先生成“理解确认卡”，由用户确认后再执行。

5. 用户也可以勾选“直接由你决定”模式，让 Agent 持续自主推进，仅在重大风险时请求确认。

6. 整个平台必须支持中英文切换。

7. 整体体验要有 2026 年高级 SaaS 产品的质感，不要粗糙，不要像 demo。

请输出以下页面的高保真方案：
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

请特别重点展开 Agent Commander 页面，它是这个产品最重要的页面之一。

Agent Commander 页面必须包含：
- Agent 顶部头部区
- Agent 身份信息区
- 当前模型区
- 候选模型区
- 模型标签区
- 默认模型 / 备用模型概念
- 执行策略开关区
- 任务输入区
- 快捷操作区
- 理解确认卡区
- 当前任务区
- 历史任务区
- 最近会话区
- 最近回复与总结区
- 执行日志区
- SOUL 编辑区
- SOP 编辑区

在这个页面中，请重点设计：

A. 模型切换体验
- 当前生效模型如何展示
- 候选模型如何排列
- 推荐模型如何高亮
- 切换成功、切换失败、模型不可用如何呈现

B. 理解确认卡
- 这张卡片必须是视觉焦点之一
- 要清晰展示：
  - 我理解你的目标
  - 我计划如何执行
  - 我会拆成哪些步骤
  - 风险点
  - 推荐方案
  - 待你确认的点

C. 确认交互
- 确认并执行
- 修改后再理解
- 仅分析不执行
- 更换模型后重试
- 转交其他 Agent
- 取消任务

D. 自主模式
- 默认模式：执行前确认
- 自主模式：直接由你决定
- 自主模式启用后必须有明显视觉提示
- 仅在重大风险、依赖缺失、权限不足、冲突、成本超限时再请求确认

请采用真正专业的 SaaS 工作台布局：
- 左侧固定导航
- 顶部工作区栏
- 中间主内容区
- 必要时使用右侧信息栏或抽屉

请采用 2026 年高级 SaaS 视觉语言：
- 高级
- 专业
- 克制
- 清晰
- 稳定
- 层级明确
- 长时间使用不疲劳

请明确避免：
- 像普通后台管理系统
- 像企业 ERP 表单
- 像 AI 聊天机器人
- 像营销官网
- 像黑客风或霓虹风 demo
- 卡片过多且缺乏主次

请支持中英文双语设计：
- 导航双语兼容
- 页面标题双语兼容
- 按钮双语兼容
- 状态标签双语兼容
- 中英文切换后布局不能崩

请考虑桌面端、平板端、手机端，但本次重点先输出桌面端高保真方案。

请使用真实感较强的示例业务数据，而不是 placeholder：

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

现在请你按照下面的固定结构输出，并尽量详细，不要省略：

1. 总体设计定位
请说明：
- 产品应该呈现成什么样的工作台气质
- 为什么这种气质适合 Agent 协作平台

2. 整体视觉方向
请明确：
- 推荐浅色还是深色
- 背景与面板的关系
- 强调色策略
- 字体策略
- 为什么这样更适合长期工作使用

3. 设计系统建议
请输出：
- 主色
- 辅助色
- 成功 / 风险 / 危险色
- 字体组合
- 间距系统
- 圆角系统
- 阴影系统
- 边框系统
- 标签、按钮、输入框、卡片、表格、日志流、确认卡的风格原则

4. 信息架构与导航
请明确：
- 左侧导航结构
- 顶部导航结构
- 页面间跳转关系
- 哪些页面适合有二级 tab
- 哪些页面适合抽屉或右栏

5. 逐页高保真页面方案
请对每一个页面分别输出：
- 页面目标
- 首屏布局结构
- 模块上下关系
- 模块左右关系
- 重点视觉焦点
- 页面中的主要卡片和组件
- 主操作按钮位置
- 次操作按钮位置
- 关键状态设计
- 页面节奏和信息密度建议

6. Agent Commander 高保真专项方案
请重点展开：
- 页面首屏结构
- 三栏或双栏建议
- 头部信息布局
- 模型切换区布局
- 指令输入区布局
- 理解确认卡视觉结构
- 当前任务 / 历史任务 / 会话日志 / SOUL / SOP 如何排布
- 在等待确认、自主执行、模型不可用、Agent 离线时各自的视觉处理

7. Dashboard 高保真专项方案
请重点展开：
- 如何在首屏 10 秒内让用户看懂全局状态
- 哪些指标必须上首屏
- 哪些内容适合卡片
- 哪些内容适合列表或时间线

8. Project Room 高保真专项方案
请重点展开：
- 阶段条如何设计
- 任务板如何设计
- 交付物如何展示
- 时间线和广播区如何布局

9. 页面状态设计
请针对全平台给出统一设计建议：
- Loading
- Empty
- Error
- Success
- Waiting for confirmation
- Autonomous mode enabled
- Agent offline
- Model unavailable
- Task blocked

10. 双语文案建议
请输出：
- 左侧导航文案中英对照
- 页面标题中英对照
- 核心按钮中英对照
- Agent Commander 里的确认动作中英对照

11. 可直接交给前端实现的建议
请输出：
- 页面级组件划分建议
- 哪些区域适合 sticky
- 哪些区域适合 drawer
- 哪些区域适合 tab
- 哪些区域适合 timeline
- 哪些区域适合 editor

12. 最后请补充一个“页面优先级建议”
请告诉我：
- 如果只优先设计 4 个最重要页面，应该先做哪 4 个
- 如果只优先落地一个核心闭环，应先打通哪条路径

重要要求：
- 不要只写抽象概念
- 不要只写几段简短建议
- 请写成真正能指导高保真页面设计的方案
- 如果合适，请直接用接近线框图说明的方式描述布局
- 如果合适，请直接写出每个页面第一屏应该出现什么
```

## 5. 英文版超强 Prompt

如果你希望 Google AI Studio 在英文语境下输出更稳定，可以使用下面这版：

```text
You are not a generic assistant. You are a world-class enterprise SaaS design director, frontend UX architect, and B2B workspace design expert.

Your task is not to give short advice. Your task is to directly produce a high-fidelity page-plan-level frontend design output.

Act as if you are designing the primary UI system and page architecture for a production-grade SaaS product that is about to ship.

The product is called:
Agent Collaboration Workbench

It is an AI agent team collaboration platform connected to a real OpenClaw workspace.
Users do not come here to chat with one AI. They come here to manage:
- projects
- agent teams
- tasks
- deliverables
- models
- SOUL
- SOP
- approvals and confirmations
- runtime status
- audit logs

Treat this product as:
a 2026-grade AI Agent Team Operating System / SaaS Command Center.

Please strictly follow these assumptions:
1. This is not a chatbot product.
2. This is not a generic task management admin panel.
3. This is not a marketing website.
4. This is not a demo-style AI console.
5. This is a real, professional, production-ready agent team collaboration platform.

This time, do not only provide strategy. Directly produce a high-fidelity page-plan-level output.

Your output should be detailed enough that:
- page structures are very clear
- module hierarchy is obvious
- visual direction is explicit
- component presentation is concrete
- frontend teams can directly continue implementation

Core product requirements:
1. On first entry, users must quickly understand:
- what projects are active
- which projects are risky
- which agents are overloaded
- which tasks are blocked
- which items are waiting for confirmation

2. At the project level, users must be able to inspect:
- project phases
- task assignments
- deliverables
- timeline
- related agents
- risks and blockers

3. At the single-agent level, users must be able to:
- select and switch models
- assign tasks
- inspect sessions and results
- edit SOUL
- edit SOP
- choose execution strategy

4. Before executing a task, the agent must first generate an understanding confirmation card for the user to confirm.

5. Users may also enable a “decide for me” mode so the agent can continue autonomously and only ask for confirmation on major risk.

6. The entire platform must support Chinese and English switching.

7. The overall experience must feel like a premium 2026 SaaS product, not rough, not demo-like.

Design these pages:
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

The Agent Commander page is one of the most important pages and must be expanded in detail.

The Agent Commander page must include:
- agent top header
- identity and role block
- current model area
- candidate models area
- model labels
- default model / fallback model concepts
- execution strategy switcher
- task input area
- quick action area
- understanding confirmation card
- current task area
- history task area
- recent sessions area
- latest replies and summaries
- execution log area
- SOUL editor
- SOP editor

In this page, please focus on:

A. Model switching experience
- how current active model is shown
- how candidate models are arranged
- how recommended models are highlighted
- how success, failure, and unavailable states are shown

B. Understanding confirmation card
- this card must be one of the visual focal points
- it should clearly show:
  - what I understand your goal to be
  - how I plan to execute
  - how I will break it down
  - risks
  - recommended approach
  - what needs your confirmation

C. Confirmation interactions
- Confirm and Execute
- Revise and Re-understand
- Analyze Only
- Retry with Another Model
- Reassign to Another Agent
- Cancel Task

D. Autonomous mode
- default mode: confirm before execution
- autonomous mode: decide for me
- autonomous mode must have an obvious visual indicator
- only ask for confirmation on major risk, missing dependency, permission limits, conflict, or cost threshold

Use a truly professional SaaS workspace layout:
- fixed left navigation
- top workspace header
- central main content area
- right-side details rail or drawer where useful

Use a premium 2026 SaaS visual language:
- premium
- professional
- restrained
- clear
- stable
- well-layered
- comfortable for long-duration use

Explicitly avoid:
- generic admin dashboards
- ERP-heavy forms
- chatbot-like UIs
- marketing site aesthetics
- hacker or neon AI demo styles
- card overload without hierarchy

Support bilingual UI:
- bilingual navigation
- bilingual titles
- bilingual buttons
- bilingual status labels
- layout must remain stable after language switching

Consider desktop, tablet, and mobile, but prioritize desktop high-fidelity output for this round.

Use realistic example data instead of placeholders:

Demo project:
- name: test SaaS management workbench demo
- description: a real project demonstrating an end-to-end workflow from requirements, design, architecture, development, to QA
- related agents: requirements_analyst, jeremy, rd_manager, qa_engineer
- deliverables: README, requirements, prototype, architecture, demo, test report

Demo agents:
- requirements_analyst: requirement decomposition and goal clarification
- jeremy: design director for UX direction, interface design, interaction logic, and visual quality
- rd_manager: engineering lead for task decomposition, delivery coordination, and technical execution
- qa_engineer: QA specialist for validation, risk checks, and testing reports

Now output in the following exact structure, in as much detail as possible:

1. Overall design positioning
Explain:
- what kind of workspace character this product should have
- why that character fits an agent collaboration platform

2. Overall visual direction
Explain:
- whether you recommend light or dark
- the relationship between page background and surfaces
- accent color strategy
- typography strategy
- why this is suitable for long-duration use

3. Design system recommendations
Provide:
- primary colors
- support colors
- success / warning / danger colors
- typography pairing
- spacing system
- radius system
- shadow system
- border system
- style principles for badges, buttons, inputs, cards, tables, log streams, and confirmation cards

4. Information architecture and navigation
Explain:
- left navigation structure
- top header structure
- page transitions
- which pages should use tabs
- which pages should use drawers or right rails

5. Page-by-page high-fidelity page plan
For each page, provide:
- page goal
- first-screen layout structure
- vertical module order
- horizontal module relationship
- visual focal points
- main cards and components
- primary action placement
- secondary action placement
- key states
- page rhythm and information density guidance

6. Agent Commander high-fidelity deep dive
Expand:
- first-screen structure
- whether the page should be two-column or three-column
- header information layout
- model switching area layout
- command input area layout
- confirmation card visual structure
- how current tasks, history, sessions, SOUL, and SOP should be arranged
- how to visually handle waiting for confirmation, autonomous mode, model unavailable, and agent offline

7. Dashboard high-fidelity deep dive
Expand:
- how users understand global status within 10 seconds
- which metrics must be above the fold
- what should be cards vs lists vs timeline

8. Project Room high-fidelity deep dive
Expand:
- phase rail design
- task board design
- deliverable presentation
- timeline and broadcast layout

9. Page state design
Provide unified design guidance for:
- Loading
- Empty
- Error
- Success
- Waiting for confirmation
- Autonomous mode enabled
- Agent offline
- Model unavailable
- Task blocked

10. Bilingual copy suggestions
Provide:
- left navigation labels in Chinese and English
- page titles in Chinese and English
- core button labels in Chinese and English
- Agent Commander confirmation actions in Chinese and English

11. Implementation-oriented frontend suggestions
Provide:
- page-level component breakdown suggestions
- which areas should be sticky
- which areas should use drawers
- which areas should use tabs
- which areas should use timeline
- which areas should use editor patterns

12. Finally provide a page priority recommendation
Tell me:
- if only 4 pages should be designed first, which 4
- if only one core workflow should be implemented first, which workflow should be prioritized

Important:
- do not stay abstract
- do not provide only short generic guidance
- write it as a true high-fidelity page-design-ready plan
- if useful, describe layouts almost like wireframes
- if useful, explicitly describe what appears above the fold on each page
```

## 6. 第一轮后继续追问的增强 Prompt

如果 Google AI Studio 第一轮输出还不够细，可以继续追加下面这一段：

```text
请继续把上一版方案展开成更接近高保真设计稿说明的级别。

这次请不要重复概念，请重点补充：
- 每个页面第一屏具体出现什么
- 每个页面的主视觉焦点是什么
- 每个页面左右分栏怎么分
- 卡片和列表各自适合承载什么信息
- Agent Commander 页面中理解确认卡、模型切换、SOUL/SOP、当前任务、最近会话如何形成清晰层级
- Dashboard、Project Room、Agent Commander、System 四个页面请重点细化

请尽量用接近线框图解说的方式来描述页面布局。
```

## 7. 最推荐的使用顺序

建议你这样发给 Google AI Studio：

1. 先发送 `docs/product-requirements.md`
2. 再发送 `docs/GOOGLE_AI_STUDIO_FRONTEND_BRIEF.md`
3. 最后发送本文件里的第 4 节超强中文版 Prompt
4. 如果它输出偏浅，再继续发送第 6 节增强 Prompt

这样通常比单独发一小段 prompt，能拿到更稳定的高保真输出。
