# Preflight Runner 说明

本目录的预检体系用于在执行验证脚本前，统一完成环境准备，降低间歇性失败。

## 模块结构

- `db-self-heal.mjs`
  - 职责：确保数据库（主要是 PostgreSQL）可连通。
  - 动作：TCP 探测、可选 `docker-compose up -d db`、可插入 `probe`（例如 Prisma `SELECT 1`）。

- `api-self-heal.mjs`
  - 职责：确保 API 可访问。
  - 动作：多候选地址探测、可选自动 `pnpm daemon:start`。
  - 输出：`apiBaseUrl`、`startedByScript`（用于后续安全回收）。

- `hermes-self-heal.mjs`
  - 职责：确保 Hermes probe 可达，并统一 runtime 统计读取。
  - 动作：调用 `/api/v1/workflows/hermes/status?probe=true`，可选本地 `pnpm hermes:daemon:start`。
  - 输出：`reachable`、`runtimeTotalSuccess`、`hasHistoricalHermesSuccess` 等。

- `preflight-runner.mjs`
  - 职责：统一编排入口。
  - 用法：按需声明 `needDb / needApi / needHermes`，并分别传入对应配置。

## 当前接入脚本

- `scripts/verify-smoke.sh`
- `scripts/verify-closure.mjs`
- `scripts/audit-single-project-platform.mjs`
- `scripts/health-check.mjs`

## 推荐调用方式

```js
import { runPreflight } from "./lib/preflight-runner.mjs";

const preflight = await runPreflight({
  needDb: true,
  db: { databaseUrl: process.env.DATABASE_URL || "", cwd: process.cwd() },
  needApi: true,
  api: { requestedBaseUrl: process.env.OCC_BASE_URL || "", cwd: process.cwd() },
  needHermes: false
});
```

## 常用环境变量

- API 相关
  - `OCC_BASE_URL`
  - `HEALTHCHECK_API_BASE`
  - `HEALTHCHECK_AUTO_START_API`（默认 `true`）

- DB 相关
  - `DATABASE_URL`

- Hermes 相关
  - `WORKFLOW_V2_HERMES_ENABLED`
  - `WORKFLOW_V2_HERMES_ENDPOINT`
  - `HERMES_MCP_ENDPOINT`
  - `HERMES_MCP`

## 行为约定

- 健康检查 `health-check` 默认不会主动拉起 Hermes，只做探测（`autoStartLocal=false`）。
- `verify-closure` 为了保证可复验，允许按需启动 Hermes daemon。
- API daemon 仅在“本轮脚本确实启动”时才会在 cleanup 停止，避免误停外部已在运行的服务。

## 排障建议

1. 先执行 `pnpm health:check`，确认 API/DB 基础连通。
2. 若 Hermes 失败，先执行 `pnpm hermes:daemon:status`，必要时 `pnpm hermes:daemon:start`。
3. 若 DB 抖动，先执行 `docker-compose up -d db`，再复跑脚本。
4. 若仍失败，查看：
   - `docs/reports/system-health-check-latest.json`
   - `docs/reports/single-project-platform-audit-latest.json`

