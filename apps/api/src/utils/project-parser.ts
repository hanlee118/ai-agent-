import type { ParsedIntent, RoleType } from "@occ/shared";

const DEFAULT_TEAM: RoleType[] = [
  "ROLE_PM",
  "ROLE_ANALYST",
  "ROLE_PRODUCT",
  "ROLE_DESIGN",
  "ROLE_ARCH",
  "ROLE_DEV",
  "ROLE_QA",
  "ROLE_HR"
];

export function previewRequirement(description: string): ParsedIntent {
  const normalized = description.trim();
  const keywords = collectKeywords(normalized);
  const constraints = collectConstraints(normalized);
  const risks = collectRisks(normalized);

  return {
    keywords,
    constraints,
    risks,
    suggestedTeam: DEFAULT_TEAM,
    summary: summarize(normalized, keywords, constraints)
  };
}

function collectKeywords(input: string): string[] {
  const normalized = input.toLowerCase();
  const domainHints: Array<{ label: string; pattern: RegExp }> = [
    { label: "跨境电商", pattern: /跨境|cross[\s-]?border/ },
    { label: "爆品监控", pattern: /爆品|爆量|热销|趋势商品/ },
    { label: "选品", pattern: /选品|选款|候选商品/ },
    { label: "跟品", pattern: /跟品|跟踪|持续追踪/ },
    { label: "商品榜单", pattern: /榜单|排名|top\s*\d+/ },
    { label: "TikTok", pattern: /tiktok|tik tok|抖音/ },
    { label: "Amazon", pattern: /amazon|亚马逊/ },
    { label: "Temu", pattern: /temu/ }
  ];

  const domainMatched = domainHints
    .filter((item) => item.pattern.test(normalized))
    .map((item) => item.label);
  if (domainMatched.length >= 2) {
    return Array.from(new Set(domainMatched)).slice(0, 8);
  }

  const dictionary = [
    "智能客服",
    "工作台",
    "多 Agent",
    "协作",
    "观测",
    "审批",
    "知识库",
    "研发",
    "前端",
    "后端"
  ];

  const matched = dictionary.filter((item) =>
    input.toLowerCase().includes(item.toLowerCase())
  );

  if (matched.length > 0) {
    return matched;
  }

  return input
    .replace(/[，。；、,.!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
}

function collectConstraints(input: string): string[] {
  const constraints: string[] = [];

  if (/(\d+)\s*(天|周|月|小时)/.test(input)) {
    const matched = input.match(/(\d+\s*(天|周|月|小时))/g) ?? [];
    constraints.push(...matched.map((item) => `时间约束: ${item}`));
  }

  if (/本地|离线|私有化/.test(input)) {
    constraints.push("部署约束: 需支持本地化或离线能力");
  }

  if (/实时|直播|观测/.test(input)) {
    constraints.push("体验约束: 需要低延迟实时观测");
  }

  if (constraints.length === 0) {
    constraints.push("约束基线: 默认按单用户 MVP 规划");
  }

  return constraints;
}

function collectRisks(input: string): string[] {
  const risks: string[] = [];

  if (/多 Agent|多角色|多人协作/.test(input)) {
    risks.push("编排复杂度较高，建议先验证主路径再扩展");
  }

  if (/实时|直播|流式/.test(input)) {
    risks.push("实时事件流对前后端协议稳定性要求较高");
  }

  if (/本地|离线|部署/.test(input)) {
    risks.push("本地部署会增加模型、存储和运维方案设计成本");
  }

  if (risks.length === 0) {
    risks.push("需求较宽泛，需通过阶段审批控制范围蔓延");
  }

  return risks;
}

function summarize(input: string, keywords: string[], constraints: string[]): string {
  const focus = keywords.slice(0, 3).join(" / ") || "产品主路径";
  const limit = constraints[0] ?? "按 MVP 方式推进";
  return `系统将围绕 ${focus} 展开，优先交付首个可验收版本，并遵循「${limit}」约束。原始需求摘要：${input.slice(0, 50)}${input.length > 50 ? "..." : ""}`;
}
