import { execFileSync } from "node:child_process";
import { StitchToolClient } from "@google/stitch-sdk";
import type { ParsedIntent } from "@occ/shared";
import type { RoleType, StageType } from "@occ/shared";

export type StitchExecutorMode = "direct";
const STITCH_TRANSPORT_COOLDOWN_MS_DEFAULT = 120_000;
const STITCH_TRANSPORT_COOLDOWN_MS_MIN = 5_000;
const STITCH_TRANSPORT_COOLDOWN_MS_MAX = 30 * 60 * 1000;
const STITCH_TRANSPORT_COOLDOWN_ERROR = "STITCH_TRANSPORT_COOLDOWN_ACTIVE";
let stitchTransportCooldownUntilMs = 0;
let stitchTransportLogFilterInstalled = false;
let stitchTransportOriginalConsoleError: typeof console.error | null = null;
let stitchFetchPatchLock: Promise<void> = Promise.resolve();

export type StitchDesignArtifact = {
  provider: "google-stitch-mcp";
  generatedAt: string;
  projectId: string;
  screenId: string;
  htmlUrl: string;
  imageUrl: string;
  prompt: string;
  executor: StitchExecutorMode;
};

export type StitchDesignPendingArtifact = {
  provider: "google-stitch-mcp";
  requestedAt: string;
  projectId: string;
  prompt: string;
  executor: StitchExecutorMode;
  status: "pending";
};

export type StitchDesignRequestResult =
  | {
      status: "ready";
      artifact: StitchDesignArtifact;
    }
  | {
      status: "pending";
      pending: StitchDesignPendingArtifact;
    };

type StitchGenerateScreenArgs = {
  projectId: string;
  prompt: string;
  deviceType?: string;
  modelId?: string;
};

function normalizeText(value: string, fallback = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim() || fallback;
}

function truncate(value: string, maxLength: number) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildPrompt(input: {
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}) {
  const summary = truncate(input.summary || `${input.projectName} 设计方案`, 200);
  const description = truncate(input.projectDescription, 400);
  const keywords = input.parsedIntent.keywords.slice(0, 8).join(" / ") || "无";
  const constraints = input.parsedIntent.constraints.slice(0, 6).join("；") || "无";
  const risks = input.parsedIntent.risks.slice(0, 6).join("；") || "无";

  return [
    "请生成可落地的产品 UI 设计方案，输出用于桌面端优先。",
    `项目: ${truncate(input.projectName, 80)}`,
    `阶段: ${input.stageType}`,
    `角色: ${input.role}`,
    `目标摘要: ${summary}`,
    `需求描述: ${description}`,
    `关键词: ${keywords}`,
    `约束: ${constraints}`,
    `风险: ${risks}`,
    "设计要求: 必须包含首屏价值主张、核心流程区块、主 CTA、状态反馈（loading/empty/error）、可访问性考量。"
  ].join("\n");
}

function readRequiredEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readOptionalEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

type ProxyEnvSnapshot = {
  HTTP_PROXY?: string;
  HTTPS_PROXY?: string;
  ALL_PROXY?: string;
  NO_PROXY?: string;
};

