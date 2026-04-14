import { useMemo, useState } from 'react';
import { roleLabel } from '../utils/newProjectHelpers';
import { getTemplateRequiredRoles, isSingleStageWorkflowTemplate } from '../utils/workflowTemplateMeta';

type ProjectMode = 'complete' | 'standalone' | 'relay';

type Props = {
  projectType: ProjectMode;
  setProjectType: (value: ProjectMode) => void;
  parentProjectId: string;
  setParentProjectId: (value: string) => void;
  relaySourceStageId: string;
  setRelaySourceStageId: (value: string) => void;
  standaloneInputName: string;
  setStandaloneInputName: (value: string) => void;
  standaloneInputType: string;
  setStandaloneInputType: (value: string) => void;
  standaloneInputContent: string;
  setStandaloneInputContent: (value: string) => void;
  workflowTemplateKey: string;
  setWorkflowTemplateKey: (value: string) => void;
  autoStartWorkflow: boolean;
  setAutoStartWorkflow: (value: boolean) => void;
  compact?: boolean;
};

type StageInputGuide = {
  name: string;
  type: string;
  nameLabel: string;
  typeLabel: string;
  contentPlaceholder: string;
};

const PROJECT_MODE_OPTIONS: Array<{
  key: ProjectMode;
  label: string;
  description: string;
}> = [
  { key: 'complete', label: '完整流程', description: '需求→设计→研发→QA，多阶段协作' },
  { key: 'standalone', label: '单阶段交付', description: '按指定阶段独立输入、实施、验收、交付' },
  { key: 'relay', label: '阶段接力', description: '从上游项目导入产物，继续当前阶段执行' },
];

const FULL_WORKFLOW_TEMPLATE_OPTIONS: Array<{ key: string; label: string; description: string; stagePreview: string }> = [
  {
    key: 'standard_software_development',
    label: '全流程编排（推荐）',
    description: '自动初始化需求、设计、研发、QA 全链路',
    stagePreview: '需求设计 → 视觉设计/技术设计 → 代码研发 → QA 验收',
  },
  {
    key: 'none',
    label: '仅创建项目',
    description: '先创建项目，不自动初始化 workflow',
    stagePreview: '无自动阶段（可在项目内手动初始化）',
  },
];

const STANDALONE_TEMPLATE_OPTIONS: Array<{ key: string; label: string; description: string; stagePreview: string }> = [
  {
    key: 'requirements_design',
    label: '需求设计阶段',
    description: '适合做需求澄清、范围边界、验收标准沉淀',
    stagePreview: '单阶段：需求设计',
  },
  {
    key: 'visual_design',
    label: '视觉设计阶段',
    description: '适合做页面结构、交互细节、视觉规范落地',
    stagePreview: '单阶段：视觉设计',
  },
  {
    key: 'tech_design',
    label: '技术设计阶段',
    description: '适合沉淀架构方案、接口契约和技术边界',
    stagePreview: '单阶段：技术设计',
  },
  {
    key: 'code_dev',
    label: '代码研发阶段',
    description: '适合从技术方案直接进入研发实现',
    stagePreview: '单阶段：代码研发',
  },
  {
    key: 'qa_acceptance',
    label: 'QA 验收阶段',
    description: '适合针对既有产物做验收、回归与交付判断',
    stagePreview: '单阶段：QA 验收',
  },
  {
    key: 'none',
    label: '仅创建项目',
    description: '先创建项目，不自动初始化 workflow',
    stagePreview: '无自动阶段（可在项目内手动初始化）',
  },
];

const ALL_WORKFLOW_TEMPLATE_OPTIONS: Array<{ key: string; label: string; description: string; stagePreview: string }> = [
  FULL_WORKFLOW_TEMPLATE_OPTIONS[0],
  ...STANDALONE_TEMPLATE_OPTIONS.filter((item) => item.key !== 'none'),
  FULL_WORKFLOW_TEMPLATE_OPTIONS[1],
];

const STAGE_INPUT_TYPE_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: 'document', label: '文档说明', description: '结构化说明文档、方案、报告' },
  { value: 'text', label: '纯文本', description: '简要文本说明、备注、摘要' },
  { value: 'prd', label: 'PRD 文档', description: '需求文档、用户故事、验收标准' },
  { value: 'mockup', label: '设计稿/原型', description: '页面草图、原型链接、视觉稿' },
  { value: 'code_repo', label: '代码仓库', description: 'Git 仓库地址、分支、提交信息' },
];

