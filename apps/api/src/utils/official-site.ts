import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ROLE_LABELS, STAGE_LABELS, type ProjectDetail } from "@occ/shared";

export interface OfficialSiteArtifact {
  publicPath: string;
  filePaths: string[];
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

function extractBullets(content: string, fallback: string[]) {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return fallback;
  }
  return Array.from(new Set(lines)).slice(0, 6);
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

function renderOfficialSiteHtml(project: ProjectDetail) {
  const analysisBullets = extractBullets(latestStageContent(project, "ANALYSIS"), [
    "明确目标、范围、验收标准",
    "确定主路径与里程碑",
    "形成风险清单与边界约束"
  ]);
  const designBullets = extractBullets(latestStageContent(project, "DESIGN"), [
    "完成视觉方向与品牌语气定义",
    "完成关键页面版式与组件清单",
    "通过可访问性检查并完成设计审查"
  ]);
  const devBullets = extractBullets(latestStageContent(project, "DEV"), [
    "完成官网核心页面与 CTA 路径实现",
    "完成响应式布局与关键交互联动",
    "保留可扩展数据位与后续接入能力"
  ]);
  const acceptBullets = extractBullets(latestStageContent(project, "ACCEPT"), [
    "主流程可访问并可演示",
    "设计审查卡通过并进入验收",
    "实施结果可回填产品说明文档"
  ]);

  const teamLabels = project.team.map((role) => ROLE_LABELS[role] ?? role).slice(0, 8);
  const completedStages = project.stages.filter((stage) => stage.status === "completed").length;
  const stageCompletionPercent = project.stages.length > 0
    ? Math.round((completedStages / project.stages.length) * 100)
    : 0;
  const topSignals = Array.from(new Set([...analysisBullets, ...designBullets, ...devBullets])).slice(0, 6);
  const quickWins = acceptBullets.slice(0, 3);
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

  return `<!doctype html>
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
    <section class="hero">
      <article class="hero-main">
        <span class="badge">Official Demo · ${escapeHtml(project.id)}</span>
        <h1>AI 协作平台<br/>让需求到研发闭环可视化、可审计、可交付</h1>
        <p class="lead">
          当前官网产物由项目交付物自动生成，覆盖需求澄清、角色协作、实时监控、阶段审批与结果回填。
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
</html>`;
}

export async function generateOfficialSiteArtifact(project: ProjectDetail): Promise<OfficialSiteArtifact> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = findWorkspaceRoot(moduleDir);
  const fileName = `ai-collab-official-${project.id}.html`;
  const relativePath = path.join("generated", fileName);
  const html = renderOfficialSiteHtml(project);

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
    filePaths: targets
  };
}
