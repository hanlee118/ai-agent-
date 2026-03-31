# GitHub 清理与 GitLab Harness 实施固化（2026-04-01）

## 1. 目标

1. 清理混乱工作区，避免垃圾文件进入 GitHub。
2. 将 GitLab 从“仅有路由”升级为“接入实施流程与验收闭环”。
3. 统一仓库文档与本地主文档，固化当前可执行状态。

## 2. 本次落地改动

### 2.1 GitLab Harness 真接入

已实现文件：

- `apps/api/src/routes/gitlab.ts`
- `apps/api/src/routes/projects.ts`
- `apps/api/src/index.ts`

实施点：

1. 新增 Harness 同步入口：`POST /api/gitlab/harness/projects/:occProjectId/sync`。
2. 同步策略：将 `DEV/ACCEPT` 阶段任务映射为 GitLab Issue，写入可追溯 marker：
   - `OCC_PROJECT_ID`
   - `OCC_TASK_ID`
3. 生命周期触发：`submit/approve/reject/intervene/resume/close/task update` 与自动推进 tick 均触发同步。
4. Webhook 回写：Issue 状态变化反向更新 OCC 任务状态（`closed -> done`，否则 `in_progress`）。
5. 项目闭环：项目完成/关闭时触发 `closeOnComplete`，自动关闭遗留 Harness Issue。

### 2.2 项目说明更新

- 更新 `README.md`：新增 GitLab Harness 能力说明与仓库治理约定。

## 3. 清理策略

1. 在干净工作树中进行提交与推送，避免把临时运行数据、缓存、日志、`node_modules`、本地数据库误推送。
2. 保持 `main` 仅承载可发布版本。
3. 清理无效的历史临时分支，只保留有效协作分支。

## 4. 验收建议

在配置 `GITLAB_TOKEN`、`GITLAB_DEFAULT_PROJECT` 后执行：

1. 新建项目并推进到 `DEV`。
2. 检查 GitLab 是否生成对应 Harness Issue。
3. 在 GitLab 改变 Issue 状态并触发 webhook。
4. 验证 OCC 任务状态是否被正确回写。
5. 项目完成后确认 Harness Issue 自动关闭。

## 5. 固化结论

本次改造后，GitLab 不再只是可选 API，而是进入了项目实施链路与验收闭环，符合 Harness Engineering 的调度与追踪要求。
