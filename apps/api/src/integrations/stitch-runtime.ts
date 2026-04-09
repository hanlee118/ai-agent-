import type { ParsedIntent } from "@occ/shared";
import type { RoleType, StageType } from "@occ/shared";

export type StitchDesignArtifact = {
  provider: "google-stitch-sdk";
  generatedAt: string;
  projectId: string;
  screenId: string;
  htmlUrl: string;
  imageUrl: string;
  prompt: string;
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

export async function generateStitchDesignArtifact(input: {
  projectId: string;
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}): Promise<StitchDesignArtifact> {
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
      prompt
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
