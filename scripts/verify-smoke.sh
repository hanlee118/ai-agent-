#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

API_BASE_URL="${OCC_BASE_URL:-}"
TMP_DIR="$(mktemp -d)"
SESSION_TOKEN=""
COOKIE_HEADER=""
API_STARTED_BY_SCRIPT="false"
SKIP_OPENCLAW_CHECKS="false"
TEMP_SESSION_CREATED="false"
API_LOGIN_SESSION_CREATED="false"
SESSION_SOURCE="none"
CONFIGURED_SESSION_COOKIE_RAW="${VERIFY_SMOKE_SESSION_COOKIE:-${HEALTHCHECK_SESSION_COOKIE:-${OCC_SESSION_COOKIE:-}}}"
CONFIGURED_ADMIN_PASSWORD="${VERIFY_SMOKE_ADMIN_PASSWORD:-${HEALTHCHECK_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-}}}"

is_true() {
  local raw="${1:-}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  [[ "$raw" == "1" || "$raw" == "true" || "$raw" == "yes" || "$raw" == "on" ]]
}

if is_true "${CI_SKIP_OPENCLAW_CHECKS:-}" || is_true "${CI:-}"; then
  SKIP_OPENCLAW_CHECKS="true"
fi

cleanup() {
  if [[ "$API_LOGIN_SESSION_CREATED" == "true" && -n "$COOKIE_HEADER" && -n "$API_BASE_URL" ]]; then
    curl -sS -X POST -H "Cookie: $COOKIE_HEADER" "$API_BASE_URL/api/auth/logout" >/dev/null 2>&1 || true
  fi

  if [[ "$TEMP_SESSION_CREATED" == "true" && -n "$SESSION_TOKEN" ]]; then
    SESSION_TOKEN="$SESSION_TOKEN" node --input-type=module <<'EOF' || true
import { prisma } from "./apps/api/dist/db.js";
import { hashSessionToken } from "./apps/api/dist/security/secret-store.js";

const sessionToken = String(process.env.SESSION_TOKEN ?? "").trim();
if (sessionToken) {
  await prisma.authSession.deleteMany({
    where: { tokenHash: await hashSessionToken(sessionToken) }
  });
}

await prisma.$disconnect();
EOF
  fi

  if [[ "$API_STARTED_BY_SCRIPT" == "true" ]]; then
    pnpm daemon:stop >/dev/null 2>&1 || true
  fi

  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

ensure_preflight() {
  local parsed
  parsed="$(
    REQUESTED_API_BASE_URL="$API_BASE_URL" node --input-type=module <<'EOF'
import { prisma } from "./apps/api/dist/db.js";
import { runPreflight } from "./scripts/lib/preflight-runner.mjs";

const result = await runPreflight({
  needDb: true,
  db: {
    databaseUrl: process.env.DATABASE_URL || "",
    cwd: process.cwd(),
    serviceName: "db",
    maxAttempts: 12,
    intervalMs: 1000,
    eagerStartDocker: true,
    probe: async () => {
      await prisma.$queryRawUnsafe("SELECT 1");
    }
  },
  needApi: true,
  api: {
    requestedBaseUrl: String(process.env.REQUESTED_API_BASE_URL || ""),
    checkPathname: "/health",
    autoStartDaemon: true,
    startCommand: ["pnpm", "daemon:start"],
    cwd: process.cwd(),
  }
});

await prisma.$disconnect();
const apiBaseUrl = String(result?.api?.apiBaseUrl || "").trim();
const apiOk = Boolean(result?.api?.ok);
const apiStartedByScript = Boolean(result?.api?.startedByScript);
process.stdout.write(`${apiBaseUrl}\n${apiOk ? "1" : "0"}\n${apiStartedByScript ? "1" : "0"}\n`);
EOF
  )"

  local parsed_api_base parsed_api_ok parsed_started
  parsed_api_base="$(printf '%s\n' "$parsed" | sed -n '1p')"
  parsed_api_ok="$(printf '%s\n' "$parsed" | sed -n '2p')"
  parsed_started="$(printf '%s\n' "$parsed" | sed -n '3p')"

  if [[ "$parsed_api_ok" != "1" || -z "$parsed_api_base" ]]; then
    echo "verify-smoke: preflight api check failed" >&2
    return 1
  fi

  API_BASE_URL="$parsed_api_base"
  if [[ "$parsed_started" == "1" ]]; then
    API_STARTED_BY_SCRIPT="true"
  fi

  return 0
}

assert_json() {
  local file_path="$1"
  local script="$2"

  node --input-type=module - "$file_path" "$script" <<'EOF'
import { readFileSync } from "node:fs";

const [, , filePath, script] = process.argv;
const payload = JSON.parse(readFileSync(filePath, "utf8"));
const assertion = new Function("payload", script);
assertion(payload);
EOF
}

