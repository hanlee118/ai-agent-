import { Zap } from 'lucide-react';
import type { NewProjectModalController } from '../hooks/useNewProjectModalController';
import type { Priority } from '../NewProjectModal.types';
import { formatClarificationBlock, formatIssueAnswersBlock, roleLabel } from '../utils/newProjectHelpers';
import Badge from './Badge';

type Props = {
  controller: NewProjectModalController;
};

const FULL_WORKFLOW_TEMPLATE_OPTIONS: Array<{ key: string; label: string; description: string }> = [
  {
    key: 'standard_software_development',
    label: '混合协作（推荐）',
    description: '需求→视觉/技术→研发→QA，多阶段自动编排',
  },
  {
    key: 'none',
    label: '暂不初始化 workflow',
    description: '只创建项目，不自动联动阶段引擎',
  },
];

const STANDALONE_TEMPLATE_OPTIONS: Array<{ key: string; label: string; description: string }> = [
  {
    key: 'requirements_design',
    label: '仅需求设计',
    description: '创建后从需求设计单阶段开始',
  },
  {
    key: 'visual_design',
    label: '仅视觉设计',
    description: '创建后直接进入视觉设计阶段',
  },
  {
    key: 'code_dev',
    label: '仅代码研发',
    description: '创建后直接进入研发阶段',
  },
  {
    key: 'qa_acceptance',
    label: '仅 QA 验收',
    description: '创建后直接进入验收阶段',
  },
  {
    key: 'none',
    label: '暂不初始化 workflow',
    description: '只创建项目，不自动联动阶段引擎',
  },
];

const PROJECT_MODE_OPTIONS: Array<{ key: 'complete' | 'standalone' | 'relay'; label: string; description: string }> = [
  { key: 'complete', label: '完整流程', description: '需求→设计→研发→QA，完整流水线协作' },
  { key: 'standalone', label: '单阶段交付', description: '独立阶段输入、实施、验收、交付' },
  { key: 'relay', label: '阶段接力', description: '导入上游项目产物，作为当前阶段输入' },
];

