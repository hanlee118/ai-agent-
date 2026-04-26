import { execFileSync } from "node:child_process";

function normalizeBaseUrl(url) {
  const raw = String(url || "").trim();
  return raw ? raw.replace(/\/$/, "") : "";
}

async function isReachable(url, pathname = "/health", headers = undefined) {
  try {
    const response = await fetch(`${url}${pathname}`, { headers });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

function detectDaemonRunning(cwd, logger = null) {
  try {
    const output = String(
      execFileSync("pnpm", ["daemon:status"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }) || ""
    );
    const running = /is running with PID|is responding on/i.test(output);
    logger?.(`daemon status detected running=${running}`);
    return running;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.(`daemon status check failed: ${message.split("\n")[0]}`);
    return false;
  }
}

export async function resolveReachableApiBase(options = {}) {
  const {
    requestedBaseUrl = "",
    candidates = [
      "http://127.0.0.1:8787",
      "http://127.0.0.1:8794",
      "http://localhost:8787",
      "http://localhost:8794",
    ],
    checkPathname = "/health",
    headers = undefined,
  } = options;

  const normalizedRequested = normalizeBaseUrl(requestedBaseUrl);
  const list = normalizedRequested
    ? [normalizedRequested, ...candidates.map(normalizeBaseUrl).filter((item) => item && item !== normalizedRequested)]
    : candidates.map(normalizeBaseUrl).filter(Boolean);

  for (const base of list) {
    const probe = await isReachable(base, checkPathname, headers);
    if (probe.ok) {
      return base;
    }
  }
  return "";
}

export async function ensureApiReady(options = {}) {
  const {
    requestedBaseUrl = "",
    candidates = undefined,
    checkPathname = "/health",
    headers = undefined,
    autoStartDaemon = true,
    startCommand = ["pnpm", "daemon:start"],
    cwd = process.cwd(),
    logger = null,
  } = options;

  let resolved = await resolveReachableApiBase({
    requestedBaseUrl,
    candidates,
    checkPathname,
    headers,
  });
  if (resolved) {
    return {
      ok: true,
      apiBaseUrl: resolved,
      startedByScript: false,
      detail: "reachable",
    };
  }

  if (!autoStartDaemon || !Array.isArray(startCommand) || startCommand.length < 1) {
    return {
      ok: false,
      apiBaseUrl: normalizeBaseUrl(requestedBaseUrl),
      startedByScript: false,
      detail: "unreachable_no_autostart",
    };
  }

  const daemonWasRunning = detectDaemonRunning(cwd, logger);

  try {
    execFileSync(startCommand[0], startCommand.slice(1), {
      cwd,
      stdio: "ignore",
    });
    logger?.(`issued ${startCommand.join(" ")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.(`failed ${startCommand.join(" ")} (non-blocking): ${message.split("\n")[0]}`);
  }

  resolved = await resolveReachableApiBase({
    requestedBaseUrl,
    candidates,
    checkPathname,
    headers,
  });

  return {
    ok: Boolean(resolved),
    apiBaseUrl: resolved || normalizeBaseUrl(requestedBaseUrl),
    startedByScript: !daemonWasRunning && Boolean(resolved),
    detail: resolved ? "started_and_reachable" : "started_but_unreachable",
  };
}
