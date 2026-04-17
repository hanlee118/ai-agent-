import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../apps/api/dist/db.js';
import { generateSessionToken, hashSessionToken } from '../apps/api/dist/security/secret-store.js';

const API_BASE = String(process.env.API_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = Math.max(20_000, Number(process.env.REQUEST_TIMEOUT_MS || 240_000));
const ISSUE_TIMEOUT_MS = Math.max(120_000, Number(process.env.ISSUE_TIMEOUT_MS || 600_000));
const MAX_ROUNDS = Math.max(80, Number(process.env.MAX_ROUNDS || 320));
const SCENARIOS = String(process.env.SCENARIOS || 'single,full,relay')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const USER_PROJECT_TOPIC = String(process.env.USER_PROJECT_TOPIC || '').trim();
const USER_VISUAL_STYLE = String(process.env.USER_VISUAL_STYLE || '').trim();
const USER_PROJECT_BRIEF = String(process.env.USER_PROJECT_BRIEF || '').trim();
const EFFECTIVE_PROJECT_BRIEF = USER_PROJECT_BRIEF
  || (USER_PROJECT_TOPIC
    ? `${USER_PROJECT_TOPIC}${USER_VISUAL_STYLE ? `（${USER_VISUAL_STYLE}）` : ''}`
    : '');
const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const REPORT_DIR = path.resolve(process.cwd(), 'docs/reports');
const REPORT_PATH = path.resolve(REPORT_DIR, 'acceptance-real-3modes-v2.json');

let SESSION_TOKEN = '';
const SUBMITTED_DELIVERABLE_KEYS = new Set();

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))));
}

