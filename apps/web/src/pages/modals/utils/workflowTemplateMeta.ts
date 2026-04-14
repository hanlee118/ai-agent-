import type { IssuePreview } from '../../../lib/api';

type StageType = 'INIT' | 'ANALYSIS' | 'DESIGN' | 'DEV' | 'ACCEPT';

type Artifact = IssuePreview['expectedArtifacts'][number];
type WorkflowStep = NonNullable<IssuePreview['workflow']>['steps'][number];

export type WorkflowTemplateKey =
  | 'standard_software_development'
  | 'requirements_design'
  | 'visual_design'
  | 'tech_design'
  | 'code_dev'
  | 'qa_acceptance';

type TemplateInputPreset = {
  name: string;
  type: string;
};

const DEFAULT_TEMPLATE_KEY: WorkflowTemplateKey = 'standard_software_development';

const TEMPLATE_KEYS = new Set<WorkflowTemplateKey>([
  'standard_software_development',
  'requirements_design',
  'visual_design',
  'tech_design',
  'code_dev',
  'qa_acceptance',
]);

const TEMPLATE_ARTIFACTS: Record<WorkflowTemplateKey, Artifact[]> = {
  standard_software_development: [
    {
      id: 'artifact-analysis-doc',
      name: '需求分析文档',
      description: '面向设计与研发的结构化需求、边界、约束、风险与验收标准。',
      stageType: 'ANALYSIS',
      ownerRoleId: 'ROLE_ANALYST',
    },
    {
      id: 'artifact-schedule',
      name: '项目排期',
      description: '里程碑、负责人、依赖与风险缓冲的执行排期。',
      stageType: 'ANALYSIS',
      ownerRoleId: 'ROLE_PM',
    },
    {
      id: 'artifact-design-review',
      name: '设计审查卡',
      description: '视觉方向、品牌语气、UX 原则、可访问性清单与审查结论。',
      stageType: 'DESIGN',
      ownerRoleId: 'ROLE_DESIGN',
    },
    {
      id: 'artifact-visual-preview',
      name: '视觉定稿单页',
      description: '可供业务确认和研发实现的静态图或 HTML 单页设计预览。',
      stageType: 'DESIGN',
      ownerRoleId: 'ROLE_DESIGN',
    },
    {
      id: 'artifact-tech-plan',
      name: '技术方案与选型',
      description: '研发实现前的系统边界、接口契约、数据链路与技术取舍。',
      stageType: 'DEV',
      ownerRoleId: 'ROLE_ARCH',
    },
    {
      id: 'artifact-impl-result',
      name: '实现结果说明',
      description: '真实页面、接口、代码改动与验证证据说明。',
      stageType: 'DEV',
      ownerRoleId: 'ROLE_DEV',
    },
    {
      id: 'artifact-runtime-delivery',
      name: '运行地址与部署说明',
      description: '运行入口、启动方式、环境变量与联调验证步骤。',
      stageType: 'DEV',
      ownerRoleId: 'ROLE_DEV',
    },
    {
      id: 'artifact-test-report',
      name: '测试报告',
      description: '面向验收阶段的测试范围、结果、阻断项与回归结论。',
      stageType: 'ACCEPT',
      ownerRoleId: 'ROLE_QA',
    },
  ],
  requirements_design: [
    {
      id: 'artifact-analysis-doc',
      name: '需求分析文档',
      description: '面向后续阶段的结构化需求、边界、约束与风险分析。',
      stageType: 'ANALYSIS',
      ownerRoleId: 'ROLE_ANALYST',
    },
    {
      id: 'artifact-requirement-contract',
      name: '需求确认单',
      description: '明确目标、范围、验收标准与阶段交接条件。',
      stageType: 'ANALYSIS',
      ownerRoleId: 'ROLE_PM',
    },
    {
      id: 'artifact-schedule',
      name: '阶段排期与里程碑',
      description: '当前阶段的里程碑、负责人与风险缓冲计划。',
      stageType: 'ANALYSIS',
      ownerRoleId: 'ROLE_PM',
    },
  ],
  visual_design: [
    {
      id: 'artifact-design-review',
      name: '设计审查卡',
      description: '视觉方向、信息层级、可访问性检查与审查结论。',
      stageType: 'DESIGN',
      ownerRoleId: 'ROLE_DESIGN',
    },
    {
      id: 'artifact-visual-preview',
      name: '视觉定稿单页',
      description: '可直接用于评审与交接的静态图或 HTML 单页设计稿。',
      stageType: 'DESIGN',
      ownerRoleId: 'ROLE_DESIGN',
    },
  ],
  tech_design: [
    {
      id: 'artifact-tech-plan',
      name: '技术方案与选型',
      description: '系统边界、技术选型、风险取舍与非功能约束。',
      stageType: 'DEV',
      ownerRoleId: 'ROLE_ARCH',
    },
    {
      id: 'artifact-api-contract',
      name: '接口与数据契约',
      description: 'API 契约、数据模型、错误语义与联调约定。',
      stageType: 'DEV',
      ownerRoleId: 'ROLE_ARCH',
    },
  ],
  code_dev: [
    {
      id: 'artifact-impl-result',
      name: '实现结果说明',
      description: '核心功能实现、代码变更摘要与关键验证证据。',
      stageType: 'DEV',
      ownerRoleId: 'ROLE_DEV',
    },
    {
      id: 'artifact-runtime-delivery',
      name: '运行地址与部署说明',
      description: '运行入口、部署方式、环境变量与联调步骤。',
      stageType: 'DEV',
      ownerRoleId: 'ROLE_DEV',
    },
  ],
  qa_acceptance: [
    {
      id: 'artifact-test-plan',
      name: '测试计划与用例清单',
      description: '覆盖范围、测试策略、关键用例与阻断项定义。',
      stageType: 'ACCEPT',
      ownerRoleId: 'ROLE_QA',
    },
    {
      id: 'artifact-test-report',
      name: '测试报告',
      description: '执行结果、缺陷结论、回归建议与发布建议。',
      stageType: 'ACCEPT',
      ownerRoleId: 'ROLE_QA',
    },
  ],
};

