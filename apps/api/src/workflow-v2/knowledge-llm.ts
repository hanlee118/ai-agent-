import { runStageAgent } from "../agents/runtime.js";
import { previewRequirement } from "../utils/project-parser.js";
import { asRecord, asStringArray, normalizeText } from "./types.js";
import type { MemoryType } from "./types.js";

export type LlmKnowledgeExtraction = {
  summary: string;
  tags: string[];
  memoryType: MemoryType;
  importanceScore: number;
  stageContext: string[];
  techStack: string[];
};

const KNOWLEDGE_LLM_ENABLED = String(process.env.WORKFLOW_V2_KNOWLEDGE_LLM_ENABLED ?? "true")
  .trim()
  .toLowerCase() !== "false";
const KNOWLEDGE_LLM_TIMEOUT_MS = Math.max(
  1500,
  Number(process.env.WORKFLOW_V2_KNOWLEDGE_LLM_TIMEOUT_MS ?? 12000)
);

function extractJsonObject(raw: string) {
  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    return null;
  }
  const fenced = normalized.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || normalized;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function clampScore(score: unknown, fallback = 0.6) {
  const value = Number(score);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeMemoryType(value: unknown): MemoryType {
  const text = normalizeText(value).toLowerCase();
  if (text === "episodic" || text === "procedural") {
    return text;
  }
  return "semantic";
}

function fallbackExtraction(input: { stageKey: string; outputText: string }): LlmKnowledgeExtraction {
  const parsed = previewRequirement(input.outputText);
  return {
    summary: normalizeText(parsed.summary || input.outputText.slice(0, 240)),
    tags: [...new Set(parsed.keywords)].slice(0, 10),
    memoryType: input.stageKey.toLowerCase().includes("qa") ? "episodic" : "semantic",
    importanceScore: 0.6,
    stageContext: [input.stageKey],
    techStack: parsed.keywords.filter((item) => /(react|vue|angular|node|typescript|java|python|go|sql|postgres|prisma)/i.test(item))
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`knowledge llm timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function extractKnowledgeFromStageOutput(input: {
  projectName: string;
  projectDescription: string;
  stageKey: string;
  outputText: string;
  summary?: string;
}): Promise<LlmKnowledgeExtraction> {
  const trimmed = normalizeText(input.outputText);
  if (!trimmed) {
    return fallbackExtraction(input);
  }
  if (!KNOWLEDGE_LLM_ENABLED) {
    return fallbackExtraction(input);
  }

  const prompt = [
    "你是知识提炼器，请从阶段输出中抽取可复用知识。",
    "严格输出 JSON，不要输出 markdown 或额外解释。",
    "JSON schema:",
    "{",
    '  "summary": "100-300字摘要",',
    '  "tags": ["标签1","标签2"],',
    '  "memoryType": "episodic|semantic|procedural",',
    '  "importanceScore": 0.0-1.0,',
    '  "stageContext": ["阶段key"],',
    '  "techStack": ["技术栈"]',
    "}",
    `stageKey=${input.stageKey}`,
    `summaryHint=${normalizeText(input.summary) || "无"}`,
    "output:",
    trimmed.slice(0, 7000)
  ].join("\n");

  try {
    const parsedIntent = previewRequirement(`${input.projectDescription}\n${trimmed.slice(0, 1500)}`);
    const run = await withTimeout(
      runStageAgent({
        projectName: input.projectName || "workflow-project",
        projectDescription: input.projectDescription || "workflow-stage-knowledge-extraction",
        parsedIntent,
        stageType: "ANALYSIS",
        role: "ROLE_ANALYST",
        summary: prompt
      }),
      KNOWLEDGE_LLM_TIMEOUT_MS
    );
    const parsed = extractJsonObject(run.body);
    const record = asRecord(parsed);
    if (!record) {
      return fallbackExtraction(input);
    }
    const fallback = fallbackExtraction(input);
    return {
      summary: normalizeText(record.summary) || fallback.summary,
      tags: asStringArray(record.tags).slice(0, 20).length > 0 ? asStringArray(record.tags).slice(0, 20) : fallback.tags,
      memoryType: normalizeMemoryType(record.memoryType),
      importanceScore: clampScore(record.importanceScore, fallback.importanceScore),
      stageContext: asStringArray(record.stageContext).length > 0 ? asStringArray(record.stageContext) : fallback.stageContext,
      techStack: asStringArray(record.techStack)
    };
  } catch {
    return fallbackExtraction(input);
  }
}
