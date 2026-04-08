import fs from "node:fs";
import path from "node:path";

const DEFAULT_LABELS = {
  stabilization: ["execution", "hardening", "codex-ready", "stabilization"],
  feature: ["execution", "feature", "codex-ready"],
  integration: ["execution", "integration", "codex-ready"]
};

export function generatePayloadFromFile(inputPath) {
  const resolved = path.resolve(process.cwd(), inputPath);
  const raw = fs.readFileSync(resolved, "utf8");
  const input = JSON.parse(raw);
  return buildPayload(input);
}

export function buildIssueAutomationPayload(input) {
  return buildPayload(input);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    printUsage();
    process.exit(1);
  }

  const payload = generatePayloadFromFile(args.input);
  const outputText = `${JSON.stringify(payload, null, 2)}\n`;

  if (args.output) {
    const outputPath = path.resolve(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, outputText);
  } else {
    process.stdout.write(outputText);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if ((current === "--input" || current === "-i") && argv[index + 1]) {
      args.input = argv[index + 1];
      index += 1;
      continue;
    }
    if ((current === "--output" || current === "-o") && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--help" || current === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage() {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/generate-gitlab-codex-payload.mjs --input <input.json> [--output <payload.json>]",
      "",
      "The input JSON should describe one of:",
      "  - stabilization",
      "  - feature",
      "  - integration"
    ].join("\n"),
  );
}

function buildPayload(input) {
  const taskType = normalizeTaskType(input.task_type);
  const title = assertNonEmpty(input.title, "title");
  const sourceOfTruth = normalizeSourceOfTruth(input.source_of_truth || {});
  const validationCommands = normalizeValidationCommands(input.validation_commands || []);
  const stopConditions = normalizeStopConditions(input.stop_conditions || {});
  const compatibilityPolicy = normalizeCompatibilityPolicy(input.compatibility_policy);
  const labels = buildLabels(taskType, input.issue_labels);

  const payload = {
    issue_title: title,
    issue_labels: labels,
    source_of_truth: sourceOfTruth,
    validation_commands: validationCommands,
    stop_conditions: stopConditions,
    compatibility_policy: compatibilityPolicy
  };

  if (taskType === "stabilization") {
    return {
      ...payload,
      issue_body: renderStabilizationIssueBody(input, validationCommands),
      codex_prompt_text: renderStabilizationPromptText(input, validationCommands, stopConditions),
      codex_prompt_sections: renderStabilizationPromptSections(input, validationCommands, stopConditions)
    };
  }

  if (taskType === "feature") {
    return {
      ...payload,
      issue_body: renderFeatureIssueBody(input, validationCommands),
      codex_prompt_text: renderFeaturePromptText(input, validationCommands, stopConditions),
      codex_prompt_sections: renderFeaturePromptSections(input, validationCommands, stopConditions)
    };
  }

  return {
    ...payload,
    issue_body: renderIntegrationIssueBody(input, validationCommands),
    codex_prompt_text: renderIntegrationPromptText(input, validationCommands, stopConditions),
    codex_prompt_sections: renderIntegrationPromptSections(input, validationCommands, stopConditions)
  };
}

function normalizeTaskType(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("task_type is required");
  }
  if (!["stabilization", "feature", "integration"].includes(raw)) {
    throw new Error(`unsupported task_type: ${raw}`);
  }
  return raw;
}

function normalizeSourceOfTruth(value) {
  if (!value || typeof value !== "object") {
    throw new Error("source_of_truth is required");
  }
  const normalized = {};
  for (const [key, item] of Object.entries(value)) {
    normalized[key] = ensureStringArray(item);
  }
  return normalized;
}

function normalizeValidationCommands(value) {
  return ensureArray(value).map((item) => {
    if (typeof item === "string") {
      return { command: item, required: true };
    }
    if (!item || typeof item !== "object") {
      throw new Error("validation_commands must be strings or objects");
    }
    return {
      command: assertNonEmpty(item.command, "validation_commands[].command"),
      required: item.required !== false
    };
  });
}

function normalizeStopConditions(value) {
  if (Array.isArray(value)) {
    return {
      hard_stop: value.map((item) => String(item || "").trim()).filter(Boolean),
      soft_stop: []
    };
  }
  const hardStop = ensureStringArray(value.hard_stop || []);
  const softStop = ensureStringArray(value.soft_stop || []);
  return {
    hard_stop: hardStop,
    soft_stop: softStop
  };
}

function normalizeCompatibilityPolicy(value) {
  if (!value) {
    return {
      allow_compat_layer: false,
      rule: "No compatibility layer rule provided."
    };
  }
  return {
    allow_compat_layer: Boolean(value.allow_compat_layer),
    rule: assertNonEmpty(value.rule, "compatibility_policy.rule")
  };
}

