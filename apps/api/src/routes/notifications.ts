import express from "express";
import type { NotificationInboxUpdateInput } from "@occ/shared";
import { listNotificationInbox, updateNotificationInboxState } from "../system/notifications.js";

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
    res.json(await listNotificationInbox(locale));
  }));

  router.patch("/notifications/:sourceKey", asyncRoute(async (req, res) => {
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