function readSystemProxyEnv(): ProxyEnvSnapshot {
  const current: ProxyEnvSnapshot = {
    HTTP_PROXY: String(process.env.HTTP_PROXY ?? "").trim() || undefined,
    HTTPS_PROXY: String(process.env.HTTPS_PROXY ?? "").trim() || undefined,
    ALL_PROXY: String(process.env.ALL_PROXY ?? "").trim() || undefined,
    NO_PROXY: String(process.env.NO_PROXY ?? "").trim() || undefined
  };

  if (current.HTTP_PROXY || current.HTTPS_PROXY || current.ALL_PROXY) {
    return current;
  }

  if (process.platform !== "darwin") {
    return current;
  }

  try {
    const raw = execFileSync("scutil", ["--proxy"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const httpEnabled = /\bHTTPEnable\s*:\s*1\b/.test(raw);
    const httpsEnabled = /\bHTTPSEnable\s*:\s*1\b/.test(raw);
    const socksEnabled = /\bSOCKSEnable\s*:\s*1\b/.test(raw);
    const httpHost = raw.match(/\bHTTPProxy\s*:\s*([^\n]+)/)?.[1]?.trim() || "";
    const httpsHost = raw.match(/\bHTTPSProxy\s*:\s*([^\n]+)/)?.[1]?.trim() || "";
    const socksHost = raw.match(/\bSOCKSProxy\s*:\s*([^\n]+)/)?.[1]?.trim() || "";
    const httpPort = raw.match(/\bHTTPPort\s*:\s*(\d+)/)?.[1]?.trim() || "";
    const httpsPort = raw.match(/\bHTTPSPort\s*:\s*(\d+)/)?.[1]?.trim() || "";
    const socksPort = raw.match(/\bSOCKSPort\s*:\s*(\d+)/)?.[1]?.trim() || "";
    const noProxyMatches = [...raw.matchAll(/^\s*\d+\s*:\s*([^\n]+)$/gm)]
      .map((match) => match[1]?.trim())
      .filter(Boolean);

    return {
      HTTP_PROXY: httpEnabled && httpHost && httpPort ? `http://${httpHost}:${httpPort}` : undefined,
      HTTPS_PROXY: httpsEnabled && httpsHost && httpsPort ? `http://${httpsHost}:${httpsPort}` : undefined,
      ALL_PROXY: socksEnabled && socksHost && socksPort ? `socks5://${socksHost}:${socksPort}` : undefined,
      NO_PROXY: noProxyMatches.length > 0 ? noProxyMatches.join(",") : undefined
    };
  } catch {
    return current;
  }
}

export type StitchProxyPlan =
  | {
      mode: "none";
      proxyUrl?: undefined;
      env: ProxyEnvSnapshot;
    }
  | {
      mode: "http";
      proxyUrl: string;
      env: ProxyEnvSnapshot;
    }
  | {
      mode: "socks5";
      proxyUrl: string;
      env: ProxyEnvSnapshot;
    };

export function resolveStitchProxyPlan(proxyEnv: ProxyEnvSnapshot): StitchProxyPlan {
  const httpsProxy = normalizeText(proxyEnv.HTTPS_PROXY || "");
  const httpProxy = normalizeText(proxyEnv.HTTP_PROXY || "");
  const allProxy = normalizeText(proxyEnv.ALL_PROXY || "");

  if (httpsProxy) {
    return {
      mode: "http",
      proxyUrl: httpsProxy,
      env: proxyEnv
    };
  }

  if (httpProxy) {
    return {
      mode: "http",
      proxyUrl: httpProxy,
      env: proxyEnv
    };
  }

  if (/^socks(?:5)?:\/\//i.test(allProxy)) {
    return {
      mode: "socks5",
      proxyUrl: allProxy,
      env: proxyEnv
    };
  }

  if (/^https?:\/\//i.test(allProxy)) {
    return {
      mode: "http",
      proxyUrl: allProxy,
      env: proxyEnv
    };
  }

  return {
    mode: "none",
    env: proxyEnv
  };
}

async function createStitchDispatcher(plan: StitchProxyPlan) {
  if (plan.mode === "none") {
    return null;
  }

  const undiciModuleId = "undici";
  const undici = await import(undiciModuleId) as any;
  if (plan.mode === "http") {
    return new undici.ProxyAgent({
      uri: plan.proxyUrl,
      allowH2: false
    });
  }

  return new undici.Socks5ProxyAgent(plan.proxyUrl, {
    allowH2: false
  });
}

export function isRetryableTransportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_DESTROYED|ClientDestroyedError|other side closed|ECONNRESET|ETIMEDOUT|socket|TimeoutError|aborted due to timeout|request aborted|request timed out/i.test(
    message
  );
}

export function isStitchQuotaExhaustedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /resource has been exhausted|quota|rate limit/i.test(message);
}

