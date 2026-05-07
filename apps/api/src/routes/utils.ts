import { Prisma } from "@prisma/client";
import type express from "express";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "WORKFLOW_ADVANCE_TIMEOUT"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export function sendSuccess<T>(res: express.Response, data: T, status = 200) {
  res.status(status).json({
    success: true,
    data
  });
}

export function sendError(
  res: express.Response,
  status: number,
  code: ApiErrorCode,
  message: string
) {
  res.status(status).json({
    success: false,
    code,
    message,
    error: {
      code,
      message
    }
  });
}

export function asyncRoute(
  handler: (req: express.Request, res: express.Response) => Promise<void>
): express.RequestHandler {
  return (req, res) => {
    void handler(req, res).catch((error) => {
      const requestIdHeader = res.getHeader("X-Request-ID");
      const requestId = typeof requestIdHeader === "string" ? requestIdHeader : "unknown";
      console.error("[ROUTE_ERROR]", JSON.stringify({
        requestId,
        route: req.path,
        method: req.method,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }));

      if (res.headersSent) {
        return;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2021"
      ) {
        sendError(
          res,
          503,
          "SERVICE_UNAVAILABLE",
          "数据库结构未同步，请先执行 Prisma 数据库同步。"
        );
        return;
      }

      const message = error instanceof Error ? error.message : "Internal server error";
      sendError(res, 500, "INTERNAL_ERROR", message);
    });
  };
}

export function maskApiKey(raw: string | null) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

export function parseStoredSteps(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeStringArray(parsed);
  } catch {
    return [];
  }
}

export function parsePositiveInt(input: unknown, fallback: number) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return fallback;
  }

  return rounded;
}

export function isoDateOnly(input: Date) {
  return input.toISOString().slice(0, 10);
}