function buildLabels(taskType, value) {
  const defaults = DEFAULT_LABELS[taskType] || [];
  if (!value) {
    return defaults;
  }
  if (Array.isArray(value)) {
    return dedupe([...defaults, ...ensureStringArray(value)]);
  }
  const fixed = ensureStringArray(value.fixed || []);
  const dynamic = ensureStringArray(value.dynamic || []);
  return dedupe([...defaults, ...fixed, ...dynamic]);
}

function renderStabilizationIssueBody(input, validationCommands) {
  const context = input.context || {};
  const decision = input.decision || {};
  const scope = input.scope || {};
  const source = normalizeSourceOfTruth(input.source_of_truth || {});
  const acceptance = ensureStringArray(input.acceptance || []);
  const risks = ensureStringArray(input.risks || []);

  return [
    "# 背景",
    ...renderBulletLines(context.background),
    "",
    "# 当前判断",
    assertNonEmpty(decision.summary, "decision.summary"),
    "",
    "判断依据：",
    ...renderBulletLines(decision.why),
    "",
    "当前约束：",
    ...renderBulletLines(context.current_constraint),
    "",
    "# 本次目标",
    ...renderBulletLines(scope.goals),
    "",
    "# 本次不做",
    ...renderBulletLines(scope.non_goals),
    "",
    "# 事实源文件",
    "## 路由入口",
    ...renderCodeBulletLines(source.route_entry),
    "",
    "## 当前事实实现",
    ...renderCodeBulletLines(source.active_implementation),
    "",
    "## 兼容/重复实现候选",
    ...renderCodeBulletLines(source.candidate_compat_layer),
    "",
    "## 相关文件",
    ...renderCodeBulletLines(source.related_files),
    "",
    "# 执行要求",
    "- 先读代码再改，不要按文件名猜测真实入口",
    "- 优先最小闭环修改，不做无关重构",
    "- 若保留兼容层，兼容层只能做无逻辑转发，不能承载第二套实现",
    "- 如果 issue 描述与代码事实不一致，以代码事实为准，但必须在结果中明确说明",
    "- 不要引入新的平行状态语义",
    "",
    "# 验收标准",
    ...renderBulletLines(acceptance),
    ...renderValidationBulletLines(validationCommands),
    "",
    "# 风险提醒",
    ...renderBulletLines(risks),
    "",
    "# 交付要求",
    "最终结果必须明确给出：",
    "1. 哪个文件是唯一事实实现",
    "2. 修改了哪些文件，以及各自修改原因",
    "3. 是否保留兼容转发层",
    "4. 验证命令是否通过",
    "5. 还有哪些残留风险未处理"
  ].join("\n");
}

function renderFeatureIssueBody(input, validationCommands) {
  const context = input.context || {};
  const scope = input.scope || {};
  const source = normalizeSourceOfTruth(input.source_of_truth || {});
  const acceptance = ensureStringArray(input.acceptance || []);
  const risks = ensureStringArray(input.risks || []);
  const reuseConstraints = ensureStringArray(input.reuse_constraints || [
    "必须复用现有领域模型与状态语义",
    "不允许并行发明第二套功能状态",
    "若发现现有语义不足，只能记录为 follow-up，不在本 issue 擅自扩模"
  ]);

  return [
    "# 背景",
    ...renderBulletLines(context.background),
    "",
    "# 功能目标",
    ...renderBulletLines(scope.goals),
    "",
    "# 复用约束",
    ...renderBulletLines(reuseConstraints),
    "",
    "# 本次不做",
    ...renderBulletLines(scope.non_goals),
    "",
    "# 事实源文件",
    "## 入口",
    ...renderCodeBulletLines(source.entry_points),
    "",
    "## 领域模型",
    ...renderCodeBulletLines(source.existing_domain_model),
    "",
    "## UI 参考",
    ...renderCodeBulletLines(source.ui_reference),
    "",
    "## API 参考",
    ...renderCodeBulletLines(source.api_reference),
    "",
    "# 执行要求",
    "- 先确认现有语义是否足够承载新能力",
    "- 新功能必须贴着现有主链落地，不要绕开主链单独实现",
    "- 若需要增加字段或接口，必须说明与既有模型的关系",
    "- 不做无关 UI 美化或结构重排",
    "",
    "# 验收标准",
    ...renderBulletLines(acceptance),
    ...renderValidationBulletLines(validationCommands),
    "",
    "# 风险提醒",
    ...renderBulletLines(risks),
    "",
    "# 交付要求",
    "最终结果必须明确给出：",
    "1. 新增能力挂接在哪条现有主链上",
    "2. 复用了哪些现有语义/状态/接口",
    "3. 修改了哪些文件，以及各自修改原因",
    "4. 验证命令是否通过",
    "5. 是否还有未覆盖的边界条件"
  ].join("\n");
}