const TEMPLATE_WORKFLOW_STEPS: Record<WorkflowTemplateKey, WorkflowStep[]> = {
  standard_software_development: [
    {
      order: 1,
      roleId: 'ROLE_ANALYST',
      title: '需求理解与边界识别',
      input: 'Issue + Product Spec + 历史变更',
      output: '需求分析文档、关键风险与冲突点',
    },
    {
      order: 2,
      roleId: 'ROLE_PM',
      title: '阶段目标与排期确认',
      input: '需求分析文档',
      output: '里程碑计划、负责人与交接条件',
    },
    {
      order: 3,
      roleId: 'ROLE_DESIGN',
      title: '视觉与交互方案审查',
      input: '需求确认单',
      output: '设计审查卡、视觉定稿单页',
    },
    {
      order: 4,
      roleId: 'ROLE_ARCH',
      title: '技术方案与契约设计',
      input: '需求确认单 + 设计审查卡',
      output: '技术方案、接口与数据契约',
    },
    {
      order: 5,
      roleId: 'ROLE_DEV',
      title: '研发实现与联调',
      input: '技术方案与任务拆解',
      output: '实现结果说明、运行地址与部署说明',
    },
    {
      order: 6,
      roleId: 'ROLE_QA',
      title: '回归验收与发布建议',
      input: '实现结果与验收口径',
      output: '测试报告、发布建议',
    },
  ],
  requirements_design: [
    {
      order: 1,
      roleId: 'ROLE_ANALYST',
      title: '需求理解与边界识别',
      input: 'Issue + 业务背景 + 历史经验',
      output: '需求分析文档（范围/约束/风险）',
    },
    {
      order: 2,
      roleId: 'ROLE_PM',
      title: '需求确认与阶段排期',
      input: '需求分析文档',
      output: '需求确认单、阶段排期与交接条件',
    },
  ],
  visual_design: [
    {
      order: 1,
      roleId: 'ROLE_ANALYST',
      title: '需求边界与验收口径复核',
      input: '需求确认单 + 品牌约束',
      output: '视觉阶段需求边界与验收口径',
    },
    {
      order: 2,
      roleId: 'ROLE_DESIGN',
      title: '视觉方向与信息架构',
      input: '视觉阶段需求边界与验收口径',
      output: '视觉框架、信息层级与交互草案',
    },
    {
      order: 3,
      roleId: 'ROLE_DESIGN',
      title: '交互细节与设计定稿',
      input: '视觉框架与交互草案',
      output: '设计审查卡、视觉定稿单页',
    },
  ],
  tech_design: [
    {
      order: 1,
      roleId: 'ROLE_ANALYST',
      title: '需求约束与技术边界复核',
      input: '需求确认单 + 设计约束',
      output: '技术设计阶段需求边界与约束清单',
    },
    {
      order: 2,
      roleId: 'ROLE_ARCH',
      title: '技术边界与架构设计',
      input: '技术设计阶段需求边界与约束清单',
      output: '技术方案与选型结论',
    },
    {
      order: 3,
      roleId: 'ROLE_ARCH',
      title: '接口与数据契约定义',
      input: '技术方案与选型',
      output: 'API 契约、数据模型与联调规范',
    },
  ],
  code_dev: [
    {
      order: 1,
      roleId: 'ROLE_ANALYST',
      title: '业务目标与验收口径复核',
      input: '技术方案与阶段目标',
      output: '研发阶段业务目标与验收口径',
    },
    {
      order: 2,
      roleId: 'ROLE_ARCH',
      title: '研发任务拆解与技术守护线',
      input: '研发阶段业务目标与验收口径',
      output: '任务拆解、实现边界与技术约束',
    },
    {
      order: 3,
      roleId: 'ROLE_DEV',
      title: '代码实现与联调验证',
      input: '任务拆解与技术约束',
      output: '实现结果说明、代码与联调证据',
    },
    {
      order: 4,
      roleId: 'ROLE_DEV',
      title: '运行交付与部署准备',
      input: '实现结果说明',
      output: '运行地址、部署说明与回滚预案',
    },
  ],
  qa_acceptance: [
    {
      order: 1,
      roleId: 'ROLE_ANALYST',
      title: '验收标准与业务口径复核',
      input: '需求确认单 + 实现结果',
      output: '验收口径清单与测试关注点',
    },
    {
      order: 2,
      roleId: 'ROLE_QA',
      title: '测试计划与用例设计',
      input: '验收口径清单与测试关注点',
      output: '测试计划、覆盖矩阵与验收用例',
    },
    {
      order: 3,
      roleId: 'ROLE_QA',
      title: '回归验收与发布建议',
      input: '测试执行结果',
      output: '测试报告、阻断项与发布建议',
    },
  ],
};

