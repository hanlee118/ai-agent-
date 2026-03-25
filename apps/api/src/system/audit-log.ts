import type { AuditLogItem } from "@occ/shared";
import { prisma } from "../db.js";

export async function writeAuditLog(input: {
  actorType: AuditLogItem["actorType"];
  actorLabel: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  summary: string;
  detail?: string;
  requestId?: string;
  ipAddress?: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorType: input.actorType,
      actorLabel: input.actorLabel,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      summary: input.summary,
      detail: input.detail,
      requestId: input.requestId,
      ipAddress: input.ipAddress
    }
  });
}

export async function listAuditLogs(limit = 50): Promise<AuditLogItem[]> {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200)
  });

  return logs.map((log) => ({
    id: log.id,
    actorType: log.actorType as AuditLogItem["actorType"],
    actorLabel: log.actorLabel,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId ?? undefined,
    summary: log.summary,
    detail: log.detail ?? undefined,
    requestId: log.requestId ?? undefined,
    ipAddress: log.ipAddress ?? undefined,
    createdAt: log.createdAt.toISOString()
  }));
}
