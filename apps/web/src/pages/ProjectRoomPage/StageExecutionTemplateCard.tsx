import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BrainCircuit,
  CheckCircle2,
  Copy,
  FileOutput,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
  Workflow,
  XCircle,
} from 'lucide-react';
import type {
  ProjectExecutionProtocolPrecheck,
  ProjectExecutionRecord,
  ProjectFinalArtifactsReport,
  ProjectRequiredAction,
  ProjectTemplateGatePrecheck,
  SystemExecutionProtocolStageRule,
} from '../../lib/api';
import { Badge } from './Badge';

type StageTemplateSection = {
  protocolName: string;
  summary: string;
  deliverables: string[];
  mustDo: string[];
  gates: string[];
  handoff: string[];
  evidence: string[];
  memoryRule: string;
};

type StageDeliverableItem = {
  id: string;
  name: string;
  status: string;
  version?: number;
  createdBy?: string;
  updatedAt: string;
};

type CopyTargetRoleKey = 'pm' | 'design' | 'dev' | 'qa';
type DispatchSummaryFormat = 'text' | 'markdown';

const STAGE_RELEVANT_COPY_TARGETS: Record<string, CopyTargetRoleKey[]> = {
  INIT: ['pm'],
  ANALYSIS: ['pm', 'design'],
  DESIGN: ['design', 'dev'],
  DEV: ['dev', 'qa'],
  ACCEPT: ['qa', 'dev', 'pm'],
};

const EXECUTION_ROLE_TO_COPY_TARGET: Partial<Record<string, CopyTargetRoleKey>> = {
  ROLE_PM: 'pm',
  ROLE_ANALYST: 'pm',
  ROLE_PRODUCT: 'pm',
  ROLE_DESIGN: 'design',
  ROLE_ARCH: 'dev',
  ROLE_DEV: 'dev',
  ROLE_QA: 'qa',
};

const COPY_TARGET_ROLES: Array<{
  key: CopyTargetRoleKey;
  label: string;
  title: string;
  focus: string[];
}> = [
  {
    key: 'pm',
    label: 'PM',
    title: '项目经理',
    focus: [
      '优先输出推进判断、取舍依据、阶段结论和下游 handoff。',
      '把模糊项转成明确范围、责任人、审批动作和下一步。',
    ],
  },
  {
    key: 'design',
    label: '设计',
    title: '设计负责人',
    focus: [
      '优先关注页面结构、交互规则、状态定义、视觉边界和设计 handoff。',
      '若当前阶段不是设计阶段，也要从体验和界面规范角度补足缺口。',
    ],
  },
  {
    key: 'dev',
    label: '研发',
    title: '研发负责人',
    focus: [
      '优先关注真实实现路径、接口链路、代码改动、运行方式和验证结果。',
      '必须避免把设计稿、静态页或演示稿当成实现结果。',
    ],
  },
  {
    key: 'qa',
    label: 'QA',
    title: '测试负责人',
    focus: [
      '优先关注验收口径、风险项、复现步骤、测试证据和阻断判断。',
      '若发现结果不可验证，要直接指出缺失证据和补测动作。',
    ],
  },
];

const STAGE_TEMPLATE_MAP: Record<string, StageTemplateSection> = {
  INIT: {
    protocolName: '立项协议 v1',
    summary: '把模糊输入收敛成项目章程，让分析角色接手时不需要重新猜需求边界。',
    deliverables: ['项目目标', '范围 / 非范围', '初始角色分工', '阶段计划', '待澄清问题列表'],
    mustDo: ['明确项目目标', '明确范围边界', '识别待确认信息', '指定阶段负责人'],
    gates: ['缺目标不能进分析', '缺范围边界不能进分析', '缺负责人不能进分析'],
    handoff: ['handoff 必须能直接交给分析阶段', 'openQuestions 必须保留风险空白'],
    evidence: ['factsConfirmed', 'assumptions', 'decisions', 'handoff', 'openQuestions'],
    memoryRule: '长期记忆保持开启，但只能引用当前项目或高关联经验，旧项目章程和默认设定不能直接沿用。',
  },
  ANALYSIS: {
    protocolName: '立项协议 v1',
    summary: '把需求变成设计和研发可直接消费的结构化输入，重点是边界、约束、风险和验收标准。',
    deliverables: ['需求分析结论', '范围与边界说明', '约束条件清单', '风险清单', '验收标准', '阶段建议与优先级'],
    mustDo: ['抽取目标与边界', '定义验收标准', '区分事实与假设', '给出优先级与取舍依据'],
    gates: ['边界不清不能进设计', '验收标准缺失不能进设计', '关键约束未确认不能进设计'],
    handoff: ['handoff 必须能直接交给产品 / 设计', 'decisions 要写清为什么这样定'],
    evidence: ['factsConfirmed', 'assumptions', 'decisions', 'handoff', 'openQuestions'],
    memoryRule: '允许参考高关联历史经验，但不得把旧需求结论、旧视觉口径或历史 demo 当作当前事实。',
  },
  DESIGN: {
    protocolName: '研发执行协议 v1',
    summary: '把分析结论转成研发可直接实现的设计方案，重点是结构、状态、交互和边界规则。',
    deliverables: ['页面 / 模块结构方案', '视觉与交互说明', '关键状态说明', '响应式与异常状态规则', '研发交付边界'],
    mustDo: ['明确体验目标', '完成关键页面和状态方案', '说明交互与响应式规则', '标注事实与假设边界'],
    gates: ['关键页面未定义不能进研发', '交互规则不完整不能进研发', '输出无法指导实现不能进研发'],
    handoff: ['handoff 必须写清实现边界', 'openQuestions 要保留未闭合设计风险'],
    evidence: ['skillsUsed', 'reasoningBasis', 'artifactsProduced', 'verification'],
    memoryRule: '只能使用当前项目或高关联经验，禁止套用旧项目视觉模板、默认 landing 页和历史演示风格。',
  },
  DEV: {
    protocolName: '研发执行协议 v1',
    summary: 'DEV 阶段必须证明“真的做出来并能复核”，所以除了技术方案，还必须补齐实现结果和运行 / 部署说明。',
    deliverables: ['技术方案与选型.md', '实现结果说明.md', '运行地址与部署说明.md'],
    mustDo: ['明确接口与依赖', '完成真实代码修改', '补齐页面 / 接口 / 数据链路证据', '补齐运行地址、环境变量和验证步骤'],
    gates: ['无真实实现证据不能进验收', '无运行 / 联调说明不能进验收', '无验证结果不能进验收'],
    handoff: ['handoff 必须写给 QA 或下游协作者', 'decisions 必须能回溯关键取舍'],
    evidence: ['skillsUsed', 'reasoningBasis', 'artifactsProduced', 'verification'],
    memoryRule: '历史经验只能作为实现参考，不能替代当前项目接口契约、风险判断和验证结果。',
  },
  ACCEPT: {
    protocolName: '研发执行协议 v1',
    summary: '基于可验证结果做验收、回填和归档，完成本轮项目闭环。',
    deliverables: ['测试报告', '验收结论', '产品说明文档回填', '长期记忆回填', '复盘项'],
    mustDo: ['按验收标准核对', '输出测试与验收结论', '回填文档与长期记忆', '判定是否可归档'],
    gates: ['必需交付物不齐不能关闭项目', '最新 QA 失败不能关闭项目', '缺少真实研发结果不能关闭项目'],
    handoff: ['handoff 必须说明下一轮输入', 'openQuestions 要明确是否还有遗留风险'],
    evidence: ['skillsUsed', 'reasoningBasis', 'artifactsProduced', 'verification'],
    memoryRule: '只有通过验收的结果才能沉淀为长期记忆，半成品经验和旧项目模板不能直接写入记忆。',
  },
};

