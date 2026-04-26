import net from "node:net";
import { execFileSync } from "node:child_process";

const WAIT = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parsePostgresEndpoint(databaseUrl) {
  const raw = String(databaseUrl || "").trim();
  if (!/^postgres(ql)?:\/\//i.test(raw)) {
    return null;
  }
  try {
    const url = new URL(raw);
    const host = url.hostname || "127.0.0.1";
    const port = Number(url.port || 5432);
    return {
      host,
      port: Number.isFinite(port) && port > 0 ? port : 5432,
    };
  } catch {
    return { host: "127.0.0.1", port: 5432 };
  }
}

async function isTcpReachable({ host, port, timeoutMs = 1200 }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

function startDockerDbBestEffort({ cwd, serviceName, logger }) {
  try {
    execFileSync("docker-compose", ["up", "-d", serviceName], {
      cwd,
      stdio: "ignore",
    });
    logger?.(`docker-compose up -d ${serviceName} issued`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.(`docker-compose up failed (non-blocking): ${message.split("\n")[0]}`);
  }
}

export async function ensureDatabaseReady(options = {}) {
  const {
    databaseUrl = process.env.DATABASE_URL || "",
    cwd = process.cwd(),
    serviceName = "db",
    maxAttempts = 12,
    intervalMs = 1500,
    connectTimeoutMs = 1200,
    logger = null,
    probe = null,
    eagerStartDocker = true,
  } = options;

  const endpoint = parsePostgresEndpoint(databaseUrl);
  if (!endpoint) {
    return { ok: true, skipped: true, reason: "non-postgres-database-url" };
  }

  if (eagerStartDocker) {
    startDockerDbBestEffort({ cwd, serviceName, logger });
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const tcpReady = await isTcpReachable({
      host: endpoint.host,
      port: endpoint.port,
      timeoutMs: connectTimeoutMs,
    });

    if (tcpReady) {
      if (!probe) {
        return { ok: true, attempt, endpoint };
      }
      try {
        await probe();
        return { ok: true, attempt, endpoint };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        logger?.(`probe failed on attempt ${attempt}/${maxAttempts}: ${message.split("\n")[0]}`);
      }
    } else {
      lastError = new Error(`tcp connect failed to ${endpoint.host}:${endpoint.port}`);
      logger?.(`db tcp not ready on attempt ${attempt}/${maxAttempts}`);
    }

    if (attempt === 1 && !eagerStartDocker) {
      startDockerDbBestEffort({ cwd, serviceName, logger });
    }
    if (attempt < maxAttempts) {
      await WAIT(intervalMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("database not reachable");
}
