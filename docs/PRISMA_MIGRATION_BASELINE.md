# Prisma 迁移基线（SQLite 当前状态固化）

## 目标

把当前 `db push` 驱动的数据库状态固化为可部署迁移文件，后续统一走 `migrate deploy` 流程。

## 已落地内容

- 基线脚本：`scripts/prisma-baseline.mjs`
- 根命令：
  - `pnpm db:baseline`（生成基线迁移，不写入 `_prisma_migrations`）
  - `pnpm db:baseline:apply`（生成 + 标记已应用）

## 使用步骤

1. 生成基线迁移：

```bash
cd /tmp/ai-agent-check
pnpm db:baseline
```

2. 对已有数据库标记为“已应用基线”：

```bash
pnpm db:baseline:apply
```

3. 校验迁移状态：

```bash
pnpm --filter @occ/api db:migrate:status
```

## 说明

- 基线迁移目录默认：`apps/api/prisma/migrations/20260331000000_baseline`
- 默认 provider 为 `sqlite`，并写入 `migration_lock.toml`。
- 对已有线上库，建议先备份再执行 `db:baseline:apply`。

## 回滚建议

- SQLite：回滚前先备份 `apps/api/prisma/dev.db`。
- 如误标记 migration，可恢复数据库备份后重新执行。
