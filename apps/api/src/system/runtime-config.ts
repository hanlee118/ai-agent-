import type {
  RuntimeMode,
  RuntimeSettings,
  RuntimeSettingsInput,
  RuntimeStatus,
  RuntimeValidationResult,
  RuntimeValidationStatus
} from "@occ/shared";
import { prisma } from "../db.js";
import { decryptSecret, encryptSecret } from "../security/secret-store.js";
import { URL } from "node:url";
import { buildOpenAiCompatibleHeaders } from "../utils/openai-compatible-headers.js";

const SYSTEM_CONFIG_ID = "default";

type SystemConfigRecord = Awaited<ReturnType<typeof prisma.systemConfig.findUniqueOrThrow>>;

export async function ensureSystemConfig() {
  const existing = await prisma.systemConfig.findUnique({
    where: { id: SYSTEM_CONFIG_ID }
  });

  if (existing) {
    return existing;
  }

  const bootstrap = readBootstrapConfig();
  return prisma.systemConfig.create({
    data: {
      id: SYSTEM_CONFIG_ID,
      provider: bootstrap.provider,
      apiBaseUrl: bootstrap.apiBaseUrl,
      apiKey: await encryptSecret(bootstrap.apiKey),
      modelName: bootstrap.modelName,
      configSource: bootstrap.configSource
    }
  });
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  return toRuntimeSettings(await ensureSystemConfig());
}

export async function updateRuntimeSettings(input: RuntimeSettingsInput): Promise<RuntimeSettings> {
  const current = await ensureSystemConfig();
  const currentApiKey = await decryptSecret(current.apiKey);
  const nextProvider = input.provider;
  const nextApiBaseUrl = sanitizeUrl(input.apiBaseUrl ?? current.apiBaseUrl);
  const nextModelName = (input.modelName ?? current.modelName).trim();
  const providedApiKey = input.apiKey?.trim();
  const nextApiKey = input.clearApiKey ? "" : providedApiKey ? providedApiKey : currentApiKey;
  const hasMaterialChange =
    nextProvider !== current.provider ||
    nextApiBaseUrl !== current.apiBaseUrl ||
    nextModelName !== current.modelName ||
    nextApiKey !== currentApiKey;

  const updated = await prisma.systemConfig.update({
    where: { id: SYSTEM_CONFIG_ID },
    data: {
      provider: nextProvider,
      apiBaseUrl: nextApiBaseUrl,
      modelName: nextModelName,
      apiKey: await encryptSecret(nextApiKey),
      configSource: "database",
      lastValidatedAt: hasMaterialChange ? null : current.lastValidatedAt,
      lastValidationStatus: hasMaterialChange ? "unknown" : current.lastValidationStatus,
      lastValidationError: hasMaterialChange ? null : current.lastValidationError
    }
  });

  return toRuntimeSettings(updated);
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  return toRuntimeStatus(await ensureSystemConfig());
}

export async function getResolvedRuntimeExecutionConfig() {
  const config = await ensureSystemConfig();

  return {
    provider: config.provider as RuntimeMode,
    apiBaseUrl: config.apiBaseUrl,
    apiKey: await decryptSecret(config.apiKey),
    modelName: config.modelName,
    status: await toRuntimeStatus(config)
  };
}

