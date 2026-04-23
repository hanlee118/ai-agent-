import { prisma } from '../apps/api/dist/db.js';
import { generateSessionToken, hashSessionToken } from '../apps/api/dist/security/secret-store.js';

const REQUEST_TIMEOUT_MS = Math.max(30000, Number(process.env.REQUEST_TIMEOUT_MS || 210000));
const MAX_IN_PROGRESS_RETRIES = Math.max(8, Number(process.env.MAX_IN_PROGRESS_RETRIES || 40));
const REQUIRE_COMPLETION = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.SMOKE_REQUIRE_COMPLETION || '').trim().toLowerCase()
);
const SESSION_TTL_MS = Math.max(
  30 * 60 * 1000,
  Number(process.env.SMOKE_SESSION_TTL_MS || 2 * 60 * 60 * 1000)
);
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

function formatProjectState(project) {
  if (!project || typeof project !== 'object') {
    return 'project=<unknown>';
  }
  return [
    `project=${project.id || '<unknown>'}`,
    `stage=${project.currentStage || '<unknown>'}`,
    `status=${project.status || '<unknown>'}`,
    `pending=${project.pendingApproval ? 1 : 0}`,
    `progress=${Number(project.progress || 0)}`
  ].join(' ');
}

function logProgress(message, extra) {
  const suffix = extra ? ` ${extra}` : '';
  process.stderr.write(`[smoke] ${message}${suffix}\n`);
}

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
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
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

function buildInitSmokeSubmissionContent() {
  return [
    '# 项目章程（Smoke）',
    '',
    '## 项目背景与目标',
    '- 项目目标：验证项目从创建到立项审批可稳定推进。',
    '- 阶段目标：确保立项输出可被下一阶段直接使用。',
    '',
    '## 范围定义（In Scope / Out of Scope）',
    '- In Scope：创建、预备、阶段提交、审批推进。',
    '- Out of Scope：生产部署改造与多租户权限重构。',
    '',
    '## 角色分工与责任',
    '- 阶段负责人：ROLE_PM。',
    '- 协作角色：ROLE_ANALYST、ROLE_PRODUCT。',
    '',
    '## 治理机制与决策规则',
    '- 规则：门禁未通过不得推进，必须补齐并重提。',
    '',
    '## 风险与应急预案',
    '- 风险：模型调用波动导致推进延迟。',
    '- 应急：保留草稿并补齐后重新提交审批。',
    '',
    '## 验收检查清单',
    '- 目标、范围、角色、风险四类信息完整且无冲突。',
    '- 关键决策规则清晰，出现阻塞时可直接执行。',
    '- 章程可作为分析阶段输入，不依赖口头补充。',
    '',
    '## 待确认项',
    '- 待确认：后续是否需要扩展到多级审批链路。',
    '',
    '## 协作交接卡',
    'factsConfirmed: 已确认立项阶段目标、范围、责任人与验收口径。',
    'assumptions: 默认按单用户 MVP 推进，新增范围需重新评审。',
    'decisions: 先通过立项门禁，再进入分析阶段。',
    'handoff: 下一阶段基于本章程产出需求分析与排期。',
    'openQuestions: 多级审批是否纳入后续阶段。',
  ].join('\n');
}

