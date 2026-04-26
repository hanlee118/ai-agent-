import type { StageType } from "@occ/shared";

export type DeliverableTemplateKind =
  | "charter"
  | "requirements_prd"
  | "schedule"
  | "presentation_ppt"
  | "implementation_word"
  | "implementation_result"
  | "runtime_delivery"
  | "design_review"
  | "visual_mockup"
  | "demo_prototype"
  | "test_report"
  | "product_backfill"
  | "generic";

export type DeliverableTemplate = {
  kind: DeliverableTemplateKind;
  label: string;
  requiredSections: string[];
  sectionBlueprint: string[];
  acceptanceChecklist: string[];
  authoringRules: string[];
  standardsProfile?: Array<{
    code: string;
    title: string;
    focus: string;
    source: string;
  }>;
};

export type DeliverableProfessionalEvidenceRule = {
  key: string;
  label: string;
  pattern: RegExp;
  minMatches?: number;
};

export type DeliverableProfessionalFormatRule = {
  requiredSections: string[];
  evidenceRules: DeliverableProfessionalEvidenceRule[];
  minBulletCount?: number;
  requireMarkdownTable?: boolean;
};

const TEMPLATE_LIBRARY: Record<DeliverableTemplateKind, DeliverableTemplate> = {
  charter: {
    kind: "charter",
    label: "项目章程模板",
    requiredSections: [
      "## 项目背景与目标",
      "## 范围定义（In Scope / Out of Scope）",
      "## 角色分工与责任",
      "## 治理机制与决策规则",
      "## 风险与应急预案"
    ],
    sectionBlueprint: [
      "- 背景必须可追溯到原始需求，不得泛化。",
      "- 范围边界至少列出 3 条 in-scope 与 2 条 out-of-scope。",
      "- 角色分工采用职责清单，标注 owner。"
    ],
    acceptanceChecklist: [
      "目标、范围、角色、风险四类信息完整且无冲突。",
      "关键决策规则清晰，出现阻塞时可直接执行。",
      "章程可作为分析阶段输入，不依赖口头补充。"
    ],
    authoringRules: [
      "优先写结论，再给证据与边界。",
      "避免口号式描述，要求条目可执行。"
    ],
    standardsProfile: [
      {
        code: "ISO/IEC/IEEE 15288:2023",
        title: "System life cycle processes",
        focus: "章程中的流程边界、角色职责与生命周期衔接需可追溯。",
        source: "https://www.iso.org/standard/81702.html"
      },
      {
        code: "ISO 31000:2018",
        title: "Risk management — Guidelines",
        focus: "风险识别、评估、应对与监控策略必须成体系。",
        source: "https://www.iso.org/standard/65694.html"
      }
    ]
  },
  requirements_prd: {
    kind: "requirements_prd",
    label: "需求分析 / PRD 模板",
    requiredSections: [
      "## 业务背景与问题定义",
      "## 用户场景与关键旅程",
      "## PRD 功能清单（MVP / 增强）",
      "## 验收标准与衡量指标",
      "## 风险、依赖与假设",
      "## 任务拆解与优先级"
    ],
    sectionBlueprint: [
      "- 必须先引用需求分析文档并标注输入来源，禁止脱离分析阶段直接写 PRD。",
      "- 每个功能项给出价值、边界、非目标。",
      "- 验收标准应可被测试与回归验证。",
      "- 任务拆解应与角色协作链路一一对应。"
    ],
    acceptanceChecklist: [
      "需求目标、用户场景、功能清单可形成闭环。",
      "验收标准可量化且可验证。",
      "风险与依赖项包含处理策略与责任人。"
    ],
    authoringRules: [
      "禁止只写抽象愿景，必须落到可执行条目。",
      "优先使用“用户行为 + 系统响应 + 验收方式”表达。"
    ],
    standardsProfile: [
      {
        code: "ISO/IEC/IEEE 29148:2018",
        title: "Requirements engineering",
        focus: "需求应具备可验证性、一致性、可追踪性并可回填。",
        source: "https://www.iso.org/standard/72089.html"
      },
      {
        code: "ISO/IEC 25010",
        title: "System and software quality models",
        focus: "验收指标需覆盖关键质量特性（如可靠性、易用性、可维护性）。",
        source: "https://www.iso.org/standard/35733.html"
      }
    ]
  },
  schedule: {
    kind: "schedule",
    label: "项目排期模板",
    requiredSections: [
      "## 里程碑总览",
      "## 迭代排期（周/冲刺）",
      "## 关键路径与外部依赖",
      "## 资源分配与职责 RACI",
      "## 缓冲策略与风险闸门"
    ],
    sectionBlueprint: [
      "- 里程碑须包含开始/结束/验收条件。",
      "- 标注关键路径中的前置依赖与阻塞处理。",
      "- 每个阶段给出交付产物与签核角色。"
    ],
    acceptanceChecklist: [
      "排期粒度可执行，且能映射到阶段任务。",
      "关键路径与缓冲策略明确。",
      "出现延期时有可触发的应急规则。"
    ],
    authoringRules: [
      "优先给时间与依赖，不写空泛“尽快推进”。",
      "排期必须覆盖验收门禁。"
    ],
    standardsProfile: [
      {
        code: "ISO 21502:2020",
        title: "Guidance on project management",
        focus: "排期必须覆盖里程碑、职责、依赖与监督控制机制。",
        source: "https://www.iso.org/standard/74947.html"
      },
      {
        code: "PMI Practice Standard for Scheduling",
        title: "Scheduling baseline and critical path",
        focus: "里程碑、关键路径、浮动缓冲与基线变更规则需要可审计。",
        source: "https://www.pmi.org/-/media/pmi/documents/public/pdf/certifications/practice-standard-scheduling.pdf"
      }
    ]
  },
  presentation_ppt: {
    kind: "presentation_ppt",
    label: "客户汇报 PPT 模板",
    requiredSections: [
      "## 演示目标与受众",
      "## PPT 页纲（逐页信息）",
      "## 核心论据与数据证据",
      "## 演示脚本与提问预案",
      "## 预约演示 CTA"
    ],
    sectionBlueprint: [
      "- 至少给出 8 页页纲（封面、问题、方案、价值、计划、风险、演示、CTA）。",
      "- 每页包含“标题 + 关键信息 + 讲解要点”。",
      "- 必须包含客户下一步行动入口。"
    ],
    acceptanceChecklist: [
      "结构完整，可直接用于客户汇报。",
      "论据与数据有来源或依据描述。",
      "CTA 明确且可执行（预约演示/评审会）。"
    ],
    authoringRules: [
      "避免纯口号或空页标题。",
      "每页只承载一个核心决策信息。"
    ]
  },
  implementation_word: {
    kind: "implementation_word",
    label: "技术实施方案模板",
    requiredSections: [
      "## 技术方案概览",
      "## 架构设计与模块边界",
      "## 数据结构与接口契约",
      "## 开发计划与任务拆解",
      "## 测试策略与发布计划",
      "## 风险与回滚方案"
    ],
    sectionBlueprint: [
      "- 架构部分至少包含上下游依赖与边界约束。",
      "- 接口契约应列关键字段、约束、错误处理。",
      "- 发布策略应包含灰度与回滚触发条件。"
    ],
    acceptanceChecklist: [
      "研发可直接按文档执行，无需额外口头同步。",
      "接口与数据约束可被联调和测试验证。",
      "风险与回滚路径清晰可执行。"
    ],
    authoringRules: [
      "优先给设计决策和权衡，不只给结果。",
      "对复杂模块补充输入/输出/失败处理。"
    ],
    standardsProfile: [
      {
        code: "IEEE 1016-2009",
        title: "Software Design Descriptions",
        focus: "设计文档应包含架构视图、接口、约束与设计决策组织结构。",
        source: "https://standards.ieee.org/standard/1016-2009.html"
      },
      {
        code: "OpenAPI Specification",
        title: "OAS (authoritative specs)",
        focus: "接口契约建议按 OAS 描述，便于联调、校验与自动化。",
        source: "https://spec.openapis.org/oas/"
      },
      {
        code: "ISO/IEC/IEEE 12207:2017",
        title: "Software life cycle processes",
        focus: "实施计划应覆盖开发、验证、发布与维护过程衔接。",
        source: "https://www.iso.org/standard/63712.html"
      }
    ]
  },
  implementation_result: {
    kind: "implementation_result",
    label: "实现结果说明模板",
    requiredSections: [
      "## 本轮实现范围",
      "## 页面 / 路由结果",
      "## 接口与数据链路",
      "## 代码改动清单",
      "## 验证结果与截图 / 日志",
      "## 已知问题与未完成项"
    ],
    sectionBlueprint: [
      "- 页面 / 路由至少列出 2 个真实访问路径或页面职责。",
      "- 接口与数据链路必须写清 API、数据源、存储或状态流转。",
      "- 代码改动清单至少包含 2 个真实文件路径。",
      "- 验证结果必须包含命令、日志、HTTP 结果或人工回归结论。"
    ],
    acceptanceChecklist: [
      "可证明存在真实实现，而不是只停留在设计或演示壳。",
      "页面、接口、代码路径、验证结果四类证据齐全。",
      "未完成项与风险边界清晰。"
    ],
    authoringRules: [
      "不要只写“已完成”，必须写清实现证据。",
      "优先给真实路径、接口、文件和验证结果。"
    ],
    standardsProfile: [
      {
        code: "ISO/IEC/IEEE 12207:2017",
        title: "Software life cycle processes",
        focus: "实现结果需体现构建、验证、配置与变更追踪证据。",
        source: "https://www.iso.org/standard/63712.html"
      },
      {
        code: "OpenAPI Specification",
        title: "OAS (authoritative specs)",
        focus: "对外接口变更应可映射到 API 契约版本与验证结果。",
        source: "https://spec.openapis.org/oas/"
      }
    ]
  },
  runtime_delivery: {
    kind: "runtime_delivery",
    label: "运行地址与部署说明模板",
    requiredSections: [
      "## 运行地址清单",
      "## 启动方式与环境变量",
      "## 部署拓扑与依赖",
      "## 联调 / 验证步骤",
      "## 监控与回滚方案"
    ],
    sectionBlueprint: [
      "- 地址清单需区分前端、后端、管理端或预发环境。",
      "- 环境变量说明必须包含关键配置项和来源。",
      "- 验证步骤至少给出 3 步可复现场景。",
      "- 回滚方案必须给触发条件。"
    ],
    acceptanceChecklist: [
      "第三方可按文档启动、访问和验证系统。",
      "关键地址、启动命令、环境变量、验证步骤齐全。",
      "部署依赖和回滚策略明确。"
    ],
    authoringRules: [
      "优先写可复现步骤，不写抽象部署概念。",
      "地址与命令必须可直接执行或核对。"
    ]
  },
  design_review: {
    kind: "design_review",
    label: "设计审查模板",
    requiredSections: [
      "## 视觉方案",
      "## 版式策略",
      "## 组件清单",
      "## 品牌语气",
      "## UX 原则",
      "## 可访问性检查",
      "## 设计审查卡"
    ],
    sectionBlueprint: [
      "- 输出视觉方向与品牌语气，避免模板化设计。",
      "- 版式策略应覆盖首屏到 CTA 的叙事路径。",
      "- 审查卡必须包含审查结论与改进建议。"
    ],
    acceptanceChecklist: [
      "设计说明可支撑开发实施，不依赖口头解释。",
      "无障碍检查项至少 3 条并可验证。",
      "审查结论明确（通过/驳回）且有理由。"
    ],
    authoringRules: [
      "避免泛化视觉词，需绑定业务场景。",
      "所有重点页面需给交互反馈策略。"
    ],
    standardsProfile: [
      {
        code: "IEEE 1016-2009",
        title: "Software Design Descriptions",
        focus: "设计审查应体现结构化设计描述与决策依据。",
        source: "https://standards.ieee.org/standard/1016-2009.html"
      },
      {
        code: "WCAG 2.2",
        title: "Web Content Accessibility Guidelines",
        focus: "可访问性检查需对应 WCAG 成功准则并可验证。",
        source: "https://www.w3.org/TR/WCAG22/"
      }
    ]
  },
  visual_mockup: {
    kind: "visual_mockup",
    label: "视觉定稿单页模板",
    requiredSections: [
      "## 视觉目标与范围",
      "## 布局与信息架构",
      "## 视觉规范（色彩 / 字体 / 间距）",
      "## 单页预览代码（HTML）",
      "## 交互与状态说明"
    ],
    sectionBlueprint: [
      "- 用页面结构解释业务主链路，不允许只写概念描述。",
      "- HTML 预览需可直接在浏览器打开并看到完整页面。",
      "- 交互说明至少覆盖主 CTA、悬停态与反馈态。"
    ],
    acceptanceChecklist: [
      "包含可渲染的单页 HTML 预览代码块（```html）。",
      "页面具备首屏价值主张、核心能力区块与主 CTA。",
      "视觉规范与交互说明可支撑开发阶段实现。"
    ],
    authoringRules: [
      "优先输出可确认视觉结果，再补充文档解释。",
      "禁止只给文字描述而没有可视化预览。"
    ]
  },
  demo_prototype: {
    kind: "demo_prototype",
    label: "Demo / 原型说明模板",
    requiredSections: [
      "## Demo 访问入口与环境",
      "## 页面清单与关键交互",
      "## 页面路由与核心流程（至少 3 页）",
      "## 真实数据链路（接口 / 数据源 / 存储）",
      "## 运行与联调说明（启动命令 / 环境变量）",
      "## 演示脚本（逐步）",
      "## 已实现能力与已知限制",
      "## 下一轮迭代建议"
    ],
    sectionBlueprint: [
      "- 给出访问地址、账号、启动方式或构建方式。",
      "- 页面路由至少覆盖列表页、详情页、监控或配置页等三类页面。",
      "- 明确接口契约、数据来源和持久化存储，不可只写静态页面说明。",
      "- 演示脚本至少 5 步，覆盖主链路。",
      "- 明确限制项与风险，避免“看起来可用”。"
    ],
    acceptanceChecklist: [
      "第三方可按文档独立复测主流程。",
      "至少提供 2 个可执行 API 接口与对应数据来源说明。",
      "至少提供 1 套持久化存储方案（表结构/Schema/迁移策略）。",
      "桌面/移动基础体验与关键 CTA 可达。",
      "限制与下一步计划清晰。"
    ],
    authoringRules: [
      "不只描述页面，要描述可操作流程。",
      "每一步要有输入、动作、预期结果。"
    ]
  },
  test_report: {
    kind: "test_report",
    label: "测试报告模板",
    requiredSections: [
      "## 测试范围与环境",
      "## 测试用例矩阵",
      "## 执行结果统计",
      "## 缺陷列表与风险评估",
      "## 发布建议与阻塞项"
    ],
    sectionBlueprint: [
      "- 用例矩阵至少覆盖功能、回归、异常三类。",
      "- 结果统计应含通过/失败/阻塞数量。",
      "- 缺陷需给严重级、复现步骤、负责人。"
    ],
    acceptanceChecklist: [
      "测试结论可回溯至验收标准。",
      "阻塞项与修复建议明确。",
      "发布建议有依据，不是主观判断。"
    ],
    authoringRules: [
      "避免“测试通过”一句话式结论。",
      "关键风险要给处置建议与时限。"
    ],
    standardsProfile: [
      {
        code: "ISO/IEC/IEEE 29119 Series",
        title: "Software testing",
        focus: "测试文档、测试条件、用例设计、执行与报告结构需完整。",
        source: "https://standards.ieee.org/wp-content/uploads/import/documents/tocs/ISO_IEC_IEEE_29119.pdf"
      }
    ]
  },
  product_backfill: {
    kind: "product_backfill",
    label: "产品说明文档回填模板",
    requiredSections: [
      "## 新增能力摘要",
      "## 需求目标一致性验证",
      "## 交付物映射与证据",
      "## 影响范围与兼容性",
      "## 文档回填记录（版本/时间）",
      "## 下次需求冲突预警"
    ],
    sectionBlueprint: [
      "- 标注每项新能力对应的需求目标与验收结果。",
      "- 回填记录必须包含版本号和时间戳。",
      "- 给出与现有产品原则的冲突检查结论。"
    ],
    acceptanceChecklist: [
      "新增能力与需求目标映射完整。",
      "冲突项可识别并给出待决策事项。",
      "可直接作为下一轮需求的输入上下文。"
    ],
    authoringRules: [
      "优先写“已验证事实”，不要写模糊判断。",
      "冲突检查必须输出“无冲突”或“待决策”。"
    ],
    standardsProfile: [
      {
        code: "ISO/IEC/IEEE 29148:2018",
        title: "Requirements engineering",
        focus: "回填内容应保留需求到交付、到验收的追踪关系。",
        source: "https://www.iso.org/standard/72089.html"
      }
    ]
  },
  generic: {
    kind: "generic",
    label: "通用交付模板",
    requiredSections: [
      "## 目标与范围",
      "## 分析与方法",
      "## 结果与证据",
      "## 验收与下一步"
    ],
    sectionBlueprint: [
      "- 目标可验证，范围可界定。",
      "- 结果要关联任务证据。",
      "- 下一步要有 owner 与动作。"
    ],
    acceptanceChecklist: [
      "内容结构完整且可审阅。",
      "结论与证据对应。",
      "下一步可直接执行。"
    ],
    authoringRules: [
      "避免泛化描述，优先使用条目化输出。"
    ]
  }
};

