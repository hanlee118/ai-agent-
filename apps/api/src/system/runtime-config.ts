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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(buildModelsUrl(config.apiBaseUrl), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`模型服务返回 ${response.status}，请检查地址、密钥和网关配置。`);
    }

    await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function buildModelsUrl(apiBaseUrl: string) {
  return `${sanitizeUrl(apiBaseUrl).replace(/\/$/, "")}/models`;
}

function sanitizeUrl(value: string) {
  return value.trim().replace(/\/$/, "");
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