export function isStitchTransportCooldownError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(STITCH_TRANSPORT_COOLDOWN_ERROR);
}

function shouldMuteStitchTransportLogs() {
  return String(process.env.STITCH_MUTE_TRANSPORT_ERROR_LOG ?? "true").trim().toLowerCase() !== "false";
}

function isStitchTransportErrorConsolePayload(args: unknown[]) {
  if (!Array.isArray(args) || args.length === 0) {
    return false;
  }
  const first = String(args[0] ?? "");
  return first.includes("Stitch Transport Error:");
}

function installStitchTransportConsoleFilter() {
  if (stitchTransportLogFilterInstalled || !shouldMuteStitchTransportLogs()) {
    return;
  }
  stitchTransportOriginalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (isStitchTransportErrorConsolePayload(args)) {
      return;
    }
    stitchTransportOriginalConsoleError?.(...args);
  };
  stitchTransportLogFilterInstalled = true;
}

async function withMutedStitchTransportConsoleError<T>(run: () => Promise<T>): Promise<T> {
  installStitchTransportConsoleFilter();
  return run();
}

export function __testOnlyInstallStitchTransportConsoleFilter() {
  installStitchTransportConsoleFilter();
}

function resolveStitchTransportCooldownMs() {
  const configured = Number(process.env.STITCH_TRANSPORT_COOLDOWN_MS ?? "");
  if (!Number.isFinite(configured) || configured <= 0) {
    return STITCH_TRANSPORT_COOLDOWN_MS_DEFAULT;
  }
  return Math.max(
    STITCH_TRANSPORT_COOLDOWN_MS_MIN,
    Math.min(STITCH_TRANSPORT_COOLDOWN_MS_MAX, Math.round(configured))
  );
}

export function noteStitchTransportFailure(nowMs = Date.now(), cooldownMs?: number) {
  const effectiveCooldownMs = Number.isFinite(cooldownMs)
    ? Math.max(0, Number(cooldownMs))
    : resolveStitchTransportCooldownMs();
  stitchTransportCooldownUntilMs = Math.max(stitchTransportCooldownUntilMs, nowMs + effectiveCooldownMs);
  return stitchTransportCooldownUntilMs;
}

export function clearStitchTransportCooldown() {
  stitchTransportCooldownUntilMs = 0;
}

export function isStitchTransportCooldownActive(nowMs = Date.now()) {
  if (stitchTransportCooldownUntilMs <= nowMs) {
    stitchTransportCooldownUntilMs = 0;
    return false;
  }
  return true;
}

type StitchClientContext = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  proxyPlan: StitchProxyPlan;
};

type StitchRuntimeConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  recoveryTimeoutMs: number;
};

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asRecordArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
}

function readDownloadUrl(value: unknown) {
  const record = asRecord(value);
  return normalizeText(String(record?.downloadUrl ?? ""));
}

