import { prisma } from '../apps/api/dist/db.js';
import { generateSessionToken, hashSessionToken } from '../apps/api/dist/security/secret-store.js';

const REQUEST_TIMEOUT_MS = Math.max(30000, Number(process.env.REQUEST_TIMEOUT_MS || 210000));
const CANDIDATE_BASES = process.env.OCC_BASE_URL
  ? [String(process.env.OCC_BASE_URL).replace(/\/$/, '')]
  : [
      'http://127.0.0.1:8787',
      'http://127.0.0.1:8794',
      'http://localhost:8787',
      'http://localhost:8794',
    ];

let BASE = '';
let SESSION_COOKIE = '';
const WAIT = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveBase() {
  for (const candidate of CANDIDATE_BASES) {
    try {
      const response = await fetch(`${candidate}/health`);
      if (response.ok) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error(`no reachable api base found in: ${CANDIDATE_BASES.join(', ')}`);
}

async function createTemporarySession() {
  const sessionToken = generateSessionToken();
  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(sessionToken),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  SESSION_COOKIE = `occ_session=${sessionToken}`;
}

async function cleanupTemporarySession() {
  const rawToken = SESSION_COOKIE.replace(/^occ_session=/, '').trim();
  if (!rawToken) {
    return;
  }
  await prisma.authSession.deleteMany({
    where: {
      tokenHash: await hashSessionToken(rawToken),
    },
  });
}

async function req(method, path, body) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(SESSION_COOKIE ? { Cookie: SESSION_COOKIE } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const raw = await response.text();
    let parsed = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      // keep raw text payload
    }

    return {
      status: response.status,
      body: parsed,
      durationMs: Date.now() - startedAt,
      method,
      path,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`request failed: ${method} ${path} (${reason})`);
  } finally {
    clearTimeout(timer);
  }
}

function unwrapEnvelope(payload) {
  if (payload && typeof payload === 'object' && 'success' in payload) {
    if (payload.success === true && 'data' in payload) {
      return payload.data;
    }
    return payload;
  }
  return payload;
}

function summarizeProject(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    id: p.id,
    status: p.status,
    currentStage: p.currentStage,
    pendingApproval: p.pendingApproval,
    progress: p.progress,
    requiredActions: Array.isArray(p.requiredActions)
      ? p.requiredActions.map((a) => ({ id: a.id, action: a.action, severity: a.severity }))
      : undefined,
  };
}