function renderIntegrationIssueBody(input, validationCommands) {
  const context = input.context || {};
  const scope = input.scope || {};
  const source = normalizeSourceOfTruth(input.source_of_truth || {});
  const acceptance = ensureStringArray(input.acceptance || []);
  const risks = ensureStringArray(input.risks || []);
  const integrationRules = ensureStringArray(input.integration_rules || [
    "联调必须复用现有共享契约",
    "不允许上下游各自发明一套映射不一致的状态语义",
    "若发现契约缺口，只能在共享契约层补，不要分别在两端私自兜底出不同逻辑"
  ]);

  return [
    "# 背景",
    ...renderBulletLines(context.background),
    "",
    "# 联调目标",
    ...renderBulletLines(scope.goals),
    "",
    "# 系统边界",
    "## 上游系统",
    ...renderCodeBulletLines(source.upstream_system),
    "",
    "## 下游系统",
    ...renderCodeBulletLines(source.downstream_system),
    "",
    "## 共享契约",
    ...renderCodeBulletLines(source.shared_contract),
    "",
    "## 联调入口",
    ...renderCodeBulletLines(source.integration_entry),
    "",
    "# 强约束",
    ...renderBulletLines(integrationRules),
    "",
    "# 本次不做",
    ...renderBulletLines(scope.non_goals),
    "",
    "# 执行要求",
    "- 先确认上游输出和下游消费的事实结构",
    "- 明确状态归属，谁产出、谁消费、谁展示，要写清楚",
    "- 若保留适配层，适配层只能做字段/协议映射，不能新增业务分叉",
    "- 遇到契约不一致时，优先收敛为单一共享定义",
    "",
    "# 验收标准",
    ...renderBulletLines(acceptance),
    ...renderValidationBulletLines(validationCommands),
    "",
    "# 风险提醒",
    ...renderBulletLines(risks),
    "",
    "# 交付要求",
    "最终结果必须明确给出：",
    "1. 上下游分别改了哪些点",
    "2. 最终共享契约以什么为准",
    "3. 是否引入了适配层，以及适配层职责",
    "4. 验证命令是否通过",
    "5. 还存在哪些联调残留风险"
  ].join("\n");
}

function renderStabilizationPromptText(input, validationCommands, stopConditions) {
  const source = normalizeSourceOfTruth(input.source_of_truth || {});
  const scope = input.scope || {};
  const acceptance = ensureStringArray(input.acceptance || []);
  return [
    "你现在要执行一个收口型任务，请严格按范围执行，不要自行扩展。",
    `任务标题：${assertNonEmpty(input.title, "title")}`,
    "这是一次稳定性收口，不是功能扩展。",
    `先核对事实源文件：${renderInlineCodeList([...source.route_entry, ...source.active_implementation, ...source.candidate_compat_layer, ...source.related_files])}。`,
    `本次目标：${joinAsSentence(scope.goals)}。`,
    `本次不做：${joinAsSentence(scope.non_goals)}。`,
    `执行约束：${joinAsSentence(stopConditions.hard_stop)}。`,
    `软约束：${joinAsSentence(stopConditions.soft_stop)}。`,
    `验收标准：${joinAsSentence(acceptance)}；${joinAsSentence(renderValidationTextList(validationCommands))}。`,
    "完成后输出：变更说明、修改文件、唯一事实实现、是否保留兼容层、验证结果、残留风险。"
  ].join(" ");
}

function renderFeaturePromptText(input, validationCommands, stopConditions) {
  const source = normalizeSourceOfTruth(input.source_of_truth || {});
  const scope = input.scope || {};
  const reuseConstraints = ensureStringArray(input.reuse_constraints || []);
  return [
    "你现在要执行一个功能型任务，但必须复用现有语义，不要发明第二套状态模型。",
    `任务标题：${assertNonEmpty(input.title, "title")}`,
    `先核对事实源文件：${renderInlineCodeList([...source.entry_points, ...source.existing_domain_model, ...source.ui_reference, ...source.api_reference])}。`,
    `本次目标：${joinAsSentence(scope.goals)}。`,
    `本次不做：${joinAsSentence(scope.non_goals)}。`,
    `复用约束：${joinAsSentence(reuseConstraints)}。`,
    `硬停止条件：${joinAsSentence(stopConditions.hard_stop)}。`,
    `软停止条件：${joinAsSentence(stopConditions.soft_stop)}。`,
    `验证要求：${joinAsSentence(renderValidationTextList(validationCommands))}。`,
    "完成后输出：功能挂接位置、复用的语义/接口、修改文件、验证结果、残留边界。"
  ].join(" ");
}

