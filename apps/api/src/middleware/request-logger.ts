import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";

const LOG_FILE_PATH = path.resolve(process.cwd(), process.env.API_LOG_PATH || "logs/api.log");
let logDirectoryReady: Promise<void> | undefined;

function ensureLogDirectoryReady() {
  if (!logDirectoryReady) {
    logDirectoryReady = mkdir(path.dirname(LOG_FILE_PATH), { recursive: true })
      .then(() => undefined)
      .catch(() => undefined);
  }
  return logDirectoryReady;
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const incomingRequestId = String(req.headers["x-request-id"] ?? "").trim();
  const requestId = incomingRequestId || randomUUID();

  req.headers["x-request-id"] = requestId;
  res.locals.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  const start = Date.now();
  res.on("finish", () => {
    const log = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString()
    };
    void ensureLogDirectoryReady()
      .then(() => appendFile(LOG_FILE_PATH, `${JSON.stringify(log)}\n`, "utf8"))
      .catch(() => undefined);
    if (res.statusCode >= 400) {
      console.error("[REQUEST_ERROR]", JSON.stringify(log));
    } else {
      console.log("[REQUEST]", JSON.stringify(log));
    }
  });

  next();
}
