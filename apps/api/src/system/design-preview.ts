function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasAny(source: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(source));
}

function collectPlatforms(source: string) {
  const platforms: string[] = [];
  if (/tiktok|tik tok|抖音/i.test(source)) platforms.push("TikTok");
  if (/amazon|亚马逊/i.test(source)) platforms.push("Amazon");
  if (/temu/i.test(source)) platforms.push("Temu");
  if (/shopify/i.test(source)) platforms.push("Shopify");
  return platforms.length > 0 ? platforms : ["TikTok", "Amazon"];
}

function hashSeed(source: string) {
  let hash = 0;
  for (const char of String(source || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash >>> 0;
}

function normalizeKeywordTokens(values: string[] = []) {
  return values
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 8);
}

type PreviewThemeVariant = {
  id: string;
  label: string;
  heroBadge: string;
  fontStack: string;
  bg: string;
  panel: string;
  panelSoft: string;
  line: string;
  text: string;
  muted: string;
  accentPrimary: string;
  accentSecondary: string;
  accentTertiary: string;
  bodyBackdrop: string;
};

const CROSS_BORDER_THEME_VARIANTS: PreviewThemeVariant[] = [
  {
    id: "pulse_neon",
    label: "Pulse Neon",
    heroBadge: "爆量预警 / Hot Product Radar",
    fontStack: "'SF Pro Display','PingFang SC','Segoe UI',sans-serif",
    bg: "#08080f",
    panel: "#12131f",
    panelSoft: "#17192a",
    line: "rgba(255,255,255,.08)",
    text: "#f5f7fb",
    muted: "#99a3b8",
    accentPrimary: "#26f4ee",
    accentSecondary: "#fe2c55",
    accentTertiary: "#b7ff5f",
    bodyBackdrop: "radial-gradient(circle at top right, rgba(254,44,85,.18), transparent 28%), radial-gradient(circle at top left, rgba(38,244,238,.18), transparent 26%), var(--bg)"
  },
  {
    id: "midnight_terminal",
    label: "Midnight Terminal",
    heroBadge: "跨境风向 / Trend Terminal",
    fontStack: "'Montserrat','PingFang SC','Segoe UI',sans-serif",
    bg: "#0a1120",
    panel: "#121a2f",
    panelSoft: "#18233d",
    line: "rgba(148,163,184,.25)",
    text: "#e7ecf7",
    muted: "#9fb0c9",
    accentPrimary: "#43d1ff",
    accentSecondary: "#7c5cff",
    accentTertiary: "#9cff67",
    bodyBackdrop: "radial-gradient(circle at top right, rgba(124,92,255,.24), transparent 30%), radial-gradient(circle at top left, rgba(67,209,255,.18), transparent 25%), linear-gradient(180deg,#070d18,#0a1120)"
  },
  {
    id: "sunset_heatmap",
    label: "Sunset Heatmap",
    heroBadge: "热卖雷达 / Growth Watch",
    fontStack: "'Space Grotesk','PingFang SC','Segoe UI',sans-serif",
    bg: "#130b12",
    panel: "#221126",
    panelSoft: "#2a1730",
    line: "rgba(255,214,179,.18)",
    text: "#fff1e8",
    muted: "#d8b8a4",
    accentPrimary: "#ff9f43",
    accentSecondary: "#ff5a8a",
    accentTertiary: "#ffe87a",
    bodyBackdrop: "radial-gradient(circle at 80% 0%, rgba(255,90,138,.24), transparent 32%), radial-gradient(circle at 10% 0%, rgba(255,159,67,.22), transparent 28%), linear-gradient(180deg,#140a12,#130b12)"
  }
];

const GENERIC_THEME_VARIANTS: PreviewThemeVariant[] = [
  {
    id: "sandstone_editorial",
    label: "Sandstone Editorial",
    heroBadge: "真实业务界面预览",
    fontStack: "'Avenir Next','PingFang SC','Segoe UI',sans-serif",
    bg: "#f6f1e8",
    panel: "#fffdf8",
    panelSoft: "#fffaf0",
    line: "rgba(15,23,42,.08)",
    text: "#1f2937",
    muted: "#6b7280",
    accentPrimary: "#c4622d",
    accentSecondary: "#f3d6c5",
    accentTertiary: "#ffd287",
    bodyBackdrop: "linear-gradient(180deg,#f7f2e9,#efe5d7)"
  },
  {
    id: "forest_ops",
    label: "Forest Ops",
    heroBadge: "业务控制台预览",
    fontStack: "'Manrope','PingFang SC','Segoe UI',sans-serif",
    bg: "#edf2ec",
    panel: "#f9fcf7",
    panelSoft: "#f1f7ef",
    line: "rgba(24,48,34,.13)",
    text: "#1d2c22",
    muted: "#5d6e63",
    accentPrimary: "#2f7d4f",
    accentSecondary: "#cde7d3",
    accentTertiary: "#91d3a2",
    bodyBackdrop: "linear-gradient(180deg,#edf4ee,#dfe9df)"
  },
  {
    id: "slate_analytics",
    label: "Slate Analytics",
    heroBadge: "数据工作台预览",
    fontStack: "'IBM Plex Sans','PingFang SC','Segoe UI',sans-serif",
    bg: "#eef1f7",
    panel: "#ffffff",
    panelSoft: "#f5f7fc",
    line: "rgba(30,41,59,.12)",
    text: "#0f172a",
    muted: "#64748b",
    accentPrimary: "#2563eb",
    accentSecondary: "#dbeafe",
    accentTertiary: "#7dd3fc",
    bodyBackdrop: "linear-gradient(180deg,#eef2ff,#e2e8f0)"
  }
];

function pickCrossBorderTheme(seed: number, source: string) {
  if (/tiktok|tik tok|抖音/i.test(source)) {
    return CROSS_BORDER_THEME_VARIANTS[0];
  }
  if (/amazon|亚马逊|bsr|rank/i.test(source)) {
    return CROSS_BORDER_THEME_VARIANTS[1];
  }
  if (/temu|aliexpress|采购|供应链/i.test(source)) {
    return CROSS_BORDER_THEME_VARIANTS[2];
  }
  return CROSS_BORDER_THEME_VARIANTS[seed % CROSS_BORDER_THEME_VARIANTS.length];
}

function pickGenericTheme(seed: number, source: string) {
  if (/运营|ops|运维|流程/i.test(source)) {
    return GENERIC_THEME_VARIANTS[1];
  }
  if (/数据|分析|dashboard|报表|指标/i.test(source)) {
    return GENERIC_THEME_VARIANTS[2];
  }
  return GENERIC_THEME_VARIANTS[seed % GENERIC_THEME_VARIANTS.length];
}

function pickProductCandidates(seed: number, keywords: string[]) {
  const pool = [
    "Magnetic Phone Cooler Clip",
    "Portable Ice Bath Tub",
    "Pet Hair Remover Roller",
    "Mini Heatless Curl Ribbon",
    "Seamless Shaping Bodysuit",
    "Foldable Walking Pad",
    "LED Sunset Projection Lamp",
    "Reusable Cleaning Gel Kit",
    "Smart Label Mini Printer",
    "Quick Dry Yoga Towel"
  ];
  const candidates = [...pool];
  for (const keyword of keywords) {
    if (/美妆|beauty/i.test(keyword)) candidates.unshift("Peptide Lip Plumper Set");
    if (/宠物|pet/i.test(keyword)) candidates.unshift("Pet Calming Lick Mat");
    if (/家居|home/i.test(keyword)) candidates.unshift("Cordless Spin Scrubber");
    if (/母婴|baby/i.test(keyword)) candidates.unshift("Portable Bottle Warmer");
  }

  const seen = new Set<string>();
  const picked: string[] = [];
  let cursor = seed % Math.max(1, candidates.length);
  while (picked.length < 3 && picked.length < candidates.length) {
    const item = candidates[cursor % candidates.length];
    if (!seen.has(item)) {
      picked.push(item);
      seen.add(item);
    }
    cursor += 3;
  }
  return picked;
}

export type DesignRequirementProfile = {
  scenarioId: "cross_border_product_radar" | "collaboration_platform" | "generic_business_ui";
  scenarioLabel: string;
  visualDirection: string;
  visualTheme: string;
  brandTone: string;
  uxPrinciples: string[];
  accessibilityChecklist: string[];
  layoutStrategy: string[];
  componentChecklist: string[];
};

type DesignProfileInput = {
  projectName: string;
  projectDescription: string;
  keywords?: string[];
};

export function resolveDesignRequirementProfile(input: DesignProfileInput): DesignRequirementProfile {
  const source = normalizeText(
    `${input.projectName || ""} ${input.projectDescription || ""} ${(input.keywords || []).join(" ")}`
  );
  const isCrossBorderProductRadar = /(跨境|电商|选品|跟品|爆品|商品|sku|tiktok|tik tok|亚马逊|amazon|temu|榜单|排名|监控|告警)/i.test(source);
  const isCollaborationPlatform = /(协作平台|项目房间|任务流转|验收报告|质量门禁|agent\s*名册|agent roster|project room|quality gate|signoff|项目详情|多\s*agent|执行证据|阶段推进|项目推进)/i.test(source);

  if (isCrossBorderProductRadar) {
    const seed = hashSeed(source);
    const directionOptions = [
      "实时爆量监控台：首屏突出榜单、增速、平台来源和跟品动作，减少流程性叙述。",
      "数据终端式选品工作台：强化排名变化、成本与利润窗口，支持快速人工决策。",
      "告警驱动的跟品面板：突出异常波动、风险信号和可执行动作，强调时效性。"
    ];
    const themeOptions = [
      "深色高对比 + 霓虹强调，突出实时性与动作反馈。",
      "冷色数据终端风格，聚焦指标密度与趋势解读。",
      "暖色热度图风格，强化爆量与风险变化可视化。"
    ];
    const toneOptions = ["敏捷、锐利、可操作", "专业、克制、证据导向", "快速、果断、结果导向"];
    const pick = seed % directionOptions.length;
    return {
      scenarioId: "cross_border_product_radar",
      scenarioLabel: "跨境爆品监控与跟品",
      visualDirection: directionOptions[pick] || directionOptions[0],
      visualTheme: themeOptions[pick] || themeOptions[0],
      brandTone: toneOptions[pick] || toneOptions[0],
      uxPrinciples: [
        "先展示爆品榜单与增长证据，再引导是否跟品",
        "每条推荐都必须带平台来源、指标变化和商品链接",
        "跟踪、忽略、查看详情必须是低摩擦强动作"
      ],
      accessibilityChecklist: [
        "高亮色与正文颜色保持足够对比度，避免仅靠颜色表达涨跌",
        "榜单表格和跟品按钮支持键盘导航与焦点可见",
        "平台标签、趋势箭头和告警状态均提供文字说明"
      ],
      layoutStrategy: [
        "首屏直接给出爆量总览、平台筛选和今日 Top 榜单，不先铺陈平台流程。",
        "中段展示爆量原因拆解、跟品监控卡和风险提醒，支撑人工决策。",
        "底部提供商品链接、持续跟踪入口和最近告警时间线。"
      ],
      componentChecklist: [
        "爆品榜单卡片或表格（商品名、平台、增速、排名、利润空间）",
        "平台筛选与时间范围切换（TikTok / Amazon / Temu）",
        "单商品分析抽屉（爆量原因、趋势曲线、竞争度、风险点）",
        "跟品动作按钮（加入跟踪 / 忽略 / 查看商品链接）"
      ]
    };
  }

  if (isCollaborationPlatform) {
    return {
      scenarioId: "collaboration_platform",
      scenarioLabel: "多 Agent 协作项目平台",
      visualDirection: "围绕项目状态、任务阻塞、Agent 执行证据与质量门禁构建工作台，让用户快速判断项目是否真实推进、卡点在哪、下一步该做什么。",
      visualTheme: "高密度工作台、强状态语义、清晰层级与证据可追溯。",
      brandTone: "专业、冷静、可信、以决策效率为先",
      uxPrinciples: [
        "项目健康度、当前阻塞点与下一步动作必须首屏可见",
        "每个关键任务都要暴露 agent、模型、技能与产出证据",
        "审批、打回、放行等人工决策动作要贴近上下文呈现"
      ],
      accessibilityChecklist: [
        "状态颜色必须配合图标与文案，避免仅靠颜色表达风险",
        "任务流转、质量门禁和时间线支持键盘导航与焦点可见",
        "复杂执行证据按分组展开，避免长文本直接堆叠"
      ],
      layoutStrategy: [
        "首屏使用总览工作台，直接展示项目阶段、质量门禁状态、阻塞任务与最新执行证据。",
        "中段使用任务流转泳道和项目房间双视角，让用户同时看到阶段推进与多 Agent 协作关系。",
        "右侧上下文面板固定展示当前选中任务的 agent、模型、技能、交付物和审批动作。"
      ],
      componentChecklist: [
        "项目健康度总览卡（阶段、风险、Quality Gate、最近活跃 Agent）",
        "任务流转泳道 / 看板（todo、running、blocked、review、done）",
        "Agent 执行证据面板（模型、技能、耗时、产出链接）",
        "验收报告与质量门禁矩阵（通过/阻断/待人工确认）"
      ]
    };
  }

  return {
    scenarioId: "generic_business_ui",
    scenarioLabel: "通用业务产品界面",
    visualDirection: "围绕真实业务对象组织页面，突出核心数据、关键动作和下一步决策。",
    visualTheme: "清晰层级、克制动效、强调信息密度与可读性。",
    brandTone: "专业、明确、可执行",
    uxPrinciples: [
      "首屏先回答用户最关心的问题",
      "关键数据与关键动作同屏出现",
      "每个模块都要能支撑后续执行或决策"
    ],
    accessibilityChecklist: [
      "正文与背景对比度达标",
      "交互控件提供焦点态与语义标签",
      "复杂信息使用标题、分组和说明文字拆解"
    ],
    layoutStrategy: [
      "首屏呈现业务价值、关键数据和主 CTA。",
      "中段呈现核心能力模块与用户流程。",
      "尾部补充风险提示、案例证据与下一步入口。"
    ],
    componentChecklist: [
      "价值主张 Hero",
      "核心指标卡片",
      "关键列表或工作台",
      "主 CTA 与次 CTA"
    ]
  };
}

export function buildRequirementAwareDesignSections(
  input: DesignProfileInput & { title: string }
) {
  const profile = resolveDesignRequirementProfile(input);
  const keywords = input.keywords?.slice(0, 6).join(" / ") || profile.scenarioLabel;
  const scenarioGuardrails = profile.scenarioId === "collaboration_platform"
    ? [
        "- 必须显式呈现项目、任务、Agent、交付物与质量门禁之间的关系。",
        "- 不允许把协作平台重构成营销落地页或泛化业务官网。"
      ]
    : [
        "- 禁止把业务站点设计成项目协作平台、Agent 中心或需求流转面板。",
        "- 所有模块都必须直接服务于业务判断、执行动作或结果追踪。"
      ];

  return [
    "## 视觉方案",
    `- 目标交付物：${input.title}`,
    `- 场景定位：${profile.scenarioLabel}`,
    `- 视觉主题：${profile.visualTheme}`,
    `- 视觉方向：${profile.visualDirection}`,
    `- 核心关键词：${keywords}`,
    "## 版式策略",
    ...profile.layoutStrategy.map((item) => `- ${item}`),
    "## 组件清单",
    ...profile.componentChecklist.map((item) => `- ${item}`),
    "## 品牌语气",
    `- 文案语气：${profile.brandTone}`,
    ...scenarioGuardrails
  ].join("\n");
}

function buildCrossBorderProductPreviewHtml(input: DesignProfileInput & { visualDirection?: string }) {
  const profile = resolveDesignRequirementProfile(input);
  const seedSource = `${input.projectName || ""}|${input.projectDescription || ""}|${(input.keywords || []).join("|")}`;
  const seed = hashSeed(seedSource);
  const theme = pickCrossBorderTheme(seed, `${seedSource} ${(input.keywords || []).join(" ")}`);
  const keywordTokens = normalizeKeywordTokens(input.keywords || []);
  const platforms = collectPlatforms(`${input.projectName} ${input.projectDescription} ${keywordTokens.join(" ")}`);
  const heroDirection = escapeHtml(input.visualDirection || profile.visualDirection);
  const title = escapeHtml(input.projectName || "跨境爆品雷达");
  const topPlatforms = platforms.slice(0, 3);
  const productNames = pickProductCandidates(seed, keywordTokens);
  const actionPool = ["加入跟品", "查看链接", "继续观察", "加入预警"];
  const productRows = productNames.map((name, index) => {
    const growth = 140 + ((seed + index * 37) % 145);
    const fromRank = 6 + ((seed + index * 11) % 20);
    const toRank = Math.max(1, fromRank - (3 + ((seed + index * 5) % 7)));
    const heat = (8.1 + ((seed + index * 13) % 17) / 10).toFixed(1);
    const margin = 22 + ((seed + index * 9) % 16);
    return {
      name,
      platform: topPlatforms[index] || topPlatforms[0] || "TikTok",
      growth: `+${growth}%`,
      rank: `#${fromRank} -> #${toRank}`,
      heat: `热度 ${heat}`,
      margin: `毛利 ${margin}%`,
      action: actionPool[(seed + index) % actionPool.length] || "加入跟品"
    };
  });
  const newHotCount = 18 + (seed % 21);
  const trackingCount = 4 + (seed % 8);
  const riskCount = 2 + (seed % 4);

  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head>",
    "  <meta charset=\"UTF-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    `  <title>${title} · 视觉定稿预览</title>`,
    "  <style>",
    `    :root { --bg:${theme.bg}; --panel:${theme.panel}; --panel-soft:${theme.panelSoft}; --line:${theme.line}; --text:${theme.text}; --muted:${theme.muted}; --cyan:${theme.accentPrimary}; --pink:${theme.accentSecondary}; --lime:${theme.accentTertiary}; }`,
    "    * { box-sizing:border-box; }",
    `    body { margin:0; font-family:${theme.fontStack}; background:${theme.bodyBackdrop}; color:var(--text); }`,
    "    .wrap { max-width:1280px; margin:0 auto; padding:32px 20px 64px; }",
    "    .hero { display:grid; grid-template-columns:1.2fr .8fr; gap:18px; align-items:stretch; }",
    "    .card { background:linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02)); border:1px solid var(--line); border-radius:24px; padding:22px; box-shadow:0 18px 48px rgba(0,0,0,.26); }",
    "    .eyebrow { display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:999px; background:rgba(254,44,85,.12); color:#ffd3dd; font-size:12px; letter-spacing:.08em; text-transform:uppercase; }",
    "    h1 { margin:14px 0 10px; font-size:40px; line-height:1.05; max-width:12ch; }",
    "    .hero-copy { color:var(--muted); font-size:15px; line-height:1.7; max-width:62ch; }",
    "    .chip-row { display:flex; flex-wrap:wrap; gap:10px; margin-top:16px; }",
    "    .chip { padding:7px 12px; border-radius:999px; background:rgba(38,244,238,.1); color:var(--cyan); font-size:12px; border:1px solid rgba(38,244,238,.22); }",
    "    .metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:18px; }",
    "    .metric { padding:14px; border-radius:18px; background:var(--panel-soft); border:1px solid var(--line); }",
    "    .metric strong { display:block; font-size:28px; margin-bottom:6px; }",
    "    .actions { display:flex; gap:10px; margin-top:18px; flex-wrap:wrap; }",
    "    .btn { display:inline-flex; align-items:center; justify-content:center; min-width:138px; padding:12px 16px; border-radius:14px; text-decoration:none; font-weight:700; }",
    "    .btn-primary { background:linear-gradient(90deg, var(--pink), #ff6b7a); color:#fff; }",
    "    .btn-secondary { border:1px solid rgba(38,244,238,.25); color:var(--cyan); background:rgba(38,244,238,.06); }",
    "    .signal-panel { display:grid; gap:12px; }",
    "    .signal-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; }",
    "    .signal-head h2, .section h2 { margin:0; font-size:20px; }",
    "    .signal-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }",
    "    .signal { padding:14px; border-radius:18px; background:var(--panel-soft); border:1px solid var(--line); }",
    "    .signal b { display:block; margin-bottom:6px; }",
    "    .signal p { margin:0; color:var(--muted); font-size:13px; line-height:1.6; }",
    "    .section { margin-top:18px; }",
    "    table { width:100%; border-collapse:collapse; }",
    "    th, td { padding:14px 12px; text-align:left; border-bottom:1px solid rgba(255,255,255,.06); vertical-align:middle; }",
    "    th { color:#c4ccda; font-size:12px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; }",
    "    td { font-size:14px; }",
    "    .platform { display:inline-flex; padding:5px 10px; border-radius:999px; font-size:12px; background:rgba(255,255,255,.06); }",
    "    .trend-up { color:var(--lime); font-weight:700; }",
    "    .action-tag { display:inline-flex; padding:6px 10px; border-radius:999px; background:rgba(254,44,85,.12); color:#ffd6df; font-size:12px; }",
    "    .analysis { display:grid; grid-template-columns:1fr 1fr; gap:18px; }",
    "    .timeline { display:grid; gap:10px; }",
    "    .timeline-item { padding:14px; border-radius:16px; background:var(--panel-soft); border:1px solid var(--line); }",
    "    .timeline-item small { color:var(--muted); display:block; margin-bottom:6px; }",
    "    .timeline-item p { margin:0; color:#d7dcec; line-height:1.6; }",
    "    @media (max-width:980px) { .hero, .analysis { grid-template-columns:1fr; } .signal-grid { grid-template-columns:1fr 1fr; } }",
    "    @media (max-width:720px) { h1 { font-size:32px; } .metrics, .signal-grid { grid-template-columns:1fr; } th:nth-child(5), td:nth-child(5) { display:none; } }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main class=\"wrap\">",
    "    <section class=\"hero\">",
    "      <article class=\"card\">",
    `        <span class=\"eyebrow\">${escapeHtml(theme.heroBadge)}</span>`,
    `        <h1>${title}</h1>`,
    `        <p class=\"hero-copy\">${heroDirection} 页面首屏直接展示爆品榜单、平台来源、增长指标和跟品动作，帮助运营人员在流量爆发窗口内快速决定是否持续跟踪。</p>`,
    "        <div class=\"chip-row\">",
    ...topPlatforms.map((platform) => `          <span class=\"chip\">${escapeHtml(platform)} 实时榜单</span>`),
    `          <span class=\"chip\">视觉母版：${escapeHtml(theme.label)}</span>`,
    "          <span class=\"chip\">商品链接直达</span>",
    "          <span class=\"chip\">人工确认跟品</span>",
    "        </div>",
    "        <div class=\"metrics\">",
    `          <div class=\"metric\"><strong>${newHotCount}</strong><span>过去 24h 新增爆量商品</span></div>`,
    `          <div class=\"metric\"><strong>${trackingCount}</strong><span>正在持续跟踪的候选品</span></div>`,
    `          <div class=\"metric\"><strong>${riskCount}</strong><span>高波动风险需人工复核</span></div>`,
    "        </div>",
    "        <div class=\"actions\">",
    "          <a class=\"btn btn-primary\" href=\"#hot-list\">查看今日爆品榜</a>",
    "          <a class=\"btn btn-secondary\" href=\"#tracking\">进入跟品清单</a>",
    "        </div>",
    "      </article>",
    "      <aside class=\"card signal-panel\">",
    "        <div class=\"signal-head\">",
    "          <h2>爆量原因拆解</h2>",
    "          <span class=\"platform\">实时刷新</span>",
    "        </div>",
    "        <div class=\"signal-grid\">",
    "          <div class=\"signal\"><b>流量增速</b><p>TikTok 视频引流与 Amazon 搜索排名同时抬升时，优先提升爆量分数。</p></div>",
    "          <div class=\"signal\"><b>利润空间</b><p>结合估算成本、售价区间与竞争密度，筛掉高热低利商品。</p></div>",
    "          <div class=\"signal\"><b>风险提醒</b><p>对高退货率、侵权词和异常降价商品标记红色告警。</p></div>",
    "          <div class=\"signal\"><b>跟品动作</b><p>支持加入观察、查看链接、忽略噪音三种人工决策入口。</p></div>",
    "        </div>",
    "      </aside>",
    "    </section>",
    "    <section class=\"section card\" id=\"hot-list\">",
    "      <div class=\"signal-head\">",
    "        <h2>今日爆品榜单</h2>",
    "        <span class=\"action-tag\">支持一键跟品</span>",
    "      </div>",
    "      <table>",
    "        <thead><tr><th>商品</th><th>平台</th><th>24h 增速</th><th>排名变化</th><th>分析摘要</th><th>动作</th></tr></thead>",
    "        <tbody>",
    ...productRows.flatMap((row) => [
      "          <tr>",
      `            <td><strong>${escapeHtml(row.name)}</strong><div style=\"color:var(--muted);font-size:12px;margin-top:4px;\">${escapeHtml(row.heat)} · ${escapeHtml(row.margin)}</div></td>`,
      `            <td><span class=\"platform\">${escapeHtml(row.platform)}</span></td>`,
      `            <td class=\"trend-up\">${escapeHtml(row.growth)}</td>`,
      `            <td>${escapeHtml(row.rank)}</td>`,
      "            <td style=\"color:var(--muted);\">评论增速明显，视频带货内容进入扩散期，可继续观察转化。</td>",
      `            <td><span class=\"action-tag\">${escapeHtml(row.action)}</span></td>`,
      "          </tr>"
    ]),
    "        </tbody>",
    "      </table>",
    "    </section>",
    "    <section class=\"section analysis\" id=\"tracking\">",
    "      <article class=\"card\">",
    "        <h2>跟品监控面板</h2>",
    "        <p class=\"hero-copy\" style=\"margin-top:10px;\">当用户手动选择继续跟踪后，页面需要持续展示该商品的价格、排名、热视频来源、评论热词和利润空间变化。</p>",
    "        <div class=\"metrics\">",
    "          <div class=\"metric\"><strong>#1</strong><span>候选榜当前名次</span></div>",
    "          <div class=\"metric\"><strong>+39%</strong><span>7 日销量估算增幅</span></div>",
    "          <div class=\"metric\"><strong>2.4h</strong><span>最新告警间隔</span></div>",
    "        </div>",
    "      </article>",
    "      <article class=\"card\">",
    "        <h2>最近告警时间线</h2>",
    "        <div class=\"timeline\" style=\"margin-top:12px;\">",
    "          <div class=\"timeline-item\"><small>09:12 · TikTok</small><p>短视频播放量 2 小时内跃升 3.1x，关联商品点击率同步拉升。</p></div>",
    "          <div class=\"timeline-item\"><small>10:04 · Amazon</small><p>类目排名从 #11 升至 #4，建议补充竞品售价与物流成本核验。</p></div>",
    "          <div class=\"timeline-item\"><small>11:30 · 人工动作</small><p>运营已将该商品加入持续跟踪，并保留商品链接供后续跟品。</p></div>",
    "        </div>",
    "      </article>",
    "    </section>",
    "  </main>",
    "</body>",
    "</html>"
  ].join("\n");
}