const PROFESSIONAL_FORMAT_RULES: Partial<Record<DeliverableTemplateKind, DeliverableProfessionalFormatRule>> = {
  requirements_prd: {
    requiredSections: [
      "## 事实依据与来源（Source of Truth）",
      "## 需求追踪矩阵（目标-功能-验收）",
      "## 决策记录（Decision Log）"
    ],
    evidenceRules: [
      {
        key: "sot_evidence",
        label: "事实依据与引用",
        pattern: /(source[_\s-]?of[_\s-]?truth|事实源|`[^`]+\.(?:ts|tsx|js|jsx|md|sql|prisma)`|\/api\/)/gi
      },
      {
        key: "metric_definition",
        label: "可量化验收指标",
        pattern: /(kpi|sla|metric|指标|成功标准|验收标准)/gi
      },
      {
        key: "non_goal_boundary",
        label: "非目标边界",
        pattern: /(非目标|out\s+of\s+scope|不做)/gi
      }
    ],
    minBulletCount: 12,
    requireMarkdownTable: true
  },
  schedule: {
    requiredSections: [
      "## 里程碑基线（日期 / Owner / Exit Criteria）",
      "## 关键路径与依赖矩阵",
      "## 变更控制与升级机制"
    ],
    evidenceRules: [
      {
        key: "milestone_date",
        label: "里程碑日期",
        pattern: /(20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}|Q[1-4])/gi
      },
      {
        key: "owner_signal",
        label: "Owner/RACI 责任归属",
        pattern: /(owner|负责人|责任人|raci)/gi
      },
      {
        key: "risk_gate",
        label: "延期/阻断升级规则",
        pattern: /(风险闸门|升级|阻断|应急|fallback)/gi
      }
    ],
    minBulletCount: 10,
    requireMarkdownTable: true
  },
  design_review: {
    requiredSections: [
      "## 设计决策记录",
      "## 可访问性检查结果（WCAG）",
      "## 审查结论与整改项"
    ],
    evidenceRules: [
      {
        key: "wcag_signal",
        label: "可访问性证据",
        pattern: /(wcag|对比度|键盘可达|语义标签|屏幕阅读器|可访问)/gi
      },
      {
        key: "review_result",
        label: "审查结论",
        pattern: /(审查结论|通过|驳回|整改)/gi
      },
      {
        key: "preview_reference",
        label: "视觉证据（Figma/预览）",
        pattern: /(figma\.com|stitch|```html|!\[[^\]]*]\((?:https?:\/\/|data:image\/))/gi
      }
    ],
    minBulletCount: 8,
    requireMarkdownTable: true
  },
  visual_mockup: {
    requiredSections: [
      "## 设计 Token 映射（色彩 / 字体 / 间距）",
      "## 状态反馈矩阵（默认 / 悬停 / 禁用 / 错误）",
      "## 响应式断点策略"
    ],
    evidenceRules: [
      {
        key: "token_signal",
        label: "Token 设计说明",
        pattern: /(token|--[a-z0-9-]+|色彩|字体|间距|spacing)/gi
      },
      {
        key: "state_matrix",
        label: "状态反馈定义",
        pattern: /(默认|悬停|hover|禁用|disabled|错误|error|loading)/gi
      },
      {
        key: "renderable_preview",
        label: "可渲染单页预览",
        pattern: /(```html|<!doctype html|<html[\s>])/gi
      }
    ],
    minBulletCount: 8,
    requireMarkdownTable: true
  },
  implementation_word: {
    requiredSections: [
      "## 架构决策记录（ADR）",
      "## 接口契约矩阵（字段 / 约束 / 错误码）",
      "## 发布与回滚演练计划"
    ],
    evidenceRules: [
      {
        key: "api_contract",
        label: "接口契约证据",
        pattern: /((?:get|post|put|patch|delete)\s+\/[a-z0-9_:/?&=\-]+|\/api\/[a-z0-9_:/?&=\-]+)/gi
      },
      {
        key: "data_model",
        label: "数据结构证据",
        pattern: /(schema|表结构|字段|migration|索引|prisma)/gi
      },
      {
        key: "rollback_plan",
        label: "发布回滚策略",
        pattern: /(回滚|rollback|灰度|发布窗口|回退)/gi
      }
    ],
    minBulletCount: 10,
    requireMarkdownTable: true
  },
  implementation_result: {
    requiredSections: [
      "## 变更证据（Commit / 文件）",
      "## 验证命令与结果",
      "## 风险回归与残留问题"
    ],
    evidenceRules: [
      {
        key: "code_change_evidence",
        label: "代码变更证据",
        pattern: /((?:apps?|src|packages|server|client|web|api)\/[a-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|sql|prisma|yml|yaml|sh))/gi,
        minMatches: 2
      },
      {
        key: "command_result",
        label: "验证命令与结论",
        pattern: /((?:pnpm|npm|yarn)\s+[^\n]+|typecheck|build|test|通过|失败|exit code)/gi
      },
      {
        key: "change_trace",
        label: "版本追踪",
        pattern: /(\b[0-9a-f]{7,40}\b|merge request|pull request|mr\s*#?\d+)/gi
      }
    ],
    minBulletCount: 10,
    requireMarkdownTable: false
  },
  runtime_delivery: {
    requiredSections: [
      "## 环境变量清单（必填 / 可选）",
      "## 部署检查清单（Pre-flight / Post-check）",
      "## 回滚触发条件与处理流程"
    ],
    evidenceRules: [
      {
        key: "runtime_url",
        label: "运行地址证据",
        pattern: /(https?:\/\/[^\s)]+|localhost:\d+)/gi
      },
      {
        key: "env_vars",
        label: "环境变量证据",
        pattern: /\b[A-Z][A-Z0-9_]{2,}\s*=/g
      },
      {
        key: "deployment_commands",
        label: "部署命令证据",
        pattern: /((?:docker|kubectl|pnpm|npm|yarn)\s+[^\n]+)/gi
      }
    ],
    minBulletCount: 8,
    requireMarkdownTable: true
  },
  test_report: {
    requiredSections: [
      "## 测试覆盖矩阵（需求 / 用例 / 结果）",
      "## 缺陷分级与处置",
      "## 发布建议与风险签收"
    ],
    evidenceRules: [
      {
        key: "case_signal",
        label: "测试用例编号",
        pattern: /(tc[-_ ]?\d+|test case|用例)/gi
      },
      {
        key: "severity_signal",
        label: "缺陷分级",
        pattern: /(p0|p1|p2|严重|高|中|低)/gi
      },
      {
        key: "result_signal",
        label: "测试结果统计",
        pattern: /(通过|失败|阻塞|pass|fail|blocked)/gi
      }
    ],
    minBulletCount: 8,
    requireMarkdownTable: true
  },
  product_backfill: {
    requiredSections: [
      "## 需求-交付映射表",
      "## 版本变更记录",
      "## 已确认事实与待决策项"
    ],
    evidenceRules: [
      {
        key: "mapping_signal",
        label: "需求映射证据",
        pattern: /(需求|目标|交付|验收|映射)/gi
      },
      {
        key: "version_signal",
        label: "版本记录",
        pattern: /(v\d+\.\d+(?:\.\d+)?|版本|20\d{2}[-/年]\d{1,2}[-/月]\d{1,2})/gi
      },
      {
        key: "decision_signal",
        label: "待决策风险项",
        pattern: /(待决策|冲突|风险|决策)/gi
      }
    ],
    minBulletCount: 6,
    requireMarkdownTable: true
  }
};

export function resolveDeliverableTemplate(title: string, stageType: StageType): DeliverableTemplate {
  const normalized = String(title || "").toLowerCase();

  if (/章程|charter/.test(normalized)) {
    return TEMPLATE_LIBRARY.charter;
  }
  if (/排期|里程碑|schedule|roadmap/.test(normalized)) {
    return TEMPLATE_LIBRARY.schedule;
  }
  if (/需求分析|prd|需求文档|requirement/.test(normalized)) {
    return TEMPLATE_LIBRARY.requirements_prd;
  }
  if (/ppt|汇报|路演|演示文稿|slides/.test(normalized)) {
    return TEMPLATE_LIBRARY.presentation_ppt;
  }
  if (/实现结果|implementation result|开发结果|研发结果/.test(normalized)) {
    return TEMPLATE_LIBRARY.implementation_result;
  }
  if (/运行地址|部署说明|deployment|runtime delivery|运行说明/.test(normalized)) {
    return TEMPLATE_LIBRARY.runtime_delivery;
  }
  if (/word|实施方案|技术方案|solution|architecture/.test(normalized)) {
    return TEMPLATE_LIBRARY.implementation_word;
  }
  if (/审查卡|design review|设计审查/.test(normalized)) {
    return TEMPLATE_LIBRARY.design_review;
  }
  if (/视觉定稿|视觉设计稿|单页预览|mockup|wireframe|design preview|preview\.html/.test(normalized)) {
    return TEMPLATE_LIBRARY.visual_mockup;
  }
  if (/demo|原型|演示页|官网/.test(normalized)) {
    return TEMPLATE_LIBRARY.demo_prototype;
  }
  if (/测试|test|qa/.test(normalized)) {
    return TEMPLATE_LIBRARY.test_report;
  }
  if (/回填|产品说明文档|backfill|acceptance/.test(normalized)) {
    return TEMPLATE_LIBRARY.product_backfill;
  }

  if (stageType === "INIT") {
    return TEMPLATE_LIBRARY.charter;
  }
  if (stageType === "ANALYSIS") {
    return TEMPLATE_LIBRARY.requirements_prd;
  }
  if (stageType === "DESIGN") {
    return TEMPLATE_LIBRARY.design_review;
  }
  if (stageType === "DEV") {
    return TEMPLATE_LIBRARY.implementation_result;
  }
  if (stageType === "ACCEPT") {
    return TEMPLATE_LIBRARY.product_backfill;
  }
  return TEMPLATE_LIBRARY.generic;
}

export function resolveDeliverableProfessionalFormatRule(
  title: string,
  stageType: StageType
): DeliverableProfessionalFormatRule | null {
  const template = resolveDeliverableTemplate(title, stageType);
  return PROFESSIONAL_FORMAT_RULES[template.kind] || null;
}

function formatEvidenceRule(evidenceRule: DeliverableProfessionalEvidenceRule) {
  const suffix = evidenceRule.minMatches && evidenceRule.minMatches > 1
    ? `（至少命中 ${evidenceRule.minMatches} 次）`
    : "";
  return `${evidenceRule.label}${suffix}`;
}

export function buildDeliverableTemplatePromptBlock(title: string, stageType: StageType, keywords: string[] = []) {
  const template = resolveDeliverableTemplate(title, stageType);
  const professionalRule = resolveDeliverableProfessionalFormatRule(title, stageType);
  const keywordLine = keywords.slice(0, 6).join(" / ") || "无";
  const standardsLines = Array.isArray(template.standardsProfile) && template.standardsProfile.length > 0
    ? [
      "标准规范对齐（写入交付物，不得只罗列名词）:",
      "- 必须新增章节: ## 标准对齐与裁剪说明",
      "- 在该章节以 Markdown 表格给出: 标准条款/要求 | 当前交付对应内容 | 不适用项与原因",
      ...template.standardsProfile.map((item) => `- ${item.code} (${item.title}): ${item.focus}；来源 ${item.source}`)
    ]
    : [];
  const professionalLines = professionalRule
    ? [
      "专业格式硬要求:",
      ...professionalRule.requiredSections.map((section) => `- 必须包含: ${section}`),
      ...(professionalRule.requireMarkdownTable ? ["- 必须至少包含 1 个 Markdown 表格用于矩阵/清单信息。"] : []),
      ...(professionalRule.minBulletCount
        ? [`- 条目化信息不少于 ${professionalRule.minBulletCount} 条（以 “- ” 开头）。`]
        : []),
      ...professionalRule.evidenceRules.map((item) => `- 必须提供证据: ${formatEvidenceRule(item)}`)
    ]
    : [];
  return [
    `交付模板类型: ${template.label}`,
    `关键词上下文: ${keywordLine}`,
    "必须严格包含以下章节（Markdown 二级标题）:",
    ...template.requiredSections.map((section) => `- ${section}`),
    "写作规则:",
    ...template.authoringRules.map((rule) => `- ${rule}`),
    "验收关注点:",
    ...template.acceptanceChecklist.map((item) => `- ${item}`),
    ...standardsLines,
    ...professionalLines
  ];
}