const TEMPLATE_INPUT_GUIDES: Record<string, StageInputGuide> = {
  requirements_design: {
    name: 'rawRequirements',
    type: 'prd',
    nameLabel: '原始需求输入',
    typeLabel: 'PRD 文档',
    contentPlaceholder: '补充目标用户、业务目标、范围边界、验收标准（可选）。',
  },
  visual_design: {
    name: 'prd',
    type: 'prd',
    nameLabel: '视觉阶段 PRD 输入',
    typeLabel: 'PRD 文档',
    contentPlaceholder: '补充品牌风格、页面结构、交互重点、验收口径（可选）。',
  },
  tech_design: {
    name: 'prd',
    type: 'prd',
    nameLabel: '技术阶段 PRD 输入',
    typeLabel: 'PRD 文档',
    contentPlaceholder: '补充技术栈、架构约束、接口边界、性能目标（可选）。',
  },
  code_dev: {
    name: 'mockups',
    type: 'mockup',
    nameLabel: '研发阶段设计输入',
    typeLabel: '设计稿/原型',
    contentPlaceholder: '补充设计稿链接、页面清单、关键交互说明（可选）。',
  },
  qa_acceptance: {
    name: 'sourceCode',
    type: 'code_repo',
    nameLabel: '验收源码输入',
    typeLabel: '代码仓库',
    contentPlaceholder: '补充仓库地址、分支、提交范围与发布版本（可选）。',
  },
  standard_software_development: {
    name: 'raw_requirements',
    type: 'document',
    nameLabel: '全流程需求输入',
    typeLabel: '文档说明',
    contentPlaceholder: '补充全流程上下文、里程碑和关键约束（可选）。',
  },
};

