import { asRecord, asRecordArray, normalizeText } from "./types.js";

export type HermesStageRunResult = {
  body: string;
  thinkingSummary: string;
  model: string;
  provider: string;
  artifacts: Array<Record<string, unknown>>;
  raw: Record<string, unknown>;
};

export type HermesMcpRuntimeStatus = {
  enabled: boolean;
  endpoint: string;
  stageMatchMode: string;
  timeoutMs: number;
  lastStageKey: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  lastSkipReason: string | null;
  totalAttempts: number;
  totalSuccess: number;
  totalFailures: number;
};

export type HermesMcpProbeStatus = {
  state: "disabled" | "endpoint_missing" | "skipped" | "reachable" | "unreachable";
  reachable: boolean | null;
  statusCode: number | null;
  latencyMs: number;
  message: string;
};

const hermesRuntimeState: HermesMcpRuntimeStatus = {
  enabled: false,
  endpoint: "",
  stageMatchMode: "design",
  timeoutMs: 20_000,
  lastStageKey: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureReason: null,
  lastSkipReason: null,
  totalAttempts: 0,
  totalSuccess: 0,
  totalFailures: 0
};

function resolveHermesEnabledDefault() {
  if (process.env.NODE_ENV === "test") {
    return false;
  }
  return true;
}

function isHermesEnabled() {
  const raw = String(process.env.WORKFLOW_V2_HERMES_ENABLED ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "on") {
    return true;
  }
  if (raw === "false" || raw === "0" || raw === "off") {
    return false;
  }
  return resolveHermesEnabledDefault();
}

function resolveHermesEndpoint() {
  const raw = normalizeText(process.env.WORKFLOW_V2_HERMES_ENDPOINT)
    || normalizeText(process.env.HERMES_MCP_ENDPOINT)
    || normalizeText(process.env.HERMES_MCP)
    || "";
  if (!raw) {
    return "";
  }
  const base = raw.replace(/\/$/, "");
  if (base.endsWith("/mcp")) {
    return `${base}/execute`;
  }
  if (base.endsWith("/mcp/execute")) {
    return base;
  }
  return `${base}/mcp/execute`;
}

function stageShouldUseHermes(stageKey: string) {
  const mode = normalizeText(process.env.WORKFLOW_V2_HERMES_STAGE_MATCH || "design").toLowerCase();
  if (mode === "none") {
    return false;
  }
  if (mode === "all") {
    return true;
  }
  const normalized = normalizeText(stageKey).toLowerCase();
  return (
    normalized.includes("design")
    || normalized.includes("visual")
    || normalized.includes("ux")
    || normalized.includes("ui")
    || normalized.includes("视觉")
  );
}

function resolveHermesStageMatchMode() {
  return normalizeText(process.env.WORKFLOW_V2_HERMES_STAGE_MATCH || "design").toLowerCase() || "design";
}

function resolveHermesTimeoutMs() {
  return Math.max(1000, Number(process.env.WORKFLOW_V2_HERMES_TIMEOUT_MS ?? 20_000));
}

function trackHermesSkip(stageKey: string, reason: string) {
  hermesRuntimeState.enabled = isHermesEnabled();
  hermesRuntimeState.endpoint = resolveHermesEndpoint();
  hermesRuntimeState.stageMatchMode = resolveHermesStageMatchMode();
  hermesRuntimeState.timeoutMs = resolveHermesTimeoutMs();
  hermesRuntimeState.lastStageKey = stageKey || null;
  hermesRuntimeState.lastSkipReason = reason;
}

function trackHermesAttempt(stageKey: string) {
  hermesRuntimeState.enabled = isHermesEnabled();
  hermesRuntimeState.endpoint = resolveHermesEndpoint();
  hermesRuntimeState.stageMatchMode = resolveHermesStageMatchMode();
  hermesRuntimeState.timeoutMs = resolveHermesTimeoutMs();
  hermesRuntimeState.lastStageKey = stageKey || null;
  hermesRuntimeState.lastAttemptAt = new Date().toISOString();
  hermesRuntimeState.lastSkipReason = null;
  hermesRuntimeState.totalAttempts += 1;
}

function trackHermesFailure(reason: string) {
  hermesRuntimeState.lastFailureAt = new Date().toISOString();
  hermesRuntimeState.lastFailureReason = reason;
  hermesRuntimeState.totalFailures += 1;
}

function trackHermesSuccess() {
  hermesRuntimeState.lastSuccessAt = new Date().toISOString();
  hermesRuntimeState.lastFailureReason = null;
  hermesRuntimeState.totalSuccess += 1;
}

export function getHermesMcpRuntimeStatus(): HermesMcpRuntimeStatus {
  return {
    ...hermesRuntimeState,
    enabled: isHermesEnabled(),
    endpoint: resolveHermesEndpoint(),
    stageMatchMode: resolveHermesStageMatchMode(),
    timeoutMs: resolveHermesTimeoutMs()
  };
}

