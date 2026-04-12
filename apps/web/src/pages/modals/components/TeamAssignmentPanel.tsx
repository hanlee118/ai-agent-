import { Users } from 'lucide-react';
import type { NewProjectModalController } from '../hooks/useNewProjectModalController';
import { getAgentRoleId, normalizeRoleId, roleLabel } from '../utils/newProjectHelpers';
import { templatePrefersHybridEngine } from '../utils/workflowTemplateMeta';
import Badge from './Badge';
import ClarificationForm from './ClarificationForm';

type Props = {
  controller: NewProjectModalController;
};

function resolveEngineMeta(engine: string | undefined) {
  const normalized = String(engine || 'managed').trim().toLowerCase();
  if (normalized === 'hermes') {
    return { label: 'Hermes', className: 'bg-accent/15 border-accent/40 text-accent' };
  }
  if (normalized === 'openclaw') {
    return { label: 'OpenClaw', className: 'bg-primary/15 border-primary/40 text-primary' };
  }
  return { label: 'Managed', className: 'bg-white/10 border-border-subtle text-slate-300' };
}

export default function TeamAssignmentPanel({ controller }: Props) {
  const {
    analysisRecommendations,
    industryAgents,
    selectedIndustryConfig,
    requiresSoulRole,
    soulRoleId,
    enforceIndustryAssemblyRule,
    workflowTemplateKey,
    requiredWorkflowRoles,
    missingWorkflowRoles,
    handleToggleAnalysisAgent,
    handleContinueFromTeam,
    setStep,
  } = controller;

  const selectedAgentIds = new Set(analysisRecommendations.map((item) => item.agentId));
  const selectedRoleIds = new Set(analysisRecommendations.map((item) => normalizeRoleId(item.roleId)));
  const selectedAgents = industryAgents.filter((agent) => selectedAgentIds.has(agent.id));
  const engineCounts = selectedAgents.reduce(
    (acc, agent) => {
      const normalized = String(agent.integrationEngine || 'managed').trim().toLowerCase();
      if (normalized === 'hermes') {
        acc.hermes += 1;
      } else if (normalized === 'openclaw') {
        acc.openclaw += 1;
      } else {
        acc.managed += 1;
      }
      return acc;
    },
    { hermes: 0, openclaw: 0, managed: 0 },
  );
  const hybridPreferred = templatePrefersHybridEngine(workflowTemplateKey);
  const hybridCoverageReady = engineCounts.hermes > 0 && engineCounts.openclaw > 0;

  return (
    <div className="space-y-5 p-5 bg-surface-soft border border-accent/30 rounded-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-accent">
          <Users size={14} />
          <span className="text-[10px] font-bold uppercase tracking-widest">团队分配与扩展信息</span>
        </div>
        <Badge variant="accent">第 3 步</Badge>
      </div>

      {selectedIndustryConfig && (
        <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-1">
          <p className="text-xs text-slate-300">
            行业角色集: {selectedIndustryConfig.roleSet.industryName} ({selectedIndustryConfig.roleSet.industryCode})
          </p>
          {enforceIndustryAssemblyRule ? (
            <p className="text-[11px] text-slate-500">
              灵魂角色: {roleLabel(selectedIndustryConfig.assemblyRule.soulRoleId)}{requiresSoulRole ? '（行业默认）' : ''}
              {` · 最少角色数: ${selectedIndustryConfig.assemblyRule.minRoles}`}
            </p>
          ) : (
            <p className="text-[11px] text-slate-500">
              当前为阶段模板模式：仅按模板关键角色校验，不应用行业最少角色数/灵魂角色限制。
            </p>
          )}
        </div>
      )}

      {workflowTemplateKey !== 'none' ? (
        <div className={`p-3 rounded-xl border space-y-1 ${missingWorkflowRoles.length > 0 ? 'bg-warning/10 border-warning/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
          <p className="text-xs text-slate-200">
            当前模板关键角色: {requiredWorkflowRoles.map((roleId) => roleLabel(roleId)).join('、') || '未配置'}
          </p>
          {missingWorkflowRoles.length > 0 ? (
            <p className="text-[11px] text-warning">
              缺少角色: {missingWorkflowRoles.map((roleId) => roleLabel(roleId)).join('、')}。补齐后才能进入创建确认。
            </p>
          ) : (
            <p className="text-[11px] text-emerald-300">
              角色覆盖已满足所选阶段模板要求。
            </p>
          )}
        </div>
      ) : null}

      <div className={`p-3 rounded-xl border space-y-1 ${
        hybridPreferred
          ? (hybridCoverageReady ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-warning/10 border-warning/30')
          : 'bg-white/5 border-border-subtle'
      }`}>
        <p className="text-xs text-slate-200">
          当前选中引擎分布: Hermes {engineCounts.hermes} · OpenClaw {engineCounts.openclaw} · Managed {engineCounts.managed}
        </p>
        {hybridPreferred ? (
          hybridCoverageReady ? (
            <p className="text-[11px] text-emerald-300">
              当前模板建议混合执行，已覆盖 Hermes 与 OpenClaw。
            </p>
          ) : (
            <p className="text-[11px] text-warning">
              当前模板建议混合执行，建议补充 {engineCounts.hermes === 0 ? 'Hermes' : ''}{engineCounts.hermes === 0 && engineCounts.openclaw === 0 ? ' 与 ' : ''}{engineCounts.openclaw === 0 ? 'OpenClaw' : ''} Agent。
            </p>
          )
        ) : (
          <p className="text-[11px] text-slate-500">
            当前模板可单引擎执行；如需跨引擎协作可额外勾选 Hermes/OpenClaw 角色。
          </p>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-xs text-slate-400">自动分配的需求分析 Agent（可取消/补充）</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {industryAgents.map((agent) => {
            const roleId = getAgentRoleId(agent);
            const selected = selectedAgentIds.has(agent.id);
            const isSoulRole = normalizeRoleId(roleId) === normalizeRoleId(soulRoleId);
            const engine = resolveEngineMeta(agent.integrationEngine);
            return (
              <label
                key={agent.id}
                className={`p-3 rounded-xl border cursor-pointer transition-colors space-y-1 ${
                  selected
                    ? 'bg-primary/10 border-primary/40'
                    : 'bg-white/5 border-border-subtle hover:bg-white/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-white">{agent.name}</p>
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded-md border text-[10px] font-semibold tracking-wide ${engine.className}`}>
                      {engine.label}
                    </span>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => handleToggleAnalysisAgent(agent.id)}
                      className="accent-primary"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  {roleLabel(roleId)}{isSoulRole ? ' · 灵魂角色' : ''}
                </p>
              </label>
            );
          })}
          {industryAgents.length === 0 && (
            <p className="text-xs text-slate-500">当前暂无可分配 Agent，请先在 Agent 管理中启用至少一个角色。</p>
          )}
        </div>
        {analysisRecommendations.length === 0 && (
          <p className="text-xs text-warning">当前未选中任何 Agent。你可以从上方列表勾选后继续。</p>
        )}
        {enforceIndustryAssemblyRule && requiresSoulRole && soulRoleId && !selectedRoleIds.has(normalizeRoleId(soulRoleId)) && (
          <p className="text-xs text-warning">
            当前行业要求包含灵魂角色 {roleLabel(soulRoleId)}，请先勾选对应 Agent。
          </p>
        )}
      </div>

      <ClarificationForm controller={controller} />

      <div className="flex gap-3 pt-1">
        <button
          onClick={() => setStep('analysis')}
          className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
        >
          查看分析草案（可选）
        </button>
        <button
          onClick={handleContinueFromTeam}
          className="flex-1 py-2.5 bg-primary text-surface rounded-xl text-xs font-bold hover:bg-primary/90 transition-all"
        >
          下一步：创建确认卡
        </button>
      </div>
    </div>
  );
}