normalize_session_cookie() {
  local raw="${1:-}"
  raw="$(printf '%s' "$raw" | tr -d '\r\n' | sed 's/^ *//;s/ *$//')"
  [[ -n "$raw" ]] || return 1
  if [[ "$raw" == *"="* ]]; then
    printf '%s' "$raw"
  else
    printf 'occ_session=%s' "$raw"
  fi
}

create_temporary_authenticated_session() {
  echo "verify-smoke: creating temporary authenticated session"
  SESSION_TOKEN="$(node --input-type=module <<'EOF'
import { prisma } from "./apps/api/dist/db.js";
import { generateSessionToken, hashSessionToken } from "./apps/api/dist/security/secret-store.js";

const sessionToken = generateSessionToken();
await prisma.authSession.create({
  data: {
    tokenHash: await hashSessionToken(sessionToken),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  }
});

console.log(sessionToken);
await prisma.$disconnect();
EOF
)"

  COOKIE_HEADER="occ_session=${SESSION_TOKEN}"
  TEMP_SESSION_CREATED="true"
  SESSION_SOURCE="temporary-session"
}

session_is_authenticated() {
  local cookie_header="${1:-}"
  [[ -n "$cookie_header" ]] || return 1
  local auth_status_file="$TMP_DIR/auth-status-session.json"
  if ! curl -sf -H "Cookie: $cookie_header" "$API_BASE_URL/api/auth/status" > "$auth_status_file"; then
    return 1
  fi
  node --input-type=module - "$auth_status_file" <<'EOF' >/dev/null
import { readFileSync } from "node:fs";
const payload = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (payload.authenticated !== true) {
  process.exit(1);
}
EOF
}

login_admin_authenticated_session() {
  local password="${1:-}"
  [[ -n "$password" ]] || return 1

  local body_file="$TMP_DIR/login-body.json"
  local headers_file="$TMP_DIR/login-headers.txt"
  local payload
  payload="$(PASSWORD="$password" node --input-type=module <<'EOF'
console.log(JSON.stringify({ password: process.env.PASSWORD ?? "" }));
EOF
)"
  local status
  status="$(curl -sS -D "$headers_file" -o "$body_file" -w "%{http_code}" \
    -X POST "$API_BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "$payload")"

  if [[ "$status" != "200" ]]; then
    return 1
  fi

  local set_cookie
  set_cookie="$(grep -i '^Set-Cookie:' "$headers_file" | sed -E 's/^[Ss]et-[Cc]ookie:[[:space:]]*//' | tr -d '\r' | head -n 1)"
  local cookie
  cookie="$(printf '%s' "$set_cookie" | grep -o 'occ_session=[^;]*' | head -n 1 || true)"
  [[ -n "$cookie" ]] || return 1

  COOKIE_HEADER="$cookie"
  API_LOGIN_SESSION_CREATED="true"
  SESSION_SOURCE="password-login"
  return 0
}

ensure_preflight
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:8787}"

echo "verify-smoke: checking public endpoints"

curl -sf "$API_BASE_URL/health" > "$TMP_DIR/health.json"
assert_json "$TMP_DIR/health.json" '
  if (!payload.ok) throw new Error("/health did not report ok");
  if (payload.service !== "occ-api") throw new Error("/health returned unexpected service name");
'

curl -sf "$API_BASE_URL/ready" > "$TMP_DIR/ready.json"
if [[ "$SKIP_OPENCLAW_CHECKS" == "true" ]]; then
  assert_json "$TMP_DIR/ready.json" '
    if (!Array.isArray(payload.services) || payload.services.length === 0) throw new Error("/ready did not include service details");
  '
else
  assert_json "$TMP_DIR/ready.json" '
    if (!payload.ok) throw new Error("/ready did not report ready");
    if (!Array.isArray(payload.services) || payload.services.length === 0) throw new Error("/ready did not include service details");
  '
fi

curl -sf "$API_BASE_URL/api/auth/status" > "$TMP_DIR/auth-status.json"
AUTH_SETUP_COMPLETE="$(node --input-type=module - "$TMP_DIR/auth-status.json" <<'EOF'
import { readFileSync } from "node:fs";
const payload = JSON.parse(readFileSync(process.argv[2], "utf8"));
console.log(payload.setupComplete === true ? "true" : "false");
EOF
)"
if [[ "$AUTH_SETUP_COMPLETE" != "true" ]]; then
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE_URL/api/auth/setup" \
    -H "Content-Type: application/json" \
    -d '{"password":"Admin@123456"}' >/dev/null || true
  curl -sf "$API_BASE_URL/api/auth/status" > "$TMP_DIR/auth-status.json"
fi
assert_json "$TMP_DIR/auth-status.json" '
  if (!payload.setupComplete) throw new Error("auth setup is incomplete");
  if (typeof payload.authenticated !== "boolean") throw new Error("auth status did not expose authenticated flag");