const ROLE_LABELS: Record<string, string> = {
  ROLE_PM: 'PM',
  ROLE_ANALYST: '分析',
  ROLE_PRODUCT: '产品',
  ROLE_DESIGN: '设计',
  ROLE_ARCH: '架构',
  ROLE_DEV: '研发',
  ROLE_QA: 'QA',
};

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'accent' | 'warning' | 'danger' | 'primary'> = {
  success: 'primary',
  approved: 'primary',
  submitted: 'accent',
  failed: 'danger',
  rejected: 'danger',
  draft: 'warning',
};

type Props = {
  projectName?: string;
  stageType?: string;
  stageLabel: string;
  stageRules: SystemExecutionProtocolStageRule[];
  stageDeliverables: StageDeliverableItem[];
  stageExecutionRecords: ProjectExecutionRecord[];
  templateGatePrecheck: ProjectTemplateGatePrecheck | null;
  executionProtocolPrecheck: ProjectExecutionProtocolPrecheck | null;
  requiredActions: ProjectRequiredAction[];
  finalArtifacts: ProjectFinalArtifactsReport | null;
  onCopyAgentPrompt?: (content: string) => void;
};

function getBadgeVariant(status?: string) {
  const normalized = String(status || '').toLowerCase();
  return STATUS_BADGE_VARIANT[normalized] || 'default';
}

function formatRecordTime(value?: string) {
  if (!value) {
    return '-';
  }
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    return value;
  }
  return time.toLocaleString('zh-CN');
}

function buildLatestExecutionMap(records: ProjectExecutionRecord[]) {
  const mapping = new Map<string, ProjectExecutionRecord>();
  records.forEach((record) => {
    const role = String(record.role || '').trim();
    if (!role) {
      return;
    }
    const current = mapping.get(role);
    const currentAt = current ? new Date(current.updatedAt || current.createdAt).getTime() : -1;
    const nextAt = new Date(record.updatedAt || record.createdAt).getTime();
    if (!current || nextAt >= currentAt) {
      mapping.set(role, record);
    }
  });
  return mapping;
}

function getRelevantCopyTargets(stageType: string | undefined, stageRules: SystemExecutionProtocolStageRule[]) {
  const orderedKeys: CopyTargetRoleKey[] = [];
  const append = (key?: CopyTargetRoleKey) => {
    if (!key || orderedKeys.includes(key)) {
      return;
    }
    orderedKeys.push(key);
  };

  (STAGE_RELEVANT_COPY_TARGETS[stageType || ''] || []).forEach(append);
  stageRules.forEach((rule) => append(EXECUTION_ROLE_TO_COPY_TARGET[rule.role]));

  if (orderedKeys.length === 0) {
    return COPY_TARGET_ROLES;
  }

  return COPY_TARGET_ROLES.filter((item) => orderedKeys.includes(item.key));
}

function compactText(value: string | null | undefined, maxLength = 220) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return '无附加说明';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatExecutionRecordBlock(record: ProjectExecutionRecord, index: number, label: string) {
  return [
    `${index + 1}. ${label}`,
    `   角色: ${ROLE_LABELS[record.role] || record.role}`,
    `   动作: ${record.action || '未知动作'}`,
    `   时间: ${formatRecordTime(record.updatedAt || record.createdAt)}`,
    `   状态: ${record.status || 'unknown'}`,
    `   模型: ${record.model || record.provider || record.runtimeMode || '未知'}`,
    `   摘要: ${compactText(record.errorMessage || record.promptSummary || record.outputPreview || '无附加说明')}`,
  ].join('\n');
}

