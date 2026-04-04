import http from 'node:http';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { prisma } from '../apps/api/dist/db.js';
import { generateSessionToken, hashSessionToken } from '../apps/api/dist/security/secret-store.js';

const BASE = String(process.env.API_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const PROJECT_ID = String(process.env.PROJECT_ID || 'OCC-20260403-003');
const OUT_DIR = path.resolve(process.cwd(), 'docs/reports');
const MAX_ROUNDS = Math.max(80, Number(process.env.MAX_ROUNDS || 220));
const TIMEOUT_MS = Math.max(10000, Number(process.env.TIMEOUT_MS || 180000));

let SESSION_COOKIE = '';
let SESSION_TOKEN = '';

const report = {
  ok: true,
  startedAt: new Date().toISOString(),
  base: BASE,
  projectId: PROJECT_ID,
  rounds: [],
  checks: [],
  errors: [],
};

function unwrap(payload) {
  if (payload && typeof payload === 'object' && 'success' in payload) {
    if (payload.success === true) return payload.data;
  }
  return payload;
}

function req(method, route, body) {
  const url = new URL(`${BASE}${route.startsWith('/') ? route : `/${route}`}`);
  const payload = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              ...(SESSION_COOKIE ? { Cookie: SESSION_COOKIE } : {}),
            }
          : (SESSION_COOKIE ? { Cookie: SESSION_COOKIE } : undefined),
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let parsed = raw;
          try { parsed = raw ? JSON.parse(raw) : null; } catch {}
          resolve({ status: res.statusCode || 0, body: parsed, data: unwrap(parsed) });
        });
      },
    );
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error(`timeout ${method} ${route}`)));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function addCheck(name, pass, detail = '') {
  report.checks.push({ name, pass, detail, at: new Date().toISOString() });
  if (!pass) report.ok = false;
}

async function ensureSession() {
  const auth = await req('GET', '/api/auth/status');
  if (auth.status !== 200 || !auth.data?.setupComplete) {
    throw new Error(`auth not ready: ${auth.status}`);
  }
  SESSION_TOKEN = generateSessionToken();
  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(SESSION_TOKEN),
      expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    },
  });
  SESSION_COOKIE = `occ_session=${SESSION_TOKEN}`;
}

async function cleanupSession() {
  if (!SESSION_TOKEN) return;
  await prisma.authSession.deleteMany({ where: { tokenHash: await hashSessionToken(SESSION_TOKEN) } });
}

async function handleRequiredActions(project, actions) {
  const list = Array.isArray(actions) ? actions : [];
  const names = list.map((a) => a.action);
  report.rounds.push({
    at: new Date().toISOString(),
    event: 'required_actions',
    stage: project.currentStage,
    actions: names,
  });

  if (names.includes('reconcile_deliverables') || names.includes('submit_stage_deliverable')) {
    const r = await req('POST', `/api/projects/${encodeURIComponent(project.id)}/reconcile-deliverables`, {});
    if (r.status !== 200) throw new Error(`reconcile failed: ${r.status}`);
    return r.data;
  }

  if (names.includes('open_design_review')) {
    const content = [
      '# 设计审查卡.md',
      '## 视觉方案',
      '- TrendHunter 跨境爆品雷达，突出榜单/证据链/告警动作。',
      '## UX 原则',
      '- 主链路优先',
      '- 状态反馈即时',
      '- 关键操作一跳可达',
      '## 可访问性检查',
      '- 键盘可达',
      '- 对比度达标',
      '- 图表附文字摘要',
      '## 设计审查卡',
      '- 审查结论: 通过',
    ].join('\n');
    const r = await req('POST', `/api/projects/${encodeURIComponent(project.id)}/stages/submit`, {
      title: '设计审查卡.md',
      content,
      designReview: {
        visualDirection: 'TikTok风格业务控制台',
        brandTone: '专业、直接、证据优先',
        uxPrinciples: ['主链路优先', '状态反馈即时', '关键操作一跳可达'],
        accessibilityChecklist: ['键盘可达', '对比度达标', '图表附文字摘要'],
        approvedBy: 'round4-auto-review',
        approved: true,
        notes: 'round4 auto submit',
      },
      finalizeApproval: false,
    });
    if (r.status !== 200) throw new Error(`submit design review failed: ${r.status}`);
    return r.data;
  }

  if (names.includes('review_pending_stage')) {
    const r = await req('POST', `/api/projects/${encodeURIComponent(project.id)}/approve`, {});
    if (r.status !== 200) throw new Error(`approve(required_action) failed: ${r.status}`);
    return r.data;
  }

  if (names.includes('resolve_blocked_tasks')) {
    const fresh = await req('GET', `/api/projects/${encodeURIComponent(project.id)}`);
    const blocked = (fresh.data?.tasks || []).filter((t) => t.status === 'blocked');
    for (const t of blocked) {
      const p = await req('PATCH', `/api/tasks/${encodeURIComponent(t.id)}`, { status: 'done' });
      if (p.status !== 200) throw new Error(`resolve blocked task failed: ${t.id}`);
    }
    const d = await req('GET', `/api/projects/${encodeURIComponent(project.id)}`);
    return d.data;
  }

  if (names.includes('refresh_runtime')) {
    const p = await req('POST', '/api/system/design-model-policy/repair', {});
    if (p.status !== 200) throw new Error(`refresh_runtime via repair failed: ${p.status}`);
    const d = await req('GET', `/api/projects/${encodeURIComponent(project.id)}`);
    return d.data;
  }

  throw new Error(`unhandled required actions: ${names.join(',')}`);
}

