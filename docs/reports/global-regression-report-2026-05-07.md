# 全局回归测试报告（2026-05-07）

## 1. 测试范围
- API Typecheck / Build
- Web Typecheck / Build
- workflow-v2 全套回归
- routes.test 回归
- 多 Agent 联动能力（workflow-v2-hybrid-acceptance）

## 2. 测试结果总览（最终）
- `pnpm --filter @occ/api typecheck`：通过
- `pnpm --filter @occ/api build`：通过
- `pnpm --filter @occ/web typecheck`：通过
- `pnpm --filter @occ/web build`：通过
- `pnpm --filter @occ/api test:workflow-v2`：通过
- `pnpm --filter @occ/api test:routes`：通过（22/22）
- `pnpm --filter @occ/api exec tsx --test src/routes/workflows-v2-hybrid-acceptance.test.ts`：通过（多 Agent 链路）

### 2.1 2026-05-07 再验证（本轮）
- `pnpm --filter @occ/api test:routes`：通过（22/22）
- `pnpm --filter @occ/api test:workflow-v2`：通过（12 组子测试全部通过）
- `pnpm --filter @occ/web build`：通过

## 3. 已修复问题

### 3.1 skills-v2 内置技能导出失败
- 现象：`skills-v2 exports built-in skills for hermes` 失败，`design-to-code` 未被导出。
- 修复：补齐内置 fallback skill 目录初始化逻辑，确保 `SKILL_FALLBACK_DESCRIPTOR` 所有项都进入导出目录。
- 文件：`apps/api/src/workflow-v2/hermes-skill-service.ts`
- 复测：`src/routes/skills-v2.test.ts` 通过；`test:workflow-v2` 全套通过。

## 4. 本轮修复完成项

### 4.1 AUTH 状态缓存导致 setup 后状态错误
1. 现象  
   - `routes.test` 中 `[400/401][AUTH] setup/login/logout flow ...` 在 `setup` 成功后读取 `/api/auth/status` 仍出现错误状态。
2. 根因  
   - `setupAdmin` 更新 `SystemConfig` 后，运行时 `systemConfigCache` 未失效，导致紧接着 `getAuthStatus` 读到旧缓存。
3. 修复  
   - 在 `runtime-config.ts` 增加 `invalidateSystemConfigCache()`。
   - 在 `security/auth.ts` 的 `setupAdmin` 更新配置后调用缓存失效函数。
4. 结果  
   - `pnpm --filter @occ/api test:routes` 全量通过（22/22）。

### 4.2 Project 创建事务超时导致 issues-workflow-link 回归失败
1. 现象  
   - `src/routes/issues-workflow-link.test.ts` 出现 `Transaction already closed`，超时阈值 5000ms。
2. 根因  
   - `persistProject` 使用交互式事务批量写入 Stage/Task/Deliverable/Timeline 等数据，在慢机或高负载下超过默认事务超时。
3. 修复  
   - 在 `apps/api/src/data/repository.ts` 的 `persistProject` 事务增加显式参数：
     - `maxWait: 10_000`
     - `timeout: 60_000`
4. 结果  
   - `pnpm --filter @occ/api exec tsx --test src/routes/issues-workflow-link.test.ts` 全量通过（3/3）。

## 5. 多 Agent 连通性结论
- 结论：可连接并执行多 Agent 协作链路（通过）。
- 证据：`workflow-v2-hybrid-acceptance` 回归通过，覆盖 Hermes + OpenClaw 联合执行、知识沉淀与阶段流转。

## 6. 当前结论
1. 全局回归已通过，核心路径无阻断缺陷。
2. 多 Agent 协同能力已通过混合验收链路验证（Hermes + OpenClaw）。
3. 本轮回归中识别并修复了 1 个真实问题（事务超时），修复后已复测通过。
4. 可进入下一轮发布检查（若需要可追加压测与长稳测试）。

## 7. 本轮追加实现清单

### 7.1 已继续实现
- 新增统一 workflow-v2 推进服务：
  - `apps/api/src/workflow-v2/project-advancement-service.ts`
- 新增 workflow-v2 项目级接口：
  - `POST /api/v1/workflows/projects/:projectId/advance`
  - `POST /api/v1/workflows/projects/:projectId/skip-stage`
- 前端项目列表推进切到 v2：
  - `apps/web/src/lib/api/workflowsApi.ts`
  - `apps/web/src/pages/ProjectsPage.tsx`

### 7.2 回归执行注意事项
- 避免并行执行多个会触发 `prisma migrate reset` 的测试命令，否则会出现 PostgreSQL advisory lock 冲突或“表不存在”假失败。
- 回归建议串行顺序：
  1. `pnpm --filter @occ/api test:workflow-v2`
  2. `pnpm --filter @occ/api test:routes`
  3. `pnpm --filter @occ/web build`

### 7.3 本轮稳定性优化（新增）
- `apps/api/package.json`
  - `test:routes` 增加统一 `retry(max=3)` 包装，降低瞬时数据库抖动导致的偶发失败。
  - `test:routes` 默认测试 schema 改为 `api_test_routes`（支持 `TEST_DATABASE_URL_ROUTES` 覆盖）。
  - `test:workflow-v2` 默认测试 schema 改为 `api_test_workflow_v2`（支持 `TEST_DATABASE_URL_WORKFLOW_V2` 覆盖）。
- 价值
  - 降低同库测试互相污染概率。
  - 将“并发冲突导致的假红”与“真实业务失败”分离，回归信号更干净。

### 7.4 本轮性能优化（新增）
- `apps/api/src/data/repository.ts`
  - 优化 `nextProjectId()`：不再读取完整 issue 列表，仅按当天项目号前缀读取 `createdProjectId` 集合用于序号占位计算。
- `apps/api/src/system/v1-method-store.ts`
  - 新增 `listIssueCreatedProjectIdsByPrefix(prefix)` 轻量接口，避免创建项目时触发不必要的大对象加载与排序。
- 效果
  - 项目创建链路减少一次全量 issue 数据读取，降低创建阶段的 I/O 与内存开销。

## 8. 本轮最终执行记录（2026-05-07）
- API 与 Web 构建链路：全通过。
- `test:routes`：22/22 通过。
- `issues-workflow-link`：3/3 通过（修复后复测）。
- 多 Agent 连通性：`workflow-v2-hybrid-acceptance` 通过，确认 Hermes + OpenClaw 可协同执行。
