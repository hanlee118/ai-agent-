import express from "express";
import { importHermesSkill, listSkillsForHermes } from "../workflow-v2/hermes-skill-service.js";
import { getSkillsV2SchemaStatus } from "../workflow-v2/schema-ready.js";
import { asRecord, normalizeText } from "../workflow-v2/types.js";
import { validateHermesApiKey } from "./hermes-auth.js";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";

type ImportHermesSkillBody = {
  hermesSkillId?: unknown;
  projectId?: unknown;
  skillData?: unknown;
};

function parsePositiveInt(input: unknown, fallback: number, max: number) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return fallback;
  }
  return Math.min(rounded, max);
}

export function createSkillsV2Router() {
  const router = express.Router();

  async function ensureSchemaReady(res: express.Response) {
    const status = await getSkillsV2SchemaStatus();
    if (status.ready) {
      return true;
    }
    sendError(res, 503, "SERVICE_UNAVAILABLE", `skills schema not ready: ${status.reason || "unknown"}`);
    return false;
  }

  router.get("/for-hermes", asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    if (!validateHermesApiKey(req, res)) {
      return;
    }

    const skills = await listSkillsForHermes({
      projectId: normalizeText(req.query.projectId) || undefined,
      stageType: normalizeText(req.query.stageType) || undefined,
      limit: parsePositiveInt(req.query.limit, 20, 200)
    });

    sendSuccess(res, {
      skills: skills.map((item) => ({
        id: item.id,
        hermesSkillId: item.hermesSkillId,
        skillKey: item.skillKey,
        name: item.name,
        type: item.type,
        instruction: item.instruction,
        manifest: item.manifest,
        sourceProjectId: item.sourceProjectId,
        source: item.source,
        isCertified: item.isCertified,
        updatedAt: item.updatedAt
      }))
    });
  }));

  router.post("/import/hermes", asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    if (!validateHermesApiKey(req, res)) {
      return;
    }

    const payload = (req.body ?? {}) as ImportHermesSkillBody;
    const skillData = asRecord(payload.skillData);
    if (!skillData) {
      sendError(res, 400, "VALIDATION_ERROR", "skillData is required");
      return;
    }

    const imported = await importHermesSkill({
      hermesSkillId: normalizeText(payload.hermesSkillId) || undefined,
      projectId: normalizeText(payload.projectId) || undefined,
      skillData
    });

    sendSuccess(res, { skill: imported }, 201);
  }));

  return router;
}
