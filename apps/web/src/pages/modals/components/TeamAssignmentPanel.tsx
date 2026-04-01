import { Users } from 'lucide-react';
import type { NewProjectModalController } from '../hooks/useNewProjectModalController';
import { getAgentRoleId, normalizeRoleId, roleLabel } from '../utils/newProjectHelpers';
import Badge from './Badge';
import ClarificationForm from './ClarificationForm';

type Props = {
  controller: NewProjectModalController;
};

export default function TeamAssignmentPanel({ controller }: Props) {
  const {
    analysisRecommendations,
    industryAgents,
    selectedIndustryConfig,
    requiresSoulRole,
    soulRoleId,
    handleToggleAnalysisAgent,
    handleContinueFromTeam,
    setStep,
  } = controller;

  const selectedAgentIds = new Set(analysisRecommendations.map((item) => item.agentId));
  const selectedRoleIds = new Set(analysisRecommendations.map((item) => normalizeRoleId(item.roleId)));

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
          <p className="text-[11px] text-slate-500">
            灵魂角色: {roleLabel(selectedIndustryConfig.assemblyRule.soulRoleId)}{requiresSoulRole ? '（必选）' : ''}
            {' '}· 最少角色数: {selectedIndustryConfig.assemblyRule.minRoles}
          </p>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs text-slate-400">自动分配的需求分析 Agent（可取消/补充）</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {industryAgents.map((agent) => {
            const roleId = getAgentRoleId(agent);
            const selected = selectedAgentIds.has(agent.id);
            const isSoulRole = normalizeRoleId(roleId) === normalizeRoleId(soulRoleId);
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
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => handleToggleAnalysisAgent(agent.id)}
                    className="accent-primary"
                  />
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
        {requiresSoulRole && soulRoleId && !selectedRoleIds.has(normalizeRoleId(soulRoleId)) && (
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
          返回讨论结论
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
