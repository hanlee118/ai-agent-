import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const apiRoot = path.join(repoRoot, "apps", "api");
const sqliteDbPath = path.join(apiRoot, "prisma", "dev.db");
const apiBase = (process.env.HEALTHCHECK_API_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const requireRealModelForHealth = String(process.env.REQUIRE_REAL_MODEL_FOR_HEALTH || "").trim().toLowerCase() === "true";

const reportsDir = path.join(repoRoot, 'docs', 'reports');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = path.join(reportsDir, `system-health-check-${stamp}.json`);
const latestPath = path.join(reportsDir, 'system-health-check-latest.json');

async function run() {
  const checks = [];

  checks.push(await check('DB 连接', async () => {
    const result = await execCapture(
      'sqlite3',
      [sqliteDbPath, 'SELECT 1;'],
      { cwd: repoRoot },
    );
    return {
      ok: true,
      detail: (result.stdout || result.stderr || 'SELECT 1 executed').trim().slice(0, 180),
    };
  }));

  checks.push(await check('核心表结构', async () => {
    const result = await execCapture(
      'sqlite3',
      [sqliteDbPath, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Project','AuthSession','SystemConfig');"],
      { cwd: repoRoot }
    );
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const hasProject = output.includes("Project");
    const hasAuthSession = output.includes("AuthSession");
    const hasSystemConfig = output.includes("SystemConfig");
    return {
      ok: hasProject && hasAuthSession && hasSystemConfig,
      detail: output.split('\n').filter(Boolean).join(' | ').slice(0, 240) || '未查询到目标表',
    };
  }));

  checks.push(await check('OpenAPI docs', async () => {
    const response = await fetch(`${apiBase}/api/docs.json`);
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status}` };
    }
    const payload = await response.json();
    const openapiVersion = String(payload?.openapi || '');
    return {
      ok: Boolean(openapiVersion),
      detail: openapiVersion ? `openapi=${openapiVersion}` : '缺少 openapi 字段',
    };
  }));

  checks.push(await check('运行时模型就绪度', async () => {
    const response = await fetch(`${apiBase}/health`);
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status}` };
    }
    const payload = await response.json();
    const runtime = payload?.runtime ?? {};
    const mode = String(runtime?.mode ?? "unknown");
    const requestedMode = String(runtime?.requestedMode ?? "unknown");
    const configured = Boolean(runtime?.configured);
    const realModelReady = mode === "openai-compatible" && requestedMode === "openai-compatible" && configured;

    if (requireRealModelForHealth) {
      return {
        ok: realModelReady,
        detail: realModelReady
          ? "real-model ready"
          : `real-model not ready (mode=${mode}, requestedMode=${requestedMode}, configured=${configured})`,
      };
    }

    return {
      ok: true,
      detail: realModelReady
        ? "real-model ready"
        : `non-blocking: mode=${mode}, requestedMode=${requestedMode}, configured=${configured}`,
    };
  }));

  const routeChecks = [
    { path: '/health', expected: [200] },
    { path: '/ready', expected: [200, 503] },
    { path: '/api/openclaw/agents', expected: [200] },
    { path: '/api/projects', expected: [200] },
    { path: '/api/product-context', expected: [200] },
  ];

  for (const route of routeChecks) {
    checks.push(await check(`关键路由 ${route.path}`, async () => {
      const response = await fetch(`${apiBase}${route.path}`);
      const ok = route.expected.includes(response.status);
      return {
        ok,
        detail: `HTTP ${response.status}${ok ? '' : ` (expected: ${route.expected.join('/')})`}`,
      };
    }));
  }

  const realModelSelfCheck = await buildRealModelSelfCheck();
  const repairGuide = buildRuntimeRepairGuide(realModelSelfCheck);

  const passed = checks.filter((item) => item.ok).length;
  const failed = checks.length - passed;
  const report = {
    generatedAt: new Date().toISOString(),
    apiBase,
    summary: {
      total: checks.length,
      passed,
      failed,
      ok: failed === 0,
    },
    checks,
    runtimeRepair: {
      realModelSelfCheck,
      repairGuide
    }
  };

  await mkdir(reportsDir, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(latestPath, JSON.stringify(report, null, 2), 'utf8');

  process.stdout.write('\n=== 一键健康检查结果 ===\n');
  for (const item of checks) {
    process.stdout.write(`${item.ok ? '✅' : '❌'} ${item.name} (${item.durationMs}ms) - ${item.detail}\n`);
  }
  process.stdout.write(`\n总计: ${checks.length}, 通过: ${passed}, 失败: ${failed}\n`);
  process.stdout.write('\n=== 真实模型配置自检 ===\n');
  process.stdout.write(`ready: ${realModelSelfCheck.ready ? 'true' : 'false'}\n`);
  process.stdout.write(
    `runtime: mode=${realModelSelfCheck.mode}, requestedMode=${realModelSelfCheck.requestedMode}, configured=${realModelSelfCheck.configured}\n`
  );
  process.stdout.write(
    `validate: ok=${realModelSelfCheck.lastValidateOk ? 'true' : 'false'}, status=${realModelSelfCheck.lastValidateStatusCode}\n`
  );
  if (realModelSelfCheck.issues.length > 0) {
    process.stdout.write(`issues: ${realModelSelfCheck.issues.slice(0, 4).join(' | ')}\n`);
  } else {
    process.stdout.write('issues: none\n');
  }
  process.stdout.write(`一键修复步骤: ${repairGuide.steps.length}\n`);
  process.stdout.write(`报告: ${reportPath}\n`);
  process.stdout.write(`最新: ${latestPath}\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

async function buildRealModelSelfCheck() {
  const checkedAt = new Date().toISOString();
  const healthResult = await requestJson(`${apiBase}/health`, { method: 'GET' });
  const runtimeResult = await requestJson(`${apiBase}/api/system/runtime`, { method: 'GET' });
  const validateResult = await requestJson(`${apiBase}/api/system/runtime/validate`, { method: 'POST' });

  const runtimeFromRuntimeApi = toObject(runtimeResult.body);
  const runtimeFromHealth = toObject(toObject(healthResult.body)?.runtime);
  const runtimeSource = looksLikeRuntimeStatus(runtimeFromRuntimeApi) ? runtimeFromRuntimeApi : runtimeFromHealth;
  const runtime = normalizeRuntime(runtimeSource);
  const validateBody = toObject(validateResult.body);
  const runtimeAuthRequired = runtimeResult.status === 401 || runtimeResult.status === 403;
  const validateAuthRequired = validateResult.status === 401 || validateResult.status === 403;
  const validationFromRuntimeHealthy = runtime.lastValidationStatus === 'healthy';
  const lastValidateOk = (validateResult.ok && validateBody?.ok === true)
    || (validateAuthRequired && validationFromRuntimeHealthy);
  const issues = [];

  if (!healthResult.ok) {
    issues.push(`无法读取 /health（HTTP ${healthResult.status}）`);
  }
  if (!runtimeResult.ok && !runtimeAuthRequired) {
    issues.push(`无法读取 /api/system/runtime（HTTP ${runtimeResult.status}）`);
  } else if (runtimeAuthRequired) {
    issues.push(`读取 /api/system/runtime 需要管理员会话（HTTP ${runtimeResult.status}）`);
  }

  if (runtime.requestedMode !== 'openai-compatible') {
    issues.push(`requestedMode=${runtime.requestedMode}，未切换到真实模型模式`);
  }
  if (!runtime.apiBaseUrl) {
    issues.push('缺少 API Base URL');
  }
  if (!runtime.apiKeyConfigured) {
    issues.push('API Key 未配置');
  }
  if (!runtime.modelName || runtime.modelName === 'scripted-agent') {
    issues.push('模型名未配置或仍为 scripted 默认值');
  }
  if (!runtime.configured) {
    issues.push('真实模型配置不完整（configured=false）');
  }
  if (runtime.lastValidationStatus === 'failed') {
    issues.push(
      runtime.lastValidationError
        ? `最近一次校验失败：${runtime.lastValidationError}`
        : '最近一次校验失败（无错误明细）'
    );
  }
  if (validateAuthRequired && !validationFromRuntimeHealthy) {
    issues.push(`读取 /api/system/runtime/validate 需要管理员会话（HTTP ${validateResult.status}）`);
  }
  if (!lastValidateOk && (!validateAuthRequired || !validationFromRuntimeHealthy)) {
    const validateMessage = String(validateBody?.message || '').trim();
    const validateError = String(validateBody?.runtime?.lastValidationError || '').trim();
    issues.push(
      `实时校验未通过（HTTP ${validateResult.status}${validateMessage ? `, ${validateMessage}` : ''}${validateError ? `, ${validateError}` : ''}）`
    );
  }

  const ready = runtime.requestedMode === 'openai-compatible'
    && runtime.mode === 'openai-compatible'
    && runtime.configured
    && (lastValidateOk || runtime.lastValidationStatus === 'healthy');

  return {
    checkedAt,
    ready,
    mode: runtime.mode,
    requestedMode: runtime.requestedMode,
    configured: runtime.configured,
    apiBaseUrl: runtime.apiBaseUrl,
    apiKeyConfigured: runtime.apiKeyConfigured,
    modelName: runtime.modelName,
    dataSource: looksLikeRuntimeStatus(runtimeFromRuntimeApi) ? 'runtime-api' : 'health-fallback',
    lastValidatedAt: runtime.lastValidatedAt,
    lastValidationStatus: runtime.lastValidationStatus,
    lastValidationError: runtime.lastValidationError,
    lastValidateOk,
    lastValidateStatusCode: validateResult.status,
    authRequired: {
      runtime: runtimeAuthRequired,
      validate: validateAuthRequired
    },
    issues,
    sources: {
      health: { ok: healthResult.ok, status: healthResult.status },
      runtime: { ok: runtimeResult.ok, status: runtimeResult.status },
      validate: { ok: validateResult.ok, status: validateResult.status }
    }
  };
}

function buildRuntimeRepairGuide(selfCheck) {
  const steps = [];
  const runtimeApiReachable = selfCheck.sources.runtime.ok
    || selfCheck.sources.runtime.status === 401
    || selfCheck.sources.runtime.status === 403;
  const validateApiReachable = selfCheck.sources.validate.ok
    || selfCheck.sources.validate.status === 401
    || selfCheck.sources.validate.status === 403
    || selfCheck.sources.validate.status === 422;

  if (!runtimeApiReachable) {
    steps.push({
      id: 'ensure-api-ready',
      title: '先恢复 API 服务',
      reason: 'runtime 接口不可用，无法执行在线修复。',
      command: `curl -sS ${apiBase}/health`,
      expected: '返回 HTTP 200 且包含 runtime 字段'
    });
    return {
      quickFixAvailable: false,
      summary: 'API 当前不可达，需先恢复服务再执行模型修复。',
      steps
    };
  }

  if (selfCheck.authRequired.runtime || selfCheck.authRequired.validate) {
    steps.push({
      id: 'login-admin-session',
      title: '先获取管理员会话',
      reason: 'runtime 配置/校验接口需要登录后调用。',
      command:
        `curl -sS -X POST '${apiBase}/api/auth/login' ` +
        `-H 'Content-Type: application/json' ` +
        `-d '{\"username\":\"<ADMIN_USERNAME>\",\"password\":\"<ADMIN_PASSWORD>\"}'`,
      expected: '返回登录成功并写入会话 Cookie（后续调用需携带 Cookie）'
    });
  }

  if (selfCheck.requestedMode !== 'openai-compatible' || !selfCheck.configured) {
    const payload = {
      provider: 'openai-compatible',
      apiBaseUrl: selfCheck.apiBaseUrl || '<YOUR_API_BASE_URL>',
      modelName: selfCheck.modelName && selfCheck.modelName !== 'scripted-agent'
        ? selfCheck.modelName
        : '<YOUR_MODEL_NAME>',
      apiKey: '<YOUR_API_KEY>'
    };
    steps.push({
      id: 'update-runtime-config',
      title: '一键补全真实模型配置',
      reason: '当前请求模式或配置不满足真实模型运行条件。',
      method: 'PUT',
      endpoint: '/api/system/runtime/config',
      payload,
      command:
        `curl -sS -X PUT '${apiBase}/api/system/runtime/config' ` +
        `-H 'Content-Type: application/json' ` +
        `-d '${JSON.stringify(payload)}'`,
      expected: '返回 provider=openai-compatible 且 apiKeyConfigured=true'
    });
  }

  if (!validateApiReachable || !selfCheck.lastValidateOk) {
    steps.push({
      id: 'validate-runtime',
      title: '触发运行时连通性校验',
      reason: '最近一次 runtime validate 未通过或状态未知。',
      method: 'POST',
      endpoint: '/api/system/runtime/validate',
      command: `curl -sS -X POST '${apiBase}/api/system/runtime/validate'`,
      expected: '返回 ok=true, status=healthy'
    });
  }

  steps.push({
    id: 'recheck-health',
    title: '复跑健康检查确认修复生效',
    reason: '确保健康报告从 scripted/degraded 收敛到真实模型可用。',
    command: 'pnpm health:check',
    expected: 'report.runtimeRepair.realModelSelfCheck.ready=true'
  });

  return {
    quickFixAvailable: steps.length > 0,
    summary: selfCheck.ready
      ? '真实模型已就绪，仅需周期性复检。'
      : '已生成可执行修复步骤，按顺序执行可恢复到真实模型可用状态。',
    steps
  };
}

function normalizeRuntime(value) {
  const runtime = toObject(value) || {};
  return {
    mode: String(runtime.mode || 'unknown'),
    requestedMode: String(runtime.requestedMode || 'unknown'),
    configured: Boolean(runtime.configured),
    apiBaseUrl: String(runtime.apiBaseUrl || ''),
    apiKeyConfigured: Boolean(runtime.apiKeyConfigured),
    modelName: String(runtime.modelName || ''),
    lastValidatedAt: runtime.lastValidatedAt ? String(runtime.lastValidatedAt) : null,
    lastValidationStatus: String(runtime.lastValidationStatus || 'unknown'),
    lastValidationError: runtime.lastValidationError ? String(runtime.lastValidationError) : null
  };
}

function looksLikeRuntimeStatus(value) {
  const runtime = toObject(value);
  if (!runtime) {
    return false;
  }
  return typeof runtime.mode === 'string' && typeof runtime.requestedMode === 'string';
}

async function requestJson(url, options) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 2000) };
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      body
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function toObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value;
}

async function check(name, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return {
      name,
      ok: Boolean(result.ok),
      detail: String(result.detail || ''),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

function execCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`命令失败: ${command} ${args.join(' ')}\n${stderr || stdout}`));
    });
  });
}

run().catch((error) => {
  process.stderr.write(`❌ 健康检查失败: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
