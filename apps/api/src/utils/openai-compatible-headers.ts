import { URL } from "node:url";

function normalizeBaseUrl(value: string) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function extractHostname(apiBaseUrl: string) {
  const normalized = normalizeBaseUrl(apiBaseUrl);
  if (!normalized) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function resolveOpenAiCompatibleGatewayGroup(apiBaseUrl: string) {
  const explicit = String(
    process.env.OPENAI_COMPAT_GROUP
    ?? process.env.MODEL_API_GROUP
    ?? process.env.UNBOUNDTECH_GATEWAY_GROUP
    ?? ""
  ).trim();
  if (explicit) {
    return explicit;
  }

  const hostname = extractHostname(apiBaseUrl);
  if (hostname === "ai.unboundtech.cn") {
    return "codex";
  }

  return "";
}

export function buildOpenAiCompatibleHeaders(input: {
  apiBaseUrl: string;
  apiKey: string;
  json?: boolean;
  extra?: Record<string, string>;
}) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`
  };
  if (input.json) {
    headers["Content-Type"] = "application/json";
  }

  const group = resolveOpenAiCompatibleGatewayGroup(input.apiBaseUrl);
  if (group) {
    headers["X-Group"] = group;
  }

  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (typeof value === "string" && value.trim()) {
      headers[key] = value;
    }
  }

  return headers;
}
