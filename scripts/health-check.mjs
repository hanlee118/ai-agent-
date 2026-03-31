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
  };

  await mkdir(reportsDir, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(latestPath, JSON.stringify(report, null, 2), 'utf8');

  process.stdout.write('\n=== 一键健康检查结果 ===\n');
  for (const item of checks) {
    process.stdout.write(`${item.ok ? '✅' : '❌'} ${item.name} (${item.durationMs}ms) - ${item.detail}\n`);
  }
  process.stdout.write(`\n总计: ${checks.length}, 通过: ${passed}, 失败: ${failed}\n`);
  process.stdout.write(`报告: ${reportPath}\n`);
  process.stdout.write(`最新: ${latestPath}\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
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