function formatExecutionFailureSummary(
  records: ProjectExecutionRecord[],
  latestExecutionByRole: Map<string, ProjectExecutionRecord>,
) {
  const failedRecords = Array.from(latestExecutionByRole.values())
    .filter((record) => String(record.status || '').toLowerCase() === 'failed')
    .sort((a, b) =>
      new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    );

  if (failedRecords.length === 0) {
    const latestRecord = [...records].sort((a, b) =>
      new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    )[0];

    if (!latestRecord) {
      return '当前阶段还没有可引用的执行记录。';
    }

    return [
      '当前没有失败执行，以下为最近一次执行记录：',
      formatExecutionRecordBlock(latestRecord, 0, '最近执行'),
    ].join('\n');
  }

  return failedRecords
    .slice(0, 3)
    .map((record, index) => formatExecutionRecordBlock(record, index, '失败执行'))
    .join('\n');
}

function formatRoleGapSummary(
  targetRole: CopyTargetRoleKey,
  stageGaps: Array<{ key: string; level: 'critical' | 'warning' | 'info'; label: string; detail: string }>,
) {
  if (stageGaps.length === 0) {
    return '当前阶段没有发现缺口，可直接做最终复核。';
  }

  const matchers: Record<CopyTargetRoleKey, RegExp> = {
    pm: /(推进|审批|范围|阶段|立项|handoff|协议)/i,
    design: /(设计|交互|页面|视觉|体验|状态)/i,
    dev: /(研发|实现|运行|部署|接口|代码|联调|真实研发|环境变量)/i,
    qa: /(QA|测试|验收|复现|风险|阻断|失败)/i,
  };
  const relevant = stageGaps.filter((item) => matchers[targetRole].test(`${item.label} ${item.detail}`));
  const selected = (relevant.length > 0 ? relevant : stageGaps)
    .sort((a, b) => {
      const levelWeight = { critical: 0, warning: 1, info: 2 } as const;
      return levelWeight[a.level] - levelWeight[b.level];
    })
    .slice(0, 5);

  return selected.map((item, index) => [
    `${index + 1}. ${item.label}`,
    `   等级: ${item.level}`,
    `   详情: ${compactText(item.detail, 200)}`,
  ].join('\n')).join('\n');
}

function buildStageGapList(input: {
  requiredActions: ProjectRequiredAction[];
  templateGatePrecheck: ProjectTemplateGatePrecheck | null;
  executionProtocolPrecheck: ProjectExecutionProtocolPrecheck | null;
  finalArtifacts: ProjectFinalArtifactsReport | null;
  stageType?: string;
  stageRules: SystemExecutionProtocolStageRule[];
  latestExecutionByRole: Map<string, ProjectExecutionRecord>;
}) {
  const gaps: Array<{ key: string; level: 'critical' | 'warning' | 'info'; label: string; detail: string }> = [];
  const resolveProtocolGapLabel = (detail: string, isBlocking: boolean) => {
    if (/最新(?:QA|测试工程师)执行失败/i.test(detail)) {
      return '最新 QA 失败';
    }
    if (/缺少真实研发实现证据|缺少真实研发结果/i.test(detail)) {
      return '缺少真实研发结果';
    }
    return isBlocking ? '执行阻断' : '协议缺口';
  };

  input.requiredActions.forEach((item) => {
    gaps.push({
      key: `action-${item.id}`,
      level: item.severity === 'critical' ? 'critical' : item.severity === 'warning' ? 'warning' : 'info',
      label: item.title,
      detail: item.detail,
    });
  });

  if (input.templateGatePrecheck && !input.templateGatePrecheck.pass) {
    input.templateGatePrecheck.items
      .filter((item) => !item.pass)
      .forEach((item) => {
        gaps.push({
          key: `template-${item.expectedName}`,
          level: 'warning',
          label: `交付物未达标: ${item.expectedName}`,
          detail: item.reason,
        });
      });
  }

  if (input.executionProtocolPrecheck && !input.executionProtocolPrecheck.pass) {
    input.executionProtocolPrecheck.issues.forEach((item, index) => {
      const isBlocking = input.executionProtocolPrecheck?.blockingIssues.includes(item);
      gaps.push({
        key: `protocol-${index}`,
        level: isBlocking ? 'critical' : 'warning',
        label: resolveProtocolGapLabel(item, Boolean(isBlocking)),
        detail: item,
      });
    });
  }

  if (input.stageType === 'ACCEPT' && input.finalArtifacts?.blockingIssues?.length) {
    input.finalArtifacts.blockingIssues.forEach((item, index) => {
      gaps.push({
        key: `final-artifact-${index}`,
        level: 'critical',
        label: /最新(?:QA|测试工程师)执行失败/i.test(item) ? '最新 QA 失败' : '最终验收阻断',
        detail: item,
      });
    });
  }

  input.stageRules.forEach((rule) => {
    if (rule.mode !== 'terminal_agent') {
      return;
    }
    const latest = input.latestExecutionByRole.get(rule.role);
    if (!latest) {
      gaps.push({
        key: `role-missing-${rule.role}`,
        level: 'warning',
        label: `${ROLE_LABELS[rule.role] || rule.role} 还没有真实执行记录`,
        detail: '该角色尚未留下可验证执行结果，当前阶段不宜直接推进。',
      });
      return;
    }
    if (String(latest.status || '').toLowerCase() === 'failed') {
      gaps.push({
        key: `role-failed-${rule.role}`,
        level: 'critical',
        label: `${ROLE_LABELS[rule.role] || rule.role} 最新执行失败`,
        detail: latest.errorMessage || latest.promptSummary || '需先修复失败原因后再推进。',
      });
    }
  });

  return gaps.filter((item, index, list) =>
    list.findIndex((candidate) => candidate.key === item.key) === index
  );
}

