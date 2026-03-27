import { Prisma } from "@prisma/client";
import express from "express";
import { prisma } from "../db.js";
import { asyncRoute, sendSuccess } from "./utils.js";

function toStringArrayFromJson(input: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(input)) {
    return [] as string[];
  }

  return input
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizeAgentStatus(status: string | null | undefined) {
  const value = String(status ?? "").trim().toLowerCase();
  if (value === "working") {
    return "Executing";
  }

  if (value === "idle") {
    return "Idle";
  }

  return status || "Idle";
}

function resolveLayer(role: string) {
  if (/assistant|pm|arch|chief|总监|架构|首席/i.test(role)) {
    return "core";
  }

  if (/analyst|qa|audit|analysis|分析|审计|测试/i.test(role)) {
    return "logic";
  }

  return "execution";
}

export function createTeamRouter() {
  const router = express.Router();

  router.get("/topology", asyncRoute(async (_req, res) => {
    const [profiles, configs, models] = await prisma.$transaction([
      prisma.agentProfile.findMany(),
      prisma.managedAgentConfig.findMany(),
      prisma.model.findMany({
        select: {
          id: true,
          name: true,
          provider: true,
          status: true,
          tokenLimit: true
        }
      })
    ]);

    const profileMap = new Map(profiles.map((profile) => [profile.roleId, profile]));
    const configMap = new Map(configs.map((config) => [config.agentId, config]));
    const agentIds = Array.from(new Set<string>([
      ...profileMap.keys(),
      ...configMap.keys()
    ])).sort((a, b) => a.localeCompare(b));

    const total = Math.max(agentIds.length, 1);
    const radius = Math.max(220, total * 40);
    const centerX = 420;
    const centerY = 300;

    const nodes = agentIds.map((agentId, index) => {
      const profile = profileMap.get(agentId);
      const config = configMap.get(agentId);
      const angle = (Math.PI * 2 * index) / total;
      const role = profile?.roleId || config?.title || agentId;

      return {
        id: agentId,
        name: config?.displayName?.trim() || profile?.name || agentId,
        role,
        status: normalizeAgentStatus(profile?.status),
        modelId: config?.selectedModel ?? "",
        layer: resolveLayer(role),
        x: Math.round(centerX + radius * Math.cos(angle)),
        y: Math.round(centerY + radius * Math.sin(angle))
      };
    });

    const edgeSet = new Set<string>();
    const edges: Array<{ from: string; to: string; label: string }> = [];

    for (const config of configs) {
      const from = config.agentId;
      const targets = toStringArrayFromJson(config.allowedAgentIds);

      for (const target of targets) {
        if (!agentIds.includes(target) || target === from) {
          continue;
        }

        const key = `${from}=>${target}`;
        if (edgeSet.has(key)) {
          continue;
        }

        edgeSet.add(key);
        edges.push({ from, to: target, label: "协作" });
      }
    }

    if (edges.length === 0 && nodes.length > 1) {
      for (let index = 0; index < nodes.length - 1; index += 1) {
        edges.push({
          from: nodes[index].id,
          to: nodes[index + 1].id,
          label: "协作"
        });
      }
    }

    const connections = edges.map((edge) => ({
      source: edge.from,
      target: edge.to,
      label: edge.label
    }));

    sendSuccess(res, {
      nodes,
      edges,
      connections,
      models,
      summary: {
        totalAgents: nodes.length,
        activeModels: models.filter((model) => model.status === "Healthy").length,
        totalConnections: edges.length
      }
    });
  }));

  return router;
}
