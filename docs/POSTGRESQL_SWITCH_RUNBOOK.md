# PostgreSQL 切换手册（从 SQLite 平滑切换）

## 1. 切换前准备

- 已完成 Prisma 基线（见 `docs/PRISMA_MIGRATION_BASELINE.md`）
- PostgreSQL 实例可用（网络、账号、库名）
- 已备份 SQLite 文件：`apps/api/prisma/dev.db`

## 2. 环境变量

在 `apps/api/.env` 或部署平台中设置：

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public"
```

## 3. Prisma provider 切换

编辑 `apps/api/prisma/schema.prisma`：

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

## 4. 执行迁移

```bash
cd /tmp/ai-agent-check
pnpm --filter @occ/api db:generate
pnpm --filter @occ/api db:migrate:deploy
pnpm --filter @occ/api db:migrate:status
```

## 5. 冒烟验证

```bash
pnpm --filter @occ/api build
pnpm dev:api
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/projects
curl http://127.0.0.1:8787/api/openclaw/agents
```

## 6. 回滚方案

### 快速回滚到 SQLite

1. 恢复 `apps/api/prisma/schema.prisma` 的 provider 为 `sqlite`
2. 还原 `DATABASE_URL=file:./prisma/dev.db`
3. 恢复 SQLite 备份文件
4. 启动 API 并执行健康检查

```bash
pnpm health:check
```

### PostgreSQL 回滚

- 使用 PostgreSQL 快照回滚到切换前时间点
- 重新执行 `db:migrate:status` 验证状态

## 7. 风险控制

- 先灰度（预发）再生产
- 切换窗口内冻结高风险写操作
- 切换后观察 15~30 分钟（错误率、延迟、任务执行成功率）