async function main() {
  const startedAt = Date.now();
  const steps = [];
  BASE = await resolveBase();
  await createTemporarySession();
  steps.push({ step: 'resolve_base', status: 200, durationMs: 0, summary: { base: BASE } });

  const create = await req('POST', '/api/projects', {
    name: `smoke-${Date.now()}`,
    description: '请做一个AI协作平台官网，突出需求到研发闭环、角色协作、实时监控，并提供预约演示入口',
    team: ['ROLE_PM', 'ROLE_ANALYST', 'ROLE_DESIGN', 'ROLE_DEV', 'ROLE_QA'],
  });
  if (create.status !== 201) {
    throw new Error(`create failed: ${create.status} ${JSON.stringify(create.body)}`);
  }
  const projectId = create.body.id;
  steps.push({ step: 'create', status: create.status, durationMs: create.durationMs, project: summarizeProject(create.body) });

  const detail1 = await req('GET', `/api/projects/${projectId}`);
  steps.push({ step: 'detail_after_create', status: detail1.status, durationMs: detail1.durationMs, project: summarizeProject(detail1.body) });

  // iterate advance path until completed or max rounds
  for (let i = 1; i <= 18; i += 1) {
    const advance = await req('POST', `/api/projects/${projectId}/advance`);
    const errorCode = advance.body?.error?.code;
    if (advance.status === 409 && errorCode === 'PROJECT_ADVANCE_IN_PROGRESS') {
      const pollAfterMs = Math.max(800, Number(advance.body?.error?.pollAfterMs || 1500));
      steps.push({
        step: `advance_${i}_in_progress`,
        status: advance.status,
        durationMs: advance.durationMs,
        code: errorCode,
        pollAfterMs,
      });
      await WAIT(pollAfterMs);
      i -= 1;
      continue;
    }

    if (advance.status === 409 && errorCode === 'REQUIRES_USER_INTERVENTION') {
      const actions = advance.body?.error?.requiredActions || [];
      if (!Array.isArray(actions) || actions.length === 0) {
        throw new Error(`advance_${i} returned REQUIRES_USER_INTERVENTION but requiredActions is empty`);
      }
      steps.push({
        step: `advance_${i}_requires_intervention`,
        status: advance.status,
        durationMs: advance.durationMs,
        code: advance.body?.error?.code,
        requiredActions: actions.map((a) => ({ id: a.id, action: a.action, severity: a.severity })),
      });

      const hasReviewPending = actions.some((a) => a.action === 'review_pending_stage');
      if (hasReviewPending) {
        const approve = await req('POST', `/api/projects/${projectId}/approve`);
        if (approve.status !== 200) {
          throw new Error(`approve_${i} failed: ${approve.status} ${JSON.stringify(approve.body)}`);
        }
        steps.push({ step: `approve_${i}`, status: approve.status, durationMs: approve.durationMs, project: summarizeProject(approve.body) });
      }

      const hasReconcile = actions.some((a) => a.action === 'reconcile_deliverables');
      if (hasReconcile) {
        const reconcile = await req('POST', `/api/projects/${projectId}/reconcile-deliverables`);
        if (reconcile.status !== 200) {
          throw new Error(`reconcile_${i} failed: ${reconcile.status} ${JSON.stringify(reconcile.body)}`);
        }
        steps.push({ step: `reconcile_${i}`, status: reconcile.status, durationMs: reconcile.durationMs, project: summarizeProject(reconcile.body) });
      }
    } else if (advance.status >= 400) {
      throw new Error(`advance_${i} failed: ${advance.status} ${JSON.stringify(advance.body)}`);
    } else {
      steps.push({ step: `advance_${i}`, status: advance.status, durationMs: advance.durationMs, project: summarizeProject(advance.body) });
    }

    const detail = await req('GET', `/api/projects/${projectId}`);
    steps.push({ step: `detail_after_round_${i}`, status: detail.status, durationMs: detail.durationMs, project: summarizeProject(detail.body) });

    if (detail.body?.status === 'completed') {
      break;
    }
  }

  const finalDetail = await req('GET', `/api/projects/${projectId}`);
  const finalProject = unwrapEnvelope(finalDetail.body);
  steps.push({ step: 'detail_final', status: finalDetail.status, durationMs: finalDetail.durationMs, project: summarizeProject(finalProject) });
  if (finalProject?.status !== 'completed') {
    throw new Error(`project did not complete within smoke flow budget: ${JSON.stringify(summarizeProject(finalProject))}`);
  }

  const artifacts = await req('GET', `/api/projects/${projectId}/final-artifacts`);
  const artifactsData = unwrapEnvelope(artifacts.body);
  if (artifacts.status === 200 && artifactsData?.readyForAcceptance !== true) {
    throw new Error(`final artifacts not ready for acceptance: ${JSON.stringify(artifactsData)}`);
  }
  steps.push({
    step: 'final_artifacts',
    status: artifacts.status,
    durationMs: artifacts.durationMs,
    summary:
      artifacts.status === 200
        ? {
            readyForAcceptance: artifactsData?.readyForAcceptance,
            coverage: artifactsData?.coverage,
            missingRequired: artifactsData?.missingRequired,
          }
        : artifacts.body,
  });

  const timed = steps.filter((step) => typeof step.durationMs === 'number');
  const slowest = [...timed]
    .sort((a, b) => Number(b.durationMs || 0) - Number(a.durationMs || 0))
    .slice(0, 5)
    .map((item) => ({ step: item.step, durationMs: item.durationMs, status: item.status }));

  console.log(JSON.stringify({
    ok: true,
    projectId,
    totalDurationMs: Date.now() - startedAt,
    slowestSteps: slowest,
    steps,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupTemporarySession();
    } finally {
      await prisma.$disconnect();
    }
  });