export default function ProjectExecutionConfigurator({
  projectType,
  setProjectType,
  parentProjectId,
  setParentProjectId,
  relaySourceStageId,
  setRelaySourceStageId,
  standaloneInputName,
  setStandaloneInputName,
  standaloneInputType,
  setStandaloneInputType,
  standaloneInputContent,
  setStandaloneInputContent,
  workflowTemplateKey,
  setWorkflowTemplateKey,
  autoStartWorkflow,
  setAutoStartWorkflow,
  compact = false,
}: Props) {
  const [showContentOverride, setShowContentOverride] = useState(Boolean(standaloneInputContent.trim()));

  const workflowOptions = ALL_WORKFLOW_TEMPLATE_OPTIONS;
  const activeWorkflowOption = workflowOptions.find((item) => item.key === workflowTemplateKey) || workflowOptions[0];

  const activeInputGuide = useMemo(() => {
    if (workflowTemplateKey === 'none') {
      return TEMPLATE_INPUT_GUIDES.standard_software_development;
    }
    return TEMPLATE_INPUT_GUIDES[workflowTemplateKey] || TEMPLATE_INPUT_GUIDES.requirements_design;
  }, [workflowTemplateKey]);

  const activeInputType = STAGE_INPUT_TYPE_OPTIONS.find((item) => item.value === standaloneInputType) || STAGE_INPUT_TYPE_OPTIONS[0];

  const applyTemplateInputPreset = () => {
    setStandaloneInputName(activeInputGuide.name);
    setStandaloneInputType(activeInputGuide.type);
  };

  return (
    <div className={`space-y-3 ${compact ? '' : 'p-4 rounded-2xl border border-border-subtle bg-white/5'}`}>
      <div className="space-y-1">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目策略模式</label>
        <p className="text-[11px] text-slate-500">创建时直接决定：是全流程执行，还是独立阶段执行。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {PROJECT_MODE_OPTIONS.map((option) => {
          const active = option.key === projectType;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setProjectType(option.key);
                if (option.key === 'complete' && isSingleStageWorkflowTemplate(workflowTemplateKey)) {
                  setWorkflowTemplateKey('standard_software_development');
                  return;
                }
                if ((option.key === 'standalone' || option.key === 'relay')
                  && workflowTemplateKey === 'standard_software_development') {
                  setWorkflowTemplateKey('requirements_design');
                }
              }}
              className={`text-left rounded-xl border px-3 py-2 transition-colors ${
                active
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border-subtle bg-surface-muted hover:bg-white/10'
              }`}
            >
              <p className={`text-xs font-semibold ${active ? 'text-primary' : 'text-slate-200'}`}>{option.label}</p>
              <p className="text-[11px] text-slate-500 mt-1">{option.description}</p>
            </button>
          );
        })}
      </div>

      {projectType === 'relay' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">来源项目 ID</label>
            <input
              type="text"
              value={parentProjectId}
              onChange={(event) => setParentProjectId(event.target.value)}
              placeholder="例如 P-2026-001"
              className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">来源阶段 ID（可选）</label>
            <input
              type="text"
              value={relaySourceStageId}
              onChange={(event) => setRelaySourceStageId(event.target.value)}
              placeholder="可留空，默认导入来源项目最新交付"
              className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
      ) : null}

      {(projectType === 'standalone' || projectType === 'relay') ? (
        <div className="space-y-2">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">阶段输入映射</label>
            <button
              type="button"
              onClick={applyTemplateInputPreset}
              className="px-3 py-1.5 rounded-lg border border-accent/40 bg-accent/10 text-[11px] text-accent font-semibold hover:bg-accent/20 transition-colors"
            >
              按所选阶段自动填充
            </button>
          </div>

          <p className="text-[11px] text-slate-500">
            默认复用上方“项目需求”正文，不重复填写；这里仅定义传给阶段执行器的输入键和值类型。
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              type="text"
              value={standaloneInputName}
              onChange={(event) => setStandaloneInputName(event.target.value)}
              placeholder={activeInputGuide.name}
              className="bg-surface-muted border border-border-subtle rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <select
              value={standaloneInputType}
              onChange={(event) => setStandaloneInputType(event.target.value)}
              className="bg-surface-muted border border-border-subtle rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
            >
              {STAGE_INPUT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-500 self-center">
              当前推荐: {activeInputGuide.nameLabel} · {activeInputGuide.typeLabel}
            </span>
          </div>

          <p className="text-[11px] text-slate-500">
            当前类型说明: {activeInputType.description}
          </p>

          <button
            type="button"
            onClick={() => setShowContentOverride((prev) => !prev)}
            className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-muted text-[11px] text-slate-300 hover:bg-white/10 transition-colors"
          >
            {showContentOverride ? '收起阶段输入覆盖内容' : '填写阶段专属输入内容（可选）'}
          </button>

          {showContentOverride ? (
            <textarea
              rows={3}
              value={standaloneInputContent}
              onChange={(event) => setStandaloneInputContent(event.target.value)}
              placeholder={activeInputGuide.contentPlaceholder}
              className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y min-h-[90px]"
            />
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">执行阶段模板</label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {workflowOptions.map((option) => {
            const active = option.key === workflowTemplateKey;
            return (
              <button
                key={option.key}
                type="button"
              onClick={() => {
                setWorkflowTemplateKey(option.key);
                if (option.key === 'none') {
                  setAutoStartWorkflow(false);
                } else if (!autoStartWorkflow) {
                  setAutoStartWorkflow(true);
                }
                if (option.key === 'standard_software_development' && projectType !== 'complete') {
                  setProjectType('complete');
                  return;
                }
                if (isSingleStageWorkflowTemplate(option.key) && projectType === 'complete') {
                  setProjectType('standalone');
                }
              }}
              className={`text-left rounded-xl border px-3 py-2 transition-colors ${
                active
                    ? 'border-accent/60 bg-accent/10'
                    : 'border-border-subtle bg-surface-muted hover:bg-white/10'
                }`}
              >
                <p className={`text-xs font-semibold ${active ? 'text-accent' : 'text-slate-200'}`}>{option.label}</p>
                <p className="text-[11px] text-slate-500 mt-1">{option.description}</p>
                <p className="text-[11px] text-slate-400 mt-1">{option.stagePreview}</p>
                {option.key !== 'none' ? (
                  <p className="text-[11px] text-slate-500 mt-1">
                    关键角色: {getTemplateRequiredRoles(option.key).map((roleId) => roleLabel(roleId)).join('、')}
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500">
          当前选择：{activeWorkflowOption?.label || '未选择'} · {activeWorkflowOption?.stagePreview || '未配置阶段'}
        </p>
        <p className="text-[11px] text-slate-500">
          说明：若在“完整流程”模式下选择单阶段模板，系统会自动切换到“单阶段交付”。
        </p>
        <label className="inline-flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={autoStartWorkflow}
            disabled={workflowTemplateKey === 'none'}
            onChange={(event) => setAutoStartWorkflow(event.target.checked)}
            className="accent-primary"
          />
          创建后自动启动 workflow
        </label>
      </div>
    </div>
  );
}
