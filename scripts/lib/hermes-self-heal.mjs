import { execFileSync } from "node:child_process";

export function toBool(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  return fallback;
}

function unwrapEnvelope(payload) {
  if (payload && typeof payload === "object" && "success" in payload && "data" in payload) {
    return payload.data;
  }
  return payload;
}

function isLocalHermesEndpoint(endpoint) {
  try {
    const host = new URL(endpoint).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

async function probeHermesRuntime({ apiBase, headers }) {
  try {
    const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/workflows/hermes/status?probe=true`, {
      headers
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    const data = unwrapEnvelope(payload) || {};
    return {
      ok: response.ok,
      status: response.status,
      data,
      reachable: Boolean(data?.probe?.reachable),
      runtimeTotalSuccess: Number(data?.runtime?.totalSuccess || 0),
      runtimeLastSuccessAt: data?.runtime?.lastSuccessAt || null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      reachable: false,
      runtimeTotalSuccess: 0,
      runtimeLastSuccessAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ensureHermesReachableViaApi(options = {}) {
  const {
    apiBase = "http://127.0.0.1:8787",
    enabled = false,
    endpoint = "",
    cwd = process.cwd(),
    headers = undefined,
    autoStartLocal = true,
    logger = null,
  } = options;

  const hasEndpoint = String(endpoint || "").trim().length > 0;
  if (!enabled) {
    return {
      enabled: false,
      hasEndpoint,
      attemptedStart: false,
      daemonStarted: false,
      reachable: null,
      detail: "hermes_disabled",
      probeStatus: null,
      runtimeTotalSuccess: 0,
      runtimeLastSuccessAt: null,
      hasHistoricalHermesSuccess: false,
    };
  }
  if (!hasEndpoint) {
    return {
      enabled: true,
      hasEndpoint: false,
      attemptedStart: false,
      daemonStarted: false,
      reachable: null,
      detail: "endpoint_missing",
      probeStatus: null,
      runtimeTotalSuccess: 0,
      runtimeLastSuccessAt: null,
      hasHistoricalHermesSuccess: false,
    };
  }

  const firstProbe = await probeHermesRuntime({ apiBase, headers });
  if (firstProbe.reachable) {
    const historical = firstProbe.runtimeTotalSuccess > 0 || Boolean(firstProbe.runtimeLastSuccessAt);
    return {
      enabled: true,
      hasEndpoint: true,
      attemptedStart: false,
      daemonStarted: false,
      reachable: true,
      detail: "probe_ok",
      probeStatus: firstProbe.status,
      runtimeTotalSuccess: firstProbe.runtimeTotalSuccess,
      runtimeLastSuccessAt: firstProbe.runtimeLastSuccessAt,
      hasHistoricalHermesSuccess: historical,
    };
  }

  if (!autoStartLocal || !isLocalHermesEndpoint(endpoint)) {
    const historical = firstProbe.runtimeTotalSuccess > 0 || Boolean(firstProbe.runtimeLastSuccessAt);
    return {
      enabled: true,
      hasEndpoint: true,
      attemptedStart: false,
      daemonStarted: false,
      reachable: false,
      detail: !autoStartLocal ? "probe_unreachable_no_autostart" : "probe_unreachable_remote_endpoint",
      probeStatus: firstProbe.status,
      runtimeTotalSuccess: firstProbe.runtimeTotalSuccess,
      runtimeLastSuccessAt: firstProbe.runtimeLastSuccessAt,
      hasHistoricalHermesSuccess: historical,
    };
  }

  let daemonStarted = false;
  try {
    execFileSync("pnpm", ["hermes:daemon:start"], {
      cwd,
      stdio: "ignore",
    });
    daemonStarted = true;
    logger?.("pnpm hermes:daemon:start issued");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.(`pnpm hermes:daemon:start failed (non-blocking): ${message.split("\n")[0]}`);
  }

  const reprobe = await probeHermesRuntime({ apiBase, headers });
  const historical = reprobe.runtimeTotalSuccess > 0 || Boolean(reprobe.runtimeLastSuccessAt);
  return {
    enabled: true,
    hasEndpoint: true,
    attemptedStart: true,
    daemonStarted,
    reachable: reprobe.reachable,
    detail: reprobe.reachable ? "started_and_reachable" : "started_but_unreachable",
    probeStatus: reprobe.status,
    runtimeTotalSuccess: reprobe.runtimeTotalSuccess,
    runtimeLastSuccessAt: reprobe.runtimeLastSuccessAt,
    hasHistoricalHermesSuccess: historical,
  };
}
