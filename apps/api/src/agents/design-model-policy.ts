const DEFAULT_DESIGN_MODEL_PRIMARY = "anthropic/claude-opus-4-6";
const DEFAULT_DESIGN_MODEL_FALLBACKS = [
  "anthropic/claude-sonnet-4-6",
  "openai/gpt-5.4",
  "openai/gpt-5.3-codex"
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

export const DESIGN_MODEL_POLICY_CHAIN: readonly string[] = [
  DESIGN_MODEL_PRIMARY,
  ...DESIGN_MODEL_FALLBACKS,
  "qwen3-coder-plus"
];

export function normalizeModelIdForPolicy(value?: string | null) {
  return String(value ?? "").trim();
}

export function isDesignModelPreferred(model: string) {
  const normalized = normalizeModelIdForPolicy(model);
  return normalized === DESIGN_MODEL_PRIMARY
    || normalized === DESIGN_MODEL_PRIMARY.replace(/^openai\//, "")
    || normalized === DESIGN_MODEL_PRIMARY.replace(/^anthropic\//, "");
}