function buildAgentInstructionTemplate(input: {
  projectName?: string;
  stageType: string;
  stageLabel: string;
  template: StageTemplateSection;
  stageGaps: Array<{ key: string; level: 'critical' | 'warning' | 'info'; label: string; detail: string }>;
  stageDeliverables: StageDeliverableItem[];
  stageRules: SystemExecutionProtocolStageRule[];
  latestExecutionByRole: Map<string, ProjectExecutionRecord>;
  executionProtocolPrecheck: ProjectExecutionProtocolPrecheck | null;
}) {
  const existingDeliverables = input.stageDeliverables.length > 0
    ? input.stageDeliverables.map((item) => `- ${item.name}（状态: ${item.status}，版本: v${item.version || 1}）`).join('\n')
    : '- 当前阶段暂无已登记交付物';

  const currentGaps = input.stageGaps.length > 0
    ? input.stageGaps.map((item, index) => `${index + 1}. [${item.level}] ${item.label}: ${item.detail}`).join('\n')
    : '1. 当前未发现协议或执行缺口，请做最终核对后提交。';

  const roleStatus = input.stageRules.length > 0
    ? input.stageRules.map((rule) => {
      const latest = input.latestExecutionByRole.get(rule.role);
      const role = ROLE_LABELS[rule.role] || rule.role;
      if (!latest) {
        return `- ${role}: 尚无真实执行记录`;
      }
      const status = String(latest.status || 'unknown').toLowerCase();
      const model = latest.model || latest.provider || latest.runtimeMode || '未知';
      const detail = latest.errorMessage || latest.promptSummary || '无附加说明';
      return `- ${role}: ${status}；模型/运行链路: ${model}；说明: ${detail}`;
    }).join('\n')
    : '- 当前阶段未配置角色执行规则';

  const collaborationState = input.executionProtocolPrecheck
    ? `协作交接卡: ${input.executionProtocolPrecheck.collaborationSatisfiedBy}`
    : '协作交接卡: 未预检';
  const skillState = input.executionProtocolPrecheck
    ? `技能执行证据: ${input.executionProtocolPrecheck.skillEvidenceSatisfiedBy}`
    : '技能执行证据: 未预检';

  return [
    `你正在处理项目「${input.projectName || '当前项目'}」的 ${input.stageLabel}（${input.stageType}）阶段。`,
    '',
    '请严格按以下执行，不要输出泛泛分析，不要把设计稿、静态演示页或占位文案冒充真实交付。',
    '',
    '【阶段目标】',
    input.template.summary,
    '',
    '【当前推进缺口】',
    currentGaps,
    '',
    '【必须交付】',
    ...input.template.deliverables.map((item) => `- ${item}`),
    '',
    '【必须完成】',
    ...input.template.mustDo.map((item) => `- ${item}`),
    '',
    '【协议门禁】',
    ...input.template.gates.map((item) => `- ${item}`),
    '',
    '【Handoff 必填】',
    ...input.template.handoff.map((item) => `- ${item}`),
    '',
    '【协议证据字段】',
    ...input.template.evidence.map((item) => `- ${item}`),
    `- ${collaborationState}`,
    `- ${skillState}`,
    '',
    '【当前阶段已有交付物】',
    existingDeliverables,
    '',
    '【当前角色真实执行状态】',
    roleStatus,
    '',
    '【执行要求】',
    '1. 先补齐所有 critical / warning 缺口，再提交阶段结果。',
    '2. 若需要修改交付物，必须直接给出可落地内容，而不是只给建议。',
    '3. 输出中必须保留事实、假设、决策、handoff、openQuestions 或 skillsUsed 等协议字段证据。',
    '4. 如果发现当前阶段不应推进，请直接明确指出阻断项与返工动作。',
    '',
    '【输出格式】',
    '1. 先给“阶段结论”。',
    '2. 再给“已完成 / 未完成 / 阻断项”。',
    '3. 再给“交付物正文或修订内容”。',
    '4. 最后给“给下游角色的 handoff”。',
  ].join('\n');
}

function buildGapRepairInstructionTemplate(input: {
  projectName?: string;
  stageType: string;
  stageLabel: string;
  template: StageTemplateSection;
  stageGaps: Array<{ key: string; level: 'critical' | 'warning' | 'info'; label: string; detail: string }>;
  stageDeliverables: StageDeliverableItem[];
  protocolChecks: Array<{
    key: string;
    label: string;
    passed: boolean;
    category: 'collaboration' | 'skill' | 'content';
    detail?: string;
  }>;
}) {
  const unresolvedProtocolChecks = input.protocolChecks.filter((item) => !item.passed);
  const stageGapBlock = input.stageGaps.length > 0
    ? input.stageGaps.map((item, index) => `${index + 1}. [${item.level}] ${item.label}: ${item.detail}`).join('\n')
    : '1. 当前没有明确缺口，请只做最终复核。';
  const protocolBlock = unresolvedProtocolChecks.length > 0
    ? unresolvedProtocolChecks.map((item, index) => `${index + 1}. ${item.label}: ${item.detail || '未通过'}`).join('\n')
    : '1. 当前没有协议条目未通过。';
  const deliverableBlock = input.stageDeliverables.length > 0
    ? input.stageDeliverables.map((item) => `- ${item.name}（${item.status}，v${item.version || 1}）`).join('\n')
    : '- 当前阶段暂无已提交交付物';

  return [
    `你正在为项目「${input.projectName || '当前项目'}」修复 ${input.stageLabel}（${input.stageType}）阶段的推进缺口。`,
    '',
    '本任务不是重新做整阶段方案，而是只修复当前阻断项，让阶段能够继续推进。',
    '',
    '【当前缺口】',
    stageGapBlock,
    '',
    '【未通过的协议条目】',
    protocolBlock,
    '',
    '【当前已有交付物】',
    deliverableBlock,
    '',
    '【修复要求】',
    '1. 逐条对应当前缺口，不要输出无关扩展方案。',
    '2. 若需要补正文，请直接给出可粘贴回交付物的最终内容。',
    '3. 若缺的是协议字段，必须补齐字段名原样输出，不可改名。',
    '4. 若缺的是交付物证据，请补真实路径、真实接口、真实验证步骤，不要写演示壳。',
    '5. 修复后请明确说明这些改动分别消除了哪条阻断。',
    '',
    '【输出格式】',
    '1. 先给“修复结论”。',
    '2. 再按“阻断项 -> 修复动作 -> 修复结果”逐条列出。',
    '3. 再给“可直接替换的交付物正文/补丁内容”。',
    '4. 最后给“修复后仍剩余的风险或待确认项”。',
    '',
    '【阶段约束】',
    ...input.template.gates.map((item) => `- ${item}`),
  ].join('\n');
}

