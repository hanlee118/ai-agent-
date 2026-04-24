import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectDetail, StageType } from "@occ/shared";

export interface OfficialSiteArtifact {
  publicPath: string;
  filePaths: string[];
  kind: "design_preview" | "narrative_summary";
  sourceDeliverableName?: string;
}

type DeliverableRef = ProjectDetail["deliverables"][number];

const GENERATED_HTML_LINK_PATTERN =
  /(https?:\/\/[^\s"'`<>]+\/generated\/[^\s"'`<>]+\.html(?:\?[^\s"'`<>]*)?(?:#[^\s"'`<>]*)?|\/generated\/[^\s"'`<>]+\.html(?:\?[^\s"'`<>]*)?(?:#[^\s"'`<>]*)?)/gi;

function findWorkspaceRoot(startDir: string) {
  let current = startDir;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(startDir, "../../../");
}

function cleanUrlCandidate(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized
    .replace(/[)\],.;]+$/g, "")
    .replace(/^["'`<]+/g, "")
    .replace(/[>"'`]+$/g, "")
    .trim();
}

function dedupe(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function extractGeneratedHtmlLinks(content: string) {
  const links: string[] = [];
  const source = String(content || "");
  let matched: RegExpExecArray | null;
  while ((matched = GENERATED_HTML_LINK_PATTERN.exec(source)) !== null) {
    const candidate = cleanUrlCandidate(String(matched[1] || ""));
    if (candidate) {
      links.push(candidate);
    }
  }
  GENERATED_HTML_LINK_PATTERN.lastIndex = 0;
  return dedupe(links);
}

function getAbsoluteUrlPathname(urlLike: string) {
  try {
    return new URL(urlLike).pathname;
  } catch {
    return "";
  }
}

function normalizePublicPath(url: string) {
  const normalized = cleanUrlCandidate(url);
  if (!normalized) {
    return "";
  }
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("/")) {
    return normalized;
  }
  if (normalized.startsWith("generated/")) {
    return `/${normalized}`;
  }
  return normalized;
}

function normalizeStageWeight(stageType: StageType) {
  if (stageType === "ACCEPT") {
    return 70;
  }
  if (stageType === "DEV") {
    return 45;
  }
  if (stageType === "DESIGN") {
    return 20;
  }
  return 5;
}

function scoreDeliverable(deliverable: DeliverableRef, url: string) {
  const name = String(deliverable.name || "");
  const content = String(deliverable.content || "");
  const composite = `${name}\n${content}\n${url}`.toLowerCase();

  let score = 0;
  if (deliverable.status === "approved") {
    score += 100;
  } else if (deliverable.status === "submitted") {
    score += 50;
  }

  score += normalizeStageWeight(deliverable.stageType);

  if (/交互原型|prototype|mvp|可访问|可演示/.test(composite)) {
    score += 90;
  }
  if (/\/generated\/liquidity-dapp-mvp\//.test(composite)) {
    score += 120;
  }
  if (/视觉定稿|mockup|wireframe|preview/.test(composite)) {
    score += 20;
  }

  score += Math.min(12, Math.max(0, Number(deliverable.version || 0)));
  return score;
}

function resolveFilePathCandidates(workspaceRoot: string, publicPath: string) {
  const probe = /^https?:\/\//i.test(publicPath) ? getAbsoluteUrlPathname(publicPath) : publicPath;
  const pathname = String(probe || "").trim();
  if (!pathname.startsWith("/generated/")) {
    return [];
  }
  const relative = pathname.replace(/^\/+/, "");
  const candidates = dedupe([
    path.join(workspaceRoot, relative),
    path.join(workspaceRoot, "site", relative)
  ]);
  const existing = candidates.filter((candidate) => existsSync(candidate));
  return existing.length > 0 ? existing : candidates.slice(0, 1);
}

function detectArtifactKind(deliverable: DeliverableRef, publicPath: string): OfficialSiteArtifact["kind"] {
  const probe = `${deliverable.name || ""}\n${deliverable.content || ""}\n${publicPath}`.toLowerCase();
  if (
    deliverable.stageType === "DESIGN"
    && /视觉定稿|design preview|mockup|wireframe|单页预览|preview/.test(probe)
  ) {
    return "design_preview";
  }
  return "narrative_summary";
}

function pickBestDeliverableLink(project: ProjectDetail) {
  const candidates: Array<{ deliverable: DeliverableRef; url: string; score: number }> = [];
  for (const deliverable of project.deliverables) {
    const links = extractGeneratedHtmlLinks(String(deliverable.content || ""));
    for (const url of links) {
      candidates.push({
        deliverable,
        url,
        score: scoreDeliverable(deliverable, url)
      });
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    const leftTime = new Date(left.deliverable.updatedAt).getTime();
    const rightTime = new Date(right.deliverable.updatedAt).getTime();
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return Number(right.deliverable.version || 0) - Number(left.deliverable.version || 0);
  });
  return candidates[0];
}

export async function generateOfficialSiteArtifact(project: ProjectDetail): Promise<OfficialSiteArtifact> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = findWorkspaceRoot(moduleDir);
  const picked = pickBestDeliverableLink(project);
  if (!picked) {
    throw new Error("OFFICIAL_SITE_LINK_NOT_FOUND: no generated html link found in project deliverables");
  }

  const publicPath = normalizePublicPath(picked.url);
  if (!publicPath) {
    throw new Error("OFFICIAL_SITE_LINK_INVALID: deliverable link is empty after normalization");
  }

  return {
    publicPath,
    filePaths: resolveFilePathCandidates(workspaceRoot, publicPath),
    kind: detectArtifactKind(picked.deliverable, publicPath),
    sourceDeliverableName: String(picked.deliverable.name || "").trim() || undefined
  };
}
