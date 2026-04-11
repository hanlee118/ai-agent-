import type { ParsedIntent, RoleType, StageType } from "@occ/shared";
import { previewRequirement } from "../utils/project-parser.js";
import {
  generateStitchDesignArtifact,
  isStitchTransportCooldownError,
  recoverStitchDesignArtifact,
  startStitchDesignGeneration,
  type StitchDesignPendingArtifact
} from "../integrations/stitch-runtime.js";
import { normalizeText } from "./types.js";

function resolveStageType(stageKey: string): StageType {
  const normalized = normalizeText(stageKey).toLowerCase();
  if (normalized.includes("design") || normalized.includes("视觉")) {
    return "DESIGN";
  }
  if (normalized.includes("analysis") || normalized.includes("需求")) {
    return "ANALYSIS";
  }
  if (normalized.includes("dev") || normalized.includes("研发") || normalized.includes("code")) {
    return "DEV";
  }
  if (normalized.includes("qa") || normalized.includes("accept")) {
    return "ACCEPT";
  }
  return "INIT";
}

function resolveRole(stageKey: string): RoleType {
  const stageType = resolveStageType(stageKey);
  if (stageType === "DESIGN") {
    return "ROLE_DESIGN";
  }
  if (stageType === "ANALYSIS") {
    return "ROLE_ANALYST";
  }
  if (stageType === "DEV") {
    return "ROLE_DEV";
  }
  if (stageType === "ACCEPT") {
    return "ROLE_QA";
  }
  return "ROLE_PM";
}

function toParsedIntent(projectDescription: string, seed: string): ParsedIntent {
  return previewRequirement(`${projectDescription}\n${seed}`);
}

function toArtifactContent(input: {
  htmlUrl?: string;
  imageUrl?: string;
  stitchProjectId?: string;
  prompt?: string;
  pending?: boolean;
}) {
  const lines: string[] = ["## Stitch 设计产物"];
  if (input.pending) {
    lines.push("- 状态: pending");
  }
  if (input.stitchProjectId) {
    lines.push(`- stitchProjectId: ${input.stitchProjectId}`);
  }
  if (input.htmlUrl) {
    lines.push(`- htmlUrl: ${input.htmlUrl}`);
  }
  if (input.imageUrl) {
    lines.push(`- imageUrl: ${input.imageUrl}`);
  }
  if (input.prompt) {
    lines.push(`- prompt: ${input.prompt}`);
  }
  return lines.join("\n");
}

export async function maybeGenerateStitchArtifacts(input: {
  enabled: boolean;
  projectId: string;
  projectName: string;
  projectDescription: string;
  stageKey: string;
  summary?: string;
}) {
  if (!input.enabled) {
    return [];
  }
  if (!String(process.env.STITCH_API_KEY ?? "").trim()) {
    return [];
  }

  const stageType = resolveStageType(input.stageKey);
  if (stageType !== "DESIGN") {
    return [];
  }

  const parsedIntent = toParsedIntent(input.projectDescription, input.summary ?? input.projectName);
  const role = resolveRole(input.stageKey);
  const baseRequest = {
    projectId: input.projectId,
    projectName: input.projectName,
    projectDescription: input.projectDescription,
    parsedIntent,
    stageType,
    role,
    summary: input.summary
  };

  try {
    const artifact = await generateStitchDesignArtifact(baseRequest);
    return [
      {
        name: "stitch_design_artifact.md",
        type: "markdown",
        content: toArtifactContent({
          stitchProjectId: artifact.projectId,
          htmlUrl: artifact.htmlUrl,
          imageUrl: artifact.imageUrl,
          prompt: artifact.prompt
        }),
        metadata: artifact
      }
    ];
  } catch (error) {
    if (!isStitchTransportCooldownError(error)) {
      try {
        const started = await startStitchDesignGeneration(baseRequest);
        if (started.status === "ready") {
          return [
            {
              name: "stitch_design_artifact.md",
              type: "markdown",
              content: toArtifactContent({
                stitchProjectId: started.artifact.projectId,
                htmlUrl: started.artifact.htmlUrl,
                imageUrl: started.artifact.imageUrl,
                prompt: started.artifact.prompt
              }),
              metadata: started.artifact
            }
          ];
        }
        const recovered = await recoverIfPossible(started.pending);
        if (recovered) {
          return [
            {
              name: "stitch_design_artifact.md",
              type: "markdown",
              content: toArtifactContent({
                stitchProjectId: recovered.projectId,
                htmlUrl: recovered.htmlUrl,
                imageUrl: recovered.imageUrl,
                prompt: recovered.prompt
              }),
              metadata: recovered
            }
          ];
        }
        return [
          {
            name: "stitch_design_pending.md",
            type: "markdown",
            content: toArtifactContent({
              stitchProjectId: started.pending.projectId,
              prompt: started.pending.prompt,
              pending: true
            }),
            metadata: started.pending
          }
        ];
      } catch {
        return [];
      }
    }
    return [];
  }
}

async function recoverIfPossible(pending: StitchDesignPendingArtifact) {
  const projectId = normalizeText(pending.projectId);
  if (!projectId) {
    return null;
  }
  try {
    return await recoverStitchDesignArtifact({
      stitchProjectId: projectId,
      prompt: normalizeText(pending.prompt)
    });
  } catch {
    return null;
  }
}
