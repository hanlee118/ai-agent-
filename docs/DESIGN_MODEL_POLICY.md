# 设计模型调用标准（固定策略）

更新时间：2026-04-10

## 目标
为设计相关任务统一模型调用顺序，保证后续项目执行一致性与可回放性。

## 固定优先级（Design Policy）
1. 主模型：`qwen3-max-2026-01-23`
2. 备选一：`qwen3.5-plus`
3. 备选二：`qwen3-coder-plus`

系统在设计任务中会按上述顺序尝试；若主模型不可用或失败，会自动降级到备选模型。

## 代码落点
- 设计模型策略常量：`apps/api/src/agents/design-model-policy.ts`
- 阶段 Agent 设计路由：`apps/api/src/agents/runtime.ts`
- OpenClaw 设计 Agent 发送与降级：`apps/api/src/openclaw/workspace.ts`

## 运行细节
- `ROLE_DESIGN` 默认强制优先 `qwen3-max-2026-01-23`。
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
    - `selectedModel = qwen3-max-2026-01-23`
    - `defaultModel = qwen3-max-2026-01-23`
    - `fallbackModel = qwen3.5-plus`
  - 修复后自动再次执行体检
  - 返回修复前后体检结果与差异（`before` / `after` / `changed`）

## 说明
- 当前实现以 `apps/api/src/agents/design-model-policy.ts` 为准；如果文档与代码不一致，以代码策略为最终执行口径。
- `anthropic/claude-opus-*` 已不再作为设计链路候选，避免平台回退到不可用或不可验证的旧模型。
- `qwen3-coder-plus` 保留在主链中，承担实现与结构化补位职责。
