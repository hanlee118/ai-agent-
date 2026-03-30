import http from 'node:http';

const PORT = process.env.PORT || '8791';
const BASE = `http://127.0.0.1:${PORT}`;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const data = body ? JSON.stringify(body) : null;
    const request = http.request(
      `${BASE}${path}`,
      {
        method,
        headers: data
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
            }
          : undefined,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            // keep raw
          }
          resolve({
            status: res.statusCode || 0,
            body: parsed,
            durationMs: Date.now() - startedAt,
            method,
            path,
          });
        });
      },
    );
    request.setTimeout(210000, () => {
      request.destroy(new Error(`request timeout: ${method} ${path}`));
    });
    request.on('error', reject);
    if (data) request.write(data);
    request.end();
  });
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

function unwrapEnvelope(payload) {
  if (payload && typeof payload === 'object' && 'success' in payload) {
    if (payload.success === true && 'data' in payload) {
      return payload.data;
    }
    return payload;
  }
  return payload;
}

async function main() {
  const startedAt = Date.now();
  const steps = [];

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
  for (let i = 1; i <= 12; i += 1) {
    const advance = await req('POST', `/api/projects/${projectId}/advance`);
    if (advance.status === 409 && advance.body?.error?.code === 'REQUIRES_USER_INTERVENTION') {
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
    } else {
      steps.push({ step: `advance_${i}`, status: advance.status, durationMs: advance.durationMs, project: summarizeProject(advance.body) });
    }

    const detail = await req('GET', `/api/projects/${projectId}`);
    steps.push({ step: `detail_after_round_${i}`, status: detail.status, durationMs: detail.durationMs, project: summarizeProject(detail.body) });

    if (detail.body?.status === 'completed') {
      break;
    }
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

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
  process.exit(1);
});