function renderIntegrationPromptText(input, validationCommands, stopConditions) {
  const source = normalizeSourceOfTruth(input.source_of_truth || {});
  const scope = input.scope || {};
  const integrationRules = ensureStringArray(input.integration_rules || []);
  return [
    "你现在要执行一个联调任务，请优先收敛系统边界和共享契约，不要在两边各写一套逻辑。",
    `任务标题：${assertNonEmpty(input.title, "title")}`,
    `先核对上游文件：${renderInlineCodeList(source.upstream_system)}；下游文件：${renderInlineCodeList(source.downstream_system)}；共享契约：${renderInlineCodeList(source.shared_contract)}；联调入口：${renderInlineCodeList(source.integration_entry)}。`,
    `本次目标：${joinAsSentence(scope.goals)}。`,
    `本次不做：${joinAsSentence(scope.non_goals)}。`,
    `联调规则：${joinAsSentence(integrationRules)}。`,
    `硬停止条件：${joinAsSentence(stopConditions.hard_stop)}。`,
    `软停止条件：${joinAsSentence(stopConditions.soft_stop)}。`,
    `验证要求：${joinAsSentence(renderValidationTextList(validationCommands))}。`,
    "完成后输出：上下游改动、共享契约依据、适配层处理、验证结果、残留联调风险。"
  ].join(" ");
}

function renderStabilizationPromptSections(input, validationCommands, stopConditions) {
  const source = normalizeSourceOfTruth(input.source_of_truth || {});
  const scope = input.scope || {};
  return {
    task_type: "stabilization",
    title: assertNonEmpty(input.title, "title"),
    goals: ensureStringArray(scope.goals),
    non_goals: ensureStringArray(scope.non_goals),
    source_of_truth: [
      ...source.route_entry,
      ...source.active_implementation,
      ...source.candidate_compat_layer,
      ...source.related_files
    ],
    validation_commands: validationCommands,
    stop_conditions: stopConditions,
    delivery_requirements: [
      "变更说明",
      "修改文件及原因",
      "唯一事实实现位置",
      "兼容层处理结果",
      "验证结果",
      "残留风险"
    ]
  };
}

function renderFeaturePromptSections(input, validationCommands, stopConditions) {
  const source = normalizeSourceOfTruth(input.source_of_truth || {});
  const scope = input.scope || {};
  return {
    task_type: "feature",
    title: assertNonEmpty(input.title, "title"),
    goals: ensureStringArray(scope.goals),
    non_goals: ensureStringArray(scope.non_goals),
    source_of_truth: [
      ...source.entry_points,
      ...source.existing_domain_model,
      ...source.ui_reference,
      ...source.api_reference
    ],
    reuse_constraints: ensureStringArray(input.reuse_constraints || []),
    validation_commands: validationCommands,
    stop_conditions: stopConditions
  };
}

function renderIntegrationPromptSections(input, validationCommands, stopConditions) {
  const source = normalizeSourceOfTruth(input.source_of_truth || {});
  const scope = input.scope || {};
  return {
    task_type: "integration",
    title: assertNonEmpty(input.title, "title"),
    goals: ensureStringArray(scope.goals),
    non_goals: ensureStringArray(scope.non_goals),
    source_of_truth: [
      ...source.upstream_system,
      ...source.downstream_system,
      ...source.shared_contract,
      ...source.integration_entry
    ],
    integration_rules: ensureStringArray(input.integration_rules || []),
    validation_commands: validationCommands,
    stop_conditions: stopConditions
  };
}

function renderBulletLines(value) {
  return ensureStringArray(value).map((item) => `- ${item}`);
}

function renderCodeBulletLines(value) {
  return ensureStringArray(value).map((item) => `- \`${item}\``);
}

function renderValidationBulletLines(value) {
  return value.map((item) => `- \`${item.command}\` ${item.required ? "必须通过" : "可选执行"}`);
}

function renderValidationTextList(value) {
  return value.map((item) => `\`${item.command}\`${item.required ? " 必须通过" : " 可选执行"}`);
}

function renderInlineCodeList(value) {
  return ensureStringArray(value).map((item) => `\`${item}\``).join("、");
}

function joinAsSentence(value) {
  const items = ensureStringArray(value);
  if (items.length === 0) {
    return "无";
  }
  return items.join("；");
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
}

function ensureStringArray(value) {
  return ensureArray(value).map((item) => String(item || "").trim()).filter(Boolean);
}

function assertNonEmpty(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function dedupe(value) {
  return Array.from(new Set(value.filter(Boolean)));
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
  main();
}