async function main() {
  const startedAt = Date.now();
  const steps = [];
  let consecutiveInProgressRetries = 0;
  BASE = await resolveBase();
  await createTemporarySession();
  steps.push({ step: 'resolve_base', status: 200, durationMs: 0, summary: { base: BASE } });
  logProgress('resolved api base', BASE);

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
  logProgress('created project', formatProjectState(create.body));

  const detail1 = await req('GET', `/api/projects/${projectId}`);
  steps.push({ step: 'detail_after_create', status: detail1.status, durationMs: detail1.durationMs, project: summarizeProject(detail1.body) });
  logProgress('fetched initial detail', formatProjectState(detail1.body));

  if (!REQUIRE_COMPLETION) {
    const prepRun = await req('POST', `/api/projects/${projectId}/post-create-prep`, {});
    if (prepRun.status !== 200) {
      throw new Error(`quick_post_create_prep_run failed: ${prepRun.status} ${JSON.stringify(prepRun.body)}`);
    }
    const prepRunData = unwrapEnvelope(prepRun.body);
    steps.push({
      step: 'quick_post_create_prep_run',
      status: prepRun.status,
      durationMs: prepRun.durationMs,
      summary: prepRunData?.postCreatePrep || null,
    });
    if (prepRunData?.postCreatePrep?.required && !prepRunData?.postCreatePrep?.completed) {
      const prepConfirm = await req('POST', `/api/projects/${projectId}/post-create-prep/confirm`, {
        confirmedBy: 'smoke-project-flow',
        notes: 'quick smoke confirmation',
      });
      if (prepConfirm.status !== 200) {
        throw new Error(`quick_post_create_prep_confirm failed: ${prepConfirm.status} ${JSON.stringify(prepConfirm.body)}`);
      }
      const prepConfirmData = unwrapEnvelope(prepConfirm.body);
      if (!prepConfirmData?.postCreatePrep?.completed) {
        throw new Error(`quick_post_create_prep_confirm not completed: ${JSON.stringify(prepConfirm.body)}`);
      }
      steps.push({
        step: 'quick_post_create_prep_confirm',
        status: prepConfirm.status,
        durationMs: prepConfirm.durationMs,
        summary: prepConfirmData?.postCreatePrep || null,
      });
    }

    const detailBeforeSubmit = await req('GET', `/api/projects/${projectId}`);
    const stageBeforeSubmit = String(detailBeforeSubmit.body?.currentStage || '').toUpperCase();
    steps.push({
      step: 'quick_detail_before_submit',
      status: detailBeforeSubmit.status,
      durationMs: detailBeforeSubmit.durationMs,
      project: summarizeProject(detailBeforeSubmit.body),
    });

    if (stageBeforeSubmit === 'INIT') {
      const submit = await req('POST', `/api/projects/${projectId}/stages/submit`, {
        title: '项目章程.md',
        content: buildInitSmokeSubmissionContent(),
      });
      if (submit.status !== 200) {
        throw new Error(`quick_submit failed: ${submit.status} ${JSON.stringify(submit.body)}`);
      }
      steps.push({
        step: 'quick_submit',
        status: submit.status,
        durationMs: submit.durationMs,
        project: summarizeProject(submit.body),
      });

      const approve = await req('POST', `/api/projects/${projectId}/approve`);
      if (approve.status !== 200) {
        throw new Error(`quick_approve failed: ${approve.status} ${JSON.stringify(approve.body)}`);
      }
      steps.push({
        step: 'quick_approve',
        status: approve.status,
        durationMs: approve.durationMs,
        project: summarizeProject(approve.body),
      });
    } else {
      logProgress('quick smoke skip init submit/approve', `stage=${stageBeforeSubmit || '<unknown>'}`);
    }

    const finalDetail = await req('GET', `/api/projects/${projectId}`);
    const finalProject = unwrapEnvelope(finalDetail.body);
    steps.push({ step: 'detail_final', status: finalDetail.status, durationMs: finalDetail.durationMs, project: summarizeProject(finalProject) });
    logProgress('final detail', formatProjectState(finalProject));
    if (String(finalProject?.currentStage || '').toUpperCase() === 'INIT') {
      throw new Error(`project did not pass init stage in quick smoke: ${JSON.stringify(summarizeProject(finalProject))}`);
    }

    const timed = steps.filter((step) => typeof step.durationMs === 'number');
    const slowest = [...timed]
      .sort((a, b) => Number(b.durationMs || 0) - Number(a.durationMs || 0))
      .slice(0, 5)
      .map((item) => ({ step: item.step, durationMs: item.durationMs, status: item.status }));

    console.log(JSON.stringify({
      ok: true,
      mode: 'quick',
      projectId,
      totalDurationMs: Date.now() - startedAt,
      slowestSteps: slowest,
      steps,
    }, null, 2));
    return;
  }

  // iterate advance path until completed or max rounds
  for (let i = 1; i <= 18; i += 1) {
    const advance = await req('POST', `/api/projects/${projectId}/advance`);
    const errorCode = advance.body?.error?.code;
    if (advance.status === 409 && errorCode === 'PROJECT_ADVANCE_IN_PROGRESS') {
      consecutiveInProgressRetries += 1;
      const pollAfterMs = Math.max(800, Number(advance.body?.error?.pollAfterMs || 1500));
      steps.push({
        step: `advance_${i}_in_progress`,
        status: advance.status,
        durationMs: advance.durationMs,
        code: errorCode,
        retryCount: consecutiveInProgressRetries,
        pollAfterMs,
      });
      logProgress(
        `advance round ${i} still in progress`,
        `retry=${consecutiveInProgressRetries} pollAfterMs=${pollAfterMs}`
      );
      if (consecutiveInProgressRetries > MAX_IN_PROGRESS_RETRIES) {
        throw new Error(
          `advance_${i} stayed in PROJECT_ADVANCE_IN_PROGRESS for ${consecutiveInProgressRetries} consecutive retries (max=${MAX_IN_PROGRESS_RETRIES})`,
        );
      }
      await WAIT(pollAfterMs);
      i -= 1;
      continue;
    }
    consecutiveInProgressRetries = 0;

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
      logProgress(
        `advance round ${i} requires intervention`,
        actions.map((a) => `${a.action}:${a.severity}`).join(', ')
      );

      const hasPostCreatePrep = actions.some((a) => a.action === 'run_post_create_prep');
      if (hasPostCreatePrep) {
        const prepRun = await req('POST', `/api/projects/${projectId}/post-create-prep`, {});
        if (prepRun.status !== 200) {
          throw new Error(`post_create_prep_run_${i} failed: ${prepRun.status} ${JSON.stringify(prepRun.body)}`);
        }
        const prepRunData = unwrapEnvelope(prepRun.body);
        steps.push({
          step: `post_create_prep_run_${i}`,
          status: prepRun.status,
          durationMs: prepRun.durationMs,
          summary: prepRunData?.postCreatePrep || null,
        });
        logProgress(`post-create prep run round ${i}`, `status=${prepRun.status}`);

        if (prepRunData?.postCreatePrep?.required && !prepRunData?.postCreatePrep?.completed) {
          const prepConfirm = await req('POST', `/api/projects/${projectId}/post-create-prep/confirm`, {
            confirmedBy: 'smoke-project-flow',
            notes: 'automated smoke confirmation',
          });
          if (prepConfirm.status !== 200) {
            throw new Error(`post_create_prep_confirm_${i} failed: ${prepConfirm.status} ${JSON.stringify(prepConfirm.body)}`);
          }
          const prepConfirmData = unwrapEnvelope(prepConfirm.body);
          if (!prepConfirmData?.postCreatePrep?.completed) {
            throw new Error(`post_create_prep_confirm_${i} not completed: ${JSON.stringify(prepConfirm.body)}`);
          }
          steps.push({
            step: `post_create_prep_confirm_${i}`,
            status: prepConfirm.status,
            durationMs: prepConfirm.durationMs,
            summary: prepConfirmData?.postCreatePrep || null,
          });
          logProgress(`post-create prep confirmed round ${i}`, `status=${prepConfirm.status}`);
        }
      }

      const hasReviewPending = actions.some((a) => a.action === 'review_pending_stage');
      if (hasReviewPending) {
        const approve = await req('POST', `/api/projects/${projectId}/approve`);
        if (approve.status !== 200) {
          throw new Error(`approve_${i} failed: ${approve.status} ${JSON.stringify(approve.body)}`);
        }
        steps.push({ step: `approve_${i}`, status: approve.status, durationMs: approve.durationMs, project: summarizeProject(approve.body) });
        logProgress(`approved round ${i}`, formatProjectState(approve.body));
      }

      const hasReconcile = actions.some((a) => a.action === 'reconcile_deliverables');
      if (hasReconcile) {
        const reconcile = await req('POST', `/api/projects/${projectId}/reconcile-deliverables`);
        if (reconcile.status !== 200) {
          throw new Error(`reconcile_${i} failed: ${reconcile.status} ${JSON.stringify(reconcile.body)}`);
        }
        steps.push({ step: `reconcile_${i}`, status: reconcile.status, durationMs: reconcile.durationMs, project: summarizeProject(reconcile.body) });
        logProgress(`reconciled deliverables round ${i}`, formatProjectState(reconcile.body));
      }
    } else if (advance.status >= 400) {
      throw new Error(`advance_${i} failed: ${advance.status} ${JSON.stringify(advance.body)}`);
    } else {
      steps.push({ step: `advance_${i}`, status: advance.status, durationMs: advance.durationMs, project: summarizeProject(advance.body) });
      logProgress(`advance round ${i} returned`, formatProjectState(advance.body));
    }

    const detail = await req('GET', `/api/projects/${projectId}`);
    steps.push({ step: `detail_after_round_${i}`, status: detail.status, durationMs: detail.durationMs, project: summarizeProject(detail.body) });
    logProgress(`detail after round ${i}`, formatProjectState(detail.body));

    if (detail.body?.status === 'completed') {
      break;
    }
    if (!REQUIRE_COMPLETION && String(detail.body?.currentStage || '').toUpperCase() !== 'INIT') {
      logProgress(`smoke quick gate reached`, `stage=${detail.body?.currentStage || '<unknown>'}`);
      break;
    }
  }

  const finalDetail = await req('GET', `/api/projects/${projectId}`);
  const finalProject = unwrapEnvelope(finalDetail.body);
  steps.push({ step: 'detail_final', status: finalDetail.status, durationMs: finalDetail.durationMs, project: summarizeProject(finalProject) });
  logProgress('final detail', formatProjectState(finalProject));
  if (REQUIRE_COMPLETION) {
    if (finalProject?.status !== 'completed') {
      throw new Error(`project did not complete within smoke flow budget: ${JSON.stringify(summarizeProject(finalProject))}`);
    }
  } else if (String(finalProject?.currentStage || '').toUpperCase() === 'INIT') {
    throw new Error(`project did not pass init stage within smoke flow budget: ${JSON.stringify(summarizeProject(finalProject))}`);
  }

  if (finalProject?.status === 'completed') {
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
    logProgress('final artifacts ready', `status=${artifacts.status}`);
  }

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