export default function ProjectConfirmCard({ controller }: Props) {
  const {
    parsedProject,
    setParsedProject,
    issueAnswers,
    clarification,
    issuePreview,
    analysisRecommendations,
    selectedIndustryConfig,
    requiresSoulRole,
    isCreating,
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
    setStep,
    handleUseManualFromParsed,
    handleCreateFromParsed,
    handleClose,
  } = controller;

  if (!parsedProject) {
    return null;
  }

  const canCreate = Boolean(issuePreview?.issueId) && Boolean(issuePreview?.analysisGate.canProceed) && !isCreating;
  const workflowOptions = projectType === 'complete' ? FULL_WORKFLOW_TEMPLATE_OPTIONS : STANDALONE_TEMPLATE_OPTIONS;
  const createBlockedHint = !issuePreview?.issueId
    ? '请先回到需求输入步骤完成 Issue 分析。'
    : !issuePreview.analysisGate.canProceed
      ? (issuePreview.analysisGate.blockers[0] || '正式讨论尚未完成，请稍后重试。')
      : '';

  return (
    <div className="bg-surface-soft border border-warning/20 rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-warning">
          <Zap size={14} />
          <span className="text-[10px] font-bold uppercase tracking-widest">创建前理解确认卡</span>
        </div>
        <Badge variant="warning">待确认</Badge>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">名称</label>
          <input
            type="text"
            value={parsedProject.name}
            onChange={(event) => setParsedProject((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">描述</label>
          <textarea
            rows={6}
            value={parsedProject.description}
            onChange={(event) =>
              setParsedProject((prev) => (prev ? { ...prev, description: event.target.value } : prev))
            }
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y min-h-[140px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">阶段</label>
            <select
              value={parsedProject.phase}
              onChange={(event) => setParsedProject((prev) => (prev ? { ...prev, phase: event.target.value } : prev))}
              className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
            >
              <option value="规划中">规划中</option>
              <option value="分析">分析</option>
              <option value="设计">设计</option>
              <option value="开发">开发</option>
              <option value="验收">验收</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">优先级</label>
            <select
              value={parsedProject.priority}
              onChange={(event) =>
                setParsedProject((prev) => (prev ? { ...prev, priority: event.target.value as Priority } : prev))
              }
              className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
            >
              <option value="High">高 (High)</option>
              <option value="Medium">中 (Medium)</option>
              <option value="Low">低 (Low)</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">需求固定结果</label>
          <pre className="whitespace-pre-wrap text-xs text-slate-300 bg-surface-muted border border-border-subtle rounded-xl px-4 py-3">
            {formatIssueAnswersBlock(issueAnswers) || formatClarificationBlock(clarification)}
          </pre>
        </div>

        {(issuePreview?.expectedArtifacts || []).length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">目标产出物</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {issuePreview!.expectedArtifacts.map((artifact) => (
                <div key={artifact.id} className="px-3 py-2 rounded-xl bg-white/5 border border-border-subtle">
                  <p className="text-xs text-slate-200">{artifact.name}</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {roleLabel(artifact.ownerRoleId)} · {artifact.stageType}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">执行团队</label>
          <div className="flex flex-wrap gap-2">
            {analysisRecommendations.length > 0
              ? analysisRecommendations.map((agent) => (
                  <span key={agent.agentId} className="px-3 py-1.5 rounded-xl bg-white/5 border border-border-subtle text-xs text-slate-300">
                    {agent.name} · {roleLabel(agent.roleId)}
                  </span>
                ))
              : (parsedProject.team.length > 0 ? parsedProject.team : ['未识别，建议手动调整']).map((roleId) => (
                  <span key={roleId} className="px-3 py-1.5 rounded-xl bg-white/5 border border-border-subtle text-xs text-slate-300">
                    {roleLabel(roleId)}
                  </span>
                ))}
          </div>
          {selectedIndustryConfig && (
            <p className="text-[11px] text-slate-500">
              行业: {selectedIndustryConfig.roleSet.industryName} · 灵魂角色: {roleLabel(selectedIndustryConfig.assemblyRule.soulRoleId)}
              {requiresSoulRole ? '（必选）' : ''}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目策略模式</label>
          <select
            value={projectType}
            onChange={(event) => setProjectType(event.target.value as 'complete' | 'standalone' | 'relay')}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
          >
            {PROJECT_MODE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500">
            {PROJECT_MODE_OPTIONS.find((item) => item.key === projectType)?.description}
          </p>
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
                placeholder="可留空导入该项目最新交付"
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
        ) : null}

        {(projectType === 'standalone' || projectType === 'relay') ? (
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">阶段输入（独立事项输入）</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                type="text"
                value={standaloneInputName}
                onChange={(event) => setStandaloneInputName(event.target.value)}
                placeholder="输入名称（如 rawRequirements / prd）"
                className="bg-surface-muted border border-border-subtle rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <select
                value={standaloneInputType}
                onChange={(event) => setStandaloneInputType(event.target.value)}
                className="bg-surface-muted border border-border-subtle rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
              >
                <option value="document">document</option>
                <option value="text">text</option>
                <option value="prd">prd</option>
                <option value="mockup">mockup</option>
                <option value="code_repo">code_repo</option>
              </select>
              <span className="text-[11px] text-slate-500 self-center">
                空内容可先创建，后续在项目输入里补充。
              </span>
            </div>
            <textarea
              rows={4}
              value={standaloneInputContent}
              onChange={(event) => setStandaloneInputContent(event.target.value)}
              placeholder="输入内容（例如需求摘要、PRD 片段、设计说明、代码仓库地址等）"
              className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y min-h-[100px]"
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目执行模式（workflow v2）</label>
          <select
            value={workflowTemplateKey}
            onChange={(event) => {
              const nextKey = event.target.value;
              setWorkflowTemplateKey(nextKey);
              if (nextKey === 'none') {
                setAutoStartWorkflow(false);
              } else if (!autoStartWorkflow) {
                setAutoStartWorkflow(true);
              }
            }}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
          >
            {workflowOptions.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500">
            {workflowOptions.find((item) => item.key === workflowTemplateKey)?.description || '按所选模板初始化 workflow'}
          </p>
          <label className="inline-flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={autoStartWorkflow}
              disabled={workflowTemplateKey === 'none'}
              onChange={(event) => setAutoStartWorkflow(event.target.checked)}
              className="accent-primary"
            />
            创建后自动启动 workflow（不勾选则仅初始化）
          </label>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={() => setStep('team')}
          className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
        >
          返回团队分配
        </button>
        <button
          onClick={handleUseManualFromParsed}
          className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
        >
          手动微调
        </button>
        <button
          onClick={() => void handleCreateFromParsed()}
          disabled={!canCreate}
          className="flex-1 py-2.5 bg-primary text-surface rounded-xl text-xs font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
        >
          {isCreating ? '创建中...' : (canCreate ? '确认创建并启动执行' : '等待分析完成')}
        </button>
      </div>
      {createBlockedHint ? (
        <p className="text-[11px] text-warning/80">{createBlockedHint}</p>
      ) : null}

      <button
        onClick={handleClose}
        className="w-full py-2 bg-transparent border border-border-subtle rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-all"
      >
        取消
      </button>
    </div>
  );
}