export async function validateRuntimeSettings(): Promise<RuntimeValidationResult> {
  const config = await ensureSystemConfig();
  const checkedAt = new Date();
  const runtime = await toRuntimeStatus(config);

  if (config.provider === "scripted") {
    const updated = await prisma.systemConfig.update({
      where: { id: SYSTEM_CONFIG_ID },
      data: {
        lastValidatedAt: checkedAt,
        lastValidationStatus: "healthy",
        lastValidationError: null
      }
    });

    return {
      ok: true,
      checkedAt: checkedAt.toISOString(),
      message: "脚本运行模式无需外部模型校验，当前配置可直接使用。",
      status: "healthy",
      runtime: await toRuntimeStatus(updated)
    };
  }

  if (!runtime.configured) {
    const updated = await prisma.systemConfig.update({
      where: { id: SYSTEM_CONFIG_ID },
      data: {
        lastValidatedAt: checkedAt,
        lastValidationStatus: "failed",
        lastValidationError: "模型配置不完整，请检查 API Base URL、API Key 和模型名。"
      }
    });

    return {
      ok: false,
      checkedAt: checkedAt.toISOString(),
      message: "模型配置不完整，请检查 API Base URL、API Key 和模型名。",
      status: "failed",
      runtime: await toRuntimeStatus(updated)
    };
  }

  try {
    await probeModelEndpoint(config);

    const updated = await prisma.systemConfig.update({
      where: { id: SYSTEM_CONFIG_ID },
      data: {
        lastValidatedAt: checkedAt,
        lastValidationStatus: "healthy",
        lastValidationError: null
      }
    });

    return {
      ok: true,
      checkedAt: checkedAt.toISOString(),
      message: "模型服务连通性校验通过，可以切换到真实运行模式。",
      status: "healthy",
      runtime: await toRuntimeStatus(updated)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "模型服务校验失败";
    const updated = await prisma.systemConfig.update({
      where: { id: SYSTEM_CONFIG_ID },
      data: {
        lastValidatedAt: checkedAt,
        lastValidationStatus: "failed",
        lastValidationError: message
      }
    });

    return {
      ok: false,
      checkedAt: checkedAt.toISOString(),
      message,
      status: "failed",
      runtime: await toRuntimeStatus(updated)
    };
  }
}

function readBootstrapConfig() {
  const provider = process.env.MODEL_PROVIDER === "openai-compatible" ? "openai-compatible" : "scripted";
  const apiBaseUrl = sanitizeUrl(process.env.MODEL_API_BASE_URL ?? "");
  const apiKey = (process.env.MODEL_API_KEY ?? "").trim();
  const modelName = (process.env.MODEL_NAME ?? "").trim();
  const configSource =
    provider === "scripted" && !apiBaseUrl && !apiKey && !modelName ? "default" : "environment";

  return {
    provider,
    apiBaseUrl,
    apiKey,
    modelName,
    configSource
  } as const;
}

async function toRuntimeSettings(config: SystemConfigRecord): Promise<RuntimeSettings> {
  const decryptedApiKey = await decryptSecret(config.apiKey);

  return {
    provider: config.provider as RuntimeMode,
    apiBaseUrl: config.apiBaseUrl,
    modelName: config.modelName,
    apiKeyConfigured: Boolean(decryptedApiKey),
    apiKeyPreview: maskApiKey(decryptedApiKey),
    updatedAt: config.updatedAt.toISOString(),
    lastValidatedAt: config.lastValidatedAt?.toISOString(),
    lastValidationStatus: config.lastValidationStatus as RuntimeValidationStatus,
    lastValidationError: config.lastValidationError
  };
}

async function toRuntimeStatus(config: SystemConfigRecord): Promise<RuntimeStatus> {
  const requestedMode = config.provider as RuntimeMode;
  const decryptedApiKey = await decryptSecret(config.apiKey);
  const apiKeyConfigured = Boolean(decryptedApiKey);
  const configured =
    requestedMode === "scripted" ||
    Boolean(config.apiBaseUrl.trim() && config.modelName.trim() && decryptedApiKey.trim());
  const mode = requestedMode === "openai-compatible" && configured ? "openai-compatible" : "scripted";

  return {
    mode,
    requestedMode,
    modelName: config.modelName || "scripted-agent",
    configured,
    apiBaseUrl: config.apiBaseUrl,
    apiKeyConfigured,
    configSource: config.configSource as RuntimeStatus["configSource"],
    lastValidatedAt: config.lastValidatedAt?.toISOString(),
    lastValidationStatus: config.lastValidationStatus as RuntimeValidationStatus,
    lastValidationError: config.lastValidationError
  };
}

async function probeModelEndpoint(config: SystemConfigRecord) {
  const apiKey = await decryptSecret(config.apiKey);
  const apiBaseUrl = sanitizeUrl(config.apiBaseUrl);
  const modelName = String(config.modelName ?? "").trim();

  const modelsProbe = await probeModelsEndpoint(apiBaseUrl, apiKey);
  if (modelsProbe.ok) {
    return;
  }

  // 某些 OpenAI 兼容网关不提供 /models，改用最小 chat/completions 探针兜底。
  if ((modelsProbe.reason === "network" || modelsProbe.reason === "unsupported") && modelName) {
    const chatProbe = await probeChatCompletionsEndpoint({
      apiBaseUrl,
      apiKey,
      modelName
    });
    if (chatProbe.ok) {
      return;
    }
    throw new Error(chatProbe.error);
  }

  throw new Error(modelsProbe.error);
}

function buildModelsUrl(apiBaseUrl: string) {
  const sanitizedBaseUrl = sanitizeUrl(apiBaseUrl);
  if (!sanitizedBaseUrl) {
    throw new Error("API Base URL 不能为空");
  }
  return `${sanitizedBaseUrl}/models`;
}

function buildModelsProbeUrls(apiBaseUrl: string) {
  const sanitizedBaseUrl = sanitizeUrl(apiBaseUrl);
  if (!sanitizedBaseUrl) {
    throw new Error("API Base URL 不能为空");
  }
  const candidates = [buildModelsUrl(sanitizedBaseUrl)];
  if (!/\/v\d+$/i.test(sanitizedBaseUrl)) {
    candidates.push(`${sanitizedBaseUrl}/v1/models`);
  }
  return [...new Set(candidates)];
}

function buildChatCompletionsUrl(apiBaseUrl: string) {
  const sanitizedBaseUrl = sanitizeUrl(apiBaseUrl);
  if (!sanitizedBaseUrl) {
    throw new Error("API Base URL 不能为空");
  }
  if (/\/chat\/completions$/i.test(sanitizedBaseUrl)) {
    return sanitizedBaseUrl;
  }
  return `${sanitizedBaseUrl}/chat/completions`;
}

function normalizeProbeModelName(name: string) {
  const normalized = String(name ?? "").trim();
  if (normalized.startsWith("openai/")) {
    return normalized.slice("openai/".length);
  }
  return normalized;
}

function requiresStreamProbe(model: string) {
  const normalized = String(model ?? "").trim().toLowerCase();
  return normalized.startsWith("openai/gpt-5.4")
    || normalized.startsWith("gpt-5.4")
    || normalized.startsWith("openai/gpt-5.3-codex")
    || normalized.startsWith("gpt-5.3-codex");
}

async function readProbeError(response: Response) {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string };
      message?: string;
    };
    return String(parsed.error?.message ?? parsed.message ?? raw).trim();
  } catch {
    return String(raw).trim();
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`请求超时（>${timeoutMs}ms）`);
    }
    if (error instanceof Error) {
      throw new Error(error.message || "网络请求失败");
    }
    throw new Error("网络请求失败");
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeModelsEndpoint(apiBaseUrl: string, apiKey: string) {
  const urls = buildModelsProbeUrls(apiBaseUrl);
  const retryDelays = [0, 400, 900];
  let lastNetworkError = "";
  let unsupported = false;

  for (const url of urls) {
    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      if (attempt > 0) {
        await sleep(retryDelays[attempt]);
      }
      try {
        const response = await fetchWithTimeout(url, {
          method: "GET",
          headers: buildOpenAiCompatibleHeaders({
            apiBaseUrl,
            apiKey
          })
        }, 10_000);

        if (response.ok) {
          await response.text();
          return { ok: true as const, reason: "ok" as const, error: "" };
        }

        const message = await readProbeError(response);
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false as const,
            reason: "auth" as const,
            error: `模型服务鉴权失败（${response.status}）：${message || "请检查 API Key 与网关权限"}`
          };
        }
        if (response.status === 404 || response.status === 405 || response.status === 501) {
          unsupported = true;
          continue;
        }
        return {
          ok: false as const,
          reason: "upstream" as const,
          error: `模型服务返回 ${response.status}：${message || "请检查地址、密钥和网关配置"}`
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastNetworkError = message || "网络请求失败";
      }
    }
  }

  if (lastNetworkError) {
    return {
      ok: false as const,
      reason: "network" as const,
      error: `模型服务连通性检查失败：${lastNetworkError}`
    };
  }

  if (unsupported) {
    return {
      ok: false as const,
      reason: "unsupported" as const,
      error: "当前网关不支持 /models 探针，已尝试候选地址。"
    };
  }

  return {
    ok: false as const,
    reason: "unknown" as const,
    error: "模型服务校验失败，请检查网关配置。"
  };
}

