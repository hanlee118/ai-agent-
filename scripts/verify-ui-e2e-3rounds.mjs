import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const reportsDir = path.join(repoRoot, "docs", "reports");

const rounds = Math.max(1, Math.min(10, Number(process.env.VERIFY_ROUNDS || 3)));
const apiBootTimeoutMs = Math.max(
  5_000,
  Math.min(120_000, Number(process.env.VERIFY_API_BOOT_TIMEOUT_MS || 25_000))
);
const uiStepTimeoutMs = Math.max(
  90_000,
  Math.min(60 * 60 * 1000, Number(process.env.VERIFY_UI_STEP_TIMEOUT_MS || 20 * 60 * 1000))
);
const testTargets = String(process.env.VERIFY_UI_TEST_TARGETS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const defaultTestTargets = [
  "scripts/e2e/ui-project-room-real-autoadvance.spec.ts",
  "scripts/e2e/ui-project-room-real-single-stage.spec.ts",
  "scripts/e2e/ui-workflow-template.spec.ts",
  "scripts/e2e/ui-visual-hermes-prefer.spec.ts",
];
const effectiveTestTargets = testTargets.length > 0 ? testTargets : defaultTestTargets;
const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8787";
const VERIFY_REUSE_EXISTING_API_ONLY =
  String(process.env.VERIFY_REUSE_EXISTING_API_ONLY ?? "true").trim().toLowerCase() !== "false";

function summarizeOutput(text, maxLength = 2400) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}\n...<truncated>`;
}

function waitForApiReady(child) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let stdout = "";
    let stderr = "";

    const done = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      done({
        ok: false,
        reason: "timeout",
        durationMs: Date.now() - startedAt,
        stdout: summarizeOutput(stdout),
        stderr: summarizeOutput(stderr)
      });
    }, apiBootTimeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (/OCC API listening on http:\/\/127\.0\.0\.1:8787/i.test(text)) {
        done({
          ok: true,
          reason: "ready",
          durationMs: Date.now() - startedAt,
          stdout: summarizeOutput(stdout),
          stderr: summarizeOutput(stderr)
        });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("exit", (code, signal) => {
      done({
        ok: false,
        reason: "exit_before_ready",
        durationMs: Date.now() - startedAt,
        exitCode: typeof code === "number" ? code : null,
        signal: signal || null,
        stdout: summarizeOutput(stdout),
        stderr: summarizeOutput(stderr)
      });
    });
  });
}

async function checkExistingApiReady() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(`${API_BASE_URL}/api/health`, {
        method: "GET",
        signal: controller.signal
      });
      clearTimeout(timer);
      if (response.ok) {
        return true;
      }
    } catch {
      // keep retrying during short readiness window
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return false;
}

function runUiSuite() {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(
      "pnpm",
      ["dlx", "playwright", "test", ...effectiveTestTargets, "--workers=1", "--reporter=line"],
      {
        cwd: repoRoot,
        env: process.env,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }, uiStepTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      resolve({
        ok: false,
        status: "spawn_error",
        durationMs: Date.now() - startedAt,
        stdout: summarizeOutput(stdout),
        stderr: summarizeOutput(`${stderr}\n${error instanceof Error ? error.message : String(error)}`)
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeoutHandle);
      resolve({
        ok: !timedOut && code === 0,
        status: timedOut ? "timeout" : code === 0 ? "passed" : "failed",
        exitCode: typeof code === "number" ? code : null,
        signal: signal || null,
        durationMs: Date.now() - startedAt,
        stdout: summarizeOutput(stdout),
        stderr: summarizeOutput(stderr)
      });
    });
  });
}

async function runRound(round) {
  const roundStartedAt = new Date().toISOString();
  const hasReadyApi = await checkExistingApiReady();
  if (!hasReadyApi && VERIFY_REUSE_EXISTING_API_ONLY) {
    return {
      round,
      ok: false,
      startedAt: roundStartedAt,
      steps: [
        {
          step: "boot-api",
          ok: false,
          reason: "existing_api_not_ready",
          durationMs: 0,
          stdout: "",
          stderr: `expected existing API at ${API_BASE_URL} to be ready`,
        },
        {
          step: "ui-e2e",
          ok: false,
          status: "skipped_api_not_ready"
        }
      ]
    };
  }
  if (hasReadyApi) {
    const uiResult = await runUiSuite();
    return {
      round,
      ok: uiResult.ok,
      startedAt: roundStartedAt,
      steps: [
        {
          step: "boot-api",
          ok: true,
          reason: "reuse_existing",
          durationMs: 0,
          stdout: "",
          stderr: ""
        },
        {
          step: "ui-e2e",
          ...uiResult
        }
      ]
    };
  }

  const apiEnv = {
    ...process.env,
    PROJECT_DIRECT_CREATE_ENABLED: process.env.VERIFY_PROJECT_DIRECT_CREATE_ENABLED || "true",
    ENFORCE_REAL_MODEL_GATE: process.env.VERIFY_ENFORCE_REAL_MODEL_GATE || "false",
    HERMES_ENABLED: process.env.VERIFY_HERMES_ENABLED || "true",
  };
  const apiProcess = spawn("node", ["apps/api/dist/index.js"], {
    cwd: repoRoot,
    env: apiEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const apiReady = await waitForApiReady(apiProcess);
  if (!apiReady.ok) {
    apiProcess.kill("SIGTERM");
    return {
      round,
      ok: false,
      startedAt: roundStartedAt,
      steps: [
        {
          step: "boot-api",
          ...apiReady
        },
        {
          step: "ui-e2e",
          ok: false,
          status: "skipped_api_not_ready"
        }
      ]
    };
  }

  const uiResult = await runUiSuite();
  apiProcess.kill("SIGTERM");

  return {
    round,
    ok: uiResult.ok,
    startedAt: roundStartedAt,
    steps: [
      {
        step: "boot-api",
        ...apiReady
      },
      {
        step: "ui-e2e",
        ...uiResult
      }
    ]
  };
}

async function run() {
  const startedAt = new Date().toISOString();
  const roundResults = [];
  let failedRounds = 0;

  for (let round = 1; round <= rounds; round += 1) {
    process.stdout.write(`[verify-ui-3rounds] round ${round}/${rounds} start\n`);
    const result = await runRound(round);
    roundResults.push(result);
    if (!result.ok) {
      failedRounds += 1;
    }
    process.stdout.write(
      `[verify-ui-3rounds] round ${round} ${result.ok ? "passed" : "failed"}\n`
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    startedAt,
    rounds,
    apiBootTimeoutMs,
    uiStepTimeoutMs,
    testTargets: effectiveTestTargets,
    summary: {
      passedRounds: rounds - failedRounds,
      failedRounds,
      ok: failedRounds === 0
    },
    roundResults
  };

  await mkdir(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportsDir, `ui-e2e-selfcheck-3rounds-${stamp}.json`);
  const latestPath = path.join(reportsDir, "ui-e2e-selfcheck-3rounds-latest.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(latestPath, JSON.stringify(report, null, 2), "utf8");

  process.stdout.write(
    `[verify-ui-3rounds] done: passed=${report.summary.passedRounds}, failed=${report.summary.failedRounds}\n`
  );
  process.stdout.write(`[verify-ui-3rounds] report=${reportPath}\n`);
  process.stdout.write(`[verify-ui-3rounds] latest=${latestPath}\n`);

  if (!report.summary.ok) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  process.stderr.write(
    `[verify-ui-3rounds] failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
