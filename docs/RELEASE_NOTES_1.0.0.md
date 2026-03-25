# Release Notes 1.0.0

## Summary

OpenClaw Agent 协作工作台 1.0.0 版本完成了从原型态到可验收版本的收口，核心目标是让平台具备真实 OpenClaw 工作区联动、可治理 Agent、可检查数据库与运行态、可本地发布与验证的完整闭环。

## Included

- SaaS 化工作台结构：
  - 总控首页
  - 项目组合
  - 项目作战室
  - OpenClaw 团队工作区
  - Agent 工作台
  - Agent 指挥页
  - 系统运营
  - 审计轨迹
  - 设置
- 真实 OpenClaw 集成：
  - 读取真实工作区项目、任务、文档、会话、最近消息
  - 创建真实 OpenClaw Agent
  - 编辑真实 SOUL / SOP
  - 下发 Agent 指令
  - 项目任务回写
- Agent 治理能力：
  - 模型切换
  - 执行策略切换
  - Token 限额
  - 长期记忆
  - 协作 Agent 白名单
  - 工具白名单
  - 调用日志查看
- 生产运维能力：
  - 管理员鉴权
  - 审计日志
  - Runtime 配置
  - 平台就绪度检查
  - 本地发布脚本
  - 本地验收脚本 `pnpm verify:local`

## Release Notes

- 数据库路径已统一为 `apps/api/prisma/dev.db`
- `db.ts` 已做绝对路径归一化，避免不同启动目录下 SQLite 指向错误
- `release-local.sh` 已加入数据库初始化兜底逻辑
- OpenClaw 页面支持深链接：
  - `/openclaw?projectId=...`
  - `/openclaw?agentId=...`
  - `/openclaw?projectId=...&agentId=...`

## Validation

- `pnpm --filter @occ/api typecheck`
- `pnpm --filter @occ/api build`
- `pnpm --filter @occ/web typecheck`
- `pnpm --filter @occ/web build`
- `pnpm verify:local`
