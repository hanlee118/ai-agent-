type Sample = {
  ts: number;
  durationMs: number;
  statusCode: number;
  bytes: number;
};

type RouteStats = {
  route: string;
  count: number;
  errorCount: number;
  p50: number;
  p95: number;
  p99: number;
  avgMs: number;
  maxMs: number;
  avgBytes: number;
};

const WINDOW_MS = Math.max(60_000, Number(process.env.PERF_MONITOR_WINDOW_MS ?? 3_600_000));
const ALERT_COOLDOWN_MS = Math.max(30_000, Number(process.env.PERF_ALERT_COOLDOWN_MS ?? 60_000));
const P95_ALERT_MS = Math.max(300, Number(process.env.PERF_ALERT_P95_MS ?? 1200));
const ERROR_RATE_ALERT = Math.max(0.001, Number(process.env.PERF_ALERT_ERROR_RATE ?? 0.01));

const routeBuckets = new Map<string, Sample[]>();
const lastAlertAt = new Map<string, number>();

function quantile(sortedValues: number[], q: number) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(q * (sortedValues.length - 1))));
  return sortedValues[idx] || 0;
}

function trimWindow(now: number) {
  const minTs = now - WINDOW_MS;
  for (const [route, samples] of routeBuckets.entries()) {
    const next = samples.filter((item) => item.ts >= minTs);
    if (next.length === 0) {
      routeBuckets.delete(route);
    } else {
      routeBuckets.set(route, next);
    }
  }
}

export function trackRequestSample(input: {
  route: string;
  durationMs: number;
  statusCode: number;
  bytes: number;
}) {
  const now = Date.now();
  trimWindow(now);
  const route = String(input.route || "/unknown");
  const samples = routeBuckets.get(route) || [];
  samples.push({
    ts: now,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    statusCode: Math.max(100, Math.floor(input.statusCode)),
    bytes: Math.max(0, Math.floor(input.bytes))
  });
  routeBuckets.set(route, samples);

  const stats = getRouteStats(route);
  if (!stats) {
    return;
  }
  const errorRate = stats.count > 0 ? stats.errorCount / stats.count : 0;
  const shouldAlert = stats.p95 >= P95_ALERT_MS || errorRate >= ERROR_RATE_ALERT;
  if (!shouldAlert) {
    return;
  }
  const key = `${route}`;
  const last = lastAlertAt.get(key) || 0;
  if (now - last < ALERT_COOLDOWN_MS) {
    return;
  }
  lastAlertAt.set(key, now);
  console.warn("[PERF_ALERT]", JSON.stringify({
    route,
    p95: stats.p95,
    p99: stats.p99,
    errorRate: Number(errorRate.toFixed(4)),
    count: stats.count,
    windowMs: WINDOW_MS
  }));
}

function getRouteStats(route: string): RouteStats | null {
  const samples = routeBuckets.get(route) || [];
  if (samples.length === 0) {
    return null;
  }
  const durations = samples.map((item) => item.durationMs).sort((a, b) => a - b);
  const bytes = samples.map((item) => item.bytes);
  const count = samples.length;
  const errorCount = samples.filter((item) => item.statusCode >= 500).length;
  const avgMs = Math.round(durations.reduce((acc, cur) => acc + cur, 0) / Math.max(1, count));
  const avgBytes = Math.round(bytes.reduce((acc, cur) => acc + cur, 0) / Math.max(1, count));
  return {
    route,
    count,
    errorCount,
    p50: quantile(durations, 0.5),
    p95: quantile(durations, 0.95),
    p99: quantile(durations, 0.99),
    avgMs,
    maxMs: durations[durations.length - 1] || 0,
    avgBytes
  };
}

export function getPerformanceSummary() {
  const now = Date.now();
  trimWindow(now);
  const routes = Array.from(routeBuckets.keys())
    .map((route) => getRouteStats(route))
    .filter((item): item is RouteStats => Boolean(item))
    .sort((a, b) => b.p95 - a.p95);

  return {
    generatedAt: new Date(now).toISOString(),
    windowMs: WINDOW_MS,
    thresholds: {
      p95AlertMs: P95_ALERT_MS,
      errorRateAlert: ERROR_RATE_ALERT
    },
    routes
  };
}
