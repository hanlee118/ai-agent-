#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

API_BASE_URL="${OCC_BASE_URL:-}"
TMP_DIR="$(mktemp -d)"
SESSION_TOKEN=""
API_STARTED_BY_SCRIPT="false"
SKIP_OPENCLAW_CHECKS="false"

is_true() {
  local raw="${1:-}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  [[ "$raw" == "1" || "$raw" == "true" || "$raw" == "yes" || "$raw" == "on" ]]
}

if is_true "${CI_SKIP_OPENCLAW_CHECKS:-}" || is_true "${CI:-}"; then
  SKIP_OPENCLAW_CHECKS="true"
fi

cleanup() {
  if [[ -n "$SESSION_TOKEN" ]]; then
    SESSION_TOKEN="$SESSION_TOKEN" node --input-type=module <<'EOF'
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

resolve_api_base_url() {
  local cookie_header="${1:-}"

  for candidate in \
    "http://127.0.0.1:8787" \
    "http://127.0.0.1:8794" \
    "http://localhost:8787" \
    "http://localhost:8794"
  do
    if [[ -n "$cookie_header" ]]; then
      local status
      status="$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: $cookie_header" "$candidate/api/system/runtime" || true)"
      if [[ "$status" == "200" ]]; then
        echo "$candidate"
        return 0
      fi
    elif curl -sf "$candidate/health" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

ensure_api_ready() {
  if [[ -n "$API_BASE_URL" ]] && curl -sf "$API_BASE_URL/health" >/dev/null 2>&1; then
    return 0
  fi

  if [[ -z "$API_BASE_URL" ]]; then
    API_BASE_URL="$(resolve_api_base_url "$COOKIE_HEADER" || resolve_api_base_url || true)"
  fi

  if [[ -n "$API_BASE_URL" ]] && curl -sf "$API_BASE_URL/health" >/dev/null 2>&1; then
    return 0
  fi

  echo "verify-smoke: API not reachable, starting local daemon on :8787"
  pnpm daemon:start >/dev/null
  API_STARTED_BY_SCRIPT="true"
  API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:8787}"

  for _ in $(seq 1 20); do
    if curl -sf "$API_BASE_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "verify-smoke: API did not become healthy in time" >&2
  return 1
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

ensure_api_ready
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
assert_json "$TMP_DIR/projects.json" '
  if (!Array.isArray(payload) || payload.length === 0) throw new Error("projects endpoint returned no projects");
'

if [[ "$SKIP_OPENCLAW_CHECKS" != "true" ]]; then
  curl -sf -H "Cookie: $COOKIE_HEADER" "$API_BASE_URL/api/openclaw/workspace" > "$TMP_DIR/workspace.json"
  assert_json "$TMP_DIR/workspace.json" '
    if (!Array.isArray(payload.agents) || payload.agents.length === 0) throw new Error("workspace did not expose agents");
    if (!Array.isArray(payload.projects) || payload.projects.length === 0) throw new Error("workspace did not expose projects");
  '

  curl -sf -H "Cookie: $COOKIE_HEADER" "$API_BASE_URL/api/openclaw/agents" > "$TMP_DIR/openclaw-agents.json"
  assert_json "$TMP_DIR/openclaw-agents.json" '
    if (!Array.isArray(payload) || payload.length === 0) throw new Error("openclaw agents endpoint returned no agents");
    if (!payload.some((agent) => agent.agentId === "jeremy")) throw new Error("jeremy agent is missing from API output");
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
