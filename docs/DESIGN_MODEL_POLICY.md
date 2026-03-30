# 设计模型调用标准（固定策略）

更新时间：2026-03-30

## 目标
为设计相关任务统一模型调用顺序，保证后续项目执行一致性与可回放性。

## 固定优先级（Design Policy）
1. 主模型：`openai/gpt-5.4`
2. 备选一：`openai/gpt-5.3-codex`
3. 备选二：`kimi-k2.5`

系统在设计任务中会按上述顺序尝试；若主模型不可用或失败，会自动降级到备选模型。

## 代码落点
- 设计模型策略常量：`apps/api/src/agents/design-model-policy.ts`
- 阶段 Agent 设计路由：`apps/api/src/agents/runtime.ts`
- OpenClaw 设计 Agent 发送与降级：`apps/api/src/openclaw/workspace.ts`

## 运行细节
- `ROLE_DESIGN` 默认强制优先 `gpt-5.4`。
- 失败类型包含鉴权/模型不可用时，会自动尝试后续备选。
- 对历史配置中的设计 Agent，会在配置同步时写入上述主/备模型，减少旧配置漂移。

## 一键体检接口
- `GET /api/system/design-model-policy/health`
- 返回项包含：
  - 主模型/备选模型可用性
  - 当前可用通道（runtime / openclaw providers）
  - 降级链是否可执行（fallbackReady）
  - `ROLE_DESIGN` 配置是否与策略对齐（policyAligned）

## 说明
- 当前环境中 `gpt-5.3` 直连可用性不稳定，策略采用 `gpt-5.3-codex` 作为 5.3 系列标准备选。