const WORKFLOW_NAME_MAP: Record<WorkflowTemplateKey, string> = {
  standard_software_development: '标准软件开发协作流程',
  requirements_design: '需求设计阶段协作流程',
  visual_design: '视觉设计阶段协作流程',
  tech_design: '技术设计阶段协作流程',
  code_dev: '代码研发阶段协作流程',
  qa_acceptance: 'QA 验收阶段协作流程',
};

const TEMPLATE_INPUT_PRESETS: Record<WorkflowTemplateKey, TemplateInputPreset> = {
  standard_software_development: { name: 'raw_requirements', type: 'document' },
  requirements_design: { name: 'rawRequirements', type: 'prd' },
  visual_design: { name: 'prd', type: 'prd' },
  tech_design: { name: 'prd', type: 'prd' },
  code_dev: { name: 'mockups', type: 'mockup' },
  qa_acceptance: { name: 'sourceCode', type: 'code_repo' },
};

function cloneArtifacts(artifacts: Artifact[]): Artifact[] {
  return artifacts.map((item) => ({ ...item, stageType: item.stageType as StageType }));
}

function cloneWorkflowSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step) => ({ ...step }));
}

export function normalizeWorkflowTemplateKey(
  templateKey: string | undefined | null,
): WorkflowTemplateKey | 'none' {
  const normalized = String(templateKey ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'none') {
    return normalized === 'none' ? 'none' : DEFAULT_TEMPLATE_KEY;
  }
  if (TEMPLATE_KEYS.has(normalized as WorkflowTemplateKey)) {
    return normalized as WorkflowTemplateKey;
  }
  return DEFAULT_TEMPLATE_KEY;
}

export function isSingleStageWorkflowTemplate(templateKey: string | undefined | null): boolean {
  const resolved = normalizeWorkflowTemplateKey(templateKey);
  return resolved !== 'none' && resolved !== DEFAULT_TEMPLATE_KEY;
}

export function getTemplateRequiredRoles(templateKey: string | undefined | null): string[] {
  const resolved = normalizeWorkflowTemplateKey(templateKey);
  if (resolved === 'none') {
    return [];
  }
  const steps = TEMPLATE_WORKFLOW_STEPS[resolved] || TEMPLATE_WORKFLOW_STEPS[DEFAULT_TEMPLATE_KEY];
  return Array.from(new Set(steps.map((step) => String(step.roleId || '').trim()).filter(Boolean)));
}

export function getTemplateInputPreset(templateKey: string | undefined | null): TemplateInputPreset {
  const resolved = normalizeWorkflowTemplateKey(templateKey);
  if (resolved === 'none') {
    return { ...TEMPLATE_INPUT_PRESETS[DEFAULT_TEMPLATE_KEY] };
  }
  return { ...(TEMPLATE_INPUT_PRESETS[resolved] || TEMPLATE_INPUT_PRESETS[DEFAULT_TEMPLATE_KEY]) };
}

export function getTemplateExpectedArtifacts(
  templateKey: string | undefined | null,
  fallback: Artifact[] = [],
): Artifact[] {
  const resolved = normalizeWorkflowTemplateKey(templateKey);
  if (resolved === 'none') {
    return [];
  }
  const matched = TEMPLATE_ARTIFACTS[resolved];
  if (!matched) {
    return cloneArtifacts(fallback);
  }
  return cloneArtifacts(matched);
}

export function getTemplateWorkflowSop(
  templateKey: string | undefined | null,
  fallback: IssuePreview['workflow'] = null,
): IssuePreview['workflow'] {
  const resolved = normalizeWorkflowTemplateKey(templateKey);
  if (resolved === 'none') {
    return null;
  }
  const steps = TEMPLATE_WORKFLOW_STEPS[resolved];
  if (!steps) {
    return fallback
      ? {
          ...fallback,
          steps: fallback.steps.map((step) => ({ ...step })),
        }
      : null;
  }
  return {
    id: `workflow-${resolved}`,
    name: WORKFLOW_NAME_MAP[resolved],
    steps: cloneWorkflowSteps(steps),
  };
}