function buildRoleTargetedInstructionTemplate(input: {
  baseTemplate: string;
  targetRole: CopyTargetRoleKey;
  mode: 'generic' | 'repair';
  stageGaps: Array<{ key: string; level: 'critical' | 'warning' | 'info'; label: string; detail: string }>;
  stageExecutionRecords: ProjectExecutionRecord[];
  latestExecutionByRole: Map<string, ProjectExecutionRecord>;
}) {
  const target = COPY_TARGET_ROLES.find((item) => item.key === input.targetRole);
  if (!target) {
    return input.baseTemplate;
  }

  const roleExecutionSummary = (input.targetRole === 'dev' || input.targetRole === 'qa')
    ? formatExecutionFailureSummary(input.stageExecutionRecords, input.latestExecutionByRole)
    : '';
  const roleGapSummary = (input.targetRole === 'dev' || input.targetRole === 'qa')
    ? formatRoleGapSummary(input.targetRole, input.stageGaps)
    : '';

  return [
    `你本次接收任务的目标角色是「${target.title}」。`,
    `模板类型: ${input.mode === 'repair' ? '当前缺口修复模板' : '通用执行模板'}`,
    '',
    '【角色关注重点】',
    ...target.focus.map((item) => `- ${item}`),
    ...(roleExecutionSummary
      ? [
          '',
          '【执行工单摘要】',
          roleExecutionSummary,
        ]
      : []),
    ...(roleGapSummary
      ? [
          '',
          '【缺口工单摘要】',
          roleGapSummary,
        ]
      : []),
    '',
    input.baseTemplate,
  ].join('\n');
}

function buildRoleDispatchSummary(input: {
  projectName?: string;
  stageType: string;
  stageLabel: string;
  targetRole: CopyTargetRoleKey;
  stageGaps: Array<{ key: string; level: 'critical' | 'warning' | 'info'; label: string; detail: string }>;
  stageExecutionRecords: ProjectExecutionRecord[];
  latestExecutionByRole: Map<string, ProjectExecutionRecord>;
  summaryScope: 'blocking' | 'all';
  format: DispatchSummaryFormat;
}) {
  const target = COPY_TARGET_ROLES.find((item) => item.key === input.targetRole);
  if (!target) {
    return '';
  }

  const scopedGaps = input.summaryScope === 'blocking'
    ? input.stageGaps.filter((item) => item.level === 'critical')
    : input.stageGaps;
  const effectiveGaps = scopedGaps.length > 0 ? scopedGaps : input.stageGaps;
  const criticalCount = input.stageGaps.filter((item) => item.level === 'critical').length;
  const warningCount = input.stageGaps.filter((item) => item.level === 'warning').length;
  const stageStatus = input.stageGaps.length === 0
    ? '可推进'
    : criticalCount > 0
      ? `阻断 ${criticalCount}`
      : `待补 ${warningCount || input.stageGaps.length}`;
  const scopeLabel = input.summaryScope === 'blocking' ? '仅阻断项' : '全部缺口';
  const scopeHint = input.summaryScope === 'blocking' && scopedGaps.length === 0
    ? '当前没有 critical 阻断，以下回退展示最相关缺口。'
    : '';
  const executionSummary = formatExecutionFailureSummary(input.stageExecutionRecords, input.latestExecutionByRole);
  const gapSummary = formatRoleGapSummary(input.targetRole, effectiveGaps);

  if (input.format === 'markdown') {
    return [
      '# 派工摘要',
      '',
      `- 派工对象: ${target.title}`,
      `- 项目: ${input.projectName || '当前项目'}`,
      `- 阶段: ${input.stageLabel} (${input.stageType})`,
      `- 推进状态: ${stageStatus}`,
      `- 摘要视图: ${scopeLabel}`,
      `- 本次重点: ${target.focus[0] || '请按当前阶段缺口推进处理。'}`,
      ...(scopeHint ? ['', `> ${scopeHint}`] : []),
      '',
      '## 执行摘要',
      '```text',
      executionSummary,
      '```',
      '',
      '## 缺口摘要',
      '```text',
      gapSummary,
      '```',
    ].join('\n');
  }

  return [
    `派工对象: ${target.title}`,
    `项目: ${input.projectName || '当前项目'}`,
    `阶段: ${input.stageLabel} (${input.stageType})`,
    `推进状态: ${stageStatus}`,
    `摘要视图: ${scopeLabel}`,
    `本次重点: ${target.focus[0] || '请按当前阶段缺口推进处理。'}`,
    ...(scopeHint ? ['', scopeHint] : []),
    '',
    '执行摘要',
    executionSummary,
    '',
    '缺口摘要',
    gapSummary,
  ].join('\n');
}

