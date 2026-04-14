import { asRecord, asRecordArray, normalizeText } from "./types.js";

export type HermesStageRunResult = {
  body: string;
  thinkingSummary: string;
  model: string;
  provider: string;
  artifacts: Array<Record<string, unknown>>;
  raw: Record<string, unknown>;
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
    return null;
  }
  if (!stageShouldUseHermes(input.stageKey)) {
    return null;
  }

  const endpoint = resolveHermesEndpoint();
  if (!endpoint) {
    return null;
  }

  const timeoutMs = Math.max(1000, Number(process.env.WORKFLOW_V2_HERMES_TIMEOUT_MS ?? 20_000));
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
      return null;
    }
    const json = asRecord(await response.json());
    if (!json) {
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
      return null;
    }
    const summary = normalizeText(input.summary) || `stage ${input.stageKey}`;

    return {
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
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
