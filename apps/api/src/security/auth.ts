import type { AuthStatus } from "@occ/shared";
import { prisma } from "../db.js";
import { ensureSystemConfig } from "../system/runtime-config.js";
import {
  createSalt,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword
} from "./secret-store.js";

const SESSION_COOKIE = "occ_session";
const SESSION_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export async function getAuthStatus(sessionToken?: string | null): Promise<AuthStatus> {
  const config = await ensureSystemConfig();
  const setupComplete = Boolean(config.adminPasswordHash && config.adminPasswordSalt);
  const authenticated = setupComplete && sessionToken ? await validateSession(sessionToken) : false;

  return {
    setupComplete,
    authenticated
  };
}

export async function setupAdmin(password: string) {
  const config = await ensureSystemConfig();
  if (config.adminPasswordHash && config.adminPasswordSalt) {
    throw new Error("管理员密码已配置");
  }

  // 密码强度验证
  validatePasswordStrength(password);

  const salt = createSalt();
  const passwordHash = hashPassword(password, salt);

  await prisma.systemConfig.update({
    where: { id: config.id },
    data: {
      adminPasswordHash: passwordHash,
      adminPasswordSalt: salt,
      adminPasswordUpdatedAt: new Date()
    }
  });

  return createSession();
}

export async function loginAdmin(password: string) {
  const config = await ensureSystemConfig();
  if (!config.adminPasswordHash || !config.adminPasswordSalt) {
    throw new Error("系统尚未完成初始化，请先设置管理员密码");
  }

  if (!verifyPassword(password, config.adminPasswordSalt, config.adminPasswordHash)) {
    throw new Error("密码不正确");
  }

  return createSession();
}

export async function logoutAdmin(sessionToken?: string | null) {
  if (!sessionToken) {
    return;
  }

  await prisma.authSession.deleteMany({
    where: {
      tokenHash: await hashSessionToken(sessionToken)
    }
  });
}

export async function validateSession(sessionToken?: string | null) {
  if (!sessionToken) {
    return false;
  }

  const tokenHash = await hashSessionToken(sessionToken);
  const session = await prisma.authSession.findUnique({
    where: { tokenHash }
  });

  if (!session) {
    return false;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.delete({ where: { tokenHash } });
    return false;
  }

  await prisma.authSession.update({
    where: { tokenHash },
    data: {
      lastUsedAt: new Date()
    }
  });

  return true;
}

export function parseSessionToken(cookieHeader?: string | null) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((item) => item.trim());
  for (const entry of cookies) {
    const [key, ...rest] = entry.split("=");
    if (key === SESSION_COOKIE) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

export function createSessionCookie(token: string) {
  const isProduction = process.env.NODE_ENV === "production";
  const cookieParts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`
  ];

  // 生产环境必须使用 Secure 标志
  if (isProduction) {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

export function clearSessionCookie() {
  const isProduction = process.env.NODE_ENV === "production";
  const cookieParts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0"
  ];

  // 生产环境必须使用 Secure 标志
  if (isProduction) {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

async function createSession() {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(token),
      expiresAt
    }
  });

  return {
    token,
    expiresAt
  };
}

/**
 * 验证密码强度
 */
function validatePasswordStrength(password: string) {
  const errors: string[] = [];

  // 最小长度检查
  if (password.length < 8) {
    errors.push("密码长度至少需要8个字符");
  }

  // 最大长度检查（防止DOS）
  if (password.length > 128) {
    errors.push("密码长度不能超过128个字符");
  }

  // 大写字母检查
  if (!/[A-Z]/.test(password)) {
    errors.push("密码必须包含至少1个大写字母");
  }

  // 小写字母检查
  if (!/[a-z]/.test(password)) {
    errors.push("密码必须包含至少1个小写字母");
  }

  // 数字检查
  if (!/\d/.test(password)) {
    errors.push("密码必须包含至少1个数字");
  }

  // 特殊字符检查
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    errors.push("密码必须包含至少1个特殊字符");
  }

  // 常见密码检查
  const commonPasswords = [
    "password", "123456", "123456789", "qwerty", "abc123",
    "password123", "admin", "administrator", "root", "user",
    "12345678", "1234567890", "Pass@word1", "Welcome1"
  ];

  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push("不能使用常见的弱密码");
  }

  // 重复字符检查
  if (/(.)\1{2,}/.test(password)) {
    errors.push("密码不能包含连续3个相同字符");
  }

  if (errors.length > 0) {
    throw new Error(`密码不符合安全要求：${errors.join(', ')}`);
  }
}
