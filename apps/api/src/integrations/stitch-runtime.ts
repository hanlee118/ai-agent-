import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ParsedIntent } from "@occ/shared";
import type { RoleType, StageType } from "@occ/shared";

const execFileAsync = promisify(execFile);

export type StitchExecutorMode = "direct" | "claude_cli" | "auto";

export type StitchDesignArtifact = {
  provider: "google-stitch-sdk" | "claude-cli-stitch-mcp";
  generatedAt: string;
  projectId: string;
  screenId: string;
  htmlUrl: string;
  imageUrl: string;
  prompt: string;
  executor: StitchExecutorMode;
};

type ClaudeCliResultEnvelope = {
  is_error?: boolean;
  result?: string;
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

function getStitchExecutorMode(): StitchExecutorMode {
  const raw = String(process.env.STITCH_EXECUTOR ?? "direct").trim().toLowerCase();
  if (raw === "claude_cli" || raw === "claude-cli" || raw === "claude") {
    return "claude_cli";
  }
  if (raw === "auto") {
    return "auto";
  }
  return "direct";
}

function extractJsonObject(raw: string) {
  const source = String(raw || "").trim();
  if (!source) {
    return null;
  }
  const directParsed = tryParseJson(source);
  if (directParsed && typeof directParsed === "object") {
    return directParsed as Record<string, unknown>;
  }

  const fenced = source.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = tryParseJson(fenced[1]);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  }

  const objectLike = source.match(/\{[\s\S]*\}/);
  if (objectLike?.[0]) {
    const parsed = tryParseJson(objectLike[0]);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  }

  return null;
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractUrlByKey(source: string, key: "html" | "image") {
  const pattern = key === "html"
    ? /(htmlurl|html_url|html)[^:\n]*[:：]\s*(https?:\/\/[^\s)]+)/i
    : /(imageurl|image_url|image|screenshot)[^:\n]*[:：]\s*(https?:\/\/[^\s)]+)/i;
  const match = String(source || "").match(pattern);
  return match?.[2] || "";
}

function parseClaudeResultArtifact(input: {
  stdout: string;
  prompt: string;
  executor: StitchExecutorMode;
}): StitchDesignArtifact {
  const normalized = String(input.stdout || "").trim();
  if (!normalized) {
    throw new Error("CLAUDE_CLI_EMPTY_OUTPUT");
  }

  const envelope = tryParseJson(normalized) as ClaudeCliResultEnvelope | null;
  if (envelope && typeof envelope === "object") {
    if (envelope.is_error) {
      throw new Error(`CLAUDE_CLI_ERROR: ${normalizeText(String(envelope.result ?? "unknown error"))}`);
    }
    const resultText = String(envelope.result ?? "").trim();
    if (resultText) {
      const artifact = parseClaudeResultArtifactFromText({
        text: resultText,
        prompt: input.prompt,
        executor: input.executor
      });
      if (artifact) {
        return artifact;
      }
    }
  }

  const parsedFromText = parseClaudeResultArtifactFromText({
    text: normalized,
    prompt: input.prompt,
    executor: input.executor
  });
  if (parsedFromText) {
    return parsedFromText;
  }

  throw new Error("CLAUDE_CLI_UNPARSABLE_OUTPUT");
}

function parseClaudeResultArtifactFromText(input: {
  text: string;
  prompt: string;
  executor: StitchExecutorMode;
}) {
  const object = extractJsonObject(input.text);
  if (object) {
    const projectId = normalizeText(String(object.projectId ?? object.stitchProjectId ?? ""), "unknown");
    const screenId = normalizeText(String(object.screenId ?? object.stitchScreenId ?? ""), "unknown");
    const htmlUrl = normalizeText(String(object.htmlUrl ?? object.stitchHtmlUrl ?? ""));
    const imageUrl = normalizeText(String(object.imageUrl ?? object.stitchImageUrl ?? ""));
    if (htmlUrl || imageUrl) {
      return {
        provider: "claude-cli-stitch-mcp",
        generatedAt: new Date().toISOString(),
        projectId,
        screenId,
        htmlUrl,
        imageUrl,
        prompt: input.prompt,
        executor: input.executor
      } satisfies StitchDesignArtifact;
    }
  }

  const htmlUrl = extractUrlByKey(input.text, "html");
  const imageUrl = extractUrlByKey(input.text, "image");
  if (htmlUrl || imageUrl) {
    return {
      provider: "claude-cli-stitch-mcp",
      generatedAt: new Date().toISOString(),
      projectId: "unknown",
      screenId: "unknown",
      htmlUrl,
      imageUrl,
      prompt: input.prompt,
      executor: input.executor
    } satisfies StitchDesignArtifact;
  }

  return null;
}

