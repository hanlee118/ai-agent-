import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  OpenClawAgentDetail,
  OpenClawExecutionMode,
  OpenClawInstructionPreview,
  OpenClawMemoryType
} from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

type EditorMode = "soul" | "sop";
type FlashState = { tone: "success" | "error"; message: string } | null;

export function AgentCommanderPage() {
  const { agentId = "" } = useParams();
  const { isEnglish, locale } = useLocale();
  const [agent, setAgent] = useState<OpenClawAgentDetail | null>(null);
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<OpenClawInstructionPreview | null>(null);
  const [latestReply, setLatestReply] = useState<{
    summary: string;
    reply: string;
    model?: string;
    provider?: string;
    durationMs?: number;
  } | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("soul");
  const [editorContent, setEditorContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingDoc, setSavingDoc] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [maxPromptTokensDraft, setMaxPromptTokensDraft] = useState("");
  const [maxCompletionTokensDraft, setMaxCompletionTokensDraft] = useState("");
  const [maxDailyTokensDraft, setMaxDailyTokensDraft] = useState("");
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [introDraft, setIntroDraft] = useState("");
  const [responsibilityDraft, setResponsibilityDraft] = useState("");
  const [toolsDraft, setToolsDraft] = useState("");
  const [allowedAgentsDraft, setAllowedAgentsDraft] = useState("");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryFilter, setMemoryFilter] = useState<"all" | OpenClawMemoryType>("all");
  const [newMemoryType, setNewMemoryType] = useState<OpenClawMemoryType>("fact");
  const [newMemorySummary, setNewMemorySummary] = useState("");
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [sending, setSending] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [flash, setFlash] = useState<FlashState>(null);

  const copy = isEnglish
    ? {
        loading: "Loading agent command room...",
        notFound: "Agent not found",
        loadFailed: "Failed to load agent details",
        saveFailed: "Failed to save document",
        settingsFailed: "Failed to update commander settings",
        previewFailed: "Failed to generate understanding preview",
        sendFailed: "Failed to send instruction",
        back: "Back to agents",
        currentModel: "Current model",
        recommendedModels: "Switch model",
        defaultModel: "Default model",
        fallbackModel: "Fallback model",
        tokenGuard: "Token guardrails",
        maxPrompt: "Max prompt tokens",
        maxCompletion: "Max completion tokens",
        maxDaily: "Max daily tokens",
        memorySwitch: "Long-term memory",
        saveLimits: "Save limits",
        executionStrategy: "Execution strategy",
        confirmFirst: "Confirm before execute",
        autonomous: "Decide for me",
        strategyHintConfirm: "The agent will first return an understanding card for your approval.",
        strategyHintAuto: "The agent will continue autonomously and ask only when risk is high.",
        governance: "Governance",
        displayName: "Display name",
        titleLabel: "Title",
        introLabel: "Intro",
        toolsLabel: "Allowed tools",
        collaboratorsLabel: "Allowed agents",
        saveGovernance: "Save governance",
        agentIdentity: "Identity snapshot",
        responsibility: "Responsibility",
        status: "Status",
        sessions: "Sessions",
        blockedTasks: "Blocked tasks",
        currentTask: "Current task",
        noTask: "No structured task detected right now.",
        commandDeck: "Direct instruction deck",
        commandHint: "The agent will understand the request first unless you switch to autonomous mode.",
        placeholder: "Describe the work you want this agent to take over...",
        previewAction: "Understand first",
        sendNow: "Send now",
        sending: "Sending...",
        quickCommands: [
          "Please analyze the request first",
          "Please break this into executable tasks",
          "Please report your current blockers and next actions",
          "Please design a production-ready page structure"
        ],
        understandingCard: "Understanding confirmation",
        plan: "Execution plan",
        steps: "Steps",
        risks: "Risks",
        suggestion: "Suggestion",
        decisionTitle: "Confirmation choices",
        decisionHint: "Choose the next action from structured options instead of rewriting the request.",
        confirmExecute: "Confirm and execute",
        revise: "Revise request",
        analysisOnly: "Analysis only",
        switchModel: "Retry after model switch",
        latestReply: "Latest execution result",
        duration: "Duration",
        unknown: "unknown",
        currentTasks: "Current tasks",
        noTasks: "This agent has no structured tasks right now.",
        recentSessions: "Recent sessions",
        noSessions: "No sessions detected yet.",
        recentMessages: "Recent messages",
        noMessages: "No recent messages detected.",
        coordinationTitle: "Coordination map",
        coordinationCopy: "Use this rail to see who this agent can collaborate with before you push multi-role execution.",
        noCollaborators: "No collaborator rules are configured yet.",
        memoryTitle: "Long-term memory",
        addMemory: "Add memory",
        memorySummary: "Memory summary",
        memoryContent: "Memory content",
        memoryType: "Memory type",
        memorySearch: "Search memory",
        usageTitle: "Usage logs",
        noUsage: "No usage logs yet.",
        editSoul: "Edit SOUL",
        editSop: "Edit SOP",
        documentPath: "Document path",
        exists: "Exists",
        willCreate: "Will create",
        save: "Save",
        saving: "Saving...",
        saved: "Saved successfully",
        settingsSaved: "Commander settings updated",
        previewReady: "Understanding preview is ready",
        instructionSent: "Instruction delivered to the agent",
        switchedModel: "Switched to the next available model",
        noAlternativeModel: "No alternative model is available",
        analysisStored: "Analysis has been kept without execution",
        emergencyAction: "Emergency intervene"
      }
    : {
        loading: "正在载入 Agent 指挥页...",
        notFound: "Agent 不存在",
        loadFailed: "加载 Agent 详情失败",
        saveFailed: "保存文档失败",
        settingsFailed: "更新指挥设置失败",
        previewFailed: "生成理解预览失败",
        sendFailed: "下发指令失败",
        back: "返回 Agent 列表",
        currentModel: "当前模型",
        recommendedModels: "切换模型",
        defaultModel: "默认模型",
        fallbackModel: "备用模型",
        tokenGuard: "Token 限额",
        maxPrompt: "单次输入上限",
        maxCompletion: "单次输出上限",
        maxDaily: "每日总量上限",
        memorySwitch: "长期记忆",
        saveLimits: "保存限额",
        executionStrategy: "执行策略",
        confirmFirst: "执行前确认",
        autonomous: "直接由你决定",
        strategyHintConfirm: "该 Agent 会先返回理解确认卡，由你确认后再执行。",
        strategyHintAuto: "该 Agent 会持续自主推进，仅在高风险时再请求确认。",
        governance: "治理配置",
        displayName: "显示名称",
        titleLabel: "职位",
        introLabel: "介绍",
        toolsLabel: "允许工具",
        collaboratorsLabel: "允许协作 Agent",
        saveGovernance: "保存治理配置",
        agentIdentity: "身份快照",
        responsibility: "职责",
        status: "状态",
        sessions: "会话数",
        blockedTasks: "阻塞任务",
        currentTask: "当前任务",
        noTask: "当前没有识别到结构化任务。",
        commandDeck: "指令操作台",
        commandHint: "默认先理解再执行，若切到自主模式则可直接持续推进。",
        placeholder: "描述你希望这个 Agent 接手的工作...",
        previewAction: "先理解一下",
        sendNow: "直接下发",
        sending: "发送中...",
        quickCommands: [
          "请先分析这项任务的目标和边界",
          "请把这项任务拆成可执行步骤",
          "请汇报当前阻塞点和下一步计划",
          "请设计一个可上线的页面结构方案"
        ],
        understandingCard: "理解确认卡",
        plan: "执行计划",
        steps: "执行步骤",
        risks: "风险提醒",
        suggestion: "建议路径",
        decisionTitle: "确认选择项",
        decisionHint: "优先通过结构化选项来确认，而不是重新手写指令。",
        confirmExecute: "确认并执行",
        revise: "修改后重来",
        analysisOnly: "仅分析不执行",
        switchModel: "换模型后重试",
        latestReply: "最近一次执行结果",
        duration: "耗时",
        unknown: "未知",
        currentTasks: "当前任务",
        noTasks: "该 Agent 当前没有结构化任务。",
        recentSessions: "最近会话",
        noSessions: "暂未检测到会话记录。",
        recentMessages: "最近消息",
        noMessages: "暂未检测到最近消息。",
        coordinationTitle: "协作地图",
        coordinationCopy: "在多角色协作前，先从这里看清这个 Agent 可以和谁协作。",
        noCollaborators: "当前还没有配置协作对象。",
        memoryTitle: "长期记忆",
        addMemory: "写入记忆",
        memorySummary: "记忆摘要",
        memoryContent: "记忆内容",
        memoryType: "记忆类型",
        memorySearch: "搜索记忆",
        usageTitle: "调用日志",
        noUsage: "当前还没有调用日志。",
        editSoul: "编辑 SOUL",
        editSop: "编辑 SOP",
        documentPath: "文档路径",
        exists: "已存在",
        willCreate: "将创建",
        save: "保存",
        saving: "保存中...",
        saved: "保存成功",
        settingsSaved: "指挥设置已更新",
        previewReady: "理解预览已生成",
        instructionSent: "指令已发给该 Agent",
        switchedModel: "已切换到下一个可用模型",
        noAlternativeModel: "当前没有其他可切换模型",
        analysisStored: "已保留分析结果，暂不执行",
        emergencyAction: "紧急介入"
      };

  async function refresh(options?: { silent?: boolean }) {
    if (!agentId) {
      return;
    }

    try {
      if (!options?.silent) {
        setLoading(true);
      }

      const detail = await api.getOpenClawAgent(agentId);
      setAgent(detail);
      setPageError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : copy.loadFailed;
      if (agent) {
        setFlash({ tone: "error", message });
      } else {
        setPageError(message);
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void refresh();
  }, [agentId]);

  useEffect(() => {
    if (!agent) {
      return;
    }

    setEditorContent(editorMode === "soul" ? agent.soul.content : agent.sop.content);
  }, [agent, editorMode]);

  useEffect(() => {
    if (!agent) {
      return;
    }

    setMaxPromptTokensDraft(agent.commander.maxPromptTokens ? String(agent.commander.maxPromptTokens) : "");
    setMaxCompletionTokensDraft(agent.commander.maxCompletionTokens ? String(agent.commander.maxCompletionTokens) : "");
    setMaxDailyTokensDraft(agent.commander.maxDailyTokens ? String(agent.commander.maxDailyTokens) : "");
    setDisplayNameDraft(agent.name || "");
    setTitleDraft(agent.title || "");
    setIntroDraft(agent.intro || "");
    setResponsibilityDraft(agent.responsibility || "");
    setToolsDraft(agent.tools.join(", "));
    setAllowedAgentsDraft(agent.allowedAgentIds.join(", "));
  }, [agent]);

  const activeDocument = useMemo(() => {
    if (!agent) {
      return null;
    }

    return editorMode === "soul" ? agent.soul : agent.sop;
  }, [agent, editorMode]);

  const filteredMemoryEntries = useMemo(() => {
    if (!agent) {
      return [];
    }

    const query = memoryQuery.trim().toLowerCase();
    return agent.memoryEntries.filter((entry) => {
      if (memoryFilter !== "all" && entry.type !== memoryFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return `${entry.summary} ${entry.content} ${entry.tags.join(" ")}`.toLowerCase().includes(query);
    });
  }, [agent, memoryFilter, memoryQuery]);

  async function updateSettings(patch: {
    displayName?: string;
    title?: string;
    intro?: string;
    responsibility?: string;
    allowedAgentIds?: string[];
    tools?: string[];
    selectedModel?: string;
    defaultModel?: string;
    fallbackModel?: string;
    executionMode?: OpenClawExecutionMode;
    requireConfirmation?: boolean;
    maxPromptTokens?: number | null;
    maxCompletionTokens?: number | null;
    maxDailyTokens?: number | null;
    memoryEnabled?: boolean;
  }) {
    if (!agent) {
      return null;
    }

    try {
      setSavingSettings(true);
      const updated = await api.updateOpenClawAgentSettings(agent.agentId, patch);
      setAgent(updated);
      setFlash({ tone: "success", message: copy.settingsSaved });
      return updated;
    } catch (error) {
      setFlash({
        tone: "error",
        message: error instanceof Error ? error.message : copy.settingsFailed
      });
      return null;
    } finally {
      setSavingSettings(false);
    }
  }

  async function handlePreview() {
    if (!agent || !instruction.trim()) {
      return;
    }

    try {
      setSending(true);
      const nextPreview = await api.previewOpenClawAgentInstruction(agent.agentId, {
        message: instruction,
        preferAutonomous: agent.commander.executionMode === "autonomous"
      });
      setPreview(nextPreview);
      setFlash({ tone: "success", message: copy.previewReady });
    } catch (error) {
      setFlash({
        tone: "error",
        message: error instanceof Error ? error.message : copy.previewFailed
      });
    } finally {
      setSending(false);
    }
  }

  async function handleExecute(messageOverride?: string) {
    if (!agent) {
      return;
    }

    const message = String(messageOverride ?? instruction).trim();
    if (!message) {
      return;
    }

    try {
      setSending(true);
      const result = await api.sendOpenClawAgentMessage(agent.agentId, { message });
      setLatestReply(result);
      setPreview(null);
      setInstruction("");
      setFlash({ tone: "success", message: copy.instructionSent });
      setAgent(await api.getOpenClawAgent(agent.agentId));
    } catch (error) {
      setFlash({
        tone: "error",
        message: error instanceof Error ? error.message : copy.sendFailed
      });
    } finally {
      setSending(false);
    }
  }

  async function handlePrimaryAction() {
    if (!agent || !instruction.trim()) {
      return;
    }

    if (agent.commander.executionMode === "autonomous") {
      await handleExecute();
      return;
    }

    await handlePreview();
  }

  async function handlePreviewOption(optionId: string) {
    if (!agent || !preview) {
      return;
    }

    if (optionId === "confirm_execute") {
      await handleExecute(preview.message);
      return;
    }

    if (optionId === "revise_instruction") {
      setInstruction(preview.message);
      setPreview(null);
      return;
    }

    if (optionId === "analysis_only") {
      setInstruction(preview.goal);
      setLatestReply({
        summary: preview.goal,
        reply: [
          `${copy.plan}:`,
          ...preview.plan.map((item, index) => `${index + 1}. ${item}`),
          "",
          `${copy.steps}:`,
          ...preview.steps.map((item, index) => `${index + 1}. ${item}`),
          "",
          `${copy.risks}:`,
          ...(preview.risks.length > 0 ? preview.risks.map((item, index) => `${index + 1}. ${item}`) : ["-"]),
          "",
          `${copy.suggestion}: ${preview.suggestion}`
        ].join("\n")
      });
      setPreview(null);
      setFlash({ tone: "success", message: copy.analysisStored });
      return;
    }

    if (optionId === "switch_model") {
      const nextModel = agent.availableModels.find((model) => model.id !== agent.commander.selectedModel);
      if (!nextModel) {
        setFlash({ tone: "error", message: copy.noAlternativeModel });
        return;
      }

      const updated = await updateSettings({ selectedModel: nextModel.id, defaultModel: nextModel.id });
      if (!updated) {
        return;
      }

      const rerunPreview = await api.previewOpenClawAgentInstruction(updated.agentId, {
        message: preview.message,
        preferAutonomous: updated.commander.executionMode === "autonomous"
      });
      setPreview(rerunPreview);
      setFlash({ tone: "success", message: copy.switchedModel });
      return;
    }
  }

  async function handleSaveDocument() {
    if (!agent) {
      return;
    }

    try {
      setSavingDoc(true);
      const updated = editorMode === "soul"
        ? await api.updateOpenClawSoul(agent.agentId, { content: editorContent, createIfMissing: true })
        : await api.updateOpenClawSop(agent.agentId, { content: editorContent, createIfMissing: true });
      setAgent(updated);
      setFlash({ tone: "success", message: copy.saved });
    } catch (error) {
      setFlash({
        tone: "error",
        message: error instanceof Error ? error.message : copy.saveFailed
      });
    } finally {
      setSavingDoc(false);
    }
  }

  async function handleSaveLimits() {
    await updateSettings({
      maxPromptTokens: parseLimit(maxPromptTokensDraft),
      maxCompletionTokens: parseLimit(maxCompletionTokensDraft),
      maxDailyTokens: parseLimit(maxDailyTokensDraft)
    });
  }

  async function handleSaveGovernance() {
    await updateSettings({
      displayName: displayNameDraft.trim() || undefined,
      title: titleDraft.trim() || undefined,
      intro: introDraft.trim() || undefined,
      responsibility: responsibilityDraft.trim() || undefined,
      tools: splitCsv(toolsDraft),
      allowedAgentIds: splitCsv(allowedAgentsDraft)
    });
  }

  async function handleAddMemory() {
    if (!agent || !newMemorySummary.trim() || !newMemoryContent.trim()) {
      return;
    }

    try {
      setSavingSettings(true);
      const updated = await api.addOpenClawAgentMemory(agent.agentId, {
        type: newMemoryType,
        summary: newMemorySummary,
        content: newMemoryContent
      });
      setAgent(updated);
      setNewMemorySummary("");
      setNewMemoryContent("");
      setFlash({ tone: "success", message: isEnglish ? "Memory stored" : "记忆已写入" });
    } catch (error) {
      setFlash({
        tone: "error",
        message: error instanceof Error ? error.message : "记忆写入失败"
      });
    } finally {
      setSavingSettings(false);
    }
  }

  function handleEmergencyFill() {
    setInstruction(
      isEnglish
        ? "Please immediately inspect the current blockers, explain the risk in one paragraph, and propose the safest next actions for my confirmation."
        : "请立即检查当前阻塞点，用一段话说明风险，并给出最稳妥的下一步动作供我确认。"
    );
  }

  if (loading) {
    return <div className="card">{copy.loading}</div>;
  }

  if (pageError) {
    return <div className="card error-text">{pageError}</div>;
  }

  if (!agent) {
    return <div className="card error-text">{copy.notFound}</div>;
  }

  return (
    <div className="page commander-page">
      {flash ? (
        <div className={flash.tone === "error" ? "card error-text" : "card success-text"}>
          {flash.message}
        </div>
      ) : null}

      <section className="commander-hero bg-[#16191E]/60 backdrop-blur-xl rounded-2xl border border-white/[0.06] p-6">
        <div className="commander-hero-main">
          <div className="commander-title-row">
            <Link className="button button-ghost inline-button" to="/agents">
              {copy.back}
            </Link>
            <div className="commander-title-block">
              <div className="commander-avatar">{agent.emoji || agent.name.slice(0, 1)}</div>
              <div>
                <p className="eyebrow">Agent Commander</p>
                <h2>{agent.name}</h2>
                <p className="hero-copy">
                  {agent.title} · {agent.commander.selectedModel} · {agent.responsibility}
                </p>
              </div>
            </div>
          </div>

          <div className="commander-hero-copy">
            <div className="commander-hero-summary">
              <span>{copy.currentTask}</span>
              <strong>{agent.currentTask ? `${agent.currentTask.projectName} / ${agent.currentTask.title}` : copy.noTask}</strong>
            </div>
            <div className="commander-hero-summary">
              <span>{copy.memorySwitch}</span>
              <strong>{agent.commander.memoryEnabled ? (isEnglish ? "Enabled" : "已开启") : (isEnglish ? "Disabled" : "已关闭")}</strong>
            </div>
          </div>
        </div>

        <div className="commander-hero-aside">
          <div className="commander-status-stack">
            <span className={`status-badge status-${agent.status}`}>{agent.status}</span>
            <span className={agent.commander.executionMode === "autonomous" ? "pill pill-primary" : "pill"}>
              {agent.commander.executionMode === "autonomous" ? copy.autonomous : copy.confirmFirst}
            </span>
          </div>

          <div className="commander-hero-actions">
            <button className="button button-ghost" type="button" onClick={handleEmergencyFill}>
              {copy.emergencyAction}
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void handlePrimaryAction()}
              disabled={sending || !instruction.trim()}
            >
              {sending ? copy.sending : agent.commander.executionMode === "autonomous" ? copy.sendNow : copy.previewAction}
            </button>
          </div>

          <div className="meta-strip meta-strip-compact commander-kpis">
            <MiniMeta label={copy.currentModel} value={agent.commander.selectedModel} />
            <MiniMeta label={copy.sessions} value={String(agent.sessionCount)} />
            <MiniMeta label={copy.blockedTasks} value={String(agent.blockedTaskCount)} />
          </div>
        </div>
      </section>

      <section className="commander-grid gap-6">
        <aside className="commander-sidebar flex flex-col gap-4">
          <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.currentModel}</p>
                <h3>{agent.commander.selectedModel}</h3>
              </div>
              {savingSettings ? <span className="muted-text">{copy.saving}</span> : null}
            </div>

            <div className="commander-model-list">
              {agent.availableModels.map((model) => (
                <button
                  key={model.id}
                  className={model.id === agent.commander.selectedModel ? "commander-model-card is-active" : "commander-model-card"}
                  onClick={() => void updateSettings({ selectedModel: model.id })}
                  disabled={savingSettings}
                >
                  <strong>{model.label}</strong>
                  <div className="pill-row">
                    {model.tags.map((tag) => (
                      <span key={tag} className="pill">
                        {tagLabel(tag, isEnglish)}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>

            <div className="form-grid">
              <label className="form-field">
                <span>{copy.defaultModel}</span>
                <select
                  value={agent.commander.defaultModel}
                  onChange={(event) => void updateSettings({ defaultModel: event.target.value })}
                >
                  {agent.availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>{copy.fallbackModel}</span>
                <select
                  value={agent.commander.fallbackModel || ""}
                  onChange={(event) => void updateSettings({ fallbackModel: event.target.value || undefined })}
                >
                  <option value="">{isEnglish ? "None" : "暂无"}</option>
                  {agent.availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.executionStrategy}</p>
                <h3>{agent.commander.executionMode === "autonomous" ? copy.autonomous : copy.confirmFirst}</h3>
              </div>
            </div>

            <div className="segmented">
              <button
                className={agent.commander.executionMode === "confirm_first" ? "segmented-item is-active" : "segmented-item"}
                onClick={() => void updateSettings({ executionMode: "confirm_first", requireConfirmation: true })}
              >
                {copy.confirmFirst}
              </button>
              <button
                className={agent.commander.executionMode === "autonomous" ? "segmented-item is-active" : "segmented-item"}
                onClick={() => void updateSettings({ executionMode: "autonomous", requireConfirmation: false })}
              >
                {copy.autonomous}
              </button>
            </div>

            <p className="muted-text">
              {agent.commander.executionMode === "autonomous" ? copy.strategyHintAuto : copy.strategyHintConfirm}
            </p>
          </div>

          <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.tokenGuard}</p>
                <h3>{agent.usage.totalTokensToday}</h3>
              </div>
              <span className="pill">{agent.usage.requestCountToday}</span>
            </div>

            <div className="form-grid">
              <label className="form-field">
                <span>{copy.maxPrompt}</span>
                <input value={maxPromptTokensDraft} onChange={(event) => setMaxPromptTokensDraft(event.target.value)} placeholder="12000" />
              </label>
              <label className="form-field">
                <span>{copy.maxCompletion}</span>
                <input value={maxCompletionTokensDraft} onChange={(event) => setMaxCompletionTokensDraft(event.target.value)} placeholder="8000" />
              </label>
              <label className="form-field">
                <span>{copy.maxDaily}</span>
                <input value={maxDailyTokensDraft} onChange={(event) => setMaxDailyTokensDraft(event.target.value)} placeholder="50000" />
              </label>
            </div>
            <div className="meta-strip meta-strip-compact">
              <MiniMeta label="Today" value={String(agent.usage.totalTokensToday)} />
              <MiniMeta label="Prompt" value={String(agent.usage.promptTokensToday)} />
              <MiniMeta label="Completion" value={String(agent.usage.completionTokensToday)} />
              <MiniMeta label="Remaining" value={String(agent.usage.remainingDailyTokens ?? "-")} />
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={agent.commander.memoryEnabled}
                onChange={(event) => void updateSettings({ memoryEnabled: event.target.checked })}
              />
              <span>{copy.memorySwitch}</span>
            </label>
            <div className="action-row">
              <button className="button button-primary" onClick={() => void handleSaveLimits()} disabled={savingSettings}>
                {copy.saveLimits}
              </button>
            </div>
          </div>

          <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.governance}</p>
                <h3>{copy.saveGovernance}</h3>
              </div>
            </div>

            <div className="form-grid">
              <label className="form-field">
                <span>{copy.displayName}</span>
                <input value={displayNameDraft} onChange={(event) => setDisplayNameDraft(event.target.value)} />
              </label>
              <label className="form-field">
                <span>{copy.titleLabel}</span>
                <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />
              </label>
              <label className="form-field">
                <span>{copy.introLabel}</span>
                <input value={introDraft} onChange={(event) => setIntroDraft(event.target.value)} />
              </label>
              <label className="form-field">
                <span>{copy.responsibility}</span>
                <input value={responsibilityDraft} onChange={(event) => setResponsibilityDraft(event.target.value)} />
              </label>
              <label className="form-field">
                <span>{copy.toolsLabel}</span>
                <input value={toolsDraft} onChange={(event) => setToolsDraft(event.target.value)} placeholder="openclaw, rg, pnpm" />
              </label>
              <label className="form-field">
                <span>{copy.collaboratorsLabel}</span>
                <input value={allowedAgentsDraft} onChange={(event) => setAllowedAgentsDraft(event.target.value)} placeholder="jeremy, ops_memory_keeper" />
              </label>
            </div>

            <div className="action-row">
              <button className="button button-primary" onClick={() => void handleSaveGovernance()} disabled={savingSettings}>
                {savingSettings ? copy.saving : copy.saveGovernance}
              </button>
            </div>
          </div>

          <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <p className="eyebrow">{copy.agentIdentity}</p>
            <div className="stack tight">
              <MiniMeta label={copy.responsibility} value={agent.responsibility} />
              <MiniMeta label={copy.status} value={agent.status} />
              <MiniMeta label={copy.currentTask} value={agent.currentTask ? `${agent.currentTask.projectName} / ${agent.currentTask.title}` : copy.noTask} />
            </div>
          </div>
        </aside>

        <div className="commander-main flex flex-col gap-4">
          <div className="card commander-panel commander-composer">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.commandDeck}</p>
                <h3>{agent.name}</h3>
              </div>
              <span className="muted-text">{copy.commandHint}</span>
            </div>

            <div className="commander-decision-bar bg-[#1C2128]/60 rounded-xl p-4 border border-white/[0.06]">
              <div className="commander-decision-metric">
                <span>{copy.executionStrategy}</span>
                <strong>{agent.commander.executionMode === "autonomous" ? copy.autonomous : copy.confirmFirst}</strong>
              </div>
              <div className="commander-decision-metric">
                <span>{copy.currentTask}</span>
                <strong>{agent.currentTask?.title ?? copy.noTask}</strong>
              </div>
              <div className="commander-decision-metric">
                <span>{copy.currentModel}</span>
                <strong>{agent.commander.selectedModel}</strong>
              </div>
            </div>

            <textarea
              className="composer-textarea commander-textarea rounded-2xl bg-[#1C2128]/60 border border-white/[0.08] focus:border-emerald-500/40"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={copy.placeholder}
            />

            <div className="pill-row">
              {copy.quickCommands.map((item) => (
                <button
                  key={item}
                  className="button button-ghost inline-button"
                  onClick={() => setInstruction(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="action-row">
              <button className="button button-primary" onClick={() => void handlePrimaryAction()} disabled={sending || !instruction.trim()}>
                {sending ? copy.sending : agent.commander.executionMode === "autonomous" ? copy.sendNow : copy.previewAction}
              </button>
              <button className="button button-ghost" onClick={() => void handleExecute()} disabled={sending || !instruction.trim()}>
                {copy.sendNow}
              </button>
            </div>
          </div>

          {preview ? (
            <div className="card commander-panel commander-preview">
              <div className="section-header">
                <div>
                  <p className="eyebrow">{copy.understandingCard}</p>
                  <h3>{preview.goal}</h3>
                </div>
                <span className={preview.needsConfirmation ? "pill pill-warning" : "pill pill-primary"}>
                  {preview.needsConfirmation ? copy.confirmFirst : copy.autonomous}
                </span>
              </div>

              <div className="commander-preview-grid">
                <PreviewBlock title={copy.plan} items={preview.plan} />
                <PreviewBlock title={copy.steps} items={preview.steps} />
                <PreviewBlock title={copy.risks} items={preview.risks} tone="danger" />
                <div className="sub-card">
                  <p className="group-title">{copy.suggestion}</p>
                  <p>{preview.suggestion}</p>
                </div>
              </div>

              <div className="commander-option-block">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">{copy.decisionTitle}</p>
                    <h3>{copy.decisionTitle}</h3>
                  </div>
                </div>
                <p className="muted-text">{copy.decisionHint}</p>
                <div className="commander-option-grid">
                  {preview.options.map((option) => (
                    <button
                      key={option.id}
                      className={`rounded-xl bg-[#1C2128]/60 border border-white/[0.06] hover:border-emerald-500/30 transition-all duration-200 ${
                        option.id === preview.recommendedAction
                          ? "commander-option-card is-recommended"
                          : `commander-option-card commander-option-${option.tone}`
                      }`}
                      onClick={() => void handlePreviewOption(option.id)}
                      disabled={sending}
                      type="button"
                    >
                      <div className="timeline-head">
                        <strong>{previewOptionLabel(option.id, option.label, copy, isEnglish)}</strong>
                        {option.recommended || option.id === preview.recommendedAction ? (
                          <span className="pill pill-primary">{isEnglish ? "Recommended" : "推荐"}</span>
                        ) : null}
                      </div>
                      <p>{previewOptionDescription(option.id, copy, isEnglish)}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="action-row">
                <button className="button button-primary" onClick={() => void handleExecute(preview.message)} disabled={sending}>
                  {copy.confirmExecute}
                </button>
                <button className="button button-ghost" onClick={() => setPreview(null)}>
                  {copy.revise}
                </button>
                <button className="button button-ghost" onClick={() => void handlePreviewOption("analysis_only")}>
                  {copy.analysisOnly}
                </button>
                <button className="button button-ghost" onClick={() => void handlePreviewOption("switch_model")}>
                  {copy.switchModel}
                </button>
              </div>
            </div>
          ) : null}

          {latestReply ? (
            <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
              <div className="section-header">
                <div>
                  <p className="eyebrow">{copy.latestReply}</p>
                  <h3>{latestReply.summary}</h3>
                </div>
                <span className="muted-text">
                  {latestReply.durationMs ? `${Math.round(latestReply.durationMs / 1000)}s` : copy.unknown}
                </span>
              </div>
              <div className="meta-strip meta-strip-compact">
                <MiniMeta label={copy.currentModel} value={latestReply.model || copy.unknown} />
                <MiniMeta label="Provider" value={latestReply.provider || copy.unknown} />
                <MiniMeta label={copy.duration} value={latestReply.durationMs ? `${Math.round(latestReply.durationMs / 1000)}s` : copy.unknown} />
              </div>
              <pre className="command-result">{latestReply.reply}</pre>
            </div>
          ) : null}

          <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.currentTasks}</p>
                <h3>{agent.tasks.length}</h3>
              </div>
            </div>
            <div className="openclaw-task-list">
              {agent.tasks.map((task) => (
                <div key={task.id} className="task-row">
                  <div>
                    <strong>{task.title}</strong>
                    <p>{task.projectName} / {task.statusLabel}</p>
                  </div>
                  <span className={`status-badge status-${taskStatusTone(task.status)}`}>{task.progress}%</span>
                </div>
              ))}
              {agent.tasks.length === 0 ? <p className="muted-text">{copy.noTasks}</p> : null}
            </div>
          </div>
        </div>

        <aside className="commander-rail flex flex-col gap-4">
          <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.coordinationTitle}</p>
                <h3>{copy.coordinationTitle}</h3>
              </div>
            </div>
            <p className="muted-text">{copy.coordinationCopy}</p>
            <div className="pill-row">
              {agent.allowedAgentIds.map((allowed) => (
                <span key={allowed} className="pill pill-primary">{allowed}</span>
              ))}
              {agent.allowedAgentIds.length === 0 ? <span className="pill">{copy.noCollaborators}</span> : null}
            </div>
            <div className="meta-strip meta-strip-compact">
              <MiniMeta label={copy.executionStrategy} value={agent.commander.executionMode} />
              <MiniMeta label={copy.toolsLabel} value={String(agent.tools.length)} />
              <MiniMeta label={copy.collaboratorsLabel} value={String(agent.allowedAgentIds.length)} />
              <MiniMeta label={copy.currentTask} value={agent.currentTask ? agent.currentTask.projectName : copy.noTask} />
            </div>
          </div>

          <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <p className="eyebrow">{copy.memoryTitle}</p>
            <div className="form-grid">
              <label className="form-field">
                <span>{copy.memorySearch}</span>
                <input value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} />
              </label>
              <label className="form-field">
                <span>{copy.memoryType}</span>
                <select value={memoryFilter} onChange={(event) => setMemoryFilter(event.target.value as "all" | OpenClawMemoryType)}>
                  <option value="all">{isEnglish ? "All" : "全部"}</option>
                  <option value="fact">fact</option>
                  <option value="preference">preference</option>
                  <option value="workflow">workflow</option>
                  <option value="project">project</option>
                  <option value="reflection">reflection</option>
                </select>
              </label>
            </div>
            <div className="stack tight">
              {filteredMemoryEntries.slice(0, 10).map((entry) => (
                <div key={entry.id} className="sub-card">
                  <p className="group-title">{entry.type} · {entry.importance}</p>
                  <strong>{entry.summary}</strong>
                  <p>{entry.content}</p>
                </div>
              ))}
              {filteredMemoryEntries.length === 0 ? <p className="muted-text">{isEnglish ? "No memory entries yet." : "还没有长期记忆。"}</p> : null}
            </div>
            <div className="form-grid">
              <label className="form-field">
                <span>{copy.memoryType}</span>
                <select value={newMemoryType} onChange={(event) => setNewMemoryType(event.target.value as OpenClawMemoryType)}>
                  <option value="fact">fact</option>
                  <option value="preference">preference</option>
                  <option value="workflow">workflow</option>
                  <option value="project">project</option>
                  <option value="reflection">reflection</option>
                </select>
              </label>
              <label className="form-field">
                <span>{copy.memorySummary}</span>
                <input value={newMemorySummary} onChange={(event) => setNewMemorySummary(event.target.value)} />
              </label>
            </div>
            <label className="form-field">
              <span>{copy.memoryContent}</span>
              <textarea className="composer-textarea compact" value={newMemoryContent} onChange={(event) => setNewMemoryContent(event.target.value)} />
            </label>
            <div className="action-row">
              <button className="button button-primary" onClick={() => void handleAddMemory()} disabled={savingSettings}>
                {copy.addMemory}
              </button>
            </div>
          </div>

          <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <p className="eyebrow">{copy.usageTitle}</p>
            <div className="openclaw-session-list">
              {agent.usageLogs.map((entry) => (
                <div key={entry.id} className="session-row">
                  <div>
                    <strong>{entry.commandType} · {entry.status}</strong>
                    <p>{entry.model} · {entry.totalTokens} tokens</p>
                  </div>
                  <span className="muted-text">{formatTime(entry.createdAt, locale)}</span>
                </div>
              ))}
              {agent.usageLogs.length === 0 ? <p className="muted-text">{copy.noUsage}</p> : null}
            </div>
          </div>

          <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <p className="eyebrow">{copy.recentSessions}</p>
            <div className="openclaw-session-list">
              {agent.sessions.map((session) => (
                <div key={session.key} className="session-row">
                  <div>
                    <strong>{session.label}</strong>
                    <p>{session.kind}</p>
                  </div>
                  <span className="muted-text">{formatTime(session.updatedAt, locale)}</span>
                </div>
              ))}
              {agent.sessions.length === 0 ? <p className="muted-text">{copy.noSessions}</p> : null}
            </div>
          </div>

          <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <p className="eyebrow">{copy.recentMessages}</p>
            <div className="openclaw-session-list">
              {agent.recentMessages.map((message) => (
                <div key={message.id} className="session-row session-message-row">
                  <div>
                    <strong>{message.role}</strong>
                    <p>{message.text}</p>
                  </div>
                  <span className="muted-text">{formatTime(message.timestamp, locale)}</span>
                </div>
              ))}
              {agent.recentMessages.length === 0 ? <p className="muted-text">{copy.noMessages}</p> : null}
            </div>
          </div>
        </aside>
      </section>

      <section className="commander-editors mt-6">
        <div className="editor-tabs">
          <button
            className={editorMode === "soul" ? "button button-primary" : "button button-ghost"}
            onClick={() => setEditorMode("soul")}
          >
            {copy.editSoul}
          </button>
          <button
            className={editorMode === "sop" ? "button button-primary" : "button button-ghost"}
            onClick={() => setEditorMode("sop")}
          >
            {copy.editSop}
          </button>
        </div>

        <div className="card commander-panel rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.documentPath}</p>
              <h3>{activeDocument?.path}</h3>
            </div>
            <span className="pill">{activeDocument?.exists ? copy.exists : copy.willCreate}</span>
          </div>

          <textarea
            className="composer-textarea openclaw-editor rounded-2xl bg-[#1C2128]/60 border border-white/[0.08] focus:border-emerald-500/40 min-h-[320px]"
            value={editorContent}
            onChange={(event) => setEditorContent(event.target.value)}
          />

          <div className="action-row">
            <button className="button button-primary" onClick={() => void handleSaveDocument()} disabled={savingDoc}>
              {savingDoc ? copy.saving : copy.save}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PreviewBlock({
  title,
  items,
  tone = "default"
}: {
  title: string;
  items: string[];
  tone?: "default" | "danger";
}) {
  return (
    <div className={tone === "danger" ? "sub-card commander-preview-block is-danger" : "sub-card commander-preview-block"}>
      <p className="group-title">{title}</p>
      <div className="stack tight">
        {items.length > 0 ? items.map((item) => (
          <p key={item}>{item}</p>
        )) : <p className="muted-text">-</p>}
      </div>
    </div>
  );
}

function previewOptionLabel(
  optionId: string,
  fallback: string,
  copy: { confirmExecute: string; revise: string; analysisOnly: string; switchModel: string },
  isEnglish: boolean
) {
  const labels = {
    confirm_execute: copy.confirmExecute,
    revise_instruction: copy.revise,
    analysis_only: copy.analysisOnly,
    switch_model: copy.switchModel
  } satisfies Record<"confirm_execute" | "revise_instruction" | "analysis_only" | "switch_model", string>;

  if (optionId in labels) {
    return labels[optionId as keyof typeof labels];
  }

  return isEnglish ? fallback : fallback;
}

function previewOptionDescription(optionId: string, copy: { suggestion: string }, isEnglish: boolean) {
  const descriptions = isEnglish
    ? {
        confirm_execute: "Approve the agent's understanding and start execution immediately.",
        revise_instruction: "Return to the draft, edit the request, then regenerate the understanding card.",
        analysis_only: "Keep the plan for reference without sending the task to the agent yet.",
        switch_model: "Move to another available model before retrying this instruction."
      }
    : {
        confirm_execute: "确认该 Agent 的理解结果，并立即开始执行。",
        revise_instruction: "回到草稿继续修改需求，再重新生成理解确认卡。",
        analysis_only: "仅保留分析结果，不立即把任务真正下发给 Agent。",
        switch_model: "先切换到其他可用模型，再重新尝试这条指令。"
      };

  return descriptions[optionId as keyof typeof descriptions] ?? copy.suggestion;
}

function MiniMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function tagLabel(tag: string, isEnglish: boolean) {
  const map: Record<string, { zh: string; en: string }> = {
    reasoning: { zh: "推理", en: "Reasoning" },
    speed: { zh: "速度", en: "Speed" },
    cost: { zh: "成本", en: "Cost" },
    multimodal: { zh: "多模态", en: "Multimodal" },
    general: { zh: "通用", en: "General" }
  };

  const matched = map[tag];
  if (!matched) {
    return tag;
  }

  return isEnglish ? matched.en : matched.zh;
}

function taskStatusTone(status: string) {
  if (status === "done") {
    return "completed";
  }
  if (status === "blocked") {
    return "paused";
  }
  if (status === "in_progress") {
    return "working";
  }
  return "idle";
}

function formatTime(timestamp: string, locale = "zh-CN") {
  return new Date(timestamp).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function parseLimit(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed);
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
