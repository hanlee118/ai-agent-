export const DESIGN_MODEL_PRIMARY = "openai/gpt-5.4";

export const DESIGN_MODEL_FALLBACKS = [
  "openai/gpt-5.3-codex",
  "kimi-k2.5"
] as const;

export const DESIGN_MODEL_POLICY_CHAIN = [
  DESIGN_MODEL_PRIMARY,
  ...DESIGN_MODEL_FALLBACKS,
  "qwen3-coder-plus",
  "anthropic/claude-sonnet-4-20250514",
  "MiniMax-M2.7-highspeed"
] as const;

export function normalizeModelIdForPolicy(value?: string | null) {
  return String(value ?? "").trim();
}

export function isDesignModelPreferred(model: string) {
  const normalized = normalizeModelIdForPolicy(model);
  return normalized === DESIGN_MODEL_PRIMARY
    || normalized === DESIGN_MODEL_PRIMARY.replace(/^openai\//, "");
}

