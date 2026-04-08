# Issue Automation Payloads

这份说明用于把一份中间输入 JSON 同时产出两类结果：

- `issue_body`：给 GitLab issue 创建器直接使用
- `codex_prompt_text` / `codex_prompt_sections`：给 Codex 执行器和人工 review 同时使用

## 目标

- 固定 `source_of_truth`，先明确事实源文件，压低修错文件概率
- 固定 `validation_commands`，让自动执行链路可以判断“改完是否没漂”
- 固定 `stop_conditions`，让 Codex 明确什么不能越界
- 固定 `compatibility_policy`，防止一边说收口、一边又留下第二套逻辑
- 同时生成 `codex_prompt_text` 与 `codex_prompt_sections`，方便机器投喂和人工排查 prompt 漂移

## 支持的任务类型

- `stabilization`
- `feature`
- `integration`

## 模板位置

- [stabilization.template.json](/Users/dalongxia/Documents/agentteam/templates/issue-automation/stabilization.template.json)
- [feature.template.json](/Users/dalongxia/Documents/agentteam/templates/issue-automation/feature.template.json)
- [integration.template.json](/Users/dalongxia/Documents/agentteam/templates/issue-automation/integration.template.json)
- 示例输入：
  [projectroom-single-implementation.input.json](/Users/dalongxia/Documents/agentteam/templates/issue-automation/examples/projectroom-single-implementation.input.json)

## 生成命令

```bash
node scripts/generate-gitlab-codex-payload.mjs \
  --input templates/issue-automation/examples/projectroom-single-implementation.input.json
```

也可以写入文件：

```bash
node scripts/generate-gitlab-codex-payload.mjs \
  --input templates/issue-automation/examples/projectroom-single-implementation.input.json \
  --output /tmp/projectroom-single-implementation.payload.json
```

## 直接创建 GitLab issue

```bash
node scripts/create-gitlab-issue-from-payload.mjs \
  --input templates/issue-automation/examples/projectroom-single-implementation.payload.json \
  --update-if-exists
```

脚本会读取 `apps/api/.env` 中的：

- `GITLAB_BASE_URL`
- `GITLAB_TOKEN`
- `GITLAB_DEFAULT_PROJECT`

并使用 payload 中的：

- `issue_title`
- `issue_body`
- `issue_labels`

若加上 `--update-if-exists`，会先按标题精确查找 opened issue，再更新 description / labels。

## 直接产出执行 bundle

```bash
node scripts/prepare-gitlab-codex-run.mjs \
  --input templates/issue-automation/examples/projectroom-single-implementation.input.json \
  --create-issue \
  --update-if-exists \
  --output /tmp/projectroom-single-implementation.bundle.json
```

这个 bundle 会包含：

- GitLab issue 元信息
- 完整 payload
- `codex_prompt_text`
- `codex_prompt_sections`

## 输入字段约定

### 固定字段

- `task_type`
- `title`
- `source_of_truth`
- `validation_commands`
- `stop_conditions`
- `compatibility_policy`

### 常用内容字段

- `context.background`
- `context.current_constraint`
- `decision.summary`
- `decision.why`
- `scope.goals`
- `scope.non_goals`
- `acceptance`
- `risks`

### `validation_commands`

建议统一使用对象形式：

```json
[
  { "command": "pnpm --filter @occ/web typecheck", "required": true },
  { "command": "pnpm --filter @occ/web build", "required": true }
]
```

### `stop_conditions`

建议区分：

- `hard_stop`
- `soft_stop`

例如：

```json
{
  "hard_stop": [
    "不要开始 AgentCommander 接入",
    "不要新增 task/delegation 平行状态语义"
  ],
  "soft_stop": [
    "不要把本任务扩大为 ProjectRoom 全量重构",
    "不要改动无关页面或无关 API"
  ]
}
```

## 输出字段

生成脚本会输出：

- `issue_title`
- `issue_labels`
- `source_of_truth`
- `validation_commands`
- `stop_conditions`
- `compatibility_policy`
- `issue_body`
- `codex_prompt_text`
- `codex_prompt_sections`

## 推荐执行链路

1. 上游 agent 先生成输入 JSON
2. 使用脚本渲染 payload
3. 自动创建 GitLab issue
4. 把同源的 `codex_prompt_text` 投喂给 Codex
5. 人工或 QA 用 `codex_prompt_sections` 做 review / 排查

如果需要管理多张有依赖关系的 rollout issue，请继续看：

- [PLAYBOOK_AUTOMATION.md](/Users/dalongxia/Documents/agentteam/docs/PLAYBOOK_AUTOMATION.md)

## 边界说明

- 这套 payload 只负责“执行单”生成，不替代业务建模
- 若 issue 描述与代码事实不一致，应以代码事实为准，并在执行结果里明确说明差异
- 兼容层若存在，只能做无逻辑转发或协议映射，不能继续承载第二套业务状态
