# 预检与自愈改造清单（最终版）

更新时间：2026-04-26

## 1. 改造目标

- 统一 DB/API/Hermes 的环境预检和自愈能力，降低脚本运行中的偶发失败。
- 让核心验收脚本共享同一套准备逻辑，减少重复代码与行为漂移。
- 保持“真实执行可观测”，避免通过脚本短路掩盖系统问题。

## 2. 新增模块

### `scripts/lib/db-self-heal.mjs`

- 功能：数据库自愈与重试（以 PostgreSQL 为主）。
- 关键能力：
  - 解析 `DATABASE_URL`
  - TCP 探测
  - 可选 `docker-compose up -d db`
  - 可插入自定义 `probe`（例如 Prisma `SELECT 1`）

### `scripts/lib/api-self-heal.mjs`

- 功能：API 可达性预检与可选 daemon 自启动。
- 关键能力：
  - 候选地址探测（8787/8794）
  - 可选执行 `pnpm daemon:start`
  - 返回 `startedByScript` 以支持安全 cleanup（避免误停外部服务）

### `scripts/lib/hermes-self-heal.mjs`

- 功能：Hermes 连通性与运行统计统一读取。
- 关键能力：
  - 调用 `/api/v1/workflows/hermes/status?probe=true`
  - 可选本地 `pnpm hermes:daemon:start`
  - 输出 `reachable`、`runtimeTotalSuccess`、`hasHistoricalHermesSuccess`

### `scripts/lib/preflight-runner.mjs`

- 功能：统一预检编排入口。
- 关键能力：
  - 通过 `needDb / needApi / needHermes` 声明式执行预检
  - 聚合返回各子模块结果，减少脚本重复实现

## 3. 已改造脚本

### `scripts/verify-smoke.sh`

- 已切换到 `preflight-runner` 统一做 DB+API 预检。
- 保留原有临时会话创建、受保护接口检查、SSE 检查流程。

### `scripts/verify-closure.mjs`

- 已切换到 `preflight-runner` 统一做 DB+API 预检。
- Hermes 检查改为 `hermes-self-heal`。
- 保留脚本启动资源的 cleanup（API/Hermes daemon）并避免误停外部服务。

### `scripts/audit-single-project-platform.mjs`

- 已切换到 `preflight-runner` 统一做 DB+API 预检。
- Hermes 门禁依赖 `hermes-self-heal` 统一探测。

### `scripts/health-check.mjs`

- 启动前统一执行 preflight（API 必需、Postgres 下 DB 必需）。
- Hermes 检查使用统一模块；默认仅探测不主动启动 Hermes。

## 4. 文档与入口

- 新增预检文档：`scripts/lib/README-preflight.md`
- 主文档入口已补充：`README.md`（“构建与自检”章节下）

## 5. 验证命令（团队标准）

```bash
pnpm health:check
pnpm verify:smoke
pnpm verify:closure:fast
pnpm audit:single-project:strict
```

推荐使用单项目固定验收：

```bash
PROJECT_ID=OCC-20260425-029 pnpm audit:single-project:strict
```

## 6. 环境变量要点

- API
  - `OCC_BASE_URL`
  - `HEALTHCHECK_API_BASE`
  - `HEALTHCHECK_AUTO_START_API`（默认 `true`）

- DB
  - `DATABASE_URL`

- Hermes
  - `WORKFLOW_V2_HERMES_ENABLED`
  - `WORKFLOW_V2_HERMES_ENDPOINT`
  - `HERMES_MCP_ENDPOINT`
  - `HERMES_MCP`

## 7. 运维注意事项

- `health-check` 默认不主动拉起 Hermes（避免健康检查改动运行态）。
- `verify-closure` 允许按需拉起 Hermes，保障闭环可复验。
- API daemon 仅在“本轮脚本确实启动”时 cleanup 才停止，避免误停外部已运行实例。

## 8. 建议的下一步（可选）

- 将 `scripts/lib` 增加轻量单元测试（重点验证返回结构和异常分支）。
- 为 preflight 增加统一日志级别参数（quiet/info/debug），便于 CI 观察。
- 将非核心历史验证脚本（如 `verify-real-data-round2`）逐步迁移到 `preflight-runner`。

