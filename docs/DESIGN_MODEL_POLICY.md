# 设计模型调用标准（固定策略）

更新时间：2026-03-30

## 目标
为设计相关任务统一模型调用顺序，保证后续项目执行一致性与可回放性。

## 固定优先级（Design Policy）
1. 主模型：`anthropic/claude-opus-4-20250514`
2. 备选一：`anthropic/claude-sonnet-4-20250514`
3. 备选二：`openai/gpt-5.4`
4. 备选四：`openai/gpt-5.3-codex`

系统在设计任务中会按上述顺序尝试；若主模型不可用或失败，会自动降级到备选模型。

## 代码落点
- 设计模型策略常量：`apps/api/src/agents/design-model-policy.ts`
- 阶段 Agent 设计路由：`apps/api/src/agents/runtime.ts`
- OpenClaw 设计 Agent 发送与降级：`apps/api/src/openclaw/workspace.ts`

## 运行细节
- `ROLE_DESIGN` 默认强制优先 `claude-opus-4-20250514`。
- 失败类型包含鉴权/模型不可用时，会自动尝试后续备选。
- 对历史配置中的设计 Agent，会在配置同步时写入上述主/备模型，减少旧配置漂移。
- 设计阶段属于关键终端阶段，要求优先经由 OpenClaw Agent + 设计技能执行，不建议退化为普通模型直答。

## 一键体检接口
- `GET /api/system/design-model-policy/health`
- 返回项包含：
  - 主模型/备选模型可用性
  - 当前可用通道（runtime / openclaw providers）
  - 降级链是否可执行（fallbackReady）
  - `ROLE_DESIGN` 配置是否与策略对齐（policyAligned）

## 一键修复接口
- `POST /api/system/design-model-policy/repair`
- 行为：
  - 自动对齐 `ROLE_DESIGN`：
    - `selectedModel = anthropic/claude-opus-4-20250514`
    - `defaultModel = anthropic/claude-opus-4-20250514`
    - `fallbackModel = anthropic/claude-sonnet-4-20250514`
  - 修复后自动再次执行体检
  - 返回修复前后体检结果与差异（`before` / `after` / `changed`）

## 说明
- 当前实现以 `apps/api/src/agents/design-model-policy.ts` 为准；如果文档与代码不一致，以代码策略为最终执行口径。
- `gpt-5.3-codex` 仍保留在设计链尾部，作为更晚一层的稳健兜底，而不是设计首选。
