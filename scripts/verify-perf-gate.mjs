#!/usr/bin/env node
import process from "node:process";

const API_BASE = String(process.env.PERF_GATE_API_BASE || "http://127.0.0.1:8787").replace(/\/+$/, "");
const PASSWORD = String(process.env.PERF_GATE_ADMIN_PASSWORD || "Admin@123456");
const ROUNDS = Math.max(2, Number(process.env.PERF_GATE_ROUNDS || 3));
const P95_THRESHOLD_MS = Math.max(100, Number(process.env.PERF_GATE_P95_MS || 1200));
const ERROR_RATE_THRESHOLD = Math.max(0, Number(process.env.PERF_GATE_ERROR_RATE || 0.01));

const TARGETS = [
  "/api/projects?page=1&pageSize=20",
  "/api/v1/knowledge?page=1&pageSize=20",
  "/api/notifications?page=1&pageSize=20",
  "/api/system/audit-logs?page=1&pageSize=20",
  "/api/product-context?page=1&pageSize=20"
];

async function loginAndGetCookie() {
  let res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD })
  });
  if (res.status === 428 || res.status === 401) {
    const setupRes = await fetch(`${API_BASE}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD })
    });
    if (!setupRes.ok && setupRes.status !== 409) {
      throw new Error(`auth setup failed: ${setupRes.status}`);
    }
    res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD })
    });
  }
  if (!res.ok) {
    throw new Error(`login failed: ${res.status}`);
  }
  const setCookie = res.headers.get("set-cookie") || "";
  const token = setCookie.split(";")[0] || "";
  if (!token) {
    throw new Error("missing session cookie");
  }
  return token;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx] || 0;
}

async function timedRequest(path, cookie) {
  const start = performance.now();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { cookie }
  });
  const text = await res.text();
  const end = performance.now();
  return {
    ok: res.ok,
    status: res.status,
    ms: end - start,
    bytes: Buffer.byteLength(text, "utf8")
  };
}

async function main() {
  const cookie = await loginAndGetCookie();
  const results = new Map();
  for (const target of TARGETS) {
    results.set(target, []);
  }

  for (let round = 0; round < ROUNDS; round += 1) {
    for (const target of TARGETS) {
      const result = await timedRequest(target, cookie);
      results.get(target).push(result);
    }
  }

  const summary = [];
  let failed = false;
  for (const target of TARGETS) {
    const samples = results.get(target) || [];
    const durations = samples.map((item) => item.ms);
    const p95 = percentile(durations, 95);
    const errorCount = samples.filter((item) => !item.ok).length;
    const errorRate = samples.length > 0 ? errorCount / samples.length : 0;
    const avgBytes = Math.round(samples.reduce((acc, cur) => acc + cur.bytes, 0) / Math.max(1, samples.length));
    summary.push({
      target,
      count: samples.length,
      p95Ms: Number(p95.toFixed(2)),
      errorRate: Number(errorRate.toFixed(4)),
      avgBytes
    });
    if (p95 > P95_THRESHOLD_MS || errorRate > ERROR_RATE_THRESHOLD) {
      failed = true;
    }
  }

  console.log("[PERF_GATE]", JSON.stringify({
    apiBase: API_BASE,
    rounds: ROUNDS,
    p95ThresholdMs: P95_THRESHOLD_MS,
    errorRateThreshold: ERROR_RATE_THRESHOLD,
    summary
  }, null, 2));

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[PERF_GATE_ERROR]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