function extractProjectId(project: unknown) {
  const record = asRecord(project);
  const rawName = normalizeText(String(record?.name ?? ""));
  return normalizeText(String(record?.projectId ?? record?.id ?? rawName.replace(/^projects\//, "")), "unknown");
}

function extractScreenId(screen: unknown) {
  const record = asRecord(screen);
  const rawName = normalizeText(String(record?.name ?? ""));
  return normalizeText(
    String(record?.screenId ?? record?.id ?? rawName.split("/").pop() ?? ""),
    "unknown"
  );
}

function buildArtifactFromScreen(input: {
  prompt: string;
  executor: StitchExecutorMode;
  projectId: string;
  screen: unknown;
}): StitchDesignArtifact | null {
  const screen = asRecord(input.screen);
  if (!screen) {
    return null;
  }

  const htmlUrl = normalizeText(
    String(readDownloadUrl(screen.htmlCode) || readDownloadUrl(screen.html) || screen.htmlUrl || "")
  );
  const imageUrl = normalizeText(
    String(readDownloadUrl(screen.screenshot) || readDownloadUrl(screen.image) || screen.imageUrl || "")
  );

  if (!htmlUrl && !imageUrl) {
    return null;
  }

  return {
    provider: "google-stitch-mcp",
    generatedAt: new Date().toISOString(),
    projectId: normalizeText(input.projectId, "unknown"),
    screenId: extractScreenId(screen),
    htmlUrl,
    imageUrl,
    prompt: input.prompt,
    executor: input.executor
  };
}

function buildPendingArtifact(input: {
  prompt: string;
  executor: StitchExecutorMode;
  projectId: string;
}): StitchDesignPendingArtifact {
  return {
    provider: "google-stitch-mcp",
    requestedAt: new Date().toISOString(),
    projectId: normalizeText(input.projectId, "unknown"),
    prompt: input.prompt,
    executor: input.executor,
    status: "pending"
  };
}

function extractListedScreens(payload: unknown) {
  if (Array.isArray(payload)) {
    return asRecordArray(payload);
  }

  const record = asRecord(payload);
  return asRecordArray(record?.screens);
}

async function withPatchedFetch<T>(
  dispatcher: Awaited<ReturnType<typeof createStitchDispatcher>>,
  stitchBaseUrl: string,
  run: () => Promise<T>
): Promise<T> {
  if (!dispatcher) {
    return run();
  }

  const patchWindow = async () => {
    const originalFetch = globalThis.fetch;
    let stitchOrigin = "";
    try {
      stitchOrigin = new URL(stitchBaseUrl).origin;
    } catch {
      stitchOrigin = "";
    }

    const patchedFetch: typeof fetch = (input, init) => {
      const requestUrl = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (typeof Request !== "undefined" && input instanceof Request
            ? input.url
            : "");
      const shouldInjectDispatcher = !stitchOrigin || requestUrl.startsWith(stitchOrigin);
      if (!shouldInjectDispatcher) {
        return originalFetch(input, init);
      }
      const initRecord = init as (RequestInit & { dispatcher?: unknown }) | undefined;
      if (initRecord?.dispatcher) {
        return originalFetch(input, init);
      }
      const nextInit = {
        ...(init || {}),
        dispatcher
      };
      return (originalFetch as any)(input, nextInit);
    };

    globalThis.fetch = patchedFetch;
    try {
      return await run();
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  const guarded = stitchFetchPatchLock.then(patchWindow, patchWindow);
  stitchFetchPatchLock = guarded.then(
    () => undefined,
    () => undefined
  );
  return guarded;
}

async function createStitchClientContext(input: {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}): Promise<StitchClientContext> {
  const proxyEnv = readSystemProxyEnv();
  const proxyPlan = resolveStitchProxyPlan(proxyEnv);
  return {
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    proxyPlan
  };
}

function readStitchRuntimeConfig(): StitchRuntimeConfig {
  const apiKey = readRequiredEnv("STITCH_API_KEY");
  const baseUrl = String(process.env.STITCH_BASE_URL ?? "").trim() || "https://stitch.googleapis.com/mcp";
  const timeoutMs = Math.max(20_000, Number(process.env.STITCH_REQUEST_TIMEOUT_MS ?? 180_000));
  const recoveryTimeoutMs = Math.max(45_000, Number(process.env.STITCH_RECOVERY_TIMEOUT_MS ?? timeoutMs));

  return {
    apiKey,
    baseUrl,
    timeoutMs,
    recoveryTimeoutMs
  };
}

function withRuntimeConfigOverrides(
  base: StitchRuntimeConfig,
  overrides?: {
    requestTimeoutMs?: number;
    recoveryTimeoutMs?: number;
  }
): StitchRuntimeConfig {
  const nextTimeoutMs = overrides?.requestTimeoutMs === undefined
    ? base.timeoutMs
    : Math.max(5_000, Math.round(overrides.requestTimeoutMs));
  const nextRecoveryTimeoutMs = overrides?.recoveryTimeoutMs === undefined
    ? base.recoveryTimeoutMs
    : Math.max(0, Math.round(overrides.recoveryTimeoutMs));

  return {
    ...base,
    timeoutMs: nextTimeoutMs,
    recoveryTimeoutMs: nextRecoveryTimeoutMs
  };
}

async function closeStitchClientContext(context: StitchClientContext) {
  void context;
}

function resolveStitchToolMaxAttempts() {
  const configured = Number(process.env.STITCH_TOOL_MAX_ATTEMPTS ?? "");
  if (!Number.isFinite(configured) || configured <= 0) {
    return 2;
  }
  return Math.max(1, Math.min(3, Math.round(configured)));
}

function resolveStitchRetryDelayMs(attempt: number) {
  const baseDelayMs = Math.max(200, Number(process.env.STITCH_TOOL_RETRY_BASE_DELAY_MS ?? 450));
  return Math.min(2500, baseDelayMs * Math.max(1, attempt));
}

async function callStitchTool<T>(
  context: StitchClientContext,
  toolName: string,
  args: Record<string, unknown>
): Promise<T> {
  if (isStitchTransportCooldownActive()) {
    throw new Error(STITCH_TRANSPORT_COOLDOWN_ERROR);
  }

  return withMutedStitchTransportConsoleError(async () => {
    const maxAttempts = resolveStitchToolMaxAttempts();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const dispatcher = await createStitchDispatcher(context.proxyPlan);
      const client = new StitchToolClient({
        apiKey: context.apiKey,
        baseUrl: context.baseUrl,
        timeout: context.timeoutMs
      });

      try {
        const result = await withPatchedFetch(dispatcher, context.baseUrl, () => client.callTool<T>(toolName, args));
        clearStitchTransportCooldown();
        return result;
      } catch (error) {
        const retryable = isRetryableTransportError(error);
        const shouldRetry = retryable && attempt < maxAttempts;
        if (!shouldRetry) {
          if (retryable) {
            noteStitchTransportFailure();
          }
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, resolveStitchRetryDelayMs(attempt)));
      } finally {
        await client.close().catch(() => undefined);
        await dispatcher?.close().catch(() => undefined);
      }
    }

    throw new Error("STITCH_CALL_UNREACHABLE");
  });
}

async function getScreenArtifact(
  context: StitchClientContext,
  input: {
    projectId: string;
    screen: unknown;
    prompt: string;
    executor: StitchExecutorMode;
  }
) {
  const screen = asRecord(input.screen);
  const screenName = normalizeText(String(screen?.name ?? ""));
  const screenId = extractScreenId(screen);
  if (!screenName || !screenId || !screen) {
    return null;
  }

  const fetched = await callStitchTool<unknown>(context, "get_screen", {
    name: screenName,
    projectId: input.projectId,
    screenId
  });

  return buildArtifactFromScreen({
    prompt: input.prompt,
    executor: input.executor,
    projectId: input.projectId,
    screen: fetched
  });
}

async function recoverGeneratedArtifact(input: {
  context: StitchClientContext;
  projectId: string;
  prompt: string;
  executor: StitchExecutorMode;
  timeoutMs: number;
}) {
  const startedAt = Date.now();
  const pollIntervalMs = Math.max(2500, Number(process.env.STITCH_RECOVERY_POLL_INTERVAL_MS ?? 5000));
  let retryableErrorStreak = 0;

  while (Date.now() - startedAt < input.timeoutMs) {
    let listed: unknown;
    try {
      listed = await callStitchTool<unknown>(input.context, "list_screens", {
        projectId: input.projectId
      });
      retryableErrorStreak = 0;
    } catch (error) {
      if (isStitchTransportCooldownError(error)) {
        return null;
      }
      if (!isRetryableTransportError(error)) {
        throw error;
      }
      retryableErrorStreak += 1;
      const backoffMs = Math.min(
        20_000,
        pollIntervalMs * Math.max(1, 2 ** Math.min(3, retryableErrorStreak - 1))
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }
    const screens = extractListedScreens(listed);
    const latest = screens.at(-1);

    if (latest) {
      const directArtifact = buildArtifactFromScreen({
        prompt: input.prompt,
        executor: input.executor,
        projectId: input.projectId,
        screen: latest
      });
      if (directArtifact) {
        return directArtifact;
      }

      let fetchedArtifact: StitchDesignArtifact | null = null;
      try {
        fetchedArtifact = await getScreenArtifact(input.context, {
          projectId: input.projectId,
          screen: latest,
          prompt: input.prompt,
          executor: input.executor
        });
      } catch (error) {
        if (isStitchTransportCooldownError(error)) {
          return null;
        }
        if (!isRetryableTransportError(error)) {
          throw error;
        }
      }
      if (fetchedArtifact) {
        return fetchedArtifact;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return null;
}

export function buildGenerateScreenArguments(input: {
  projectId: string;
  prompt: string;
}): StitchGenerateScreenArgs {
  const args: StitchGenerateScreenArgs = {
    projectId: input.projectId,
    prompt: input.prompt
  };

  const deviceType = readOptionalEnv("STITCH_DEVICE_TYPE") || "DESKTOP";
  if (deviceType) {
    args.deviceType = deviceType;
  }

  const modelId = readOptionalEnv("STITCH_MODEL_ID");
  if (modelId) {
    args.modelId = modelId;
  }

  return args;
}

async function generateViaDirectSdk(
  input: {
    projectId: string;
    projectName: string;
    projectDescription: string;
    parsedIntent: ParsedIntent;
    stageType: StageType;
    role: RoleType;
    summary?: string;
  },
  executor: StitchExecutorMode,
  options?: {
    allowPending?: boolean;
    requestTimeoutMs?: number;
    recoveryTimeoutMs?: number;
  }
): Promise<StitchDesignRequestResult> {
  const prompt = buildPrompt(input);
  if (isStitchTransportCooldownActive()) {
    if (options?.allowPending) {
      return {
        status: "pending",
        pending: buildPendingArtifact({
          projectId: input.projectId,
          prompt,
          executor
        })
      };
    }
    throw new Error(STITCH_TRANSPORT_COOLDOWN_ERROR);
  }
  const runtimeConfig = withRuntimeConfigOverrides(readStitchRuntimeConfig(), {
    requestTimeoutMs: options?.requestTimeoutMs,
    recoveryTimeoutMs: options?.recoveryTimeoutMs
  });
  const recoveryTimeoutMs = Math.max(
    0,
    Number(options?.recoveryTimeoutMs ?? runtimeConfig.recoveryTimeoutMs)
  );
  const title = truncate(`${input.projectId} ${input.projectName}`, 90);
  const context = await createStitchClientContext({
    apiKey: runtimeConfig.apiKey,
    baseUrl: runtimeConfig.baseUrl,
    timeoutMs: runtimeConfig.timeoutMs
  });
  let stitchProjectIdForPending = normalizeText(input.projectId, "unknown");

  try {
    const createdProject = await callStitchTool<unknown>(context, "create_project", { title });
    const stitchProjectId = extractProjectId(createdProject);
    stitchProjectIdForPending = stitchProjectId;

    try {
      const generatedScreen = await callStitchTool<unknown>(
        context,
        "generate_screen_from_text",
        buildGenerateScreenArguments({
          projectId: stitchProjectId,
          prompt
        })
      );
      const directArtifact =
        buildArtifactFromScreen({
          prompt,
          executor,
          projectId: stitchProjectId,
          screen: generatedScreen
        }) ||
        (await getScreenArtifact(context, {
          projectId: stitchProjectId,
          screen: generatedScreen,
          prompt,
          executor
        }));

      if (directArtifact) {
        return {
          status: "ready",
          artifact: directArtifact
        };
      }
    } catch (error) {
      if (!isRetryableTransportError(error) && !isStitchQuotaExhaustedError(error)) {
        throw error;
      }
      noteStitchTransportFailure();
    }

    let recoveredArtifact: StitchDesignArtifact | null = null;
    try {
      recoveredArtifact = await recoverGeneratedArtifact({
        context,
        projectId: stitchProjectId,
        prompt,
        executor,
        timeoutMs: recoveryTimeoutMs
      });
    } catch (error) {
      if (!isStitchTransportCooldownError(error)) {
        throw error;
      }
      if (!options?.allowPending) {
        throw error;
      }
    }
    if (recoveredArtifact) {
      clearStitchTransportCooldown();
      return {
        status: "ready",
        artifact: recoveredArtifact
      };
    }

    if (options?.allowPending) {
      return {
        status: "pending",
        pending: buildPendingArtifact({
          projectId: stitchProjectId,
          prompt,
          executor
        })
      };
    }

    throw new Error(`STITCH_RECOVERY_TIMEOUT: project=${stitchProjectId}`);
  } catch (error) {
    const isQuota = isStitchQuotaExhaustedError(error);
    const isCooldown = isStitchTransportCooldownError(error);
    if (isQuota) {
      noteStitchTransportFailure();
    }
    if ((isQuota || isCooldown) && options?.allowPending) {
      return {
        status: "pending",
        pending: buildPendingArtifact({
          projectId: stitchProjectIdForPending,
          prompt,
          executor
        })
      };
    }
    throw error;
  } finally {
    await closeStitchClientContext(context);
  }
}

export async function generateStitchDesignArtifact(input: {
  projectId: string;
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}): Promise<StitchDesignArtifact> {
  const result = await generateViaDirectSdk(input, "direct");
  return result.status === "ready"
    ? result.artifact
    : Promise.reject(new Error(`STITCH_RECOVERY_TIMEOUT: project=${result.pending.projectId}`));
}

export async function startStitchDesignGeneration(input: {
  projectId: string;
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}, options?: {
  requestTimeoutMs?: number;
  recoveryTimeoutMs?: number;
}): Promise<StitchDesignRequestResult> {
  return generateViaDirectSdk(input, "direct", {
    requestTimeoutMs: options?.requestTimeoutMs,
    allowPending: true,
    recoveryTimeoutMs: options?.recoveryTimeoutMs
  });
}

export async function recoverStitchDesignArtifact(input: {
  stitchProjectId: string;
  prompt: string;
  executor?: StitchExecutorMode;
  requestTimeoutMs?: number;
  timeoutMs?: number;
}): Promise<StitchDesignArtifact | null> {
  if (isStitchTransportCooldownActive()) {
    return null;
  }
  const runtimeConfig = withRuntimeConfigOverrides(readStitchRuntimeConfig(), {
    requestTimeoutMs: input.requestTimeoutMs
  });
  const context = await createStitchClientContext({
    apiKey: runtimeConfig.apiKey,
    baseUrl: runtimeConfig.baseUrl,
    timeoutMs: runtimeConfig.timeoutMs
  });

  try {
    const artifact = await recoverGeneratedArtifact({
      context,
      projectId: input.stitchProjectId,
      prompt: input.prompt,
      executor: input.executor ?? "direct",
      timeoutMs: Math.max(0, Number(input.timeoutMs ?? runtimeConfig.recoveryTimeoutMs))
    });
    if (artifact) {
      clearStitchTransportCooldown();
    }
    return artifact;
  } finally {
    await closeStitchClientContext(context);
  }
}
