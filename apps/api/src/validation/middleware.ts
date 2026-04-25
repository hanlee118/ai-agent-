import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { ZodType } from "zod";
import { sendError } from "../routes/utils.js";

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const messages = result.error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; ");
      sendError(res, 400, "VALIDATION_ERROR", messages);
      return;
    }
    req.body = result.data;
    next();
  };
}

const JsonObjectSchema = z.object({}).passthrough();

export function validateJsonMutationBody() {
  return (req: Request, res: Response, next: NextFunction) => {
    const method = String(req.method || "").toUpperCase();
    if (!["POST", "PUT", "PATCH"].includes(method)) {
      next();
      return;
    }

    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      next();
      return;
    }

    const result = JsonObjectSchema.safeParse(req.body);
    if (!result.success) {
      const messages = result.error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; ");
      sendError(res, 400, "VALIDATION_ERROR", messages || "body: 请求体必须是 JSON 对象");
      return;
    }

    next();
  };
}