function buildGenericBusinessPreviewHtml(input: DesignProfileInput & { visualDirection?: string }) {
  const profile = resolveDesignRequirementProfile(input);
  const seedSource = `${input.projectName || ""}|${input.projectDescription || ""}|${(input.keywords || []).join("|")}`;
  const seed = hashSeed(seedSource);
  const theme = pickGenericTheme(seed, `${seedSource} ${(input.keywords || []).join(" ")}`);
  const title = escapeHtml(input.projectName || "业务界面");
  const direction = escapeHtml(input.visualDirection || profile.visualDirection);
  const keywords = escapeHtml(input.keywords?.slice(0, 6).join(" / ") || profile.scenarioLabel);

  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head>",
    "  <meta charset=\"UTF-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    `  <title>${title} · 视觉定稿预览</title>`,
    "  <style>",
    `    :root { --bg:${theme.bg}; --panel:${theme.panel}; --panel-soft:${theme.panelSoft}; --text:${theme.text}; --muted:${theme.muted}; --line:${theme.line}; --accent:${theme.accentPrimary}; --accent-soft:${theme.accentSecondary}; }`,
    "    * { box-sizing:border-box; }",
    `    body { margin:0; font-family:${theme.fontStack}; background:${theme.bodyBackdrop}; color:var(--text); }`,
    "    .wrap { max-width:1180px; margin:0 auto; padding:36px 20px 56px; }",
    "    .grid { display:grid; grid-template-columns:1.15fr .85fr; gap:18px; }",
    "    .card { background:rgba(255,255,255,.88); border:1px solid var(--line); border-radius:26px; padding:24px; box-shadow:0 18px 44px rgba(15,23,42,.08); }",
    "    h1 { margin:12px 0; font-size:38px; line-height:1.08; max-width:11ch; }",
    "    h2 { margin:0; font-size:22px; }",
    "    p { color:var(--muted); line-height:1.7; }",
    "    .tag { display:inline-flex; padding:6px 12px; border-radius:999px; background:var(--accent-soft); color:var(--accent); font-size:12px; }",
    "    .stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:16px; }",
    "    .stat { padding:14px; border-radius:18px; background:#fff; border:1px solid var(--line); }",
    "    .stat strong { display:block; font-size:24px; margin-bottom:4px; }",
    "    .feature { padding:14px 0; border-bottom:1px solid var(--line); }",
    "    .cta { display:inline-flex; margin-top:16px; padding:12px 16px; border-radius:14px; background:var(--accent); color:#fff; text-decoration:none; font-weight:700; }",
    "    @media (max-width:920px) { .grid, .stats { grid-template-columns:1fr; } }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main class=\"wrap\">",
    "    <section class=\"grid\">",
    "      <article class=\"card\">",
    `        <span class=\"tag\">${escapeHtml(theme.heroBadge)} · ${escapeHtml(theme.label)}</span>`,
    `        <h1>${title}</h1>`,
    `        <p>${direction}</p>`,
    `        <p>关键词：${keywords}</p>`,
    "        <div class=\"stats\">",
    "          <div class=\"stat\"><strong>核心任务</strong><span>围绕真实业务目标组织首页</span></div>",
    "          <div class=\"stat\"><strong>关键数据</strong><span>同屏展示判断依据和下一步动作</span></div>",
    "          <div class=\"stat\"><strong>主 CTA</strong><span>帮助用户继续推进或决策</span></div>",
    "        </div>",
    "        <a class=\"cta\" href=\"#workbench\">查看核心工作台</a>",
    "      </article>",
    "      <aside class=\"card\">",
    "        <h2>信息架构</h2>",
    "        <div class=\"feature\"><strong>首屏价值</strong><p>先讲用户为什么现在要使用这个产品，再给出主动作。</p></div>",
    "        <div class=\"feature\"><strong>核心工作台</strong><p>展示真实业务列表、状态、数据或结果，而不是内部协作流程。</p></div>",
    "        <div class=\"feature\" style=\"border-bottom:none;\"><strong>证据与风险</strong><p>让用户看到判断依据、限制条件与下一步计划。</p></div>",
    "      </aside>",
    "    </section>",
    "  </main>",
    "</body>",
    "</html>"
  ].join("\n");
}

