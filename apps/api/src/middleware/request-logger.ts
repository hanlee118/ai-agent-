import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import { trackRequestSample } from "../system/performance-monitor.js";

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
    const durationMs = Date.now() - start;
    const contentLengthRaw = res.getHeader("content-length");
    const bytes = Number(
      typeof contentLengthRaw === "string"
        ? contentLengthRaw
        : Array.isArray(contentLengthRaw)
          ? contentLengthRaw[0]
          : contentLengthRaw ?? 0
    );
    const log = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      timestamp: new Date().toISOString()
    };
    trackRequestSample({
      route: req.path || req.originalUrl || "/unknown",
      durationMs,
      statusCode: res.statusCode,
      bytes: Number.isFinite(bytes) ? bytes : 0
    });
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
