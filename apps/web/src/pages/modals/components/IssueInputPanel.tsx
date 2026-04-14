import { FileUp } from 'lucide-react';
import type { NewProjectModalController } from '../hooks/useNewProjectModalController';
import type { Priority } from '../NewProjectModal.types';
import { getAgentRoleId, roleLabel } from '../utils/newProjectHelpers';
import ProjectExecutionConfigurator from './ProjectExecutionConfigurator';

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

export default function IssueInputPanel({ controller }: Props) {
  const {
    issueSourceType,
    setIssueSourceType,
    rawInput,
    setRawInput,
    prdInput,
    setPrdInput,
    sourceInput,
    importedFileName,
    handleImportProjectFile,
    handleCreateProjectNow,
    isLoadingIndustryConfig,
    showManualForm,
    setShowManualForm,
    formData,
    setFormData,
    industryAgents,
    handleToggleManualAgent,
    handleManualSubmit,
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
  } = controller;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">需求来源类型</label>
        <select
          value={issueSourceType}
          onChange={(event) => setIssueSourceType(event.target.value as typeof issueSourceType)}
          className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
        >
          <option value="text">一句话需求</option>
          <option value="journey">用户旅程</option>
          <option value="meeting_notes">会议纪要</option>
          <option value="competitor">竞品分析</option>
          <option value="file_import">文件导入</option>
          <option value="prd">PRD输入</option>
        </select>
      </div>

      {issueSourceType === 'file_import' ? (
        <div className="space-y-3">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">需求文件导入</label>
          <div className="p-4 border border-dashed border-border-subtle rounded-xl bg-white/5 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {importedFileName ? `已导入: ${importedFileName}` : '请选择需求文件'}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                支持 .txt / .md / .json / .yaml / .csv
              </p>
            </div>
            <div>
              <input
                type="file"
                className="hidden"
                id="issue-source-file"
                accept=".txt,.md,.json,.yaml,.yml,.csv,.log,.xml"
                onChange={(event) => void handleImportProjectFile(event)}
              />
              <label
                htmlFor="issue-source-file"
                className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-surface rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors cursor-pointer"
              >
                <FileUp size={14} />
                选择文件
              </label>
            </div>
          </div>
          <textarea
            rows={5}
            value={rawInput}
            onChange={(event) => setRawInput(event.target.value)}
            placeholder="导入后会自动填充，可在这里继续编辑。"
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>
      ) : issueSourceType === 'prd' ? (
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">PRD 输入</label>
          <textarea
            rows={7}
            value={prdInput}
            onChange={(event) => setPrdInput(event.target.value)}
            placeholder={'建议包含：\n1. 背景与目标\n2. 目标用户\n3. 功能范围（In/Out Scope）\n4. 验收标准与里程碑'}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目需求（自然语言）</label>
          <textarea
            rows={5}
            value={rawInput}
            onChange={(event) => setRawInput(event.target.value)}
            placeholder="例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。"
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>
      )}

      <ProjectExecutionConfigurator
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

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => void handleCreateProjectNow()}
          disabled={isCreating || isLoadingIndustryConfig || (!sourceInput.trim() && !(showManualForm && formData.description.trim()))}
          className="py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
        >
          {isCreating ? '创建中...' : isLoadingIndustryConfig ? '加载行业配置中...' : '创建项目（先创建后分析）'}
        </button>
        <button
          onClick={() => setShowManualForm((prev) => !prev)}
          className="py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all"
        >
          {showManualForm ? '收起手动表单' : '手动填写'}
        </button>
      </div>

      {showManualForm && (
        <div className="space-y-4 p-4 bg-white/5 border border-border-subtle rounded-2xl">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目名称</label>
            <input
              type="text"
              value={formData.name}
              onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="例如: 智能供应链优化"
              className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目描述</label>
            <textarea
              rows={3}
              value={formData.description}
              onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="简述项目目标、范围和关键约束..."
              className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">优先级</label>
              <select
                value={formData.priority}
                onChange={(event) => setFormData((prev) => ({ ...prev, priority: event.target.value as Priority }))}
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
              >
                <option value="High">高 (High)</option>
                <option value="Medium">中 (Medium)</option>
                <option value="Low">低 (Low)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">截止日期</label>
              <input
                type="date"
                value={formData.dueDate}
                onChange={(event) => setFormData((prev) => ({ ...prev, dueDate: event.target.value }))}
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">分配团队</label>
            <div className="flex flex-wrap gap-2">
              {industryAgents.map((agent) => {
                const engine = resolveEngineMeta(agent.integrationEngine);
                return (
                  <label
                    key={agent.id}
                    className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-border-subtle rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={formData.agentIds.includes(agent.id)}
                      onChange={() => handleToggleManualAgent(agent.id)}
                      className="accent-primary"
                    />
                    <span className="text-xs text-slate-300">{agent.name} · {roleLabel(getAgentRoleId(agent))}</span>
                    <span className={`px-1.5 py-0.5 rounded-md border text-[10px] font-semibold tracking-wide ${engine.className}`}>
                      {engine.label}
                    </span>
                  </label>
                );
              })}
              {industryAgents.length === 0 && (
                <p className="text-xs text-slate-500">当前行业角色集中暂无可用 Agent</p>
              )}
            </div>
          </div>

          <button
            onClick={() => void handleManualSubmit()}
            disabled={isCreating}
            className="w-full py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all mt-2 disabled:opacity-50"
          >
            {isCreating ? '创建中...' : '立即创建项目'}
          </button>
        </div>
      )}
    </div>
  );
}
