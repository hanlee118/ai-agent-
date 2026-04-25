import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const loopbackOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const desktopOriginPatterns = [
  /^app:\/\//i,
  /^tauri:\/\//i,
  /^capacitor:\/\/localhost$/i
];

function resolveAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveCorsOrigin(): cors.CorsOptions["origin"] {
  const configuredAllowedOrigins = resolveAllowedOrigins();

  if (process.env.NODE_ENV === "production" && configuredAllowedOrigins.length === 0) {
    throw new Error("生产环境必须设置 ALLOWED_ORIGINS 环境变量，不允许使用通配符");
  }

  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (configuredAllowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    if (loopbackOriginPattern.test(origin)) {
      callback(null, true);
      return;
    }

    if (desktopOriginPatterns.some((pattern) => pattern.test(origin))) {
      callback(null, true);
      return;
    }

    callback(new Error(`Not allowed by CORS: ${origin}`));
  };
}

export function configureSecurityMiddleware(app: Express) {
  const globalRateLimitMax = Math.max(100, Number(process.env.RATE_LIMIT_MAX ?? 5000));

  app.use(cors({
    origin: resolveCorsOrigin(),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"]
  }));

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: globalRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: "RATE_LIMIT", message: "请求过于频繁" }
      });
    }
  }));

  app.use("/api/auth/login", rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: "RATE_LIMIT", message: "登录尝试次数过多" }
      });
    }
  }));
}