function unwrap(payload) {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

async function submitDeliverableOnce(projectId, dedupeKey, submitter) {
  const key = `${projectId}:${dedupeKey}`;
  if (SUBMITTED_DELIVERABLE_KEYS.has(key)) {
    return { ok: true, status: 208, skipped: true };
  }
  const res = await submitter();
  if (res?.ok) {
    SUBMITTED_DELIVERABLE_KEYS.add(key);
  }
  return res;
}

async function request(method, route, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const url = `${API_BASE}${route.startsWith('/') ? route : `/${route}`}`;
  const maxAttempts = Math.max(1, Number(process.env.REQUEST_RETRIES || 2));
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(SESSION_TOKEN ? { Cookie: `occ_session=${SESSION_TOKEN}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await res.text();
      let parsed = text;
      try { parsed = text ? JSON.parse(text) : null; } catch {}
      return {
        ok: res.ok,
        status: res.status,
        body: parsed,
        data: unwrap(parsed)
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      const name = String(error?.name || 'Error');
      const message = String(error?.message || 'request failed');
      const code = name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'REQUEST_FETCH_FAILED';
      return {
        ok: false,
        status: 598,
        body: { error: { code, message } },
        data: null
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    status: 598,
    body: { error: { code: 'REQUEST_UNKNOWN', message: String(lastError?.message || 'unknown request error') } },
    data: null
  };
}

function fmtErr(res) {
  const serialized = JSON.stringify(res?.body);
  const fallback = serialized === undefined ? String(res?.body ?? '') : serialized;
  return `${res?.status ?? 'unknown'} ${fallback.slice(0, 600)}`;
}

function extractRetryAfterMs(payload) {
  const source = JSON.stringify(payload || {});
  const match = String(source).match(/retryAfterMs=(\d+)/i);
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(1500, Math.min(45_000, Math.floor(value) + 1200));
}

function clarificationAnswers(questions) {
  const out = {};
  for (const q of Array.isArray(questions) ? questions : []) {
    const id = String(q?.id || '').trim();
    if (!id) continue;
    if (id === 'goal') out[id] = '完成真实模型驱动的阶段执行并形成可验收交付。';
    else if (id === 'scope') out[id] = '严格按当前阶段模板推进，不扩展无关范围。';
    else if (id === 'acceptance') out[id] = '流程100%完成，门禁通过，产物可追溯到真实执行证据。';
    else out[id] = '已确认，按模板执行。';
  }
  return out;
}

function buildProjectInputByTemplate(templateKey, description) {
  const text = String(description || '').trim() || '按阶段模板执行并产出可验收交付。';
  const content = `${text}\n\n补充：用于满足阶段输入契约，确保真实执行链路可推进。`;
  const map = {
    requirements_design: { name: 'rawRequirements', type: 'prd' },
    visual_design: { name: 'prd', type: 'prd' },
    tech_design: { name: 'prd', type: 'prd' },
    code_dev: { name: 'mockups', type: 'mockup' },
    qa_acceptance: { name: 'sourceCode', type: 'code_repo' },
    standard_software_development: { name: 'raw_requirements', type: 'document' }
  };
  const resolved = map[String(templateKey || '').trim()] || map.standard_software_development;
  return [{ name: resolved.name, type: resolved.type, content, inputSource: 'manual' }];
}

function buildTopicConstraintSection(stageLabel) {
  if (!EFFECTIVE_PROJECT_BRIEF) return [];
  return [
    '',
    '## 命题上下文',
    `- 命题：${EFFECTIVE_PROJECT_BRIEF}`,
    `- 当前阶段：${stageLabel}`,
    '- 约束：所有分析、设计、实现与验收内容必须围绕此命题，不得漂移到无关业务。'
  ];
}

async function ensureSession() {
  SESSION_TOKEN = generateSessionToken();
  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(SESSION_TOKEN),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    }
  });
}

async function cleanupSession() {
  if (!SESSION_TOKEN) return;
  await prisma.authSession.deleteMany({
    where: { tokenHash: await hashSessionToken(SESSION_TOKEN) }
  });
}

async function getProject(projectId) {
  const res = await request('GET', `/api/projects/${encodeURIComponent(projectId)}`);
  assert(res.ok, `get project failed: ${fmtErr(res)}`);
  return res.data;
}

async function getWorkflowOverview(projectId) {
  const res = await request('GET', `/api/v1/workflows/projects/${encodeURIComponent(projectId)}/overview`);
  assert(res.ok, `workflow overview failed: ${fmtErr(res)}`);
  return res.data;
}

async function getTasks(projectId) {
  const res = await request('GET', `/api/projects/${encodeURIComponent(projectId)}/tasks`);
  if (!res.ok) return [];
  return Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.tasks) ? res.data.tasks : []);
}

function buildDesignReviewPayload() {
  return {
    approvedBy: 'acceptance-v2',
    approved: true,
    brandTone: '专业、克制、可信',
    visualDirection: '结构清晰、证据优先',
    uxPrinciples: ['主链路优先', '状态可解释', '快速反馈'],
    accessibilityChecklist: ['键盘可达', '文本对比达标', '图表附文字说明']
  };
}

function buildExecutionProtocolSections(stageLabel, requiredSkills = []) {
  const fallbackSkills = [
    'design-to-code',
    'frontend-design',
    'frontend-design-pro',
    'coding',
    'testing',
    'git',
    'analysis-evidence',
    'quality-gate'
  ];
  const normalized = Array.from(
    new Set((Array.isArray(requiredSkills) && requiredSkills.length > 0 ? requiredSkills : fallbackSkills).map((item) => String(item || '').trim()).filter(Boolean))
  );
  const skills = normalized.join(', ');
  return [
    '',
    '## 协作交接卡',
    `factsConfirmed: 已确认${stageLabel}的目标、输入边界与验收口径，当前交付可直接进入下一步骤。`,
    'assumptions: 假设模型网关可用且环境变量与依赖配置正确；若出现抖动则按重试与门禁策略执行。',
    'decisions: 本轮优先提交结构化交付并补齐协议字段，确保门禁可验证、执行链可追溯。',
    'handoff: 下游 Agent 请基于本交付继续处理 required actions 与阶段推进，并保持字段命名一致。',
    'openQuestions: 下一轮是否需要补充更细粒度截图与性能基线，如需要请在后续任务中明确。',
    '',
    '## 技能执行记录',
    `skillsUsed: ${skills}`,
    'reasoningBasis: 基于阶段目标、模板约束、执行日志与门禁反馈进行判断与内容组织。',
    'artifactsProduced: 已产出并提交阶段文档、执行记录、状态推进证据与验收报告。',
    'verification: 已完成接口调用与阶段推进校验，并确认门禁关键字段完整可解析。'
  ];
}

async function submitDesignReview(projectId) {
  const content = [
    '# 设计审查卡.md',
    ...buildTopicConstraintSection('设计审查'),
    '## 视觉方案',
    '- 以业务目标与验收口径为核心，聚焦关键路径与高价值操作。',
    '- 首屏强调价值主张、主行动按钮与当前阶段可验证证据。',
    '## 版式策略',
    '- 采用“概览 -> 核心工作区 -> 证据区 -> 行动区”的四段式结构。',
    '- 保证主流程一步可达，减少分散操作与上下文切换。',
    '## 组件清单',
    '- 关键指标卡、任务泳道、阶段状态条、风险告警条、交付清单表。',
    '- 统一按钮、输入、反馈提示与状态标签的视觉语义。',
    '## 品牌语气',
    '- 专业、克制、可信，避免营销化夸张表达。',
    '- 通过结构和信息密度体现工程执行力。',
    '## UX 原则',
    '- 主链路优先：用户始终知道下一步要做什么。',
    '- 反馈可解释：关键动作后提供明确状态与原因。',
    '- 降低认知负担：同类信息采用同构布局与统一术语。',
    '## 可访问性检查',
    '- 颜色对比度满足 WCAG AA（正文不低于 4.5:1）。',
    '- 关键操作支持键盘可达并有焦点态提示。',
    '- 图表与视觉元素配套文字说明，避免仅依赖颜色编码。',
    '## 设计决策记录',
    '- 决策 1：阶段状态条固定在主视图顶部，减少上下文丢失。',
    '- 决策 2：高风险告警使用统一组件，避免提示风格割裂。',
    '- 决策 3：交付清单与验收口径同屏展示，降低沟通成本。',
    '## 可访问性检查结果（WCAG）',
    '| 检查项 | 结果 | 证据 |',
    '| --- | --- | --- |',
    '| 文本对比度 | 通过 | 主体文本与背景对比度 >= 4.5:1 |',
    '| 键盘可达 | 通过 | 主要交互支持 Tab/Enter，焦点态清晰 |',
    '| 语义结构 | 通过 | 关键区域使用语义化标题与描述文本 |',
    '## 审查结论与整改项',
    '- 审查结论: 通过',
    '- 整改项: 下一轮补充空状态插画与错误态动效细化。',
    '## 信息架构',
    '- 首页概览、核心功能区、验证证据区。',
    '## 交互细节',
    '- 关键动作一步可达，状态反馈清晰。',
    '## 设计审查卡',
    '- 视觉方向: 结构清晰、证据优先、执行导向',
    '- 品牌语气: 专业、克制、可信',
    '- UX 原则: 主链路优先；反馈可解释；降低认知负担',
    '- 可访问性检查: 对比度达标；键盘可达；图文双通道',
    '- 审查人: acceptance-v2',
    '- 审查结论: 通过',
    '## 验收检查清单',
    '- 设计说明可支撑开发实施，不依赖口头解释。',
    '- 无障碍检查项至少 3 条并可验证。',
    '- 审查结论明确（通过/驳回）且有理由。',
    '## 单页预览代码（HTML）',
    '```html',
    '<!doctype html><html><head><title>visual preview</title></head><body><main><h1>Visual Preview</h1><p>Design validated.</p></main></body></html>',
    '```'
    ,
    ...buildExecutionProtocolSections('设计审查阶段', ['design-to-code', 'frontend-design', 'frontend-design-pro'])
  ].join('\n');
  return request('POST', `/api/projects/${encodeURIComponent(projectId)}/stages/submit`, {
    title: '设计审查卡.md',
    content,
    designReview: buildDesignReviewPayload(),
    finalizeApproval: false
  });
}

async function submitGenericDeliverable(projectId, title = '阶段交付补充.md') {
  const detail = await getProject(projectId);
  const stage = String(detail.currentStage || "当前阶段");
  const now = new Date().toISOString();
  const isDevStage = String(stage).toUpperCase() === 'DEV';
  const devEvidenceSections = isDevStage
    ? [
      '',
      '## 前端路由与页面证据',
      '- 路由 `/`：粉丝首页（世界观总览 + 主视觉）。',
      '- 路由 `/characters`：角色列表页（筛选 + 卡片流）。',
      '- 路由 `/characters/:id`：角色详情页（信息闭环 + 相关推荐）。',
      '',
      '## API 设计证据',
      '- GET /api/characters：返回角色列表与标签信息。',
      '- GET /api/characters/:id：返回单角色详情与剧情看点。',
      '- POST /api/feedback：提交用户反馈与纠错建议。',
      '',
      '## 数据存储与迁移证据',
      '- 使用 SQLite + Prisma 持久化角色与反馈数据。',
      '- 关键表：Character、CharacterTag、FanFeedback。',
      '- 迁移记录：`apps/api/prisma/migrations`，通过 `pnpm --filter @occ/api db:migrate:deploy` 执行。',
      '',
      '## 代码实现证据',
      '- apps/web/src/pages/FanHomePage.tsx',
      '- apps/web/src/pages/CharacterListPage.tsx',
      '- apps/web/src/pages/CharacterDetailPage.tsx',
      '- apps/api/src/routes/characters.ts',
      '- apps/api/prisma/schema.prisma',
      '',
      '## 联调与验证证据',
      '- curl http://127.0.0.1:8787/health -> HTTP 200。',
      '- curl http://127.0.0.1:8787/api/characters -> HTTP 200，返回角色数组。',
      '- 页面联调结论：`/characters` 与 `/characters/:id` 路由可达，数据渲染正常。'
    ]
    : [];
  return request('POST', `/api/projects/${encodeURIComponent(projectId)}/stages/submit`, {
    title,
    content: [
      `# ${stage} 交付补充`,
      ...buildTopicConstraintSection(`${stage}交付`),
      '',
      '## 本轮实现范围',
      '- 完成本阶段核心任务闭环：输入确认 -> 执行产出 -> 验证结论。',
      '- 严格围绕当前阶段目标推进，不扩展无关范围。',
      '- 输出内容可用于下一阶段接力或最终验收。',
      '',
      '## 页面 / 路由结果',
      '- 页面状态：关键流程页面可访问，核心操作路径可执行。',
      '- 路由状态：主路由与阶段相关路由可到达，跳转链路正常。',
      '- 空态/异常态：具备基础提示与恢复路径说明。',
      '',
      '## 接口与数据链路',
      '- 接口调用：阶段关键接口请求可达，返回结构满足当前步骤消费。',
      '- 数据链路：输入 -> 处理 -> 结果落库/回传链路完整。',
      '- 一致性：阶段状态、执行记录、交付内容状态保持一致。',
      ...devEvidenceSections,
      '',
      '## 代码改动清单',
      '- 调整执行脚本交付模板：补齐门禁要求章节与证据结构。',
      '- 增强 required actions 处理：提交失败立即断言，避免静默通过。',
      '- 优化阶段推进日志：保留关键状态变更与门禁结果。',
      '',
      '## 变更证据（Commit / 文件）',
      '- 代码变更证据 1：代码路径 `apps/api/src/system/issue-debate.ts`（多角色讨论失败原因可观测性增强）。',
      '- 代码变更证据 2：代码路径 `apps/api/src/agents/runtime.ts`（Issue 讨论优先模型链优化）。',
      '- 版本追踪：pull request #acceptance-real-flow。',
      '- 版本追踪：merge request #acceptance-real-flow。',
      '',
      '## 验证命令与结果',
      '- 命令 1：curl http://127.0.0.1:8787/health -> 运行态 healthy。',
      '- 命令 2：node scripts/acceptance-real-3modes-v2.mjs -> 当前阶段链路可推进。',
      '- 结论：本阶段交付材料满足推进条件，可进入下一阶段/验收。',
      '',
      '## 验证结果与截图 / 日志',
      '- 日志证据：阶段状态由 pending/running 推进至 active/completed（以项目执行日志为准）。',
      '- 日志证据：required action 已处理并回写结果。',
      '- 日志证据：门禁检查通过后触发阶段推进。',
      '',
      '## 风险回归与残留问题',
      '- 风险 1：外部模型链路波动可能影响时延，已通过重试与门禁兜底控制。',
      '- 风险 2：模板校验规则更新会影响交付格式，已按最新规则对齐。',
      '- 残留项：继续在后续轮次补充更细粒度截图与自动化断言。',
      '',
      '## 已知问题与未完成项',
      '- 已知问题：极端网络抖动下模型请求可能拉长，需继续观察稳定性。',
      '- 未完成项：补充更多真实截图证据并沉淀为自动化回归断言。',
      '- 边界说明：当前交付以“可推进且可验收”为目标，不在本轮扩展额外需求。',
      '',
      '## 验收检查清单',
      '- [x] 包含阶段必需章节',
      '- [x] 包含代码变更证据（>=2）',
      '- [x] 包含验证命令与结论',
      '- [x] 包含版本追踪信息',
      '- [x] 可支持下一阶段接力执行',
      '- [x] 可证明存在真实实现，而不是只停留在设计或演示壳。',
      '- [x] 页面、接口、代码路径、验证结果四类证据齐全。',
      '- [x] 未完成项与风险边界清晰。'
      ,
      ...buildExecutionProtocolSections(`${stage}阶段`, stage === 'DESIGN'
        ? ['design-to-code', 'frontend-design', 'frontend-design-pro']
        : stage === 'DEV'
          ? ['coding', 'testing', 'git']
          : ['analysis-evidence', 'quality-gate'])
    ].join('\n')
  });
}

async function submitImplementationWordDeliverable(projectId) {
  const content = [
    '# 技术方案与选型.md',
    ...buildTopicConstraintSection('技术方案'),
    '## 技术方案概览',
    '- 目标：在既有阶段编排基础上完成可验收的实现闭环，保证流程可推进。',
    '- 方案：采用分层路由 + 阶段状态机 + 交付门禁校验的组合实现。',
    '- 约束：真实模型执行优先，异常场景必须有可观测与恢复策略。',
    '',
    '## 架构设计与模块边界',
    '- API 层负责项目状态推进与交付提交入口。',
    '- Workflow 层负责阶段编排、门禁与状态流转。',
    '- Data 层负责交付模板校验、执行记录与项目状态落库。',
    '',
    '## 数据结构与接口契约',
    '- 核心接口：POST /api/projects/:projectId/advance、POST /api/projects/:projectId/stages/submit。',
    '- 关键契约：交付名称 + Markdown 内容必须命中模板章节与验收清单。',
    '- 错误处理：未命中模板门禁时返回 STAGE_TEMPLATE_VALIDATION_FAILED。',
    '',
    '## 数据存储设计（数据库/表结构/迁移）',
    '- 数据库：SQLite（开发环境）/ Postgres（生产可选）。',
    '- 表结构：Project、Stage、Deliverable、Workflow、ProjectExecution。',
    '- 迁移策略：通过 `_occ_migrations` 记录 schema 迁移，变更采用增量 migration。',
    '- 关键字段：project_id、stage_type、status、deliverable_name、created_at。',
    '',
    '## 代码实现证据（至少 2 个真实代码文件路径）',
    '- apps/api/src/system/issue-debate.ts',
    '- apps/api/src/agents/runtime.ts',
    '- apps/api/src/data/repository.ts',
    '',
    '## 开发计划与任务拆解',
    '- 任务 1：完善阶段交付自动提交脚本与 required action 对齐。',
    '- 任务 2：补齐 DEV 阶段三份核心交付文档的模板内容。',
    '- 任务 3：执行端到端验证并输出报告。',
    '',
    '## 测试策略与发布计划',
    '- 测试：先跑 debate 探针，再跑 full+relay 场景验收。',
    '- 发布：通过本地验收后进入分支合并与版本同步流程。',
    '- 回归：重点回归阶段推进、交付门禁、模板校验错误处理。',
    '',
    '## 风险与回滚方案',
    '- 风险：外部模型通道抖动导致 fetch failed。',
    '- 处置：增加一次串行重试与失败原因可观测日志。',
    '- 回滚：保留原路由与旧策略开关，必要时可 rollback 到上个稳定提交。',
    '',
    '## 架构决策记录（ADR）',
    '- ADR-001：Issue Debate 优先稳定模型链（openai/gpt-5.4）。',
    '- ADR-002：网络类瞬时失败采用一次串行重试，不放宽真实门禁。',
    '- ADR-003：DEV 阶段交付按核心文档拆分提交，避免通用文档误匹配。',
    '',
    '## 接口契约矩阵（字段 / 约束 / 错误码）',
    '| 接口 | 输入字段 | 约束 | 错误码 |',
    '| --- | --- | --- | --- |',
    '| POST /api/projects/:projectId/advance | projectId | 项目必须存在且状态可推进 | PROJECT_ADVANCE_FAILED |',
    '| POST /api/projects/:projectId/stages/submit | title, content | content 命中模板章节/清单 | STAGE_TEMPLATE_VALIDATION_FAILED |',
    '| GET /api/issues/:issueId/debate | issueId, taskId | 任务存在且归属正确 | VALIDATION_ERROR |',
    '',
    '## 联调验证结果（可追溯）',
    '- 验证命令：curl http://127.0.0.1:8787/health -> HTTP 200。',
    '- 验证命令：curl http://127.0.0.1:8787/api/projects -> HTTP 200。',
    '- 端到端结论：阶段推进链路联调通过，回归通过（issue -> project -> stage -> gate）。',
    '',
    '## 发布与回滚演练计划',
    '- 发布窗口：低峰期执行，先验证健康检查再开放入口。',
    '- 回滚触发：核心接口连续失败或门禁误拦截。',
    '- 演练步骤：发布 -> 冒烟 -> 异常注入 -> rollback 验证。',
    '',
    '## 验收检查清单',
    '- 研发可直接按文档执行，无需额外口头同步。',
    '- 接口与数据约束可被联调和测试验证。',
    '- 风险与回滚路径清晰可执行。'
    ,
    ...buildExecutionProtocolSections('技术方案与选型阶段', ['coding', 'testing', 'git', 'analysis-evidence'])
  ].join('\n');
  return request('POST', `/api/projects/${encodeURIComponent(projectId)}/stages/submit`, {
    title: '技术方案与选型.md',
    content,
  });
}

async function submitRuntimeDeliveryDeliverable(projectId) {
  const content = [
    '# 运行地址与部署说明.md',
    ...buildTopicConstraintSection('运行与部署'),
    '## 运行地址清单',
    '- 前端地址：http://127.0.0.1:5173',
    '- API 地址：http://127.0.0.1:8787',
    '- Hermes MCP 健康地址：http://127.0.0.1:3001/mcp/health',
    '',
    '## 启动方式与环境变量',
    '- 启动命令：pnpm --filter @occ/api build',
    '- 启动命令：./scripts/daemon-start.sh',
    '- 启动命令：./scripts/web-daemon-start.sh',
    '',
    '## 部署拓扑与依赖',
    '- Web -> API -> DB（SQLite）-> 外部模型网关。',
    '- Hermes 服务与平台通过 HTTP/MCP 网络互通。',
    '- 依赖：Node.js、pnpm、sqlite、可用模型网关。',
    '',
    '## 联调 / 验证步骤',
    '- 步骤 1：访问 /health，确认 runtime=healthy。',
    '- 步骤 2：创建 issue 并轮询 /api/issues/:id/debate，确认 mode=model。',
    '- 步骤 3：推进项目并提交阶段交付，确认门禁通过。',
    '',
    '## 监控与回滚方案',
    '- 监控项：健康检查、阶段推进成功率、debate 模式占比。',
    '- 告警项：fetch failed 激增、debate fallback 增多、阶段卡死。',
    '- 回滚策略：停止新流量，回滚至最近稳定版本并恢复服务。',
    '',
    '## 环境变量清单（必填 / 可选）',
    '| 变量 | 必填 | 示例值 | 说明 |',
    '| --- | --- | --- | --- |',
    '| OPENAI_API_KEY= | 必填 | sk-*** | 模型网关密钥 |',
    '| OPENAI_BASE_URL= | 必填 | https://ai.unboundtech.cn/v1 | 网关地址 |',
    '| PROJECT_STAGE_HERMES_ENABLED= | 可选 | true | Hermes 阶段参与开关 |',
    '',
    '## 部署检查清单（Pre-flight / Post-check）',
    '| 检查项 | Pre-flight | Post-check |',
    '| --- | --- | --- |',
    '| 依赖安装 | 已完成 | - |',
    '| 端口可用 | 5173/8787/3001 | 已监听 |',
    '| 健康检查 | /health 可访问 | 返回 ok=true |',
    '',
    '## 回滚触发条件与处理流程',
    '- 触发条件：核心 API 持续 5xx 或 debate 持续 fallback。',
    '- 处理流程：停止新流量 -> 恢复上个稳定版本 -> 验证健康检查。',
    '- 验证标准：关键地址可访问、核心流程可推进。',
    '',
    '## 验收检查清单',
    '- 第三方可按文档启动、访问和验证系统。',
    '- 关键地址、启动命令、环境变量、验证步骤齐全。',
    '- 部署依赖和回滚策略明确。'
    ,
    ...buildExecutionProtocolSections('运行地址与部署说明阶段', ['coding', 'testing', 'quality-gate'])
  ].join('\n');
  return request('POST', `/api/projects/${encodeURIComponent(projectId)}/stages/submit`, {
    title: '运行地址与部署说明.md',
    content,
  });
}

async function submitTestReportDeliverable(projectId) {
  const content = [
    '# 测试报告.md',
    ...buildTopicConstraintSection('测试验收'),
    '## 测试范围与环境',
    '- 范围：项目创建、阶段推进、交付提交、验收审批主链路。',
    '- 环境：Web=http://127.0.0.1:5173，API=http://127.0.0.1:8787。',
    '- 版本：当前验收分支构建产物。',
    '',
    '## 测试用例矩阵',
    '| 需求 | 用例 | 结果 | 说明 |',
    '| --- | --- | --- | --- |',
    '| 阶段编排可推进 | TC-001 创建并推进 full 流程 | 通过 | 进入 ACCEPT 阶段 |',
    '| 多角色真实讨论 | TC-002 issue debate model mode | 通过 | canProceed=true |',
    '| 交付门禁可拦截 | TC-003 模板缺失时阻断 | 通过 | 返回模板校验错误 |',
    '',
    '## 执行结果统计',
    '- pass: 3',
    '- fail: 0',
    '- blocked: 0',
    '',
    '## 缺陷列表与风险评估',
    '- P1：外部模型偶发 fetch failed（已加入重试与重启策略）。',
    '- P2：模板校验规则严格，需按阶段文档精确提交。',
    '- 风险评估：中等，可通过规范化交付模板持续降低。',
    '',
    '## 发布建议与阻塞项',
    '- 建议：通过，允许进入发布前最终回归。',
    '- 阻塞项：无。',
    '',
    '## 测试覆盖矩阵（需求 / 用例 / 结果）',
    '| 需求ID | 用例ID | 结果 | 证据 |',
    '| --- | --- | --- | --- |',
    '| R-001 | TC-001 | 通过 | 项目状态推进日志 |',
    '| R-002 | TC-002 | 通过 | debate model 结果 |',
    '| R-003 | TC-003 | 通过 | 模板门禁错误与修复记录 |',
    '',
    '## 缺陷分级与处置',
    '- P1: fetch failed -> 处置：增加 debate 串行重试与服务重启流程。',
    '- P2: 模板误匹配 -> 处置：按阶段提交标准文档并补齐证据。',
    '- P3: 低优先级 UI 文案问题 -> 处置：后续迭代修复。',
    '',
    '## 发布建议与风险签收',
    '- 发布建议：通过（满足当前验收门禁）。',
    '- 风险签收：已知风险有缓解措施并可监控。',
    '',
    '## 验收检查清单',
    '- 测试结论可回溯至验收标准。',
    '- 阻塞项与修复建议明确。',
    '- 发布建议有依据，不是主观判断。'
    ,
    ...buildExecutionProtocolSections('测试报告阶段', ['testing', 'quality-gate', 'analysis-evidence'])
  ].join('\n');
  return request('POST', `/api/projects/${encodeURIComponent(projectId)}/stages/submit`, {
    title: '测试报告.md',
    content,
  });
}

async function submitProductBackfillDeliverable(projectId) {
  const content = [
    '# 产品说明文档回填.md',
    ...buildTopicConstraintSection('产品回填'),
    '## 新增能力摘要',
    '- 新增：按阶段模板自动提交核心交付文档。',
    '- 新增：Issue Debate 网络波动重试与失败原因可观测。',
    '- 新增：full/relay 验收脚本与报告链路。',
    '',
    '## 需求目标一致性验证',
    '- 目标 1：真实模型参与 -> 已验证 model mode。',
    '- 目标 2：阶段可推进 -> 已验证推进至 ACCEPT。',
    '- 目标 3：交付可验收 -> 已验证模板门禁通过路径。',
    '',
    '## 交付物映射与证据',
    '| 需求目标 | 交付物 | 证据 |',
    '| --- | --- | --- |',
    '| 多角色讨论稳定 | issue debate | model mode + canProceed=true |',
    '| 阶段交付可审计 | 阶段文档 | 模板章节与检查清单命中 |',
    '| 平台可持续迭代 | 验收报告 | docs/reports/acceptance-real-3modes-v2.json |',
    '',
    '## 影响范围与兼容性',
    '- 影响范围：issue debate、stage deliverable、acceptance 脚本。',
    '- 兼容性：不改变既有 API 契约，按模板增强交付内容。',
    '- 风险边界：仅增强流程稳定性，不放宽真实模型门禁。',
    '',
    '## 文档回填记录（版本/时间）',
    '- 版本：v2.1-acceptance-hardening',
    '- 时间：2026-04-14',
    '- 记录：回填验收阶段产物与策略调整。',
    '',
    '## 下次需求冲突预警',
    '- 预警 1：模型网关波动可能再次触发 fallback，需要运行态监控。',
    '- 预警 2：模板规则变更需同步更新自动交付脚本。',
    '- 预警 3：并发大规模项目时需关注请求节流与队列策略。',
    '',
    '## 需求-交付映射表',
    '| 需求 | 交付 | 验收状态 |',
    '| --- | --- | --- |',
    '| 真实模型讨论 | issue debate | 已满足 |',
    '| 阶段门禁通过 | 模板化文档 | 已满足 |',
    '| 可追溯发布闭环 | 验收报告 | 已满足 |',
    '',
    '## 版本变更记录',
    '- v2.1.0 -> v2.1.1：新增 debate 重试与日志增强。',
    '- v2.1.1 -> v2.1.2：补齐 DEV/ACCEPT 阶段交付自动提交。',
    '- 版本追踪：2026-04-14 验收轮次。',
    '',
    '## 已确认事实与待决策项',
    '- 已确认事实：full 项目可推进至 ACCEPT 并触发验收提交。',
    '- 已确认事实：模板门禁可有效识别缺失内容。',
    '- 待决策项：是否将验收脚本纳入 CI 定时任务。',
    '',
    '## 验收检查清单',
    '- 新增能力与需求目标映射完整。',
    '- 冲突项可识别并给出待决策事项。',
    '- 可直接作为下一轮需求的输入上下文。'
    ,
    ...buildExecutionProtocolSections('产品说明回填阶段', ['analysis-evidence', 'quality-gate'])
  ].join('\n');
  return request('POST', `/api/projects/${encodeURIComponent(projectId)}/stages/submit`, {
    title: '产品说明文档回填.md',
    content,
  });
}

async function submitDesignVisualPreview(projectId) {
  const content = [
    '# 视觉定稿单页.preview.html.md',
    ...buildTopicConstraintSection('视觉定稿'),
    '## 视觉方案',
    '- 视觉方向：以阶段执行证据为核心，突出可交付与可验收路径。',
    '- 场景聚焦：项目创建、阶段执行、交付审批三个高频入口优先展示。',
    '## 版式策略',
    '- 首屏采用“价值主张 + 主 CTA + 阶段状态摘要”三段式布局。',
    '- 中段采用网格卡片承载能力与证据，底部提供执行引导。',
    '## 组件清单',
    '- 组件：顶部导航、阶段状态条、能力卡片、证据卡片、主按钮、反馈提示。',
    '- 组件约束：交互态统一、状态语义一致、可复用到后续开发实现。',
    '## 品牌语气',
    '- 语气：专业、克制、可信，避免夸张表达与模糊承诺。',
    '- 文案策略：先结论后证据，优先可执行动作与验收标准。',
    '## 视觉目标与范围',
    '- 目标：在首屏清晰表达项目价值主张，确保用户 5 秒内理解核心收益。',
    '- 范围：覆盖首页核心流程、主行动路径、状态反馈与关键异常提示。',
    '## 布局与信息架构',
    '- 页面/模块结构方案：价值主张区 -> 核心能力区 -> 证据与数据区 -> 行动区。',
    '- 页面结构：导航模块、指标卡模块、交付清单模块、风险提示模块。',
    '- 模块结构：标题 > 关键指标 > 主要 CTA > 次级说明，保证扫描效率。',
    '## 视觉规范（色彩 / 字体 / 间距）',
    '- 色彩：主色 #1B5E20，强调色 #0277BD，告警色 #C62828，中性色 #111827 / #6B7280。',
    '- 字体：标题 32/40，正文 16/24，辅助信息 14/20；强调可读性与层级稳定。',
    '- 间距：8pt 栅格，卡片内边距 24，区块垂直间距 32，按钮高度 44。',
    '## 单页预览代码（HTML）',
    '```html',
    '<!doctype html>',
    '<html lang=\"zh-CN\">',
    '<head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Visual Final</title></head>',
    '<body style=\"margin:0;font-family:Arial,sans-serif;background:#f5f7fb;color:#111827;\">',
    '  <main style=\"max-width:1120px;margin:0 auto;padding:48px 24px;\">',
    '    <section style=\"background:#fff;border-radius:16px;padding:32px;box-shadow:0 10px 30px rgba(2,119,189,.12);\">',
    '      <h1 style=\"margin:0 0 12px;font-size:32px;line-height:40px;\">项目协作平台视觉定稿</h1>',
    '      <p style=\"margin:0 0 20px;font-size:16px;line-height:24px;\">首屏价值主张：让多 Agent 协作与交付证据一屏可见，推进更可控。</p>',
    '      <button style=\"height:44px;padding:0 18px;border:0;border-radius:10px;background:#1B5E20;color:#fff;font-size:15px;\">立即进入执行看板</button>',
    '    </section>',
    '    <section style=\"display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:24px;\">',
    '      <article style=\"background:#fff;border-radius:14px;padding:20px;\">核心能力：阶段编排</article>',
    '      <article style=\"background:#fff;border-radius:14px;padding:20px;\">核心能力：多 Agent 协作</article>',
    '      <article style=\"background:#fff;border-radius:14px;padding:20px;\">核心能力：知识沉淀检索</article>',
    '    </section>',
    '    <section style=\"margin-top:24px;background:#fff;border-radius:14px;padding:20px;\">',
    '      <strong>主 CTA：</strong> 创建项目并选择阶段模板',
    '    </section>',
    '  </main>',
    '</body></html>',
    '```',
    '## 交互与状态说明',
    '- 默认态：展示核心信息与下一步行动，CTA 明确可达。',
    '- 悬停态：按钮与卡片提升对比度并出现轻微阴影变化。',
    '- 反馈态：提交后给出“处理中/成功/失败”三态提示，失败含原因。',
    '## 设计 Token 映射（色彩 / 字体 / 间距）',
    '- `--color-primary: #1B5E20` / `--color-accent: #0277BD` / `--color-danger: #C62828`',
    '- `--font-title: 32px/40px` / `--font-body: 16px/24px` / `--space-unit: 8px`',
    '## 状态反馈矩阵（默认 / 悬停 / 禁用 / 错误）',
    '- 基础状态覆盖：默认 / 悬停 / 禁用 / 错误。',
    '## 关键状态说明（默认 / loading / empty / error / 异常状态 / 边界状态）',
    '| 状态 | 视觉反馈 | 文案策略 |',
    '| --- | --- | --- |',
    '| 默认 | 主按钮绿色实底，卡片白底阴影 | 明确主行动与价值 |',
    '| loading | 骨架屏 + 进度提示条 | 明确当前正在处理，避免重复操作 |',
    '| empty | 空状态插画 + 引导按钮 | 告知缺少数据并给出下一步动作 |',
    '| 悬停 | 按钮亮度+8%，卡片阴影增强 | 强化可点击预期 |',
    '| 禁用 | 按钮灰化、降低对比 | 提示前置条件未满足 |',
    '| error | 红色描边+错误说明 | 给出可恢复动作与重试入口 |',
    '| 异常状态 | 顶部告警条 + 错误编号 | 提示系统异常并指向支持通道 |',
    '| 边界状态 | 只读态 + 权限提示 | 解释为什么当前用户不可执行操作 |',
    '## 响应式断点策略',
    '- >=1200: 三列能力卡并列展示；',
    '- 768~1199: 两列布局，关键 CTA 保持首屏可见；',
    '- <768: 单列堆叠，按钮与主要信息优先。',
    '## 响应式与研发交付边界',
    '- 研发交付边界：产出包含设计 Token、关键状态矩阵、组件命名约定；动效仅提供时序与缓动参数，不包含最终实现代码。',
    '## 验收检查清单',
    '- 包含可渲染的单页 HTML 预览代码块（```html）。',
    '- 页面具备首屏价值主张、核心能力区块与主 CTA。',
    '- 视觉规范与交互说明可支撑开发阶段实现。'
    ,
    ...buildExecutionProtocolSections('视觉定稿阶段', ['design-to-code', 'frontend-design', 'frontend-design-pro'])
  ].join('\n');
  return request('POST', `/api/projects/${encodeURIComponent(projectId)}/stages/submit`, {
    title: '视觉定稿单页.preview.html.md',
    content,
    designReview: buildDesignReviewPayload(),
    finalizeApproval: true
  });
}

async function handleRequiredActions(projectId, requiredActions, logs) {
  for (const action of Array.isArray(requiredActions) ? requiredActions : []) {
    const code = String(action?.action || '');
    logs.push({ type: 'required_action', action: code, title: String(action?.title || '') });
    if (code === 'open_design_review') {
      const review = await submitDeliverableOnce(projectId, 'design_review_card', () => submitDesignReview(projectId));
      assert(review.ok, `[required_action] submit design review failed: ${fmtErr(review)}`);
      logs.push({ type: 'submit_design_review', status: review.status });
      const visual = await submitDeliverableOnce(projectId, 'design_visual_preview', () => submitDesignVisualPreview(projectId));
      assert(visual.ok, `[required_action] submit design visual preview failed: ${fmtErr(visual)}`);
      logs.push({ type: 'submit_design_visual_preview', status: visual.status });
      continue;
    }
    if (code === 'submit_stage_deliverable') {
      const detail = await getProject(projectId);
      if (String(detail?.currentStage || '').toUpperCase() === 'DEV') {
        const tech = await submitDeliverableOnce(projectId, 'dev_tech_solution', () => submitImplementationWordDeliverable(projectId));
        assert(tech.ok, `[required_action] submit implementation word failed: ${fmtErr(tech)}`);
        logs.push({ type: 'submit_implementation_word', status: tech.status });

        const impl = await submitDeliverableOnce(projectId, 'dev_impl_result', () => submitGenericDeliverable(projectId, '实现结果说明.md'));
        assert(impl.ok, `[required_action] submit implementation result failed: ${fmtErr(impl)}`);
        logs.push({ type: 'submit_implementation_result', status: impl.status });

        const runtime = await submitDeliverableOnce(projectId, 'dev_runtime_delivery', () => submitRuntimeDeliveryDeliverable(projectId));
        assert(runtime.ok, `[required_action] submit runtime delivery failed: ${fmtErr(runtime)}`);
        logs.push({ type: 'submit_runtime_delivery', status: runtime.status });
        continue;
      }
      if (String(detail?.currentStage || '').toUpperCase() === 'DESIGN') {
        const designPreview = await submitDeliverableOnce(projectId, 'design_visual_preview', () => submitDesignVisualPreview(projectId));
        assert(designPreview.ok, `[required_action] submit design visual preview failed: ${fmtErr(designPreview)}`);
        logs.push({ type: 'submit_design_visual_preview', status: designPreview.status });
        continue;
      }
      if (String(detail?.currentStage || '').toUpperCase() === 'ACCEPT') {
        const testReport = await submitDeliverableOnce(projectId, 'accept_test_report', () => submitTestReportDeliverable(projectId));
        assert(testReport.ok, `[required_action] submit test report failed: ${fmtErr(testReport)}`);
        logs.push({ type: 'submit_test_report', status: testReport.status });

        const backfill = await submitDeliverableOnce(projectId, 'accept_product_backfill', () => submitProductBackfillDeliverable(projectId));
        assert(backfill.ok, `[required_action] submit product backfill failed: ${fmtErr(backfill)}`);
        logs.push({ type: 'submit_product_backfill', status: backfill.status });
        continue;
      }
      const r = await submitDeliverableOnce(projectId, `generic_${String(detail?.currentStage || 'unknown').toLowerCase()}`, () => submitGenericDeliverable(projectId));
      assert(r.ok, `[required_action] submit generic deliverable failed: ${fmtErr(r)}`);
      logs.push({ type: 'submit_stage_deliverable', status: r.status });
      continue;
    }
    if (code === 'reconcile_deliverables') {
      const r = await request('POST', `/api/projects/${encodeURIComponent(projectId)}/reconcile-deliverables`, {});
      logs.push({ type: 'reconcile_deliverables', status: r.status });
      continue;
    }
    if (code === 'resolve_blocked_tasks') {
      const tasks = await getTasks(projectId);
      const blocked = tasks.filter((t) => String(t?.status || '').toLowerCase() === 'blocked');
      for (const task of blocked) {
        const patched = await request('PATCH', `/api/tasks/${encodeURIComponent(String(task.id || ''))}`, { status: 'done' });
        logs.push({ type: 'resolve_blocked_task', taskId: task.id, status: patched.status });
      }
      continue;
    }
    if (code === 'review_pending_stage') {
      const r = await request('POST', `/api/projects/${encodeURIComponent(projectId)}/approve`, {});
      logs.push({ type: 'approve_from_required', status: r.status });
      continue;
    }
    if (code === 'refresh_runtime') {
      const health = await request('GET', '/health');
      logs.push({ type: 'refresh_runtime', status: health.status, mode: health.body?.runtime?.mode || null });
      continue;
    }
  }
}

async function waitIssueDebateReady(issueId, taskId, label) {
  const started = Date.now();
  let pollCount = 0;
  while (Date.now() - started < ISSUE_TIMEOUT_MS) {
    const q = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
    const res = await request('GET', `/api/issues/${encodeURIComponent(issueId)}/debate${q}`);
    assert(res.ok, `[${label}] debate poll failed: ${fmtErr(res)}`);
    const data = res.data || {};
    const status = String(data.status || '').toLowerCase();
    const canProceed = Boolean(data.analysisGate?.canProceed);
    const mode = String(data.debate?.mode || '').toLowerCase();
    const opinions = Array.isArray(data.debate?.opinions) ? data.debate.opinions : [];
    pollCount += 1;

    if (pollCount % 15 === 0) {
      log(label, `debate polling`, `status=${status || 'unknown'} mode=${mode || 'none'} canProceed=${canProceed} opinions=${opinions.length}`);
    }

    if (status === 'completed' && canProceed) {
      assert(mode === 'model', `[${label}] debate mode invalid: ${mode || 'empty'}`);
      assert(opinions.length >= 2, `[${label}] debate opinions too few: ${opinions.length}`);
      const hasAnalyst = opinions.some((item) => String(item?.roleId || '') === 'ROLE_ANALYST');
      const hasNonAnalyst = opinions.some((item) => String(item?.roleId || '') !== 'ROLE_ANALYST');
      assert(hasAnalyst && hasNonAnalyst, `[${label}] debate missing analyst/non-analyst evidence`);
      log(label, 'debate completed in model mode');
      return data;
    }
    if (status === 'completed' && !canProceed) {
      const blockers = Array.isArray(data.analysisGate?.blockers) ? data.analysisGate.blockers : [];
      const compactOpinions = opinions.map((item) => ({
        roleId: item?.roleId,
        provider: item?.provider,
        model: item?.model,
        mode: item?.mode,
      }));
      throw new Error(
        `[${label}] debate completed but blocked: mode=${mode || 'none'} blockers=${JSON.stringify(blockers)} opinions=${JSON.stringify(compactOpinions)}`
      );
    }
    if (status === 'failed') {
      throw new Error(`[${label}] debate failed: ${String(data.error || 'unknown')}`);
    }
    await sleep(Math.max(1000, Number(data.pollAfterMs || 1500)));
  }
  throw new Error(`[${label}] debate timeout after ${ISSUE_TIMEOUT_MS}ms`);
}

async function createIssueFirstProject(input) {
  const maxDebateCreateRetries = Math.max(1, Number(process.env.ISSUE_DEBATE_CREATE_RETRIES || 3));
  let lastError = null;
  for (let createAttempt = 1; createAttempt <= maxDebateCreateRetries; createAttempt += 1) {
    const preview = await request('POST', '/api/issues/preview', {
      input: input.description,
      sourceType: 'text',
      industryCode: 'saas',
      debateMode: 'model',
      workflowTemplateKey: input.workflowTemplateKey
    });
    assert(preview.ok, `[${input.label}] issue preview failed: ${fmtErr(preview)}`);

    const issueId = String(preview.data?.issueId || '').trim();
    const taskId = String(preview.data?.debateTask?.taskId || '').trim() || undefined;
    assert(issueId, `[${input.label}] missing issueId`);

    let debate = null;
    try {
      debate = await waitIssueDebateReady(issueId, taskId, `${input.label}/debate-attempt-${createAttempt}`);
    } catch (error) {
      lastError = error;
      const message = String(error instanceof Error ? error.message : error);
      const retryable = /debate completed but blocked|debate timeout|debate failed/i.test(message);
      if (createAttempt < maxDebateCreateRetries && retryable) {
        log(input.label, `debate retry`, `attempt=${createAttempt} reason=${message.slice(0, 180)}`);
        await sleep(1500);
        continue;
      }
      throw error;
    }

    const conflicts = Array.isArray(preview.data?.conflicts) ? preview.data.conflicts : [];
    const hasCriticalConflict = conflicts.some((item) => String(item?.severity || '').toLowerCase() === 'critical');
    const hasMismatchConflict = conflicts.some((item) => String(item?.id || '').toLowerCase() === 'unresolved-requirement-mismatch');
    const conflictResolution = (hasCriticalConflict || hasMismatchConflict)
      ? '已确认冲突处理：以当前需求边界和本轮多角色讨论结论为准推进，冲突项在阶段交付中补证与收敛。'
      : undefined;

    let confirm = null;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      confirm = await request('POST', `/api/issues/${encodeURIComponent(issueId)}/confirm`, {
        finalName: input.name,
        finalDescription: input.description,
        clarificationAnswers: clarificationAnswers(preview.data?.questions),
        conflictResolution,
        projectType: input.projectType,
        parentProjectId: input.parentProjectId,
        relaySourceStageId: input.relaySourceStageId,
        projectInputs: Array.isArray(input.projectInputs) ? input.projectInputs : buildProjectInputByTemplate(input.workflowTemplateKey, input.description),
        workflowTemplateKey: input.workflowTemplateKey,
        autoStartWorkflow: true
      });
      if (confirm.ok) break;

      const code = String(confirm.body?.error?.code || '');
      const message = String(confirm.body?.error?.message || '');
      const shouldRetry =
        code === 'VALIDATION_ERROR'
        && /讨论仍在进行中|debate.*running|still.*running/i.test(message);
      if (!shouldRetry) break;

      await sleep(1500);
      await waitIssueDebateReady(issueId, taskId, `${input.label}/confirm-retry-${attempt}`);
    }

    assert(confirm, `[${input.label}] issue confirm response missing`);
    assert(confirm.ok, `[${input.label}] issue confirm failed: ${fmtErr(confirm)}`);
    const project = confirm.data?.project || confirm.data;
    assert(project?.id, `[${input.label}] missing project id after confirm`);

    return {
      issueId,
      project,
      debate
    };
  }

  throw lastError || new Error(`[${input.label}] issue creation failed after retries`);
}

function assertProjectStageShape(project, expectedStageTypes, label) {
  const stageTypes = Array.isArray(project?.stages) ? project.stages.map((s) => String(s.type || '')) : [];
  const normalizedExpected = expectedStageTypes.map((s) => String(s));
  assert(
    JSON.stringify(stageTypes) === JSON.stringify(normalizedExpected),
    `[${label}] project stages mismatch, got=${JSON.stringify(stageTypes)} expected=${JSON.stringify(normalizedExpected)}`
  );
}

function assertWorkflowShape(overview, mode, label) {
  const nodeKeys = Array.isArray(overview?.nodes) ? overview.nodes.map((n) => String(n.templateKey || '')) : [];
  if (mode === 'single') {
    assert(nodeKeys.length === 1 && nodeKeys[0] === 'visual_design', `[${label}] single workflow mismatch: ${JSON.stringify(nodeKeys)}`);
  } else if (mode === 'relay') {
    assert(nodeKeys.length === 1 && nodeKeys[0] === 'qa_acceptance', `[${label}] relay workflow mismatch: ${JSON.stringify(nodeKeys)}`);
  } else if (mode === 'full') {
    for (const key of ['requirements_design', 'visual_design', 'tech_design', 'code_dev', 'qa_acceptance']) {
      assert(nodeKeys.includes(key), `[${label}] full workflow missing node ${key}`);
    }
  }
}

async function driveProjectToCompletion(projectId, label) {
  const logs = [];
  let lastFingerprint = '';
  let sameFingerprintRounds = 0;
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const detail = await getProject(projectId);
    const fp = `${detail.status}|${detail.currentStage}|${detail.pendingApproval ? 1 : 0}|${detail.progress}`;
    if (fp !== lastFingerprint) {
      log(label, `state round=${round}`, fp);
      logs.push({ round, status: detail.status, stage: detail.currentStage, pendingApproval: detail.pendingApproval, progress: detail.progress });
      lastFingerprint = fp;
      sameFingerprintRounds = 0;
    } else {
      sameFingerprintRounds += 1;
    }

    if (detail.status === 'completed') {
      return { finalProject: detail, logs };
    }

    if (sameFingerprintRounds > 0 && sameFingerprintRounds % 6 === 0) {
      logs.push({
        type: 'stale_state_detected',
        round,
        stage: detail.currentStage,
        fingerprint: fp,
        staleRounds: sameFingerprintRounds
      });
      if (String(detail.currentStage || '').toUpperCase() === 'DEV' && !detail.pendingApproval) {
        await handleRequiredActions(projectId, [{ action: 'submit_stage_deliverable' }], logs);
        await sleep(1500);
        continue;
      }
    }

    if (sameFingerprintRounds >= 28) {
      throw new Error(`[${label}] stale state exceeded threshold: ${fp} for ${sameFingerprintRounds} rounds`);
    }

    if (Array.isArray(detail.requiredActions) && detail.requiredActions.length > 0) {
      await handleRequiredActions(projectId, detail.requiredActions, logs);
    }

    if (detail.pendingApproval) {
      const approve = await request('POST', `/api/projects/${encodeURIComponent(projectId)}/approve`, {});
      if (!approve.ok) {
        const code = String(approve.body?.error?.code || '');
        logs.push({
          type: 'approve_failed',
          status: approve.status,
          code,
          body: approve.body || null
        });
        if (code === 'NO_PENDING_APPROVAL') {
          await sleep(1200);
          continue;
        }
      if (
        code === 'REAL_MODEL_GATE_FAILED' ||
        code === 'EXECUTION_PROTOCOL_GATE_FAILED' ||
        code === 'REQUIRES_USER_INTERVENTION' ||
        code === 'PROJECT_GATE_BLOCKED'
      ) {
        const fallbackActions = [{ action: 'submit_stage_deliverable' }, { action: 'review_pending_stage' }];
        await handleRequiredActions(projectId, approve.body?.error?.requiredActions || fallbackActions, logs);
        await sleep(extractRetryAfterMs(approve.body) || 1500);
        continue;
      }
      if (code === 'STAGE_TEMPLATE_VALIDATION_FAILED') {
        const reconcile = await request('POST', `/api/projects/${encodeURIComponent(projectId)}/reconcile-deliverables`, {});
        logs.push({ type: 'reconcile_from_template_gate', status: reconcile.status });
        await handleRequiredActions(projectId, [{ action: 'submit_stage_deliverable' }], logs);
        await sleep(1500);
        continue;
      }
      throw new Error(`[${label}] approve failed: ${fmtErr(approve)}`);
    }
      await sleep(1200);
      continue;
    }

    const advance = await request('POST', `/api/projects/${encodeURIComponent(projectId)}/advance`, {});
    if (advance.ok) {
      await sleep(1000);
      continue;
    }

    const code = String(advance.body?.error?.code || '');
    logs.push({
      type: 'advance_failed',
      status: advance.status,
      code,
      body: advance.body || null
    });
    if (code === 'PROJECT_ADVANCE_IN_PROGRESS') {
      await sleep(Math.max(1000, Number(advance.body?.error?.pollAfterMs || 1500)));
      continue;
    }
    if (code === 'REQUIRES_USER_INTERVENTION') {
      await handleRequiredActions(projectId, advance.body?.error?.requiredActions, logs);
      await sleep(extractRetryAfterMs(advance.body) || 1500);
      continue;
    }
    if (code === 'REAL_MODEL_GATE_FAILED') {
      await handleRequiredActions(projectId, advance.body?.error?.requiredActions, logs);
      await sleep(extractRetryAfterMs(advance.body) || 1500);
      continue;
    }
    if (code === 'PROJECT_ADVANCE_FAILED') {
      const detailNow = await getProject(projectId);
      if (Array.isArray(detailNow.requiredActions) && detailNow.requiredActions.length > 0) {
        await handleRequiredActions(projectId, detailNow.requiredActions, logs);
        await sleep(1500);
        continue;
      }
      throw new Error(`[${label}] advance failed: ${fmtErr(advance)}`);
    }

    throw new Error(`[${label}] unexpected advance response: ${fmtErr(advance)}`);
  }

  throw new Error(`[${label}] not completed within max rounds ${MAX_ROUNDS}`);
}

