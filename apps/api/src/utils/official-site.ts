import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ROLE_LABELS, STAGE_LABELS, type ProjectDetail } from "@occ/shared";

export interface OfficialSiteArtifact {
  publicPath: string;
  filePaths: string[];
  kind: "design_preview" | "narrative_summary";
  sourceDeliverableName?: string;
}

function findWorkspaceRoot(startDir: string) {
  let current = startDir;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(startDir, "../../../");
}

function latestStageContent(project: ProjectDetail, stageType: "ANALYSIS" | "DESIGN" | "DEV" | "ACCEPT") {
  const candidate = project.deliverables
    .filter((item) => item.stageType === stageType)
    .sort((left, right) => right.version - left.version);
  return candidate[0]?.content ?? "";
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function listToHtml(items: string[]) {
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function extractRenderableHtmlPreview(content: string) {
  const source = String(content || "");
  const fencedPattern = /(?:^|\n)```html[ \t]*\n([\s\S]*?)\n```(?:\n|$)/gi;
  let matched: RegExpExecArray | null;
  while ((matched = fencedPattern.exec(source)) !== null) {
    const candidate = String(matched[1] || "").trim();
    if (/(<!doctype html|<html[\s>]|<body[\s>]|<main[\s>]|<section[\s>]|<div[\s>])/i.test(candidate)) {
      return candidate;
    }
  }

  if (/(<!doctype html|<html[\s>])/i.test(source)) {
    return source.trim();
  }

  return null;
}

function wrapPreviewSnippetAsHtml(snippet: string, projectName: string) {
  const normalized = String(snippet || "").trim();
  if (!normalized) {
    return "";
  }
  if (/(<!doctype html|<html[\s>])/i.test(normalized)) {
    return normalized;
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(projectName)} · 视觉定稿预览</title>
  <style>
    body { margin: 0; font-family: "SF Pro Display","PingFang SC","Segoe UI",sans-serif; background: #0b0f17; color: #eef2ff; }
    .preview-shell { padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,.12); background: rgba(6,10,18,.85); }
    .preview-shell strong { display: block; font-size: 14px; letter-spacing: .06em; text-transform: uppercase; color: #8ea3ff; }
    .preview-shell p { margin: 6px 0 0; font-size: 12px; color: #b7c4e8; }
  </style>
</head>
<body>
  <section class="preview-shell">
    <strong>Design Preview Source</strong>
    <p>当前官网演示页直接渲染“视觉定稿单页”交付物中的 HTML 片段。</p>
  </section>
  ${normalized}
</body>
</html>`;
}

type NarrativeStage = "ANALYSIS" | "DESIGN" | "DEV" | "ACCEPT";

const GENERIC_BULLET_PATTERNS: RegExp[] = [
  /^项目[:：]/i,
  /^阶段[:：]/i,
  /^当前状态[:：]/i,
  /^产出角色[:：]/i,
  /^执行角色[:：]/i,
  /^执行引擎[:：]/i,
  /^生成时间[:：]/i,
  /^更新时间[:：]/i,
  /^模型[:：]/i,
  /^任务[:：]/i,
  /^角色[:：]/i,
  /^\d+\.\s*(openai|gpt-|claude|qwen|deepseek|gemini)/i
];

const NOISY_TEXT_PATTERNS: RegExp[] = [
  /runtime-selected/i,
  /MODEL_ATTEMPT_TIMEOUT|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i,
  /scripted-agent/i,
  /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i,
  /https?:\/\//i
];

const STAGE_SECTION_HINTS: Record<NarrativeStage, RegExp[]> = {
  ANALYSIS: [/需求|目标|范围|约束|风险|验收|里程碑|场景|用户/i],
  DESIGN: [/视觉|版式|布局|组件|品牌|交互|无障碍|可访问|审查|信息架构/i],
  DEV: [/技术|架构|实现|接口|数据|开发|联调|部署|测试|工程/i],
  ACCEPT: [/验收|回填|发布|上线|复盘|结论|指标|质量|交付/i]
};

const STAGE_IGNORED_SECTION_HINTS = /交付物元信息|专业模板约束|当前任务清单|模板章节骨架|关键词上下文|关键约束|主要风险|下一阶段输入|自动推进元信息|模型尝试轨迹/i;
const GENERIC_KEYWORD_STOPWORDS = new Set([
  "系统",
  "平台",
  "项目",
  "分析",
  "设计",
  "开发",
  "研发",
  "观测",
  "验收"
]);

function dedupeList(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function summarizeText(input: string, maxLength = 86) {
  const normalized = String(input || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function isMeaningfulNarrativeLine(line: string) {
  const normalized = String(line || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  if (normalized.length < 6 || normalized.length > 120) {
    return false;
  }
  if (GENERIC_BULLET_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  if (NOISY_TEXT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  if (/交付模板类型|模板章节骨架|请结合(?:\s*Agent\s*输出正文)?与任务证据补全本节|关键词上下文|专业模板约束|当前任务清单|交付物元信息/i.test(normalized)) {
    return false;
  }
  return true;
}

function stripMarkdownNoise(content: string) {
  return String(content || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\r\n/g, "\n");
}

function parseMarkdownSections(content: string) {
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current = { title: "__root__", lines: [] as string[] };
  for (const rawLine of stripMarkdownNoise(content).split("\n")) {
    const line = rawLine.trim();
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      sections.push(current);
      current = { title: heading[1].trim(), lines: [] };
      continue;
    }
    if (line) {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

function extractListItems(lines: string[]) {
  const bullets = lines
    .map((line) => {
      const listMatch = line.match(/^[-*+]\s+(.+)$/);
      if (listMatch?.[1]) {
        return listMatch[1].trim();
      }
      const orderMatch = line.match(/^\d+\.\s+(.+)$/);
      if (orderMatch?.[1]) {
        return orderMatch[1].trim();
      }
      return "";
    })
    .filter(Boolean);
  return dedupeList(bullets);
}

function normalizeDeliverableName(name: string) {
  return String(name || "")
    .replace(/\.(md|markdown|txt|html)$/i, "")
    .replace(/[-_]/g, " ")
    .trim();
}

function buildIntentDrivenFallbacks(project: ProjectDetail, stage: NarrativeStage) {
  const keywords = dedupeList((project.parsedIntent?.keywords || []).map((item) => summarizeText(item, 24)));
  const constraints = dedupeList((project.parsedIntent?.constraints || []).map((item) => summarizeText(item, 30)));
  const risks = dedupeList((project.parsedIntent?.risks || []).map((item) => summarizeText(item, 30)));
  const summary = summarizeText(project.parsedIntent?.summary || project.description || "", 72);

  if (stage === "ANALYSIS") {
    return dedupeList([
      summary ? `核心目标：${summary}` : "",
      keywords.length > 0 ? `关键业务词：${keywords.slice(0, 3).join(" / ")}` : "",
      constraints.length > 0 ? `约束条件：${constraints.slice(0, 2).join("；")}` : "",
      risks.length > 0 ? `主要风险：${risks.slice(0, 2).join("；")}` : ""
    ]);
  }

  if (stage === "DESIGN") {
    return dedupeList([
      keywords.length > 0 ? `视觉与交互需服务于：${keywords.slice(0, 3).join(" / ")}` : "",
      constraints.length > 0 ? `设计约束需覆盖：${constraints.slice(0, 2).join("；")}` : "",
      "通过设计审查卡确认信息架构、组件与可访问性清单",
      "提供可确认静态稿或 HTML 单页后再进入开发"
    ]);
  }

  if (stage === "DEV") {
    return dedupeList([
      keywords.length > 0 ? `研发实现优先打通：${keywords.slice(0, 3).join(" / ")}` : "",
      "按阶段任务拆解关键路径并保留执行证据",
      constraints.length > 0 ? `实现需满足：${constraints.slice(0, 2).join("；")}` : "",
      risks.length > 0 ? `重点规避：${risks.slice(0, 2).join("；")}` : ""
    ]);
  }

  return dedupeList([
    "按验收口径核对主流程、证据链与关键指标",
    "将最终结果回填产品说明文档并沉淀版本记录",
    risks.length > 0 ? `验收阶段重点关注：${risks.slice(0, 2).join("；")}` : "",
    constraints.length > 0 ? `交付遵循约束：${constraints.slice(0, 2).join("；")}` : ""
  ]);
}

function extractStageHighlights(
  project: ProjectDetail,
  stage: NarrativeStage,
  content: string,
  fallback: string[]
) {
  const sections = parseMarkdownSections(content);
  const stageSections = sections.filter((section) => !STAGE_IGNORED_SECTION_HINTS.test(section.title));
  const sectionHints = STAGE_SECTION_HINTS[stage];
  const preferredSections = stageSections.filter((section) => sectionHints.some((hint) => hint.test(section.title)));
  const selectedSections = preferredSections.length > 0 ? preferredSections : stageSections;

  const candidates = dedupeList(
    selectedSections.flatMap((section) => extractListItems(section.lines))
  ).filter((line) => isMeaningfulNarrativeLine(line));

  if (candidates.length > 0) {
    return candidates.slice(0, 6);
  }

  const intentFallback = buildIntentDrivenFallbacks(project, stage);
  const mergedFallback = dedupeList([...fallback, ...intentFallback]).filter((line) => isMeaningfulNarrativeLine(line) || line.startsWith("核心目标："));
  return mergedFallback.slice(0, 6);
}

function buildHeroKeywordLine(project: ProjectDetail) {
  const keywords = dedupeList(project.parsedIntent?.keywords || []);
  const filtered = keywords.filter((item) => {
    const normalized = String(item || "").trim();
    if (!normalized) {
      return false;
    }
    if (GENERIC_KEYWORD_STOPWORDS.has(normalized)) {
      return false;
    }
    return true;
  });
  if (filtered.length > 0) {
    return filtered.slice(0, 3).join(" / ");
  }

  const source = `${project.name} ${project.description} ${project.parsedIntent?.summary || ""}`;
  const inferred: string[] = [];
  if (/tiktok/i.test(source)) inferred.push("TikTok");
  if (/amazon/i.test(source)) inferred.push("Amazon");
  if (/temu/i.test(source)) inferred.push("Temu");
  if (/跨境/i.test(source)) inferred.push("跨境");
  if (/爆品/i.test(source)) inferred.push("爆品监控");
  if (/跟品/i.test(source)) inferred.push("跟品跟踪");
  return dedupeList(inferred).slice(0, 3).join(" / ");
}

function buildTopSignals(project: ProjectDetail, stageBullets: string[][]) {
  const keywords = dedupeList((project.parsedIntent?.keywords || []).map((item) => summarizeText(item, 24)));
  const constraints = dedupeList((project.parsedIntent?.constraints || []).map((item) => summarizeText(item, 24)));
  const risks = dedupeList((project.parsedIntent?.risks || []).map((item) => summarizeText(item, 24)));

  const intentSignals = [
    ...keywords.slice(0, 2).map((item) => `业务关键词：${item}`),
    ...constraints.slice(0, 2).map((item) => `约束条件：${item}`),
    ...risks.slice(0, 2).map((item) => `风险关注：${item}`)
  ];

  const stageSignals = stageBullets.flat().filter((line) => isMeaningfulNarrativeLine(line)).slice(0, 6);
  return dedupeList([...intentSignals, ...stageSignals]).slice(0, 6);
}

function buildQuickWins(project: ProjectDetail, acceptBullets: string[]) {
  const approvedDeliverables = project.deliverables
    .filter((item) => item.status === "approved")
    .slice()
    .sort((left, right) => right.version - left.version)
    .slice(0, 2)
    .map((item) => `已完成交付：${normalizeDeliverableName(item.name)}`);
  const completedTasks = project.tasks.filter((item) => item.status === "done").length;
  const primary = dedupeList([
    ...approvedDeliverables,
    completedTasks > 0 ? `已落地任务：${completedTasks} 项` : ""
  ]);
  const supplemental = acceptBullets.filter((item) => !primary.includes(item));
  return dedupeList([...primary, ...supplemental]).slice(0, 3);
}

type VisualPreset = "apple" | "default";

function detectVisualPreset(project: ProjectDetail, designContent: string): VisualPreset {
  const source = [
    project.name,
    project.description,
    project.parsedIntent?.summary,
    designContent
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(苹果|apple|ios|macos|swiftui|human interface)/i.test(source)) {
    return "apple";
  }
  return "default";
}

function renderAppleOfficialSiteHtml(input: {
  project: ProjectDetail;
  heroTitle: string;
  heroLead: string;
  stageCompletionPercent: number;
  completedStages: number;
  analysisBullets: string[];
  designBullets: string[];
  devBullets: string[];
  acceptBullets: string[];
  signalCards: string;
  stageTrack: string;
  stageCards: string;
  teamChips: string;
}) {
  const {
    project,
    heroTitle,
    heroLead,
    stageCompletionPercent,
    completedStages,
    analysisBullets,
    designBullets,
    devBullets,
    acceptBullets,
    signalCards,
    stageTrack,
    stageCards,
    teamChips
  } = input;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(project.name)} · 官方介绍页</title>
  <style>
    :root {
      --bg: #f5f5f7;
      --panel: rgba(255, 255, 255, 0.86);
      --line: rgba(15, 23, 42, 0.08);
      --text: #111827;
      --muted: #4b5563;
      --brand: #0071e3;
      --brand-soft: #e8f3ff;
      --ok: #16a34a;
      --shadow: 0 24px 70px rgba(15, 23, 42, 0.12);
      --radius-xl: 28px;
      --radius-lg: 18px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif;
      background:
        radial-gradient(760px 480px at 50% -30%, #d9ecff 0%, transparent 68%),
        radial-gradient(560px 300px at 90% 0%, #eef6ff 0%, transparent 70%),
        var(--bg);
      min-height: 100vh;
    }
    .wrap {
      width: min(1180px, 92vw);
      margin: 0 auto;
      padding: 48px 0 88px;
    }
    .preview-notice {
      margin-bottom: 18px;
      border: 1px solid rgba(0,113,227,0.18);
      border-radius: 18px;
      padding: 14px 16px;
      background: rgba(255,255,255,0.76);
      color: #334155;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
    }
    .preview-notice strong {
      display: block;
      font-size: 13px;
      color: #0f172a;
    }
    .preview-notice p {
      margin: 6px 0 0;
      font-size: 12px;
      line-height: 1.7;
    }
    .hero {
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      background: linear-gradient(150deg, rgba(255,255,255,0.93), rgba(255,255,255,0.7));
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
      padding: 34px;
      display: grid;
      gap: 24px;
      grid-template-columns: 1.35fr 0.65fr;
    }
    .badge {
      display: inline-flex;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid rgba(0,113,227,0.28);
      background: var(--brand-soft);
      color: var(--brand);
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.04em;
    }
    h1 {
      margin: 14px 0 0;
      font-size: clamp(32px, 4.8vw, 58px);
      line-height: 1.02;
      letter-spacing: -0.03em;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif;
      max-width: 820px;
    }
    .lead {
      margin: 14px 0 0;
      color: var(--muted);
      line-height: 1.8;
      font-size: 15px;
      max-width: 760px;
    }
    .hero-side {
      border: 1px solid var(--line);
      border-radius: 20px;
      background: rgba(255,255,255,0.8);
      padding: 16px;
    }
    .hero-side h3 {
      margin: 0;
      font-size: 12px;
      color: #334155;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .meter {
      margin-top: 12px;
      background: #eef2f7;
      border-radius: 999px;
      overflow: hidden;
      height: 10px;
    }
    .meter span {
      display: block;
      width: ${stageCompletionPercent}%;
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, #2d8cff, #0071e3);
    }
    .meter-label {
      margin-top: 8px;
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #475569;
    }
    .mini-kpi {
      margin-top: 12px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .mini-kpi article {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      background: rgba(255,255,255,0.92);
    }
    .mini-kpi strong {
      display: block;
      font-size: 20px;
      letter-spacing: -0.02em;
    }
    .mini-kpi span {
      font-size: 11px;
      color: #64748b;
    }
    .kpis {
      margin: 14px 0;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .kpi {
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(255,255,255,0.88);
      padding: 14px;
    }
    .kpi strong { display: block; font-size: 28px; letter-spacing: -0.03em; }
    .kpi span { color: #64748b; font-size: 12px; }
    .kpi .hint { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; }
    .signals {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 10px;
    }
    .signal-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(255,255,255,0.9);
      padding: 14px;
    }
    .signal-index {
      display: inline-flex;
      font-size: 10px;
      padding: 3px 7px;
      border-radius: 999px;
      background: #eef4ff;
      color: #2563eb;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .signal-card p {
      margin: 0;
      line-height: 1.7;
      color: #475569;
      font-size: 14px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: rgba(255,255,255,0.9);
      padding: 16px;
    }
    .card h3 { margin: 0 0 10px; font-size: 18px; letter-spacing: -0.01em; }
    .card ul { margin: 0; padding-left: 18px; color: #475569; line-height: 1.85; }
    .stage-track {
      margin-top: 10px;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
    }
    .track-node {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      background: #ffffff;
      display: grid;
      gap: 4px;
    }
    .track-node .dot {
      width: 22px;
      height: 22px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      color: #334155;
      background: #e5edf7;
    }
    .track-node.done .dot {
      color: #fff;
      background: linear-gradient(120deg, #3397ff, #0071e3);
    }
    .track-node strong { font-size: 13px; }
    .track-node em { font-style: normal; color: #64748b; font-size: 11px; }
    .flow {
      margin-top: 10px;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
    }
    .stage-card {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #ffffff;
      padding: 10px;
    }
    .stage-card h4 { margin: 0 0 4px; font-size: 13px; color: #0f172a; }
    .stage-card p { margin: 0; color: #64748b; font-size: 12px; }
    .team {
      margin-top: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 12px;
      background: #fff;
      color: #334155;
    }
    .cta {
      margin-top: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      border-radius: 999px;
      padding: 11px 17px;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .btn-primary {
      color: #fff;
      background: linear-gradient(120deg, #2490ff, #0071e3);
    }
    .btn-ghost {
      color: #334155;
      border-color: #cdd7e4;
      background: #fff;
    }
    .ok { color: var(--ok); font-weight: 700; }
    @media (max-width: 980px) {
      .hero { grid-template-columns: 1fr; }
      .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .signals { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
      .stage-track, .flow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      .kpis { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="preview-notice">
      <strong>交付物快照页</strong>
      <p>此页面用于呈现当前项目交付物生成结果快照；审批状态与项目房间实时信息以平台主界面为准。</p>
    </section>
    <section class="hero">
      <article>
        <span class="badge">Apple Style · ${escapeHtml(project.id)}</span>
        <h1>${escapeHtml(heroTitle)}</h1>
        <p class="lead">
          ${escapeHtml(heroLead)}
          项目状态：<span class="ok">${escapeHtml(project.status)}（${project.progress}%）</span>。
        </p>
      </article>
      <article class="hero-side">
        <h3>Progress</h3>
        <div class="meter"><span></span></div>
        <div class="meter-label"><span>流程完成率</span><b>${stageCompletionPercent}%</b></div>
        <div class="mini-kpi">
          <article><strong>${completedStages}/${project.stages.length}</strong><span>阶段完成</span></article>
          <article><strong>${project.deliverables.filter((item) => item.status === "approved").length}</strong><span>批准产物</span></article>
          <article><strong>${project.tasks.filter((item) => item.status === "done").length}</strong><span>完成任务</span></article>
          <article><strong>${project.team.length}</strong><span>协作角色</span></article>
        </div>
      </article>
    </section>

    <section class="kpis">
      <article class="kpi"><strong>${project.stages.length}</strong><span>流程阶段</span><i class="hint">Workflow</i></article>
      <article class="kpi"><strong>${project.deliverables.filter((item) => item.status === "approved").length}</strong><span>已批准交付物</span><i class="hint">Deliverables</i></article>
      <article class="kpi"><strong>${project.tasks.filter((item) => item.status === "done").length}</strong><span>完成任务数</span><i class="hint">Execution</i></article>
      <article class="kpi"><strong>${project.team.length}</strong><span>协作角色</span><i class="hint">Agent Team</i></article>
    </section>

    <section class="signals">${signalCards}</section>

    <section class="grid">
      <article class="card"><h3>需求分析</h3><ul>${listToHtml(analysisBullets)}</ul></article>
      <article class="card"><h3>视觉设计</h3><ul>${listToHtml(designBullets)}</ul></article>
      <article class="card"><h3>研发实现</h3><ul>${listToHtml(devBullets)}</ul></article>
      <article class="card"><h3>验收回填</h3><ul>${listToHtml(acceptBullets)}</ul></article>
    </section>

    <section class="card" style="margin-top: 10px">
      <h3>协作流程</h3>
      <div class="stage-track">${stageTrack}</div>
      <div class="flow">${stageCards}</div>
      <div class="team">${teamChips}</div>
      <div class="cta">
        <a class="btn btn-primary" href="#demo">预约演示</a>
        <a class="btn btn-ghost" href="/" target="_blank" rel="noreferrer">进入协作平台</a>
      </div>
    </section>

    <section id="demo" class="card" style="margin-top: 10px">
      <h3>演示预约入口</h3>
      <ul>
        <li>邮箱：demo@aicollab.local</li>
        <li>请附带行业、团队规模、上线目标时间</li>
        <li>我们将基于项目上下文提供专属演示脚本</li>
      </ul>
    </section>
  </main>
</body>
</html>`;
}

function renderOfficialSiteHtml(project: ProjectDetail): {
  html: string;
  kind: "design_preview" | "narrative_summary";
  sourceDeliverableName?: string;
} {
  const visualPreviewCandidate = project.deliverables
    .filter((item) => item.stageType === "DESIGN")
    .sort((left, right) => {
      const byVersion = right.version - left.version;
      if (byVersion !== 0) {
        return byVersion;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    })
    .find((item) => /视觉定稿|preview\.html|单页预览|mockup|wireframe|design preview/i.test(String(item.name || "")));
  const previewHtml = extractRenderableHtmlPreview(String(visualPreviewCandidate?.content || ""));
  if (previewHtml && project.status !== "completed") {
    return {
      html: wrapPreviewSnippetAsHtml(previewHtml, project.name),
      kind: "design_preview",
      sourceDeliverableName: String(visualPreviewCandidate?.name || "").trim() || undefined
    };
  }

  const latestDesign = latestStageContent(project, "DESIGN");
  const visualPreset = detectVisualPreset(project, latestDesign);
  const analysisBullets = extractStageHighlights(
    project,
    "ANALYSIS",
    latestStageContent(project, "ANALYSIS"),
    [
      "明确目标、范围、验收标准",
      "确定主路径与里程碑",
      "形成风险清单与边界约束"
    ]
  );
  const designBullets = extractStageHighlights(
    project,
    "DESIGN",
    latestDesign,
    [
      "完成视觉方向与品牌语气定义",
      "完成关键页面版式与组件清单",
      "通过可访问性检查并完成设计审查"
    ]
  );
  const devBullets = extractStageHighlights(
    project,
    "DEV",
    latestStageContent(project, "DEV"),
    [
      "完成核心流程实现与关键路径联调",
      "补齐任务证据与工程可追踪记录",
      "保留可扩展数据位与后续接入能力"
    ]
  );
  const acceptBullets = extractStageHighlights(
    project,
    "ACCEPT",
    latestStageContent(project, "ACCEPT"),
    [
      "主流程可访问并可演示",
      "设计审查卡通过并进入验收",
      "实施结果可回填产品说明文档"
    ]
  );

  const teamLabels = project.team.map((role) => ROLE_LABELS[role] ?? role).slice(0, 8);
  const intentSummary = summarizeText(project.parsedIntent?.summary || project.description || "", 120);
  const keywordLine = buildHeroKeywordLine(project);
  const constraintLine = dedupeList(project.parsedIntent?.constraints || []).slice(0, 2).join("；");
  const heroTitle = keywordLine
    ? `${project.name} · ${keywordLine}`
    : `${project.name} · 需求到研发闭环`;
  const heroLeadParts = [
    intentSummary || "该项目关注真实业务链路落地，强调可执行与可验收。",
    constraintLine ? `关键约束：${constraintLine}` : ""
  ].filter(Boolean);
  const heroLead = `${heroLeadParts.join(" ")} `;

  const completedStages = project.stages.filter((stage) => stage.status === "completed").length;
  const stageCompletionPercent = project.stages.length > 0
    ? Math.round((completedStages / project.stages.length) * 100)
    : 0;
  const topSignals = buildTopSignals(project, [analysisBullets, designBullets, devBullets, acceptBullets]);
  const quickWins = buildQuickWins(project, acceptBullets);
  const stageCards = project.stages
    .map((stage) => {
      const value = stage.status === "completed" ? "完成" : stage.status;
      return `<article class="stage-card"><h4>${escapeHtml(STAGE_LABELS[stage.type])}</h4><p>${escapeHtml(value)}</p></article>`;
    })
    .join("");
  const stageTrack = project.stages
    .map((stage, index) => {
      const done = stage.status === "completed";
      return `
      <div class="track-node ${done ? "done" : ""}">
        <span class="dot">${index + 1}</span>
        <strong>${escapeHtml(STAGE_LABELS[stage.type])}</strong>
        <em>${escapeHtml(done ? "完成" : stage.status)}</em>
      </div>`;
    })
    .join("");
  const signalCards = topSignals
    .map(
      (signal, index) => `
      <article class="signal-card" style="--delay:${index * 70}ms">
        <span class="signal-index">0${index + 1}</span>
        <p>${escapeHtml(signal)}</p>
      </article>`
    )
    .join("");
  const winItems = quickWins.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const teamChips = teamLabels.map((label) => `<span class="chip">${escapeHtml(label)}</span>`).join("");

  if (visualPreset === "apple") {
    return {
      html: renderAppleOfficialSiteHtml({
        project,
        heroTitle,
        heroLead,
        stageCompletionPercent,
        completedStages,
        analysisBullets,
        designBullets,
        devBullets,
        acceptBullets,
        signalCards,
        stageTrack,
        stageCards,
        teamChips
      }),
      kind: "narrative_summary"
    };
  }

  return {
    kind: "narrative_summary",
    html: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(project.name)} · 官方介绍页</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=IBM+Plex+Sans+SC:wght@400;500;700&display=swap');
    :root {
      --bg-0: #050a16;
      --bg-1: #0c1730;
      --panel: rgba(255, 255, 255, 0.08);
      --panel-strong: rgba(255, 255, 255, 0.11);
      --line: rgba(136, 177, 255, 0.28);
      --text: #eff5ff;
      --muted: #a9b9d7;
      --brand-a: #36ddc8;
      --brand-b: #5f8dff;
      --brand-c: #ffbe64;
      --ok: #70f3b0;
      --shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      font-family: "IBM Plex Sans SC", "PingFang SC", sans-serif;
      background:
        radial-gradient(920px 640px at 0% -12%, #2494ff4f, transparent 62%),
        radial-gradient(980px 600px at 100% -20%, #39d7c34f, transparent 68%),
        radial-gradient(700px 420px at 48% 110%, #ffbe6426, transparent 72%),
        linear-gradient(155deg, var(--bg-0), var(--bg-1) 68%, #080e1d);
      min-height: 100vh;
    }
    .mesh,
    .mesh-2 {
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(255,255,255,0.027) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.027) 1px, transparent 1px);
      background-size: 40px 40px;
      opacity: 0.2;
    }
    .mesh-2 {
      transform: rotate(8deg) scale(1.08);
      opacity: 0.08;
      filter: blur(1px);
    }
    .wrap { width: min(1160px, 92vw); margin: 0 auto; padding: 58px 0 88px; position: relative; }
    .preview-notice {
      margin-bottom: 18px;
      border: 1px solid rgba(136, 177, 255, 0.24);
      border-radius: 18px;
      padding: 14px 16px;
      background: rgba(4, 10, 22, 0.48);
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
    }
    .preview-notice strong {
      display: block;
      font-size: 13px;
      color: #eff5ff;
    }
    .preview-notice p {
      margin: 6px 0 0;
      font-size: 12px;
      line-height: 1.7;
      color: #b7c7e6;
    }
    .hero {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 16px;
      margin-bottom: 20px;
      animation: rise 560ms ease;
    }
    .hero-main,
    .hero-side {
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 22px;
      background: linear-gradient(140deg, rgba(255,255,255,0.11), rgba(255,255,255,0.04));
      backdrop-filter: blur(10px);
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
    }
    .hero-main::after {
      content: "";
      position: absolute;
      width: 320px;
      height: 320px;
      right: -110px;
      top: -140px;
      border-radius: 999px;
      background: radial-gradient(circle at 30% 40%, #66e5d8aa, #2c69ff22 72%);
      filter: blur(2px);
      animation: pulse 6.2s ease-in-out infinite;
    }
    .badge {
      display: inline-flex;
      width: fit-content;
      gap: 8px;
      align-items: center;
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 999px;
      padding: 7px 13px;
      color: #9de9dc;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: rgba(0,0,0,0.25);
    }
    h1,
    h2 {
      margin: 0;
      font-family: "Sora", "IBM Plex Sans SC", sans-serif;
      line-height: 1.05;
      letter-spacing: -0.02em;
    }
    h1 {
      font-size: clamp(32px, 5.2vw, 58px);
      max-width: 780px;
      margin-top: 14px;
      background: linear-gradient(130deg, #ffffff 8%, #d0ddff 44%, #8af2df 92%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .lead {
      margin: 12px 0 0;
      color: var(--muted);
      line-height: 1.78;
      max-width: 760px;
      font-size: 15px;
    }
    .hero-side h3 {
      margin: 0;
      font-size: 14px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #bcd0ef;
    }
    .meter {
      margin-top: 14px;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      background: rgba(5, 18, 38, 0.5);
    }
    .meter-label {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #c7d7f5;
      margin-bottom: 8px;
    }
    .meter-track {
      height: 9px;
      border-radius: 999px;
      background: rgba(255,255,255,0.15);
      overflow: hidden;
    }
    .meter-track span {
      display: block;
      height: 100%;
      width: ${stageCompletionPercent}%;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--brand-a), var(--brand-b));
    }
    .mini-kpi {
      margin-top: 10px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .mini-kpi article {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      background: rgba(255,255,255,0.05);
    }
    .mini-kpi strong { display: block; font-size: 20px; }
    .mini-kpi span { font-size: 11px; color: var(--muted); }
    .kpis {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin: 14px 0 26px;
      animation: rise 680ms ease;
    }
    .kpi {
      background: linear-gradient(145deg, var(--panel-strong), rgba(255,255,255,0.03));
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 16px;
      backdrop-filter: blur(8px);
      transition: transform 200ms ease;
    }
    .kpi:hover { transform: translateY(-2px); }
    .kpi .hint {
      display: inline-block;
      margin-top: 7px;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #98c5ff;
    }
    .kpi strong { display: block; font-size: 28px; font-weight: 800; color: var(--text); }
    .kpi span { color: var(--muted); font-size: 12px; letter-spacing: 0.04em; }
    .signals {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 14px;
    }
    .signal-card {
      background: linear-gradient(140deg, rgba(255,255,255,0.12), rgba(255,255,255,0.05));
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 16px;
      backdrop-filter: blur(8px);
      animation: rise 760ms ease both;
      animation-delay: var(--delay);
    }
    .signal-index {
      display: inline-flex;
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.2);
      font-size: 10px;
      color: #b8d2ff;
      letter-spacing: 0.1em;
      margin-bottom: 8px;
    }
    .signal-card p {
      margin: 0;
      line-height: 1.72;
      color: var(--muted);
      font-size: 14px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 14px;
      animation: rise 820ms ease;
    }
    .card {
      background: linear-gradient(145deg, var(--panel), rgba(255,255,255,0.03));
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
      backdrop-filter: blur(8px);
      box-shadow: 0 8px 28px rgba(0,0,0,0.25);
    }
    .card h3 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0.01em; }
    .card ul { margin: 0; padding-left: 18px; color: var(--muted); line-height: 1.9; }
    .stage-track {
      margin-top: 14px;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
    }
    .track-node {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      background: rgba(255,255,255,0.03);
      display: grid;
      gap: 4px;
    }
    .track-node .dot {
      width: 22px;
      height: 22px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      color: #0f1b2f;
      background: #c2d1ec;
    }
    .track-node.done .dot { background: linear-gradient(130deg, var(--brand-a), var(--brand-b)); }
    .track-node strong { font-size: 13px; }
    .track-node em { font-style: normal; font-size: 11px; color: var(--muted); }
    .flow {
      margin-top: 14px;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
    }
    .stage-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      background: rgba(255,255,255,0.04);
    }
    .stage-card h4 { margin: 0 0 6px; font-size: 14px; color: var(--accent); }
    .stage-card p { margin: 0; color: var(--muted); font-size: 13px; }
    .team {
      margin-top: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 12px;
      color: var(--text);
      background: rgba(255,255,255,0.05);
      font-size: 12px;
    }
    .cta {
      margin-top: 18px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .btn {
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 11px 16px;
      border-radius: 12px;
      border: 1px solid transparent;
      font-weight: 700;
      transition: transform 180ms ease, opacity 180ms ease;
    }
    .btn:hover { transform: translateY(-1px); opacity: 0.92; }
    .btn-primary {
      background: linear-gradient(120deg, var(--brand-a), var(--brand-b));
      color: #072236;
    }
    .btn-ghost {
      border-color: var(--line);
      color: var(--text);
    }
    .ok { color: var(--ok); font-weight: 700; }
    @keyframes rise {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.85; }
      50% { transform: scale(1.08); opacity: 1; }
    }
    @media (max-width: 980px) {
      .hero { grid-template-columns: 1fr; }
      .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .signals { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
      .stage-track { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .flow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      .kpis { grid-template-columns: 1fr; }
      .mini-kpi { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <div class="mesh"></div>
  <div class="mesh-2"></div>
  <main class="wrap">
    <section class="preview-notice">
      <strong>交付物快照页</strong>
      <p>此页面用于呈现当前项目交付物生成结果快照；审批状态与项目房间实时信息以平台主界面为准。</p>
    </section>
    <section class="hero">
      <article class="hero-main">
        <span class="badge">Official Demo · ${escapeHtml(project.id)}</span>
        <h1>${escapeHtml(heroTitle)}</h1>
        <p class="lead">
          ${escapeHtml(heroLead)}
          项目状态：<span class="ok">${escapeHtml(project.status)}（${project.progress}%）</span>。
        </p>
      </article>
      <article class="hero-side">
        <h3>Execution Console</h3>
        <div class="meter">
          <div class="meter-label"><span>流程完成率</span><b>${stageCompletionPercent}%</b></div>
          <div class="meter-track"><span></span></div>
        </div>
        <div class="mini-kpi">
          <article><strong>${completedStages}/${project.stages.length}</strong><span>阶段完成</span></article>
          <article><strong>${project.deliverables.filter((item) => item.status === "approved").length}</strong><span>批准产物</span></article>
          <article><strong>${project.tasks.filter((item) => item.status === "done").length}</strong><span>完成任务</span></article>
          <article><strong>${teamLabels.length}</strong><span>协作角色</span></article>
        </div>
      </article>
    </section>

    <section class="kpis">
      <article class="kpi"><strong>${project.stages.length}</strong><span>流程阶段</span><i class="hint">Workflow</i></article>
      <article class="kpi"><strong>${project.deliverables.filter((item) => item.status === "approved").length}</strong><span>已批准交付物</span><i class="hint">Deliverables</i></article>
      <article class="kpi"><strong>${project.tasks.filter((item) => item.status === "done").length}</strong><span>完成任务数</span><i class="hint">Execution</i></article>
      <article class="kpi"><strong>${teamLabels.length}</strong><span>协作角色</span><i class="hint">Agent Team</i></article>
    </section>

    <section class="signals">${signalCards}</section>

    <section class="grid">
      <article class="card"><h3>需求分析</h3><ul>${listToHtml(analysisBullets)}</ul></article>
      <article class="card"><h3>视觉设计</h3><ul>${listToHtml(designBullets)}</ul></article>
      <article class="card"><h3>研发实现</h3><ul>${listToHtml(devBullets)}</ul></article>
      <article class="card"><h3>验收回填</h3><ul>${listToHtml(acceptBullets)}</ul><ul style="margin-top:10px">${winItems}</ul></article>
    </section>

    <section class="card">
      <h3>协作流程</h3>
      <div class="stage-track">${stageTrack}</div>
      <div class="flow">${stageCards}</div>
      <div class="team">${teamChips}</div>
      <div class="cta">
        <a class="btn btn-primary" href="#demo">预约演示</a>
        <a class="btn btn-ghost" href="/" target="_blank" rel="noreferrer">进入协作平台</a>
      </div>
    </section>

    <section id="demo" class="card" style="margin-top: 16px;">
      <h3>演示预约入口</h3>
      <ul>
        <li>邮箱：demo@aicollab.local</li>
        <li>请附带行业、团队规模、上线目标时间</li>
        <li>我们将基于项目上下文提供专属演示脚本</li>
      </ul>
    </section>
  </main>
</body>
</html>`
  };
}

export async function generateOfficialSiteArtifact(project: ProjectDetail): Promise<OfficialSiteArtifact> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = findWorkspaceRoot(moduleDir);
  const fileName = `ai-collab-official-${project.id}.html`;
  const relativePath = path.join("generated", fileName);
  const rendered = renderOfficialSiteHtml(project);
  const html = rendered.html;

  const targets = [
    path.join(workspaceRoot, "apps", "web", "public", relativePath),
    path.join(workspaceRoot, "apps", "web", "dist", relativePath),
    path.join(workspaceRoot, "site", relativePath)
  ];

  for (const target of targets) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html, "utf8");
  }

  return {
    publicPath: `/${relativePath.replaceAll("\\", "/")}`,
    filePaths: targets,
    kind: rendered.kind,
    sourceDeliverableName: rendered.sourceDeliverableName
  };
}