function StageRuleCard({
  rule,
  latestRecord,
}: {
  rule: SystemExecutionProtocolStageRule;
  latestRecord?: ProjectExecutionRecord;
}) {
  const recordStatus = latestRecord ? String(latestRecord.status || '').toLowerCase() : 'missing';
  const statusLabel = !latestRecord
    ? '未执行'
    : recordStatus === 'success'
      ? '最近成功'
      : recordStatus === 'failed'
        ? '最近失败'
        : latestRecord.status;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{ROLE_LABELS[rule.role] || rule.role}</p>
          <p className="mt-1 text-[11px] text-slate-400">
            {rule.mode === 'terminal_agent' ? `Terminal Agent · ${rule.openClawAgentId || '未绑定'}` : 'Direct Model'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={rule.mode === 'terminal_agent' ? 'accent' : 'default'}>
            {rule.mode === 'terminal_agent' ? '终端优先' : '直接模型'}
          </Badge>
          <Badge variant={recordStatus === 'success' ? 'primary' : recordStatus === 'failed' ? 'danger' : 'warning'}>
            {statusLabel}
          </Badge>
        </div>
      </div>
      <div className="space-y-1 text-[11px] text-slate-400">
        <p>模型链: {rule.preferredModels.slice(0, 3).join(' -> ') || '未配置'}</p>
        <p>requiredSkills: {rule.requiredSkills.join(' / ') || '无'}</p>
        <p>handoff 字段: {rule.requiredCollaborationFields.join(' / ') || '无'}</p>
        <p>最近执行: {latestRecord ? formatRecordTime(latestRecord.updatedAt || latestRecord.createdAt) : '暂无'}</p>
        <p>最近模型: {latestRecord?.model || latestRecord?.provider || latestRecord?.runtimeMode || '未知'}</p>
      </div>
      {latestRecord?.errorMessage ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {latestRecord.errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export default function StageExecutionTemplateCard({
  projectName,
  stageType,
  stageLabel,
  stageRules,
  stageDeliverables,
  stageExecutionRecords,
  templateGatePrecheck,
  executionProtocolPrecheck,
  requiredActions,
  finalArtifacts,
  onCopyAgentPrompt,
}: Props) {
  const template = STAGE_TEMPLATE_MAP[stageType || ''] || null;
  const [dispatchSummaryScope, setDispatchSummaryScope] = useState<'blocking' | 'all'>('blocking');
  const [dispatchSummaryFormat, setDispatchSummaryFormat] = useState<DispatchSummaryFormat>('text');

  if (!stageType || !template) {
    return null;
  }

  const latestExecutionByRole = buildLatestExecutionMap(stageExecutionRecords);
  const stageGaps = buildStageGapList({
    requiredActions,
    templateGatePrecheck,
    executionProtocolPrecheck,
    finalArtifacts,
    stageType,
    stageRules,
    latestExecutionByRole,
  });

  const criticalGapCount = stageGaps.filter((item) => item.level === 'critical').length;
  const templateItems = templateGatePrecheck?.items || [];
  const contentChecks = executionProtocolPrecheck?.contentChecks || [];
  const protocolChecks = executionProtocolPrecheck?.protocolChecks || [];
  const genericAgentInstructionTemplate = buildAgentInstructionTemplate({
    projectName,
    stageType,
    stageLabel,
    template,
    stageGaps,
    stageDeliverables,
    stageRules,
    latestExecutionByRole,
    executionProtocolPrecheck,
  });
  const gapRepairInstructionTemplate = buildGapRepairInstructionTemplate({
    projectName,
    stageType,
    stageLabel,
    template,
    stageGaps,
    stageDeliverables,
    protocolChecks,
  });
  const relevantCopyTargets = getRelevantCopyTargets(stageType, stageRules);
  const compactDispatchTargets = relevantCopyTargets.filter((target) => target.key === 'dev' || target.key === 'qa');
  const dispatchSummaryByRole = new Map(
    compactDispatchTargets.map((target) => [
      target.key,
      buildRoleDispatchSummary({
        projectName,
        stageType,
        stageLabel,
        targetRole: target.key,
        stageGaps,
        stageExecutionRecords,
        latestExecutionByRole,
        summaryScope: dispatchSummaryScope,
        format: dispatchSummaryFormat,
      }),
    ]),
  );
  const copyRoleTemplate = (mode: 'generic' | 'repair', role: CopyTargetRoleKey) => {
    const baseTemplate = mode === 'repair' ? gapRepairInstructionTemplate : genericAgentInstructionTemplate;
    onCopyAgentPrompt?.(buildRoleTargetedInstructionTemplate({
      baseTemplate,
      targetRole: role,
      mode,
      stageGaps,
      stageExecutionRecords,
      latestExecutionByRole,
    }));
  };
  const copyDispatchSummary = (role: CopyTargetRoleKey) => {
    const summary = dispatchSummaryByRole.get(role);
    if (summary) {
      onCopyAgentPrompt?.(summary);
    }
  };

  return (
    <section className="overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[linear-gradient(180deg,rgba(34,211,238,0.12),rgba(15,23,42,0.94)_18%,rgba(15,23,42,0.98))] shadow-[0_28px_90px_rgba(0,0,0,0.35)]">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="accent">{template.protocolName}</Badge>
              <Badge variant="default">{stageType}</Badge>
              <Badge variant={stageGaps.length === 0 ? 'primary' : criticalGapCount > 0 ? 'danger' : 'warning'}>
                {stageGaps.length === 0 ? '可推进' : criticalGapCount > 0 ? `阻断 ${criticalGapCount}` : `待补 ${stageGaps.length}`}
              </Badge>
            </div>
            <h3 className="mt-3 text-xl font-semibold tracking-tight text-white">{stageLabel}阶段执行卡模板</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{template.summary}</p>
          </div>
          <div className="flex max-w-md flex-col items-end gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onCopyAgentPrompt?.(genericAgentInstructionTemplate)}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-400/15"
                >
                  <Copy size={14} />
                  复制通用 Agent 模板
                </button>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {relevantCopyTargets.map((target) => (
                    <button
                      key={`generic-${target.key}`}
                      type="button"
                      onClick={() => copyRoleTemplate('generic', target.key)}
                      className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-1 text-[11px] text-cyan-100 transition hover:bg-cyan-400/10"
                    >
                      复制给 {target.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onCopyAgentPrompt?.(gapRepairInstructionTemplate)}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-400/15"
                >
                  <Copy size={14} />
                  复制当前缺口修复模板
                </button>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {relevantCopyTargets.map((target) => (
                    <button
                      key={`repair-${target.key}`}
                      type="button"
                      onClick={() => copyRoleTemplate('repair', target.key)}
                      className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-2.5 py-1 text-[11px] text-amber-100 transition hover:bg-amber-400/10"
                    >
                      复制给 {target.label}
                    </button>
                  ))}
                </div>
              </div>
              {compactDispatchTargets.length > 0 ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Quick Dispatch</span>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {compactDispatchTargets.map((target) => (
                      <button
                        key={`dispatch-${target.key}`}
                        type="button"
                        onClick={() => copyDispatchSummary(target.key)}
                        className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 transition hover:bg-white/10"
                      >
                        复制{target.label}工单摘要
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-right">
              <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200">Memory Guardrail</p>
              <p className="mt-2 text-xs leading-5 text-slate-300">{template.memoryRule}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-6 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="space-y-4">
          <div className={`rounded-2xl border p-4 ${
            stageGaps.length === 0
              ? 'border-emerald-400/25 bg-emerald-500/10'
              : criticalGapCount > 0
                ? 'border-danger/40 bg-danger/10'
                : 'border-amber-400/25 bg-amber-500/10'
          }`}>
            <div className="flex items-center justify-between gap-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                {criticalGapCount > 0 ? <ShieldAlert size={16} className="text-danger" /> : <ShieldCheck size={16} className="text-emerald-300" />}
                本阶段还缺什么才可推进
              </h4>
              <Badge variant={stageGaps.length === 0 ? 'primary' : criticalGapCount > 0 ? 'danger' : 'warning'}>
                {stageGaps.length === 0 ? '已满足' : `${stageGaps.length} 项缺口`}
              </Badge>
            </div>
            {stageGaps.length === 0 ? (
              <p className="mt-3 text-xs text-emerald-100/90">
                当前阶段模板门禁、协议门禁和执行记录都已满足推进要求。
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {stageGaps.map((item) => (
                  <div key={item.key} className="rounded-xl border border-white/10 bg-black/15 px-3 py-2">
                    <div className="flex items-center gap-2">
                      {item.level === 'critical' ? (
                        <XCircle size={14} className="text-danger" />
                      ) : item.level === 'warning' ? (
                        <AlertTriangle size={14} className="text-amber-300" />
                      ) : (
                        <CheckCircle2 size={14} className="text-sky-300" />
                      )}
                      <p className="text-xs font-medium text-white">{item.label}</p>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-slate-300">{item.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {compactDispatchTargets.length > 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-white">当前派工摘要</h4>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                    <button
                      type="button"
                      onClick={() => setDispatchSummaryScope('blocking')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] transition ${
                        dispatchSummaryScope === 'blocking'
                          ? 'bg-danger/20 text-danger'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                      }`}
                    >
                      仅阻断项
                    </button>
                    <button
                      type="button"
                      onClick={() => setDispatchSummaryScope('all')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] transition ${
                        dispatchSummaryScope === 'all'
                          ? 'bg-cyan-400/15 text-cyan-100'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                      }`}
                    >
                      全部缺口
                    </button>
                  </div>
                  <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                    <button
                      type="button"
                      onClick={() => setDispatchSummaryFormat('text')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] transition ${
                        dispatchSummaryFormat === 'text'
                          ? 'bg-white/10 text-white'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                      }`}
                    >
                      纯文本
                    </button>
                    <button
                      type="button"
                      onClick={() => setDispatchSummaryFormat('markdown')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] transition ${
                        dispatchSummaryFormat === 'markdown'
                          ? 'bg-white/10 text-white'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                      }`}
                    >
                      Markdown
                    </button>
                  </div>
                  <Badge variant="default">研发 / QA 轻量版</Badge>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-slate-400">
                这里展示的是可直接分发的精简摘要，不替代完整阶段模板。当前视图和格式会同步影响“复制摘要”按钮的内容。
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {compactDispatchTargets.map((target) => (
                  <div key={`summary-card-${target.key}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">{target.title}</p>
                      <button
                        type="button"
                        onClick={() => copyDispatchSummary(target.key)}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 transition hover:bg-white/10"
                      >
                        <Copy size={12} />
                        复制摘要
                      </button>
                    </div>
                    <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-[11px] leading-5 text-slate-300">
                      {dispatchSummaryByRole.get(target.key)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                <FileOutput size={16} className="text-cyan-300" />
                协议标准产物
              </h4>
              <div className="mt-3 flex flex-wrap gap-2">
                {template.deliverables.map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-[11px] text-slate-200">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ListChecks size={16} className="text-emerald-300" />
                本阶段必须完成
              </h4>
              <div className="mt-3 space-y-2">
                {template.mustDo.map((item) => (
                  <p key={item} className="text-xs text-slate-300">{item}</p>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck size={16} className="text-amber-200" />
                协议门禁
              </h4>
              <div className="mt-3 space-y-2">
                {template.gates.map((item) => (
                  <p key={item} className="text-xs text-amber-100/90">{item}</p>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/10 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ArrowRightLeft size={16} className="text-fuchsia-200" />
                Handoff 规则
              </h4>
              <div className="mt-3 space-y-2">
                {template.handoff.map((item) => (
                  <p key={item} className="text-xs text-fuchsia-100/90">{item}</p>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <BrainCircuit size={16} className="text-sky-300" />
              协议字段对照
            </h4>
            <div className="mt-3 flex flex-wrap gap-2">
              {template.evidence.map((item) => (
                <span key={item} className="rounded-full border border-sky-400/25 bg-sky-500/10 px-3 py-1 text-[11px] text-sky-100">
                  {item}
                </span>
              ))}
            </div>
            {executionProtocolPrecheck ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-[11px] text-slate-400">协作交接卡</p>
                  <p className="mt-1 text-sm text-white">
                    {executionProtocolPrecheck.collaborationSatisfiedBy === 'missing'
                      ? '缺失'
                      : executionProtocolPrecheck.collaborationSatisfiedBy === 'metadata'
                        ? '已由执行元数据覆盖'
                        : executionProtocolPrecheck.collaborationSatisfiedBy === 'content'
                          ? '已由交付正文覆盖'
                          : '当前阶段不要求'}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-[11px] text-slate-400">技能执行记录</p>
                  <p className="mt-1 text-sm text-white">
                    {executionProtocolPrecheck.skillEvidenceSatisfiedBy === 'missing'
                      ? '缺失'
                      : executionProtocolPrecheck.skillEvidenceSatisfiedBy === 'metadata'
                        ? '已由执行元数据覆盖'
                        : executionProtocolPrecheck.skillEvidenceSatisfiedBy === 'content'
                          ? '已由交付正文覆盖'
                          : '当前阶段不要求'}
                  </p>
                </div>
              </div>
            ) : null}
            {protocolChecks.length > 0 ? (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">协议逐条核验</p>
                  <Badge variant={protocolChecks.every((item) => item.passed) ? 'primary' : 'warning'}>
                    {protocolChecks.filter((item) => !item.passed).length === 0
                      ? '全部通过'
                      : `${protocolChecks.filter((item) => !item.passed).length} 条未过`}
                  </Badge>
                </div>
                {protocolChecks.map((item) => (
                  <div key={item.key} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {item.passed ? (
                          <CheckCircle2 size={14} className="text-emerald-300" />
                        ) : item.category === 'content' ? (
                          <AlertTriangle size={14} className="text-amber-300" />
                        ) : (
                          <XCircle size={14} className="text-danger" />
                        )}
                        <p className="text-xs text-slate-200">{item.label}</p>
                      </div>
                      <Badge variant={item.passed ? 'primary' : item.category === 'content' ? 'warning' : 'danger'}>
                        {item.passed ? '通过' : '未过'}
                      </Badge>
                    </div>
                    {item.detail ? (
                      <p className="mt-1 text-[11px] leading-5 text-slate-400">{item.detail}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {contentChecks.length > 0 ? (
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {contentChecks.map((item) => (
                  <div key={item.key} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-200">{item.label}</p>
                      <Badge variant={item.passed ? 'primary' : 'warning'}>
                        {item.passed ? '已覆盖' : '缺失'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Workflow size={16} className="text-cyan-300" />
              当前项目真实执行对照
            </h4>
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              下面展示的不是协议文案，而是当前项目在该阶段已经留下的真实执行记录。
            </p>
            <div className="mt-4 space-y-3">
              {stageRules.map((rule) => (
                <StageRuleCard
                  key={`${rule.stageType}-${rule.role}`}
                  rule={rule}
                  latestRecord={latestExecutionByRole.get(rule.role)}
                />
              ))}
              {stageRules.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-5 text-xs text-slate-500">
                  当前未读取到系统执行矩阵，阶段模板仍可作为协作基线使用。
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <FileOutput size={16} className="text-cyan-300" />
              当前交付物对照
            </h4>
            {templateItems.length > 0 ? (
              <div className="mt-4 space-y-3">
                {templateItems.map((item) => (
                  <div key={item.expectedName} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{item.expectedName}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {item.matched
                            ? `当前命中 ${item.matched.name} · v${item.matched.version} · ${item.matched.status}`
                            : '当前未命中核心交付物'}
                        </p>
                      </div>
                      <Badge variant={item.pass ? 'primary' : 'warning'}>
                        {item.pass ? '已达标' : '待补'}
                      </Badge>
                    </div>
                    {!item.pass ? (
                      <div className="mt-2 space-y-2">
                        <p className="text-[11px] leading-5 text-amber-100/90">{item.reason}</p>
                        {item.gate?.issues?.length ? (
                          <ul className="space-y-1 text-[11px] text-amber-100/90">
                            {item.gate.issues.slice(0, 4).map((issue, issueIndex) => (
                              <li key={`${item.expectedName}-issue-${issueIndex}`} className="leading-5">
                                - {issue}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                    {item.gate?.professionalRuleEnabled ? (
                      <div className="mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-[11px] font-medium text-slate-200">专业格式校验</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {item.gate.professionalChecks?.filter((check) => check.passed).length || 0}
                          /
                          {item.gate.professionalChecks?.length || 0}
                          {' '}项证据已命中
                        </p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {stageDeliverables.length > 0 ? stageDeliverables.map((item) => (
                  <span key={item.id} className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-[11px] text-slate-200">
                    {item.name} · {item.status}
                  </span>
                )) : (
                  <p className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-5 text-xs text-slate-500">
                    当前阶段还没有提交交付物。
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