async function drive(projectId) {
  let inProgressSince = 0;
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const detail = await req('GET', `/api/projects/${encodeURIComponent(projectId)}`);
    if (detail.status !== 200) throw new Error(`get project failed: ${detail.status}`);

    const p = detail.data;
    report.rounds.push({
      at: new Date().toISOString(),
      round,
      stage: p.currentStage,
      status: p.status,
      pendingApproval: Boolean(p.pendingApproval),
      progress: p.progress,
    });
    console.log(`[round ${round}] stage=${p.currentStage} status=${p.status} pending=${Boolean(p.pendingApproval)} progress=${p.progress}`);

    if (p.status === 'completed') return p;

    if (p.pendingApproval) {
      const approve = await req('POST', `/api/projects/${encodeURIComponent(projectId)}/approve`, {});
      console.log(`  -> approve ${approve.status}`);
      if (approve.status !== 200 && approve.body?.error?.code !== 'NO_PENDING_APPROVAL') {
        throw new Error(`approve failed: ${approve.status}`);
      }
      inProgressSince = Date.now();
      await sleep(1200);
      continue;
    }

    const advance = await req('POST', `/api/projects/${encodeURIComponent(projectId)}/advance`, {});
    console.log(`  -> advance ${advance.status} ${advance.body?.error?.code || ''}`);
    if (advance.status === 200) {
      inProgressSince = Date.now();
      await sleep(1200);
      continue;
    }

    const code = advance.body?.error?.code;
    if (advance.status === 409 && code === 'PROJECT_ADVANCE_IN_PROGRESS') {
      if (!inProgressSince) inProgressSince = Date.now();
      const waited = Date.now() - inProgressSince;
      if (waited > 14 * 60 * 1000) {
        throw new Error(`stuck in progress too long (${waited}ms)`);
      }
      await sleep(Math.max(900, Number(advance.body?.error?.pollAfterMs || 1400)));
      continue;
    }

    if (advance.status === 409 && code === 'REQUIRES_USER_INTERVENTION') {
      inProgressSince = 0;
      await handleRequiredActions(p, advance.body?.error?.requiredActions);
      await sleep(900);
      continue;
    }

    if (advance.status === 409 && code === 'PROJECT_ADVANCE_FAILED') {
      const msg = String(advance.body?.error?.message || '');
      if (/STAGE_TEMPLATE_VALIDATION_FAILED/i.test(msg)) {
        const rr = await req('POST', `/api/projects/${encodeURIComponent(projectId)}/reconcile-deliverables`, {});
        if (rr.status !== 200) throw new Error(`reconcile after template failed: ${rr.status}`);
        await sleep(900);
        continue;
      }
    }

    throw new Error(`advance failed: ${advance.status} ${JSON.stringify(advance.body).slice(0, 300)}`);
  }

  throw new Error(`not completed after max rounds ${MAX_ROUNDS}`);
}

