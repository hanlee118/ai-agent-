# Round 3 全链路检查报告（2026-04-03）

## 1. 检查目标
- 从 `ANALYSIS -> DESIGN -> DEV -> ACCEPT` 进行三轮连续实机推进。
- 每个阶段核验真实模型调用路径，排除“模板填充伪完成”。
- 检查视觉交付是否被同质化模板污染。

## 2. 执行记录（证据文件）
- `docs/reports/triple-lifecycle-deepcheck-2026-04-03T01-07-27-624Z.json`
- `docs/reports/triple-lifecycle-deepcheck-2026-04-03T01-30-24-909Z.json`
- `docs/reports/triple-lifecycle-deepcheck-latest.json`

## 3. 关键发现
### 3.1 同质化视觉产出（高优先级）
- 根因：`apps/api/src/system/design-preview.ts` 的视觉预览兜底逻辑场景过少，长期退化为固定母版（跨境一套、通用一套），导致不同项目仅做文案填充。
- 影响：用户看到“不同需求但视觉风格几乎一致”，误判系统未进行真实设计。

### 3.2 深检脚本误报失败（中高优先级）
- 根因1：会话 TTL 过短，长链路复核中触发 401。
- 根因2：`PROJECT_ADVANCE_IN_PROGRESS` 计时器在阶段切换/审批后未重置，造成跨阶段累计等待导致误判 `ADVANCE_STUCK_IN_PROGRESS`。
- 文件：`scripts/triple-lifecycle-deepcheck.mjs`

### 3.3 真实模型门禁超时（高优先级）
- 证据：`triple-lifecycle-deepcheck-latest.json` 出现
  - `REAL_MODEL_GATE_FAILED`
  - `MODEL_ATTEMPT_TIMEOUT: openai-compatible:openai/gpt-5.3-codex@runtime-selected exceeded 46021ms`
- 说明：模型超时预算偏紧会把链路推向失败或降级，进一步放大“模板化产出”体感。

## 4. 已完成修复
### 4.1 视觉生成去同质化
- 文件：`apps/api/src/system/design-preview.ts`
- 修复内容：
  - 新增多视觉母版（跨境 3 套 + 通用 3 套）。
  - 按需求语义 + hash seed 选择主题，不再固定同一风格。
  - 视觉预览中显式记录母版标签，便于验收追踪。
- 快速验证：
  - 跨境 TikTok 需求命中 `Pulse Neon`
  - 跨境 Amazon 需求命中 `Midnight Terminal`
  - 通用运营需求命中 `Forest Ops`

### 4.2 三轮深检脚本稳定性
- 文件：`scripts/triple-lifecycle-deepcheck.mjs`
- 修复内容：
  - 增加会话 TTL 配置（默认 4h）。
  - `IN_PROGRESS` 改为按等待时长而非固定次数判定。
  - 审批/阶段切换后重置 `IN_PROGRESS` 计时。
  - 单轮失败保留 `projectId/steps`，避免证据丢失。

### 4.3 真实模型超时预算优化
- 文件：`apps/api/src/agents/runtime.ts`
- 修复内容：
  - 提高总预算与单次尝试默认预算。
  - 为 `ROLE_ANALYST/ROLE_PRODUCT` 增加阶段与单次调用超时基线。
- 目标：降低因预算过紧导致的模型超时假失败。

## 5. 回归验证结果
- `pnpm --filter @occ/api typecheck` 通过
- `pnpm --filter @occ/api test:routes` 通过（17/17）
- `pnpm --filter @occ/web typecheck` 通过
- `pnpm --filter @occ/api exec tsx --test src/system/design-preview.test.ts` 通过

## 6. 当前结论
- 你反馈的“后续项目沿用前一个视觉高风格并同质化”问题属实，已定位到视觉预览兜底生成器并完成修复。
- 三轮深检链路中的“卡住/401/超时误报”也已完成脚本与预算层面修复。
- 仍需再跑一次完整 3/3 深检（使用最新修复）以产出新的全绿报告。

## 7. 建议的下一步（执行顺序）
1. 先运行一次最新三轮深检，生成新报告并替换 `triple-lifecycle-deepcheck-latest.json`。
2. 抽取 3 个不同域项目（跨境/金融/通用运营）对比视觉稿，人工验收“母版不重复 + 业务信号命中”。
3. 将本报告与新深检报告一起挂到 PR #3 说明，形成可追溯验收闭环。

## 8. 演示站点链接链路排查（补充）
- 现状：`GET /api/projects/:id/official-site` 已返回绝对 URL（`protocol://host/generated/...`），链路本身可用于直达。
- 风险点：最终交付任务中 `runFinalArtifactsGenerationJob` 仍把 `officialSite.url` 记录为相对路径（`/generated/...`）。
- 影响：在跨端口/跨入口查看报告时，前端可能按当前页面 host 解释相对路径，出现“链接打开到错误站点/旧静态页”的误判。
- 建议修复：在最终交付任务写入时统一存绝对 URL（按请求 host 或 `PUBLIC_BASE_URL` 组装），并同时保留 `publicPath` 供前端静态拼接。