'

NORMALIZED_CONFIGURED_SESSION_COOKIE="$(normalize_session_cookie "$CONFIGURED_SESSION_COOKIE_RAW" || true)"
if [[ -n "$NORMALIZED_CONFIGURED_SESSION_COOKIE" ]] && session_is_authenticated "$NORMALIZED_CONFIGURED_SESSION_COOKIE"; then
  echo "verify-smoke: using configured authenticated session cookie"
  COOKIE_HEADER="$NORMALIZED_CONFIGURED_SESSION_COOKIE"
  SESSION_SOURCE="env-cookie"
elif [[ -n "$CONFIGURED_ADMIN_PASSWORD" ]] && login_admin_authenticated_session "$CONFIGURED_ADMIN_PASSWORD"; then
  echo "verify-smoke: authenticated via admin password login"
else
  create_temporary_authenticated_session
fi

echo "verify-smoke: session source = $SESSION_SOURCE"

UNAUTH_STATUS="$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE_URL/api/system/runtime")"
if [[ "$UNAUTH_STATUS" != "401" ]]; then
  echo "Expected /api/system/runtime to reject anonymous access with 401, got $UNAUTH_STATUS" >&2
  exit 1
fi

echo "verify-smoke: checking protected APIs"

curl -sf -H "Cookie: $COOKIE_HEADER" "$API_BASE_URL/api/system/runtime" > "$TMP_DIR/runtime.json"
assert_json "$TMP_DIR/runtime.json" '
  if (typeof payload.mode !== "string" || payload.mode.length === 0) throw new Error("runtime mode missing");
'

curl -sf -H "Cookie: $COOKIE_HEADER" "$API_BASE_URL/api/projects" > "$TMP_DIR/projects.json"
if [[ "$SKIP_OPENCLAW_CHECKS" == "true" ]]; then
  assert_json "$TMP_DIR/projects.json" '
    if (!Array.isArray(payload)) throw new Error("projects endpoint did not return an array");
  '
else
  assert_json "$TMP_DIR/projects.json" '
    if (!Array.isArray(payload) || payload.length === 0) throw new Error("projects endpoint returned no projects");
  '
fi

if [[ "$SKIP_OPENCLAW_CHECKS" != "true" ]]; then
  curl -sf -H "Cookie: $COOKIE_HEADER" "$API_BASE_URL/api/openclaw/workspace" > "$TMP_DIR/workspace.json"
  assert_json "$TMP_DIR/workspace.json" '
    if (!Array.isArray(payload.agents)) throw new Error("workspace did not expose agents");
    if (!Array.isArray(payload.projects)) throw new Error("workspace did not expose projects");
  '

  curl -sf -H "Cookie: $COOKIE_HEADER" "$API_BASE_URL/api/openclaw/agents" > "$TMP_DIR/openclaw-agents.json"
  assert_json "$TMP_DIR/openclaw-agents.json" '
    if (!Array.isArray(payload)) throw new Error("openclaw agents endpoint did not return array");
    if (payload.length > 0 && !payload.some((agent) => agent.agentId === "jeremy")) throw new Error("jeremy agent is missing from API output");
  '
fi

curl -sf -H "Cookie: $COOKIE_HEADER" "$API_BASE_URL/api/system/local-agent-monitor" > "$TMP_DIR/local-monitor.json"
assert_json "$TMP_DIR/local-monitor.json" '
  if (!Array.isArray(payload.tools) || payload.tools.length === 0) throw new Error("local monitor has no tool summaries");
  if (!Array.isArray(payload.sessions)) throw new Error("local monitor sessions are missing");
  if (!payload.totals || typeof payload.totals.totalTokens !== "number") throw new Error("local monitor totals are missing");
'

echo "verify-smoke: checking local monitor SSE stream"

set +o pipefail
SSE_SNAPSHOT="$(
  curl -m 6 -sN \
    -H "Accept: text/event-stream" \
    -H "Cookie: $COOKIE_HEADER" \
    "$API_BASE_URL/api/system/local-agent-monitor/live" \
  | awk '/^event: snapshot$/{getline; sub(/^data: /, ""); print; exit}'
)"
set -o pipefail

if [[ -z "$SSE_SNAPSHOT" ]]; then
  echo "Did not receive a snapshot event from local monitor SSE stream" >&2
  exit 1
fi

printf '%s' "$SSE_SNAPSHOT" > "$TMP_DIR/local-monitor-sse.json"
assert_json "$TMP_DIR/local-monitor-sse.json" '
  if (typeof payload.scannedAt !== "string" || payload.scannedAt.length === 0) throw new Error("SSE snapshot is missing scannedAt");
  if (!Array.isArray(payload.tools) || payload.tools.length === 0) throw new Error("SSE snapshot is missing tools");
'

echo "verify-smoke: ok"