function buildCollaborationPlatformPreviewHtml(input: DesignProfileInput & { visualDirection?: string }) {
  const profile = resolveDesignRequirementProfile(input);
  const seedSource = `${input.projectName || ""}|${input.projectDescription || ""}|${(input.keywords || []).join("|")}`;
  const seed = hashSeed(seedSource);
  const title = escapeHtml(input.projectName || "协作平台 UI 重构");
  const direction = escapeHtml(input.visualDirection || profile.visualDirection);
  const keywords = escapeHtml(input.keywords?.slice(0, 8).join(" / ") || profile.scenarioLabel);
  const runningTasks = 6 + (seed % 4);
  const blockedTasks = 1 + (seed % 3);
  const passedGates = 8 + (seed % 3);
  const totalGates = passedGates + 2;
  const agentRows = [
    ["Jeremy", "视觉设计总监", "Stitch 方案定稿", "running"],
    ["Kuhn", "项目经理", "设计评审排队", "review"],
    ["Feynman", "研发负责人", "接口契约对齐", "blocked"]
  ];

  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head>",
    "  <meta charset=\"UTF-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    `  <title>${title} · 视觉定稿预览</title>`,
    "  <style>",
    "    :root { --bg:#09111f; --panel:#101b31; --panel-soft:#16233d; --panel-muted:#1c2c4b; --line:rgba(148,163,184,.18); --text:#ecf3ff; --muted:#93a4bf; --blue:#4f8cff; --cyan:#5dd6ff; --green:#3dd68c; --amber:#ffbf66; --red:#ff6b6b; }",
    "    * { box-sizing:border-box; }",
    "    body { margin:0; font-family:'Sora','PingFang SC','Segoe UI',sans-serif; background:radial-gradient(circle at top left, rgba(79,140,255,.18), transparent 28%), linear-gradient(180deg,#08101d,#0c1526 48%,#0a1322); color:var(--text); }",
    "    .shell { max-width:1360px; margin:0 auto; padding:28px 18px 48px; }",
    "    .hero { display:grid; grid-template-columns:1.18fr .82fr; gap:18px; }",
    "    .card { background:linear-gradient(180deg,rgba(16,27,49,.96),rgba(11,20,38,.96)); border:1px solid var(--line); border-radius:24px; padding:22px; box-shadow:0 18px 48px rgba(3,8,20,.34); }",
    "    .badge { display:inline-flex; align-items:center; gap:8px; padding:7px 12px; border-radius:999px; background:rgba(93,214,255,.12); color:var(--cyan); font-size:12px; letter-spacing:.04em; text-transform:uppercase; }",
    "    h1 { margin:14px 0 12px; font-size:42px; line-height:1.06; max-width:12ch; }",
    "    p { color:var(--muted); line-height:1.72; }",
    "    .metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-top:18px; }",
    "    .metric { padding:14px; border-radius:18px; background:rgba(255,255,255,.03); border:1px solid var(--line); }",
    "    .metric strong { display:block; font-size:26px; margin-bottom:4px; }",
    "    .metric span { color:var(--muted); font-size:13px; }",
    "    .cta-row { display:flex; gap:12px; flex-wrap:wrap; margin-top:18px; }",
    "    .cta, .ghost { display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:0 16px; border-radius:14px; text-decoration:none; font-weight:700; }",
    "    .cta { background:linear-gradient(135deg,var(--blue),var(--cyan)); color:#07101d; }",
    "    .ghost { border:1px solid var(--line); color:var(--text); background:rgba(255,255,255,.02); }",
    "    .list { display:grid; gap:12px; margin-top:14px; }",
    "    .lane-grid { display:grid; grid-template-columns:1.05fr .95fr; gap:18px; margin-top:18px; }",
    "    .lane-head, .agent-row { display:grid; grid-template-columns:1.2fr .9fr .9fr .7fr; gap:10px; align-items:center; }",
    "    .lane-head { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; margin-bottom:10px; }",
    "    .agent-row { padding:12px 0; border-top:1px solid var(--line); }",
    "    .pill { display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px; font-size:12px; }",
    "    .running { background:rgba(93,214,255,.12); color:var(--cyan); }",
    "    .review { background:rgba(255,191,102,.12); color:var(--amber); }",
    "    .blocked { background:rgba(255,107,107,.12); color:var(--red); }",
    "    .flow { display:grid; gap:12px; }",
    "    .flow-card { padding:16px; border-radius:18px; border:1px solid var(--line); background:rgba(255,255,255,.03); }",
    "    .flow-card header { display:flex; justify-content:space-between; gap:10px; margin-bottom:10px; }",
    "    .flow-card strong { font-size:16px; }",
    "    .flow-card small { color:var(--muted); }",
    "    .evidence { display:grid; gap:10px; margin-top:10px; }",
    "    .evidence div { padding:12px; border-radius:14px; background:var(--panel-muted); color:var(--muted); }",
    "    .gate { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:14px; }",
    "    .gate-item { padding:12px; border-radius:16px; border:1px solid var(--line); background:rgba(255,255,255,.03); }",
    "    .gate-item strong { display:block; margin-bottom:6px; }",
    "    @media (max-width:1100px) { .hero, .lane-grid, .metrics, .gate { grid-template-columns:1fr; } }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main class=\"shell\">",
    "    <section class=\"hero\">",
    "      <article class=\"card\">",
    "        <span class=\"badge\">协作平台工作台 · Real Execution UI</span>",
    `        <h1>${title}</h1>`,
    `        <p>${direction}</p>`,
    `        <p>需求关键词：${keywords}</p>`,
    "        <div class=\"metrics\">",
    `          <div class=\"metric\"><strong>${runningTasks}</strong><span>运行中任务</span></div>`,
    `          <div class=\"metric\"><strong>${blockedTasks}</strong><span>阻塞项</span></div>`,
    `          <div class=\"metric\"><strong>${passedGates}/${totalGates}</strong><span>Quality Gate</span></div>`,
    "          <div class=\"metric\"><strong>3m 24s</strong><span>最近链路耗时</span></div>",
    "        </div>",
    "        <div class=\"cta-row\">",
    "          <a class=\"cta\" href=\"#project-room\">进入项目房间</a>",
    "          <a class=\"ghost\" href=\"#quality-gate\">查看质量门禁</a>",
    "        </div>",
    "      </article>",
    "      <aside class=\"card\">",
    "        <h2 style=\"margin:0 0 8px;\">Agent 执行概览</h2>",
    "        <p>通过同屏暴露 agent、模型、技能与交付物，减少“看起来完成但没有证据”的判断风险。</p>",
    "        <div class=\"list\">",
    "          <div class=\"lane-head\"><span>名称</span><span>角色</span><span>当前任务</span><span>状态</span></div>",
    ...agentRows.map(([name, role, task, status]) => `          <div class="agent-row"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(role)}</span><span>${escapeHtml(task)}</span><span class="pill ${status}">${escapeHtml(status)}</span></div>`),
    "        </div>",
    "      </aside>",
    "    </section>",
    "    <section class=\"lane-grid\" id=\"project-room\">",
    "      <article class=\"card\">",
    "        <h2 style=\"margin:0 0 14px;\">任务流转</h2>",
    "        <div class=\"flow\">",
    "          <section class=\"flow-card\">",
    "            <header><strong>设计阶段 / UI 重构主链</strong><span class=\"pill running\">running</span></header>",
    "            <small>当前聚焦：项目房间、任务流转、验收报告、Quality Gate 的统一视觉体系</small>",
    "            <div class=\"evidence\">",
    "              <div>Agent: Jeremy · Model: openai/gpt-5.4 · Skill: frontend-design / stitch</div>",
    "              <div>最新产出：设计审查卡、视觉定稿单页、Stitch 导出链接</div>",
    "            </div>",
    "          </section>",
    "          <section class=\"flow-card\">",
    "            <header><strong>质量门禁阻断项批量修复</strong><span class=\"pill blocked\">blocked</span></header>",
    "            <small>阻塞原因：部分历史项目未归档真实执行证据，需在验收报告中补齐链接与运行结果。</small>",
    "          </section>",
    "        </div>",
    "      </article>",
    "      <aside class=\"card\" id=\"quality-gate\">",
    "        <h2 style=\"margin:0 0 10px;\">验收报告与 Quality Gate</h2>",
    "        <p>将人工审批动作放到证据附近，而不是隐藏在页面深处。</p>",
    "        <div class=\"gate\">",
    "          <div class=\"gate-item\"><strong>真实模型执行</strong><span>通过：保留模型、耗时与降级痕迹</span></div>",
    "          <div class=\"gate-item\"><strong>Stitch 设计证据</strong><span>通过：记录 html / image 链接</span></div>",
    "          <div class=\"gate-item\"><strong>页面可访问性</strong><span>待确认：移动端折叠规则与焦点态</span></div>",
    "        </div>",
    "      </aside>",
    "    </section>",
    "  </main>",
    "</body>",
    "</html>"
  ].join("\n");
}