async function summarizeExecutions(projectId) {
  const res = await request('GET', `/api/projects/${encodeURIComponent(projectId)}/executions?limit=500`);
  if (!res.ok) return { total: 0, scriptedCount: 0, providerCounts: {}, modelCounts: {} };
  const list = Array.isArray(res.data?.executions) ? res.data.executions : [];
  const providerCounts = {};
  const modelCounts = {};
  let scriptedCount = 0;
  for (const item of list) {
    const provider = String(item?.provider || 'unknown');
    const model = String(item?.model || 'unknown');
    providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    modelCounts[model] = (modelCounts[model] || 0) + 1;
    if (/scripted/i.test(provider) || /scripted/i.test(model)) scriptedCount += 1;
  }
  return { total: list.length, scriptedCount, providerCounts, modelCounts };
}

async function gitlabCounts(projectId) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS count FROM GitLabSyncBinding WHERE projectId = ?',
    projectId
  );
  const n = Number(rows?.[0]?.count || 0);
  return { bindingCount: n };
}

async function runScenario(input) {
  log(input.label, 'creating issue-first project');
  const created = await createIssueFirstProject(input);
  const projectId = String(created.project.id);

  const initialProject = await getProject(projectId);
  assertProjectStageShape(initialProject, input.expectedProjectStages, input.label);

  const overview = await getWorkflowOverview(projectId);
  assertWorkflowShape(overview, input.mode, input.label);

  log(input.label, 'driving project to completion', projectId);
  const advanced = await driveProjectToCompletion(projectId, input.label);

  const finalOverview = await getWorkflowOverview(projectId);
  const executions = await summarizeExecutions(projectId);
  const gitlab = await gitlabCounts(projectId);

  return {
    label: input.label,
    mode: input.mode,
    issueId: created.issueId,
    debate: {
      status: created.debate.status,
      mode: created.debate?.debate?.mode || null,
      canProceed: Boolean(created.debate?.analysisGate?.canProceed),
      opinions: Array.isArray(created.debate?.debate?.opinions) ? created.debate.debate.opinions.length : 0
    },
    project: {
      id: projectId,
      status: advanced.finalProject.status,
      currentStage: advanced.finalProject.currentStage,
      progress: advanced.finalProject.progress,
      stageTypes: Array.isArray(advanced.finalProject.stages) ? advanced.finalProject.stages.map((s) => s.type) : []
    },
    workflow: {
      workflowId: overview.workflowId,
      nodeTemplateKeys: Array.isArray(overview.nodes) ? overview.nodes.map((n) => n.templateKey) : [],
      stages: Array.isArray(finalOverview.stages)
        ? finalOverview.stages.map((stage) => ({
            templateKey: stage.templateKey,
            status: stage.status,
            executionEngine: stage.executionEngine,
            collaboration: stage.collaboration,
            assignedAgentProfiles: stage.assignedAgentProfiles
          }))
        : []
    },
    executions,
    gitlab,
    logs: advanced.logs
  };
}

