import type { NewProjectModalController } from '../hooks/useNewProjectModalController';
import { roleLabel } from '../utils/newProjectHelpers';
import Badge from './Badge';

type Props = {
  controller: NewProjectModalController;
};

export default function IndustryConfigPanel({ controller }: Props) {
  const {
    selectedIndustryCode,
    setSelectedIndustryCode,
    isLoadingRoleSets,
    industryRoleSets,
    selectedIndustryConfig,
    hrRoleEnabled,
    recommendedRoleIds,
    enforceIndustryAssemblyRule,
    workflowTemplateKey,
    requiredWorkflowRoles,
  } = controller;

  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">行业角色集</label>
      <select
        value={selectedIndustryCode}
        onChange={(event) => setSelectedIndustryCode(event.target.value)}
        disabled={isLoadingRoleSets}
        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none disabled:opacity-50"
      >
        {industryRoleSets.map((item) => (
          <option key={item.id} value={item.industryCode}>
            {item.industryName} ({item.industryCode})
          </option>
        ))}
        {industryRoleSets.length === 0 && <option value="">暂无行业配置</option>}
      </select>

      {selectedIndustryConfig && (
        <div className="p-3 bg-white/5 border border-border-subtle rounded-xl space-y-2">
          {enforceIndustryAssemblyRule ? (
            <p className="text-[11px] text-slate-400">
              灵魂角色: <span className="text-primary font-semibold">{roleLabel(selectedIndustryConfig.assemblyRule.soulRoleId)}</span>
              {selectedIndustryConfig.assemblyRule.mustHaveSoulRole ? '（必选）' : ''}
            </p>
          ) : (
            <p className="text-[11px] text-slate-400">
              当前模板模式: <span className="text-primary font-semibold">{workflowTemplateKey || 'standard_software_development'}</span>，按模板关键角色执行
            </p>
          )}
          <p className="text-[11px] text-slate-400 flex items-center gap-2">
            ROLE_HR 扩展入口:
            <Badge variant={hrRoleEnabled ? 'accent' : 'default'}>{hrRoleEnabled ? '已启用' : '未启用'}</Badge>
          </p>
          {enforceIndustryAssemblyRule ? (
            <p className="text-[11px] text-slate-500">
              团队规模建议: {selectedIndustryConfig.assemblyRule.minRoles} - {selectedIndustryConfig.assemblyRule.maxRoles ?? 'N'}
            </p>
          ) : (
            <p className="text-[11px] text-slate-500">
              模板关键角色: {requiredWorkflowRoles.map((role) => roleLabel(role)).join('、') || '未配置'}
            </p>
          )}
          <p className="text-[11px] text-slate-500">行业可选角色池</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedIndustryConfig.roleSet.roleIds.map((role) => (
              <span key={role} className="px-2 py-1 text-[10px] rounded-lg bg-white/5 border border-border-subtle text-slate-300">
                {roleLabel(role)}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 pt-1">系统建议角色（SOP）</p>
          <div className="flex flex-wrap gap-1.5">
            {recommendedRoleIds.map((role) => (
              <span
                key={`recommended-${role}`}
                className="px-2 py-1 text-[10px] rounded-lg bg-primary/10 border border-primary/40 text-primary"
              >
                {roleLabel(role)}
              </span>
            ))}
            {recommendedRoleIds.length === 0 && <span className="text-[10px] text-slate-500">暂无建议角色</span>}
          </div>
        </div>
      )}
    </div>
  );
}
