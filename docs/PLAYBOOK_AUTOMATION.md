# Playbook Automation

这份说明补在现有 `issue automation payload` 之上，用来管理一组有依赖顺序、产物约束和结果 schema 的 rollout playbook。

## 当前仓库内产物

- playbook 文件：
  [projectroom-to-agentcommander-rollout.playbook.json](/Users/dalongxia/Documents/agentteam/templates/playbooks/projectroom-to-agentcommander-rollout.playbook.json)
- 校验脚本：
  [validate-playbook.mjs](/Users/dalongxia/Documents/agentteam/scripts/validate-playbook.mjs)
- issue 物化脚本：
  [materialize-playbook-issue.mjs](/Users/dalongxia/Documents/agentteam/scripts/materialize-playbook-issue.mjs)
- 共享库：
  [playbook-automation.mjs](/Users/dalongxia/Documents/agentteam/scripts/lib/playbook-automation.mjs)

## 解决的问题

- 固化 `depends_on`，避免执行顺序漂移
- 固化 `artifact_requirements`，避免上一步没交付关键产物却继续放行
- 固化 `result_schema`，让下一步可以机器消费上一步结果
- 保持与现有 GitLab/Codex payload 链路兼容，不新建第二套 issue 执行格式

## 1. 校验 playbook

```bash
node scripts/validate-playbook.mjs \
  --input templates/playbooks/projectroom-to-agentcommander-rollout.playbook.json
```

校验内容包括：

- 顶层关键字段是否存在
- `issues[].id` 是否唯一
- `depends_on` 是否引用了真实 issue
- `recommended_order` 是否只引用已存在 issue
- `validation_commands` / `stop_conditions` / `compatibility_policy` 是否成形
- `artifact_requirements.must_produce` 是否存在
- `result_schema` 是否为 object schema
- 依赖图是否存在环

## 2. 从 playbook 物化单个 issue payload

```bash
node scripts/materialize-playbook-issue.mjs \
  --input templates/playbooks/projectroom-to-agentcommander-rollout.playbook.json \
  --issue-id projectroom-minimal-no-behavior-split \
  --output /tmp/projectroom-split.payload.json
```

输出结果兼容现有 issue automation payload 体系，核心字段包括：

- `issue_title`
- `issue_labels`
- `source_of_truth`
- `validation_commands`
- `stop_conditions`
- `compatibility_policy`
- `issue_body`
- `codex_prompt_text`
- `codex_prompt_sections`

同时保留 playbook 执行器需要的附加字段：

- `issue_id`
- `depends_on`
- `auto_run_if_previous_passed`
- `blocking_policy`
- `artifact_requirements`
- `result_schema`

## 3. 继续走现有 GitLab issue 创建链路

物化后的 payload 可以直接复用现有脚本：

```bash
node scripts/create-gitlab-issue-from-payload.mjs \
  --input /tmp/projectroom-split.payload.json \
  --project root/ai-agent-workbench \
  --update-if-exists
```

## 推荐执行顺序

1. 先校验 playbook
2. 再按 `issue-id` 物化当前要执行的一步
3. 用现有 GitLab issue 创建脚本创建或更新 issue
4. 把同源 `codex_prompt_text` 投喂给 Codex
5. 回收结果时按 playbook 的 `result_schema` 和 `artifact_requirements` 做放行判断

## 当前边界

- 当前只补到“playbook 可校验 + issue 可物化”
- 还没有在仓库里实现完整自动调度器
- `transition_rules` / `auto_retry_policy` 当前作为机器可读配置落库，供后续执行器直接消费