export function buildRequirementAwareVisualPreviewHtml(input: DesignProfileInput & { visualDirection?: string }) {
  const profile = resolveDesignRequirementProfile(input);
  if (profile.scenarioId === "cross_border_product_radar") {
    return buildCrossBorderProductPreviewHtml(input);
  }
  if (profile.scenarioId === "collaboration_platform") {
    return buildCollaborationPlatformPreviewHtml(input);
  }
  return buildGenericBusinessPreviewHtml(input);
}

const GENERIC_DESIGN_TEMPLATE_PATTERNS = [
  /需求输入/i,
  /多\s*agent\s*协作/i,
  /执行证据回写/i,
  /阶段验收与回填/i,
  /项目观测室/i,
  /agent\s*中心/i
];

export function evaluateVisualDesignRequirementAlignment(input: DesignProfileInput & { content: string }) {
  const profile = resolveDesignRequirementProfile(input);
  const content = normalizeText(input.content);
  const issues: string[] = [];
  const diagnostics: string[] = [];
  const genericHits = GENERIC_DESIGN_TEMPLATE_PATTERNS.filter((pattern) => pattern.test(content));

  if (profile.scenarioId !== "collaboration_platform" && genericHits.length >= 2) {
    issues.push("视觉稿仍在描述协作平台流程，而不是用户真实业务界面。");
  }

  if (profile.scenarioId === "cross_border_product_radar") {
    const groups = [
      { label: "平台来源", patterns: [/tiktok|tik tok|亚马逊|amazon|temu/i] },
      { label: "爆品榜单", patterns: [/爆品|热卖|hot product|榜单|top\s*\d|排名/i] },
      { label: "监控告警", patterns: [/监控|告警|提醒|alert|预警/i] },
      { label: "跟品动作", patterns: [/跟品|跟踪|追踪|观察|watchlist|加入跟品/i] },
      { label: "商品链接", patterns: [/链接|详情|商品页|查看链接/i] },
      { label: "爆量指标", patterns: [/流量|热度|销量|增速|gmv|排名变化|趋势/i] }
    ];
    const matchedGroups = groups.filter((group) => hasAny(content, group.patterns));
    diagnostics.push(`业务信号命中: ${matchedGroups.length}/${groups.length}`);
    if (matchedGroups.length < 4) {
      issues.push("视觉稿没有覆盖爆品监控、榜单、跟品、平台来源和商品链接等核心业务信号。");
    }
    if (!matchedGroups.some((group) => group.label === "平台来源")) {
      issues.push("缺少 TikTok / Amazon / Temu 等平台来源表达。");
    }
    if (!matchedGroups.some((group) => group.label === "跟品动作")) {
      issues.push("缺少“加入跟品 / 继续观察 / 查看链接”等人工决策动作。");
    }
  } else if (profile.scenarioId === "collaboration_platform") {
    const groups = [
      { label: "项目总览", patterns: [/项目|project|项目详情|项目房间/i] },
      { label: "任务流转", patterns: [/任务|流转|看板|泳道|blocked|review|todo|running/i] },
      { label: "Agent 证据", patterns: [/agent|模型|skills?|技能|执行证据|耗时/i] },
      { label: "质量门禁", patterns: [/质量门禁|quality gate|signoff|验收|审批/i] },
      { label: "决策动作", patterns: [/打回|放行|批准|approve|reject|介入|进入项目房间/i] }
    ];
    const matchedGroups = groups.filter((group) => hasAny(content, group.patterns));
    diagnostics.push(`协作平台信号命中: ${matchedGroups.length}/${groups.length}`);
    if (matchedGroups.length < 4) {
      issues.push("视觉稿没有覆盖项目总览、任务流转、Agent 证据、质量门禁等协作平台核心信号。");
    }
    if (!matchedGroups.some((group) => group.label === "Agent 证据")) {
      issues.push("缺少 agent / 模型 / 技能 / 产出证据的可视化表达。");
    }
    if (!matchedGroups.some((group) => group.label === "质量门禁")) {
      issues.push("缺少验收报告或 Quality Gate 的决策信息层。");
    }
  } else {
    const businessSignals = [
      /工作台|列表|详情|看板|指标|主\s*cta|下一步/i,
      /用户|业务|场景|结果|动作/i
    ].filter((pattern) => pattern.test(content)).length;
    diagnostics.push(`通用业务信号命中: ${businessSignals}/2`);
    if (businessSignals < 2) {
      issues.push("视觉稿没有明确业务对象、关键数据和主动作。");
    }
  }

  return {
    pass: issues.length === 0,
    issues,
    diagnostics,
    profile
  };
}
