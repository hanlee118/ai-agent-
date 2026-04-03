export const DESIGN_MODEL_PRIMARY = "anthropic/claude-opus-4-20250514";

export const DESIGN_MODEL_FALLBACKS = [
  "anthropic/claude-sonnet-4-20250514",
  "openai/gpt-5.4",
  "openai/gpt-5.3-codex"
] as const;

export const DESIGN_MODEL_POLICY_CHAIN = [
  DESIGN_MODEL_PRIMARY,
  ...DESIGN_MODEL_FALLBACKS,
  "qwen3-coder-plus"
] as const;

export function normalizeModelIdForPolicy(value?: string | null) {
  return String(value ?? "").trim();
}

export function isDesignModelPreferred(model: string) {
  const normalized = normalizeModelIdForPolicy(model);
  return normalized === DESIGN_MODEL_PRIMARY
    || normalized === DESIGN_MODEL_PRIMARY.replace(/^openai\//, "")
    || normalized === DESIGN_MODEL_PRIMARY.replace(/^anthropic\//, "");
}