async function probeChatCompletionsEndpoint(input: {
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
}) {
  const endpoint = buildChatCompletionsUrl(input.apiBaseUrl);
  const request = async (stream: boolean) => {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: buildOpenAiCompatibleHeaders({
        apiBaseUrl: input.apiBaseUrl,
        apiKey: input.apiKey,
        json: true
      }),
      body: JSON.stringify({
        model: normalizeProbeModelName(input.modelName),
        temperature: 0,
        max_tokens: 16,
        stream,
        messages: [{ role: "user", content: "Reply with OK only." }]
      })
    }, 12_000);
    return response;
  };

  try {
    let stream = requiresStreamProbe(input.modelName);
    let response = await request(stream);
    if (!response.ok) {
      const message = await readProbeError(response);
      if (!stream && /stream must be set to true/i.test(message)) {
        stream = true;
        response = await request(stream);
      } else if (stream && /stream/i.test(message)) {
        stream = false;
        response = await request(stream);
      } else {
        return {
          ok: false as const,
          error: `模型服务校验失败（chat/completions ${response.status}）：${message || "请求失败"}`
        };
      }
    }

    if (!response.ok) {
      const message = await readProbeError(response);
      return {
        ok: false as const,
        error: `模型服务校验失败（chat/completions ${response.status}）：${message || "请求失败"}`
      };
    }

    await response.text();
    return { ok: true as const, error: "" };
  } catch (error) {
    return {
      ok: false as const,
      error: `模型服务连通性检查失败：${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function sanitizeUrl(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) {
    return "";
  }

  // 验证URL安全性
  validateUrlSafety(trimmed);
  return trimmed;
}

function validateUrlSafety(urlString: string) {
  if (!urlString) {
    return;
  }

  let url: URL;
  try {
    url = new URL(urlString);
  } catch (error) {
    throw new Error("无效的URL格式");
  }

  // 仅允许 http 和 https 协议
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("仅允许 HTTP 和 HTTPS 协议");
  }

  // 检查是否为内网 IP
  const hostname = url.hostname;
  if (isPrivateIP(hostname)) {
    throw new Error("不允许访问内网地址");
  }
}

function isPrivateIP(hostname: string): boolean {
  // IPv4 私有网段
  const ipv4Patterns = [
    /^127\./,                    // 127.0.0.0/8 (localhost)
    /^10\./,                     // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./,               // 192.168.0.0/16
    /^169\.254\./,               // 169.254.0.0/16 (link-local)
    /^0\./                       // 0.0.0.0/8
  ];

  // 检查 IPv4
  for (const pattern of ipv4Patterns) {
    if (pattern.test(hostname)) {
      return true;
    }
  }

  // 检查本地主机名
  const forbiddenHosts = ["localhost", "0.0.0.0"];
  if (forbiddenHosts.includes(hostname.toLowerCase())) {
    return true;
  }

  // 检查 IPv6 本地地址
  if (hostname === "::1" || hostname.startsWith("::ffff:127.") || hostname.startsWith("fe80:")) {
    return true;
  }

  return false;
}

function maskApiKey(value: string) {
  if (!value) {
    return "未配置";
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}****`;
  }

  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
