# AgentCommander ProjectRoom Boundary Definition

- Issue: `#25`
- Issue title: `定义 AgentCommander 接入 ProjectRoom 的联调边界，强制复用 task/delegation 语义`
- Date: `2026-04-08`
- Status: `passed`

## Summary

`ProjectRoom/API` 是 task/delegation 协作语义的事实来源。
`AgentCommander` 只允许消费、展示和触发既有语义，不允许在页面内部重新定义 reviewer、delegation、ready-for-review、blocked、pending delegation 等核心状态。

## Shared Semantics List

- `ownerAgentId`: 当前任务 owner
- `reviewAgentId`: 当前任务 reviewer
- `coordinationMode`: 任务协作模式
- `pendingDelegationCount`: 当前待回收 delegation 数
- `delegationSummary`: delegation 摘要列表
- `blockedReason`: 结构化阻塞原因
- `nextAction`: 结构化下一步动作
- `gitlab.status / issueIid / webUrl / summary`: GitLab 协作状态
- `ready-for-review` 门禁: reviewer 必填、pending delegation 归零、依赖阻塞解除

## State Ownership Matrix

| Concept | Source of truth | Consumer | Trigger |
| --- | --- | --- | --- |
| owner / reviewer | `apps/api/src/services/task-coordination.ts` | ProjectRoom, AgentCommander | `assignOwner`, `setReviewer` |
| blockedReason / nextAction | `apps/api/src/services/task-collaboration.ts` | ProjectRoom, AgentCommander | task/dependency/delegation status recompute |
| pendingDelegationCount | `apps/api/src/services/task-delegation.ts` | ProjectRoom, AgentCommander | create / dispatch / complete / retry / cancel delegation |
| delegationSummary | `apps/api/src/services/task-collaboration.ts` | ProjectRoom, AgentCommander | delegation lifecycle update |
| ready-for-review gating | `apps/api/src/services/task-coordination.ts` + `apps/web/src/pages/ProjectRoomPage/taskCollaborationUi.ts` | ProjectRoom, AgentCommander | `readyForReview` |
| GitLab sync state | `apps/api/src/services/task-collaboration.ts` | ProjectRoom, AgentCommander | `syncGitlab` |

## Allowed Capabilities In AgentCommander

- 读取项目任务列表并筛选与当前 agent 相关的协作任务
- 展示 owner、reviewer、coordination mode、blocked reason、next action
- 展示 pending delegation、delegation summary、delegation 明细
- 复用现有门禁展示 ready-for-review 的禁用态与提示文案
- 调用既有 API 触发：`syncGitlab`、`readyForReview`、`dispatchDelegation`、`retryDelegation`、`cancelDelegation`

## Forbidden Patterns

- 在 AgentCommander 内部新增一套 task/delegation 平行状态语义
- 前端自行决定最终 blocked / nextAction / pending state，而不以 API 结果为准
- 为 AgentCommander 私有流程修改 task/delegation API 契约
- 在 AgentCommander 中复制一套与 ProjectRoom 分叉的错误提示口径

## Code Evidence

- ProjectRoom 事实页面: `apps/web/src/pages/ProjectRoomPage.impl.tsx`
- ProjectRoom 门禁文案复用: `apps/web/src/pages/ProjectRoomPage/taskCollaborationUi.ts`
- AgentCommander 任务加载: `apps/web/src/pages/AgentCommanderPage.tsx`
- API task projection: `apps/api/src/services/task-coordination.ts`
- 协作语义派生: `apps/api/src/services/task-collaboration.ts`
- ready-for-review 路由: `apps/api/src/routes/tasks.ts`

## Validation Results

- Passed: `pnpm --filter @occ/api typecheck`
- Passed: `pnpm --filter @occ/web typecheck`
- Passed: `pnpm --filter @occ/web build`

## Follow-up Gaps

- 后续若继续扩 AgentCommander，只能在当前共享语义之上加视图或受控操作，不能回到“独立状态中心”模式
- 若要继续降低维护风险，优先继续拆解 `ProjectRoomPage.impl.tsx` 中非 task/delegation 的剩余大区块