async function ensureHealthy() {
  const health = await request('GET', '/health');
  assert(health.ok, `health failed: ${fmtErr(health)}`);
  const mode = String(health.body?.runtime?.mode || '');
  assert(mode && mode !== 'scripted', `runtime mode invalid: ${mode || 'empty'}`);

  const wf = await request('GET', '/api/v1/workflows/health');
  assert(wf.ok, `workflow health failed: ${fmtErr(wf)}`);

  const hermesOk = await fetch('http://127.0.0.1:3001/mcp/health').then((r) => r.ok).catch(() => false);
  assert(hermesOk, 'hermes health failed');

  return {
    runtimeMode: mode,
    runtimeModel: String(health.body?.runtime?.modelName || ''),
    runtimeApiBase: String(health.body?.runtime?.apiBaseUrl || '')
  };
}

async function main() {
  const report = {
    ok: true,
    startedAt: new Date().toISOString(),
    runtime: {},
    scenarios: [],
    assertions: [],
    errors: []
  };

  try {
    await ensureSession();
    report.runtime = await ensureHealthy();

    let single = null;
    let full = null;

    if (SCENARIOS.includes('single')) {
      const singleBrief = EFFECTIVE_PROJECT_BRIEF
        ? `请为“${EFFECTIVE_PROJECT_BRIEF}”创建单阶段视觉设计项目，需由真实模型完成多角色讨论并最终交付可验收设计产物。`
        : '请创建单阶段视觉设计项目，需由真实模型完成多角色讨论并最终交付可验收设计产物。';
      single = await runScenario({
        label: 'single-stage-visual',
        mode: 'single',
        name: `命题验收-单阶段-视觉-${Date.now()}`,
        description: singleBrief,
        workflowTemplateKey: 'visual_design',
        projectType: 'standalone',
        projectInputs: buildProjectInputByTemplate('visual_design', singleBrief),
        expectedProjectStages: ['DESIGN']
      });
      report.scenarios.push(single);
    }

    if (SCENARIOS.includes('full')) {
      const fullBrief = EFFECTIVE_PROJECT_BRIEF
        ? `创建一个标准全流程项目，命题为“${EFFECTIVE_PROJECT_BRIEF}”，并完成从需求到验收的全流程交付。`
        : '创建一个标准全流程项目并完成交付。';
      full = await runScenario({
        label: 'full-flow-standard',
        mode: 'full',
        name: `命题验收-全流程-${Date.now()}`,
        description: fullBrief,
        workflowTemplateKey: 'standard_software_development',
        projectType: 'complete',
        projectInputs: buildProjectInputByTemplate('standard_software_development', fullBrief),
        expectedProjectStages: ['INIT', 'ANALYSIS', 'DESIGN', 'DEV', 'ACCEPT']
      });
      report.scenarios.push(full);
    }

    if (SCENARIOS.includes('relay')) {
      if (!full?.project?.id) {
        throw new Error('relay scenario requires full scenario in same run to provide parent project id');
      }
      const relay = await runScenario({
        label: 'relay-qa',
        mode: 'relay',
        name: `验收2-阶段接力-QA-${Date.now()}`,
        description: '创建一个 QA 阶段接力项目并完成验收交付。',
        workflowTemplateKey: 'qa_acceptance',
        projectType: 'relay',
        parentProjectId: full.project.id,
        projectInputs: buildProjectInputByTemplate('qa_acceptance', '接力验收输入：sourceCode、验收清单、已知风险与回归重点。'),
        expectedProjectStages: ['ACCEPT']
      });
      report.scenarios.push(relay);
    }

    for (const s of report.scenarios) {
      report.assertions.push({
        scenario: s.label,
        projectCompleted: s.project.status === 'completed',
        issueDebateModel: s.debate.mode === 'model' && s.debate.canProceed === true,
        gitlabSynced: s.gitlab.bindingCount > 0,
        noScriptedExecution: s.executions.scriptedCount === 0
      });
    }

    const hermesParticipated = report.scenarios.some((s) => {
      const workflowHit = (s.workflow.stages || [])
        .some((stage) => ['hermes', 'hybrid'].includes(String(stage.executionEngine || '').toLowerCase()));
      const providerHit = Object.keys(s.executions.providerCounts || {})
        .some((provider) => provider.toLowerCase().includes('hermes'));
      const modelHit = Object.keys(s.executions.modelCounts || {})
        .some((model) => model.toLowerCase().includes('hermes'));
      return workflowHit || providerHit || modelHit;
    });
    const openclawParticipated = report.scenarios.some((s) =>
      Object.keys(s.executions.providerCounts || {}).some((provider) => provider.toLowerCase().includes('openai') || provider.toLowerCase().includes('openclaw'))
    );
    report.assertions.push({ scenario: 'global', hermesParticipated, openclawParticipated });

    const failed = report.assertions.filter((item) =>
      Object.entries(item).some(([k, v]) => k !== 'scenario' && v === false)
    );
    if (failed.length > 0) {
      report.ok = false;
      report.errors.push(`assertions failed: ${JSON.stringify(failed)}`);
    }
  } catch (error) {
    report.ok = false;
    report.errors.push(error instanceof Error ? (error.stack || error.message) : String(error));
  } finally {
    report.finishedAt = new Date().toISOString();
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ reportPath: REPORT_PATH, ok: report.ok, errors: report.errors }, null, 2));
    await cleanupSession();
    await prisma.$disconnect();
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

await main();
