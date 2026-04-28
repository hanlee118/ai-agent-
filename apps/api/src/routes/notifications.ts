import express from "express";
import { MutationPassthroughSchema } from "../validation/schemas.js";
import { validateBody } from "../validation/middleware.js";
import type { NotificationInboxUpdateInput } from "@occ/shared";
import {
  getNotificationInboxCandidateTotal,
  listNotificationInbox,
  updateNotificationInboxState
} from "../system/notifications.js";
const NOTIFICATION_TOTAL_CACHE_TTL_MS = Math.max(
  3_000,
  Number(process.env.NOTIFICATION_TOTAL_CACHE_TTL_MS ?? 20_000)
);
const notificationTotalCache = new Map<"zh-CN" | "en-US", { value: number; expiresAt: number }>();

interface CreateNotificationsRouterOptions {
  asyncRoute: (
    handler: (req: express.Request, res: express.Response) => Promise<void>
  ) => express.RequestHandler;
  safeAudit: (
    req: express.Request,
    res: express.Response,
    input: {
      actorType: "admin" | "system";
      actorLabel: string;
      action: string;
      resourceType: string;
      resourceId?: string;
      summary: string;
      detail?: string;
    }
  ) => Promise<void>;
}

export function createNotificationsRouter(options: CreateNotificationsRouterOptions) {
  const router = express.Router();
  const { asyncRoute, safeAudit } = options;

  router.get("/notifications", asyncRoute(async (req, res) => {
    const locale = String(req.query.locale ?? "zh-CN").trim() === "en-US" ? "en-US" : "zh-CN";
    const pageRaw = Number(req.query.page ?? 1);
    const pageSizeRaw = Number(req.query.pageSize ?? req.query.limit ?? 20);
    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
    const pageSize = Number.isFinite(pageSizeRaw) ? Math.max(1, Math.min(100, Math.floor(pageSizeRaw))) : 20;
    const now = Date.now();
    const cached = notificationTotalCache.get(locale);
    const total = cached && cached.expiresAt > now
      ? cached.value
      : await getNotificationInboxCandidateTotal(locale);
    if (!cached || cached.expiresAt <= now) {
      notificationTotalCache.set(locale, {
        value: total,
        expiresAt: now + NOTIFICATION_TOTAL_CACHE_TTL_MS
      });
    }
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Page-Size", String(pageSize));
    res.setHeader("X-Total-Count", String(total));
    const summary = String(req.query.summary ?? "true").trim().toLowerCase() !== "false";
    res.json(await listNotificationInbox(locale, { page, pageSize, summary }));
  }));

  router.patch("/notifications/:sourceKey", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const sourceKey = String(req.params.sourceKey ?? "").trim();
    if (!sourceKey) {
      res.status(400).json({ message: "sourceKey is required" });
      return;
    }

    const payload = (req.body ?? {}) as Partial<NotificationInboxUpdateInput> & { status?: string };
    const status = String(payload.status ?? "").trim().toLowerCase();
    const updated = await updateNotificationInboxState(sourceKey, {
      read: payload.read ?? (status === "read" ? true : undefined),
      assignedTo: payload.assignedTo,
      confirmedBy: payload.confirmedBy,
      workflowStatus: payload.workflowStatus
    });

    if (!updated) {
      res.status(404).json({ message: "Notification not found" });
      return;
    }

    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "notification.updated",
      resourceType: "notification",
      resourceId: sourceKey,
      summary: `通知状态已更新：${sourceKey}`
    });
    res.json(updated);
  }));

  return router;
}