async function generateViaDirectSdk(input: {
  projectId: string;
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}, executor: StitchExecutorMode): Promise<StitchDesignArtifact> {
  const apiKey = readRequiredEnv("STITCH_API_KEY");
  const baseUrl = String(process.env.STITCH_BASE_URL ?? "").trim() || "https://stitch.googleapis.com/mcp";
  const timeoutMs = Math.max(20_000, Number(process.env.STITCH_REQUEST_TIMEOUT_MS ?? 180_000));
  const { Stitch, StitchToolClient } = await import("@google/stitch-sdk");
  const prompt = buildPrompt(input);
  const title = truncate(`${input.projectId} ${input.projectName}`, 90);

  const client = new StitchToolClient({
    apiKey,
    baseUrl,
    timeout: timeoutMs
  });

  try {
    const sdk = new Stitch(client);
    const project = await sdk.createProject(title);
    const screen = await project.generate(prompt, "DESKTOP");
    const htmlUrl = normalizeText(await screen.getHtml());
    const imageUrl = normalizeText(await screen.getImage());

    if (!htmlUrl && !imageUrl) {
      throw new Error("STITCH_EMPTY_ARTIFACT: html/image urls are missing");
    }

    return {
      provider: "google-stitch-sdk",
      generatedAt: new Date().toISOString(),
      projectId: normalizeText(project.projectId || project.id, "unknown"),
      screenId: normalizeText(screen.screenId || screen.id, "unknown"),
      htmlUrl,
      imageUrl,
      prompt,
      executor
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function buildClaudePrompt(basePrompt: string) {
  return [
    "你必须通过已配置的 Stitch MCP 生成设计产物，不允许只做文字描述。",
    basePrompt,
    "输出要求：只能返回一个 JSON 对象，不要 Markdown，不要解释。",
    "JSON 字段：projectId, screenId, htmlUrl, imageUrl。",
    "如果某字段缺失，用空字符串，不要省略字段名。"
  ].join("\n\n");
}

function buildClaudeCliArgs(prompt: string) {
  const args = ["-p", "--output-format", "json", prompt];
  const model = String(process.env.STITCH_CLAUDE_MODEL ?? "").trim();
  if (model) {
    args.unshift(model);
    args.unshift("--model");
  }
  const mcpConfig = String(process.env.STITCH_CLAUDE_MCP_CONFIG ?? "").trim();
  if (mcpConfig) {
    args.unshift(mcpConfig);
    args.unshift("--mcp-config");
    args.unshift("--strict-mcp-config");
  }
  return args;
}

async function generateViaClaudeCli(input: {
  projectId: string;
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}, executor: StitchExecutorMode): Promise<StitchDesignArtifact> {
  const prompt = buildPrompt(input);
  const commandPrompt = buildClaudePrompt(prompt);
  const bin = String(process.env.STITCH_CLAUDE_CLI_BIN ?? "claude").trim() || "claude";
  const timeoutMs = Math.max(20_000, Number(process.env.STITCH_CLAUDE_TIMEOUT_MS ?? 240_000));
  const args = buildClaudeCliArgs(commandPrompt);

  const { stdout, stderr } = await execFileAsync(bin, args, {
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024
  });

  const output = String(stdout || "").trim();
  if (!output) {
    throw new Error(`CLAUDE_CLI_EMPTY_OUTPUT: ${normalizeText(String(stderr || ""), "no stderr")}`);
  }

  return parseClaudeResultArtifact({
    stdout: output,
    prompt,
    executor
  });
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
  const executor = getStitchExecutorMode();

  if (executor === "direct") {
    return generateViaDirectSdk(input, executor);
  }

  if (executor === "claude_cli") {
    return generateViaClaudeCli(input, executor);
  }

  try {
    return await generateViaDirectSdk(input, executor);
  } catch (directError) {
    const directReason = directError instanceof Error ? directError.message : String(directError);
    try {
      return await generateViaClaudeCli(input, executor);
    } catch (cliError) {
      const cliReason = cliError instanceof Error ? cliError.message : String(cliError);
      throw new Error(`STITCH_AUTO_FAILED: direct=${directReason}; claude_cli=${cliReason}`);
    }
  }
}