export async function probeHermesMcpEndpoint() {
  if (!isHermesEnabled()) {
    return {
      state: "disabled",
      reachable: null,
      statusCode: null,
      latencyMs: 0,
      message: "hermes_disabled"
    } satisfies HermesMcpProbeStatus;
  }

  const endpoint = resolveHermesEndpoint();
  if (!endpoint) {
    return {
      state: "endpoint_missing",
      reachable: null,
      statusCode: null,
      latencyMs: 0,
      message: "endpoint_missing"
    } satisfies HermesMcpProbeStatus;
  }
  const endpointUrl = new URL(endpoint);
  const healthUrl = `${endpointUrl.protocol}//${endpointUrl.host}/health`;
  const startedAt = Date.now();
  try {
    const response = await fetch(healthUrl, {
      method: "GET"
    });
    const latencyMs = Math.max(0, Date.now() - startedAt);
    return {
      state: response.ok ? "reachable" : "unreachable",
      reachable: response.ok,
      statusCode: response.status,
      latencyMs,
      message: response.ok ? "ok" : `http_${response.status}`
    } satisfies HermesMcpProbeStatus;
  } catch (error) {
    return {
      state: "unreachable",
      reachable: false,
      statusCode: null,
      latencyMs: Math.max(0, Date.now() - startedAt),
      message: error instanceof Error ? error.message : String(error)
    } satisfies HermesMcpProbeStatus;
  }
}

function asHermesArtifactList(value: unknown) {
  return asRecordArray(value)
    .map((item) => ({
      name: normalizeText(item.name) || "artifact",
      type: normalizeText(item.type) || "text",
      format: normalizeText(item.format) || "markdown",
      content: String(item.content ?? "")
    }))
    .filter((item) => item.content.trim().length > 0);
}

function toRunBody(input: {
  stageKey: string;
  summary: string;
  resolution?: string;
  textualOutput?: string;
  artifacts: Array<{ name: string; type: string; format: string; content: string }>;
}) {
  const lines: string[] = [
    `## Hermes 执行摘要`,
    `- stage: ${input.stageKey}`,
    `- summary: ${input.summary}`
  ];
  if (input.resolution) {
    lines.push(`- resolution: ${input.resolution}`);
  }
  if (input.textualOutput) {
    lines.push("", "## Hermes 输出", input.textualOutput);
  }
  for (const artifact of input.artifacts) {
    lines.push("", `### ${artifact.name} (${artifact.type}/${artifact.format})`, artifact.content);
  }
  return lines.join("\n");
}

export async function tryRunStageWithHermes(input: {
  stageId: string;
  stageKey: string;
  projectId: string;
  summary: string;
  context: string;
  previousOutputs: Array<Record<string, unknown>>;
  expectedSkills?: string[];
}): Promise<HermesStageRunResult | null> {
  if (!isHermesEnabled()) {
    trackHermesSkip(input.stageKey, "disabled");
    return null;
  }
  if (!stageShouldUseHermes(input.stageKey)) {
    trackHermesSkip(input.stageKey, "stage_not_matched");
    return null;
  }

  const endpoint = resolveHermesEndpoint();
  if (!endpoint) {
    trackHermesSkip(input.stageKey, "endpoint_missing");
    return null;
  }

  trackHermesAttempt(input.stageKey);
  const timeoutMs = resolveHermesTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const apiKey = normalizeText(process.env.HERMES_MCP_API_KEY || "");
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (apiKey) {
    headers["x-hermes-api-key"] = apiKey;
  }

  const payload = {
    task: input.summary,
    stageId: input.stageId,
    templateKey: input.stageKey,
    inputs: input.previousOutputs,
    soulMd: `Project: ${input.projectId}`,
    memoryMd: `Project: ${input.projectId}\n\n${input.context.slice(0, 6000)}`,
    skills: (input.expectedSkills ?? []).map((skillKey) => ({ skillKey })),
    enableSelfEvaluation: true
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      trackHermesFailure(`http_${response.status}`);
      return null;
    }
    const json = asRecord(await response.json());
    if (!json) {
      trackHermesFailure("invalid_json");
      return null;
    }

    const success = Boolean(json.success ?? true);
    const artifacts = asHermesArtifactList(json.artifacts);
    const resolution = normalizeText(json.resolution);
    const textualOutput = normalizeText(
      json.output
      ?? json.answer
      ?? json.finalAnswer
      ?? json.content
      ?? json.message
      ?? ""
    );
    if (!success || (artifacts.length === 0 && !resolution && !textualOutput)) {
      trackHermesFailure("empty_payload");
      return null;
    }
    const summary = normalizeText(input.summary) || `stage ${input.stageKey}`;

    const result = {
      body: toRunBody({
        stageKey: input.stageKey,
        summary,
        resolution,
        textualOutput,
        artifacts
      }),
      thinkingSummary: resolution || textualOutput || `Hermes completed ${input.stageKey} with ${artifacts.length} artifacts`,
      model: normalizeText(json.model) || "hermes-v2.1",
      provider: "hermes-mcp",
      artifacts: artifacts.map((item) => ({
        name: item.name,
        type: item.type,
        format: item.format,
        content: item.content
      })),
      raw: json
    };
    trackHermesSuccess();
    return result;
  } catch {
    trackHermesFailure("request_failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