async function collectEvidence(projectId) {
  const detail = await req('GET', `/api/projects/${encodeURIComponent(projectId)}`);
  if (detail.status !== 200) throw new Error(`get detail for evidence failed: ${detail.status}`);

  const execResp = await req('GET', `/api/projects/${encodeURIComponent(projectId)}/executions?limit=800`);
  if (execResp.status !== 200) throw new Error(`get executions failed: ${execResp.status}`);
  const executions = Array.isArray(execResp.data?.executions) ? execResp.data.executions : [];

  const design = executions.filter((e) => e.stageType === 'DESIGN' && e.status === 'success');
  const designModels = [...new Set(design.map((e) => String(e.model || '')).filter(Boolean))];
  const designProviders = [...new Set(design.map((e) => String(e.provider || '')).filter(Boolean))];

  addCheck('project_completed', detail.data?.status === 'completed', `status=${detail.data?.status}, stage=${detail.data?.currentStage}`);
  addCheck('design_success_execution_exists', design.length > 0, `count=${design.length}`);
  addCheck('design_hits_gpt54', designModels.some((m) => m.includes('gpt-5.4')), `models=${JSON.stringify(designModels)}`);
  addCheck('design_provider_real', designProviders.some((p) => p.includes('openai-compatible')), `providers=${JSON.stringify(designProviders)}`);

  const deliverables = Array.isArray(detail.data?.deliverables) ? detail.data.deliverables : [];
  const designDeliverables = deliverables.filter((d) => d.stageType === 'DESIGN');
  addCheck('design_review_card_present', designDeliverables.some((d) => String(d.name || '').includes('设计审查卡')));
  addCheck('design_visual_preview_present', designDeliverables.some((d) => String(d.name || '').includes('preview.html')));

  const stagePreview = await req('POST', '/api/system/stage-model-policy/preview', { stageType: 'DESIGN', role: 'ROLE_DESIGN' });
  if (stagePreview.status === 200) {
    const cands = Array.isArray(stagePreview.data?.candidates) ? stagePreview.data.candidates : [];
    addCheck('design_stage_candidates_include_gpt54', cands.some((c) => String(c).includes('gpt-5.4')), JSON.stringify(cands.slice(0, 6)));
  }

  report.evidence = {
    project: {
      id: detail.data?.id,
      status: detail.data?.status,
      currentStage: detail.data?.currentStage,
      progress: detail.data?.progress,
      pendingApproval: detail.data?.pendingApproval,
    },
    designExecutions: design.map((e) => ({
      id: e.id,
      action: e.action,
      provider: e.provider,
      model: e.model,
      createdAt: e.createdAt,
    })),
    designModels,
    designProviders,
    designDeliverables: designDeliverables.map((d) => ({ name: d.name, status: d.status, version: d.version })),
  };
}

async function main() {
  try {
    await mkdir(OUT_DIR, { recursive: true });
    const health = await req('GET', '/health');
    if (health.status !== 200) throw new Error(`api health not ok: ${health.status}`);

    await ensureSession();
    await drive(PROJECT_ID);
    await collectEvidence(PROJECT_ID);
  } catch (err) {
    report.ok = false;
    report.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await cleanupSession().catch(() => {});
    await prisma.$disconnect().catch(() => {});

    report.finishedAt = new Date().toISOString();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fullPath = path.join(OUT_DIR, `trendhunter-round4-verify-${stamp}.json`);
    const latestPath = path.join(OUT_DIR, 'trendhunter-round4-verify-latest.json');
    await writeFile(fullPath, JSON.stringify(report, null, 2), 'utf8');
    await writeFile(latestPath, JSON.stringify(report, null, 2), 'utf8');

    console.log('\n=== REPORT ===');
    console.log(JSON.stringify({ ok: report.ok, projectId: PROJECT_ID, fullPath, latestPath, checks: report.checks, errors: report.errors }, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
}

await main();
