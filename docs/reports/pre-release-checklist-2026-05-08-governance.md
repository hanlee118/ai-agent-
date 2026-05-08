# 发布前清单（治理增强批次）

日期：2026-05-08  
分支：`codex/governance-hardening-release`

## 1) Prisma 迁移（StructuredMergeRequest）
- 结论：已完成并已应用。
- 证据：`pnpm -C apps/api exec prisma migrate status`
- 输出要点：
  - `16 migrations found in prisma/migrations`
  - `Database schema is up to date!`
- 备注：包含 `20260507181456_add_structured_merge_request`。

## 2) Prisma Client 生成
- 结论：已完成。
- 证据：`pnpm -C apps/api db:generate`
- 输出要点：
  - `Generated Prisma Client (v6.19.3)`

## 3) 真实调用验证：`POST /api/system/trigger-audit`
- 前置：接口需要登录态（匿名会返回 401）。
- 实际过程：
  1. 使用本地管理员会话登录（`POST /api/auth/login`）
  2. 携带 cookie 调用 `POST /api/system/trigger-audit`
- 验证结果：
  - `login_code=200`
  - `trigger_code=200`
  - 响应：`{"ok":true,"scanned":0,"actions":[]}`
- 解释：当前本地环境没有可巡检的 opened MR（或未配置可扫描数据源），因此 `scanned=0` 为预期可接受结果，接口能力可用。

## 4) 已可用接口 + 验证结果 + 剩余问题

### 4.1 已可用接口（本轮已实测）
1. `GET /api/auth/status`：可返回 setup/auth 状态。
2. `POST /api/auth/login`：可建立会话。
3. `GET /api/system/health`：可返回健康状态。
4. `GET /api/system/runtime`：可返回运行模式状态。
5. `POST /api/system/trigger-audit`：可真实触发巡检。

### 4.2 验证结果摘要
1. 后端运行正常，健康检查可访问。
2. 权限控制正常：匿名访问受保护接口返回 401。
3. 登录后可调用受保护系统接口。
4. 巡检触发 API 可成功返回 200。

### 4.3 剩余问题（发布前需确认）
1. 本地 `agents` 数据为空（`agent_count=0`），多 Agent 实战链路无法在该环境下完成完整巡检闭环。
2. 巡检返回 `scanned=0`，说明当前环境缺少待巡检 MR 样本或 GitLab 可扫描目标；建议用测试仓库构造 2-3 条 opened MR（含超 72h、无 issue 链接、坏分支名）再做一次验收。
3. `GET /api/system/health` 输出结构当前偏向 `services[]`，而非 earlier 文档中的 `observabilitySummary`；若前端依赖固定字段，需要统一契约。

## 5) 回归补充（本轮）
1. `pnpm -C apps/web typecheck`：通过。
2. `pnpm -r typecheck`：通过。
3. `pnpm -C apps/api test:routes -- --runInBand`：22/22 通过。
4. PR CI：成功（run `25534935775`）。
