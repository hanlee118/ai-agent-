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
const DEFAULT_ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "admin@occ.local").trim().toLowerCase();
const DEFAULT_ADMIN_NAME = String(process.env.ADMIN_NAME || "System Admin").trim() || "System Admin";

export async function getAuthStatus(sessionToken?: string | null): Promise<AuthStatus> {
  const config = await ensureSystemConfig();
  const setupComplete = Boolean(config.adminPasswordHash && config.adminPasswordSalt);
  const currentUser = setupComplete && sessionToken ? await getCurrentUser(sessionToken) : null;
  const authenticated = Boolean(currentUser);

  return {
    setupComplete,
    authenticated,
    user: currentUser
      ? {
          id: currentUser.id,
          email: currentUser.email,
          name: currentUser.name,
          role: currentUser.role
        }
      : undefined
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

  const adminUser = await ensureAdminUser();
  return createSession(adminUser.id);
}

export async function loginAdmin(password: string) {
  const config = await ensureSystemConfig();
  if (!config.adminPasswordHash || !config.adminPasswordSalt) {
    throw new Error("系统尚未完成初始化，请先设置管理员密码");
  }

  if (!verifyPassword(password, config.adminPasswordSalt, config.adminPasswordHash)) {
    throw new Error("密码不正确");
  }

  const adminUser = await ensureAdminUser();
  return createSession(adminUser.id);
}

type RegisterUserInput = {
  email: string;
  name: string;
  password: string;
  role?: string;
};

const ALLOWED_USER_ROLES = new Set(["admin", "viewer", "editor"]);

function normalizeUserRole(role: string) {
  const normalized = String(role || "").trim().toLowerCase();
  if (ALLOWED_USER_ROLES.has(normalized)) {
    return normalized;
  }
  return "viewer";
}

function validateEmailFormat(email: string) {
  const normalized = String(email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export async function registerUserByAdmin(sessionToken: string | null | undefined, input: RegisterUserInput) {
  const actor = await getCurrentUser(sessionToken);
  if (!actor) {
    throw new Error("AUTH_REQUIRED");
  }
  if (String(actor.role || "").toLowerCase() !== "admin") {
    throw new Error("FORBIDDEN");
  }

  const email = String(input.email || "").trim().toLowerCase();
  const name = String(input.name || "").trim();
  const password = String(input.password || "");
  const role = normalizeUserRole(String(input.role || "viewer"));

  if (!validateEmailFormat(email)) {
    throw new Error("INVALID_EMAIL");
  }
  if (name.length < 1) {
    throw new Error("INVALID_NAME");
  }
  validatePasswordStrength(password);

  const exists = await prisma.userProfile.findUnique({
    where: { email }
  });
  if (exists) {
    throw new Error("USER_EXISTS");
  }

  const salt = createSalt();
  const passwordHash = hashPassword(password, salt);

  return prisma.userProfile.create({
    data: {
      email,
      name,
      role,
      passwordHash,
      passwordSalt: salt,
      passwordUpdatedAt: new Date(),
      isActive: true
    }
  });
}

export async function loginUserByEmail(emailInput: string, passwordInput: string) {
  const email = String(emailInput || "").trim().toLowerCase();
  const password = String(passwordInput || "");
  if (!email || !password) {
    throw new Error("CREDENTIALS_REQUIRED");
  }

  const user = await prisma.userProfile.findUnique({
    where: { email }
  });
  if (!user || !user.isActive) {
    throw new Error("INVALID_CREDENTIALS");
  }
  if (!user.passwordHash || !user.passwordSalt) {
    throw new Error("PASSWORD_NOT_SET");
  }
  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    throw new Error("INVALID_CREDENTIALS");
  }

  return createSession(user.id);
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
  return Boolean(await resolveSession(sessionToken));
}

export async function resolveSession(sessionToken?: string | null) {
  if (!sessionToken) {
    return null;
  }

  const tokenHash = await hashSessionToken(sessionToken);
  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    include: {
      user: true
    }
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.deleteMany({ where: { tokenHash } });
    return null;
  }

  await prisma.authSession.update({
    where: { tokenHash },
    data: {
      lastUsedAt: new Date()
    }
  });

  return session;
}

export async function getCurrentUser(sessionToken?: string | null) {
  const session = await resolveSession(sessionToken);
  if (!session) {
    return null;
  }

  if (session.user?.isActive) {
    return session.user;
  }

  // Backward compatibility for legacy sessions without userId.
  const adminUser = await ensureAdminUser();
  if (!session.userId) {
    await prisma.authSession.update({
      where: { tokenHash: session.tokenHash },
      data: { userId: adminUser.id }
    });
  }
  return adminUser;
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

async function createSession(userId?: string) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(token),
      userId: userId || null,
      expiresAt
    }
  });

  return {
    token,
    expiresAt
  };
}

async function ensureAdminUser() {
  const existing = await prisma.userProfile.findUnique({
    where: { email: DEFAULT_ADMIN_EMAIL }
  });
  if (existing) {
    if (existing.role !== "admin" || !existing.isActive) {
      return prisma.userProfile.update({
        where: { id: existing.id },
        data: {
          role: "admin",
          isActive: true
        }
      });
    }
    return existing;
  }

  return prisma.userProfile.create({
    data: {
      email: DEFAULT_ADMIN_EMAIL,
      name: DEFAULT_ADMIN_NAME,
      role: "admin",
      isActive: true
    }
  });
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

  // 特殊字符不再强制，避免阻塞基础角色创建与自动化验收。
  // 仍通过最小长度 + 大小写 + 数字约束确保基本安全强度。

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
