const DEFAULT_DESIGN_MODEL_PRIMARY = "openai/gpt-5.4";
const DEFAULT_DESIGN_MODEL_FALLBACKS = [
  "openai/gpt-5.3-codex",
  "qwen3.5-plus",
  "qwen3-max-2026-01-23",
  "qwen3-coder-plus",
  "kimi-k2.5",
  "minima/MiniMax-M2.7-highspeed",
  "glm-5"
];

function parseModelCsv(value?: string | null) {
  return String(value ?? "")
    .split(",")
    .map((item) => String(item ?? "").trim())
    .filter((item) => Boolean(item));
}

export const DESIGN_MODEL_PRIMARY =
  normalizeModelIdForPolicy(process.env.DESIGN_MODEL_PRIMARY) || DEFAULT_DESIGN_MODEL_PRIMARY;

export const DESIGN_MODEL_FALLBACKS: readonly string[] = (() => {
  const configured = parseModelCsv(process.env.DESIGN_MODEL_FALLBACKS);
  if (configured.length > 0) {
    return configured;
  }
  return DEFAULT_DESIGN_MODEL_FALLBACKS;
})();

export const DESIGN_MODEL_POLICY_CHAIN: readonly string[] = (() => {
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const model of [DESIGN_MODEL_PRIMARY, ...DESIGN_MODEL_FALLBACKS]) {
    const normalized = normalizeModelIdForPolicy(model);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    chain.push(normalized);
  }
  return chain;
})();

export function normalizeModelIdForPolicy(value?: string | null) {
  return String(value ?? "").trim();
}

export function isDesignModelPreferred(model: string) {
  const normalized = normalizeModelIdForPolicy(model);
  return normalized === DESIGN_MODEL_PRIMARY
    || normalized === DESIGN_MODEL_PRIMARY.replace(/^openai\//, "")
    || normalized === DESIGN_MODEL_PRIMARY.replace(/^anthropic\//, "");
}
