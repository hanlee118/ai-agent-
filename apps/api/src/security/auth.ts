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
      tokenHash: hashSessionToken(sessionToken)
    }
  });
}

export async function validateSession(sessionToken?: string | null) {
  if (!sessionToken) {
    return false;
  }

  const tokenHash = hashSessionToken(sessionToken);
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
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`
  ].join("; ");
}

export function clearSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ].join("; ");
}

async function createSession() {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.authSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      expiresAt
    }
  });

  return {
    token,
    expiresAt
  };
}
