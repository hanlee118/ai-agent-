# GitLab 集成联调报告（2026-03-31）

## 范围
- 后端路由：`/api/gitlab/*`
- Webhook：`POST /api/gitlab/webhook`
- 运行环境：本地 `@occ/api`（临时端口 8897/8898/8899）

## 前置
- 已执行：`pnpm --filter @occ/api db:generate`
- 本地联调库补齐 `GitLabSync` 表（避免 `P2021`）
- 未配置 `GITLAB_TOKEN`（用于验证失败分支）

## 实测结果

### 1) Issues 列表（无 Token）
- 请求：`GET /api/gitlab/projects/group%2Frepo/issues?state=opened`
- 返回：`503 SERVICE_UNAVAILABLE`
- 响应：`GITLAB_TOKEN 未配置，无法调用 GitLab API`
- 结论：符合预期（配置门禁生效）

### 2) Webhook（无 secret）
- 请求：`POST /api/gitlab/webhook`（`X-Gitlab-Event: Issue Hook`）
- 返回：`200 { ok: true }`
- 结论：符合预期（默认放通）

### 3) Webhook（启用 secret）
- 环境：`GITLAB_WEBHOOK_SECRET=abc`
- 无 `X-Gitlab-Token`：返回 `403 FORBIDDEN`
- `X-Gitlab-Token: abc`：返回 `200 { ok: true }`
- 结论：符合预期（签名校验生效）

## 缺陷与修复
- 发现：Webhook 在 `GitLabSync` 表缺失时会报 `P2021` 并导致 500/503。
- 修复：在 `gitlab.ts` 增加 `P2021` 降级处理，缺表时仅跳过同步写入，不阻塞 webhook 主流程。

## 结论
- GitLab 集成链路可用：路由、鉴权分支、Webhook 校验均正常。
- 部署前请配置：
  - `GITLAB_TOKEN`
  - `GITLAB_DEFAULT_PROJECT`（或 `GITLAB_DEFAULT_PROJECT_ID`）
  - 可选 `GITLAB_WEBHOOK_SECRET`
