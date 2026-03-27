import { randomBytes, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

const secretFilePath = fileURLToPath(new URL("../../.occ-secret", import.meta.url));
let cachedAppSecret: string | null = null;

export async function getAppSecret() {
  if (cachedAppSecret) {
    return cachedAppSecret;
  }

  const fromEnv = process.env.APP_SECRET?.trim();
  if (fromEnv) {
    cachedAppSecret = fromEnv;
    return fromEnv;
  }

  try {
    const existing = (await fs.readFile(secretFilePath, "utf8")).trim();
    if (existing) {
      cachedAppSecret = existing;
      return existing;
    }
  } catch {
    // fall through and create one
  }

  const generated = randomBytes(32).toString("hex");
  await fs.writeFile(secretFilePath, generated, { mode: 0o600 });
  cachedAppSecret = generated;
  return generated;
}

export async function encryptSecret(plainText: string) {
  if (!plainText) {
    return "";
  }

  if (plainText.startsWith("enc:v1:")) {
    return plainText;
  }

  const key = await deriveEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export async function decryptSecret(cipherText: string) {
  if (!cipherText) {
    return "";
  }

  if (!cipherText.startsWith("enc:v1:")) {
    return cipherText;
  }

  const [, version, ivValue, tagValue, payload] = cipherText.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !payload) {
    throw new Error("Secret format is invalid");
  }

  const key = await deriveEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

export function createSalt() {
  return randomBytes(16).toString("hex");
}

export function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

export function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export function generateSessionToken() {
  return randomBytes(32).toString("hex");
}

export async function hashSessionToken(token: string) {
  // 使用应用密钥作为盐值的一部分，确保一致性
  const appSecret = await getAppSecret();
  const salt = `session:${appSecret}`;
  return scryptSync(token, salt, 32).toString("hex");
}

async function deriveEncryptionKey() {
  return scryptSync(await getAppSecret(), "occ-runtime-secret", 32);
}
