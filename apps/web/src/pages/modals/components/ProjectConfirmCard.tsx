import { Zap } from 'lucide-react';
import type { NewProjectModalController } from '../hooks/useNewProjectModalController';
import type { Priority } from '../NewProjectModal.types';
import { formatClarificationBlock, formatIssueAnswersBlock, roleLabel } from '../utils/newProjectHelpers';
import Badge from './Badge';
import ProjectExecutionConfigurator from './ProjectExecutionConfigurator';

type Props = {
  controller: NewProjectModalController;
};

export default function ProjectConfirmCard({ controller }: Props) {
  const {
    parsedProject,
    setParsedProject,
    issueAnswers,
    clarification,
    issuePreview,
    activeExpectedArtifacts,
    analysisRecommendations,
    selectedIndustryConfig,
    requiresSoulRole,
    enforceIndustryAssemblyRule,
    requiredWorkflowRoles,
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

  const canCreateProject = issuePreview?.analysisGate
    ? (issuePreview.analysisGate.canCreateProject ?? issuePreview.analysisGate.canProceed)
    : false;
  const canCreate = Boolean(issuePreview?.issueId) && canCreateProject && !isCreating;
  const createBlockedHint = !issuePreview?.issueId
    ? '请先回到需求输入步骤完成 Issue 分析。'
    : !canCreateProject
      ? (
          issuePreview.analysisGate.createBlockers?.[0]
          || issuePreview.analysisGate.blockers[0]
          || '分析阶段尚未满足创建条件，请稍后重试。'
        )
      : '';
  const formalDebateDeferred = Boolean(
    issuePreview?.analysisGate
    && !(issuePreview.analysisGate.canProceed)
    && (issuePreview.analysisGate.canCreateProject ?? issuePreview.analysisGate.canProceed),
  );

  return (
    <div className="bg-surface-soft border border-warning/20 rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-warning">
          <Zap size={14} />
          <span className="text-[10px] font-bold uppercase tracking-widest">创建前理解确认卡</span>
        </div>
        <Badge variant="warning">待确认</Badge>
      </div>
      {formalDebateDeferred ? (
        <div className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2">
          <p className="text-[11px] text-accent font-semibold">Create-first 模式：项目骨架将先创建，正式辩论后置补齐</p>
        </div>
      ) : null}

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

        {activeExpectedArtifacts.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">目标产出物</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {activeExpectedArtifacts.map((artifact) => (
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
          {selectedIndustryConfig && enforceIndustryAssemblyRule && (
            <p className="text-[11px] text-slate-500">
              行业: {selectedIndustryConfig.roleSet.industryName} · 灵魂角色: {roleLabel(selectedIndustryConfig.assemblyRule.soulRoleId)}
              {requiresSoulRole ? '（必选）' : ''}
            </p>
          )}
          {!enforceIndustryAssemblyRule && requiredWorkflowRoles.length > 0 ? (
            <p className="text-[11px] text-slate-500">
              当前阶段模板关键角色: {requiredWorkflowRoles.map((roleId) => roleLabel(roleId)).join('、')}
            </p>
          ) : null}
        </div>

        <ProjectExecutionConfigurator
          compact
          projectType={projectType}
          setProjectType={setProjectType}
          parentProjectId={parentProjectId}
          setParentProjectId={setParentProjectId}
          relaySourceStageId={relaySourceStageId}
          setRelaySourceStageId={setRelaySourceStageId}
          standaloneInputName={standaloneInputName}
          setStandaloneInputName={setStandaloneInputName}
          standaloneInputType={standaloneInputType}
          setStandaloneInputType={setStandaloneInputType}
          standaloneInputContent={standaloneInputContent}
          setStandaloneInputContent={setStandaloneInputContent}
          workflowTemplateKey={workflowTemplateKey}
          setWorkflowTemplateKey={setWorkflowTemplateKey}
          autoStartWorkflow={autoStartWorkflow}
          setAutoStartWorkflow={setAutoStartWorkflow}
        />
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
          {isCreating ? '创建中...' : (canCreate ? '确认创建并启动执行' : '等待创建条件满足')}
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
