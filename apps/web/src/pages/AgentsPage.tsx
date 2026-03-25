import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { OpenClawAgentSummary, SystemHealth } from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

export function AgentsPage() {
  const { isEnglish } = useLocale();
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newAgentId, setNewAgentId] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentTitle, setNewAgentTitle] = useState("");
  const [newAgentModel, setNewAgentModel] = useState("gpt-5.2");
  const [newAgentIntro, setNewAgentIntro] = useState("");
  const [newAgentResponsibility, setNewAgentResponsibility] = useState("");
  const [newAgentTools, setNewAgentTools] = useState("");
  const [newAgentAllowedAgents, setNewAgentAllowedAgents] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 15000);

    return () => window.clearInterval(timer);
  }, []);

  async function refresh(options?: { silent?: boolean }) {
    try {
      if (!options?.silent) {
        setError(null);
      }

      const [agentList, healthInfo] = await Promise.all([
        api.getOpenClawAgents(),
        api.getSystemHealth()
      ]);
      setAgents(agentList);
      setHealth(healthInfo);
      setLastSyncedAt(new Date().toISOString());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    }
  }

  const sortedAgents = useMemo(
    () =>
      [...agents].sort((left, right) => {
        const blockedDelta = right.blockedTaskCount - left.blockedTaskCount;
        if (blockedDelta !== 0) {
          return blockedDelta;
        }

        return right.taskCount - left.taskCount;
      }),
    [agents]
  );

  const activeTaskTotal = agents.reduce((sum, agent) => sum + agent.taskCount, 0);
  const autonomousCount = agents.filter((agent) => agent.commander.executionMode === "autonomous").length;
  const overloadedCount = agents.filter((agent) => agent.taskCount >= 3 || agent.blockedTaskCount > 0).length;
  const overloadedAgents = useMemo(
    () => sortedAgents.filter((agent) => agent.taskCount >= 3 || agent.blockedTaskCount > 0).slice(0, 5),
    [sortedAgents]
  );
  const hasJeremy = agents.some((agent) => {
    const normalizedId = agent.agentId.toLowerCase();
    const normalizedName = agent.name.toLowerCase();
    return normalizedId === "jeremy" || normalizedId === "design_director" || normalizedName.includes("jeremy");
  });
  const copy = isEnglish
    ? {
        title: "Live OpenClaw agent roster",
        hero: "Inspect the real agent team, spot overloaded specialists, and jump directly into a dedicated commander view for each role.",
        lastSynced: "Last sync",
        refresh: "Refresh",
        activeTasks: "Structured tasks",
        autonomous: "Autonomous agents",
        overloaded: "Attention needed",
        runtime: "Runtime mode",
        runtimeWatch: "Runtime Watch",
        serviceHealth: "Service Health",
        openCommander: "Open commander",
        createAgent: "Create agent",
        creatingAgent: "Creating...",
        agentId: "Agent ID",
        name: "Name",
        titleLabel: "Title",
        modelLabel: "Model",
        introLabel: "Intro",
        responsibilityLabel: "Responsibility",
        toolsLabel: "Tools",
        collaboratorsLabel: "Allowed agents",
        currentTask: "Current task",
        noTask: "No structured task detected.",
        sessions: "Sessions",
        blocked: "Blocked",
        allowed: "Collaboration",
        rosterTitle: "Command-ready roster",
        rosterCopy: "Review who is carrying load, who is blocked, and which specialist should receive the next instruction.",
        governanceTitle: "Roster governance",
        governanceCopy: "Create or patch team roles from here, then jump into the dedicated commander page for model switching and approvals.",
        workloadTitle: "Attention queue",
        workloadCopy: "These agents are most likely to need reassignment, intervention, or a quick sync check.",
        missingDesignLead: "Design Director Jeremy is not in the managed roster yet.",
        fillJeremy: "Fill Jeremy preset",
        currentModel: "Current model",
        executionMode: "Execution",
        confirmFirst: "Confirm first",
        tasksLabel: "Tasks",
        updatedLabel: "Updated"
      }
    : {
        title: "真实 OpenClaw Agent 团队总览",
        hero: "这里展示的是当前真实 Agent 团队，而不是静态画像。你可以快速看出谁在承压、谁可接单，并直接进入单独指挥页。",
        lastSynced: "最近同步",
        refresh: "刷新状态",
        activeTasks: "结构化任务",
        autonomous: "自主执行 Agent",
        overloaded: "需要关注",
        runtime: "运行模式",
        runtimeWatch: "运行观察",
        serviceHealth: "服务状态",
        openCommander: "进入指挥页",
        createAgent: "创建 Agent",
        creatingAgent: "创建中...",
        agentId: "Agent ID",
        name: "名称",
        titleLabel: "职位",
        modelLabel: "模型",
        introLabel: "介绍",
        responsibilityLabel: "职责",
        toolsLabel: "工具白名单",
        collaboratorsLabel: "允许协作 Agent",
        currentTask: "当前任务",
        noTask: "当前没有识别到结构化任务。",
        sessions: "会话数",
        blocked: "阻塞数",
        allowed: "协作范围",
        rosterTitle: "可指挥的团队名册",
        rosterCopy: "快速识别谁在承压、谁已阻塞、谁适合接下一单，再直接跳转到专属指挥页。",
        governanceTitle: "团队治理",
        governanceCopy: "在这里补齐角色、创建 Agent，再进入单独指挥页切换模型和执行策略。",
        workloadTitle: "重点关注队列",
        workloadCopy: "这些 Agent 最可能需要改派、介入或被你优先询问进展。",
        missingDesignLead: "当前受管团队里还没有设计总监 Jeremy。",
        fillJeremy: "填入 Jeremy 模板",
        currentModel: "当前模型",
        executionMode: "执行方式",
        confirmFirst: "执行前确认",
        tasksLabel: "任务数",
        updatedLabel: "最近更新"
      };

  if (error) {
    return <div className="card error-text">{error}</div>;
  }

  async function handleCreateAgent() {
    if (!newAgentId.trim() || !newAgentName.trim() || !newAgentTitle.trim()) {
      return;
    }

    try {
      setCreating(true);
      await api.createOpenClawAgent({
        agentId: newAgentId,
        name: newAgentName,
        title: newAgentTitle,
        model: newAgentModel,
        intro: newAgentIntro || undefined,
        responsibility: newAgentResponsibility || undefined,
        tools: splitCsv(newAgentTools),
        allowedAgentIds: splitCsv(newAgentAllowedAgents)
      });
      setNewAgentId("");
      setNewAgentName("");
      setNewAgentTitle("");
      setNewAgentModel("gpt-5.2");
      setNewAgentIntro("");
      setNewAgentResponsibility("");
      setNewAgentTools("");
      setNewAgentAllowedAgents("");
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  function applyJeremyPreset() {
    setNewAgentId("jeremy");
    setNewAgentName("Jeremy");
    setNewAgentTitle(isEnglish ? "Design Director" : "设计总监");
    setNewAgentModel("gpt-5.2");
    setNewAgentIntro(
      isEnglish
        ? "Leads product design direction, interaction quality, and final visual reviews."
        : "负责产品设计方向、交互质量与最终视觉评审。"
    );
    setNewAgentResponsibility(
      isEnglish
        ? "Own the design system, information hierarchy, UI consistency, and review of critical pages."
        : "负责设计系统、信息层级、界面一致性以及关键页面评审。"
    );
    setNewAgentTools("openclaw, rg, pnpm");
    setNewAgentAllowedAgents("product_owner, frontend_lead, backend_lead");
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Agent Center</p>
          <h2>{copy.title}</h2>
          <p className="hero-copy">{copy.hero}</p>
        </div>
        <div className="hero-inline-meta">
          <span className="muted-text">
            {copy.lastSynced}：{lastSyncedAt ? formatTime(lastSyncedAt, isEnglish ? "en-US" : "zh-CN") : "n/a"}
          </span>
          <button className="button button-ghost inline-button" onClick={() => void refresh()}>
            {copy.refresh}
          </button>
        </div>
      </header>

      <section className="agent-summary-grid">
        <MetricTile label={copy.activeTasks} value={String(activeTaskTotal)} />
        <MetricTile label={copy.autonomous} value={String(autonomousCount)} />
        <MetricTile label={copy.overloaded} value={String(overloadedCount)} tone="warning" />
        <MetricTile label={copy.runtime} value={health?.runtime.mode ?? "unknown"} />
      </section>

      <section className="agent-workbench">
        <div className="agent-workbench-main">
          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.rosterTitle}</p>
                <h3>{copy.rosterTitle}</h3>
                <p className="hero-copy">{copy.rosterCopy}</p>
              </div>
              <span className="pill">{sortedAgents.length}</span>
            </div>

            <div className="agent-roster-list">
              {sortedAgents.map((agent) => (
                <article className="agent-roster-row" key={agent.agentId}>
                  <div className="agent-roster-main">
                    <div className="agent-roster-head">
                      <div>
                        <div className="pill-row">
                          <span className={`status-badge status-${agent.status}`}>{agent.status}</span>
                          {agent.commander.executionMode === "autonomous" ? (
                            <span className="pill pill-primary">{copy.autonomous}</span>
                          ) : (
                            <span className="pill">{copy.confirmFirst}</span>
                          )}
                        </div>
                        <h3 className="agent-roster-title">{agent.emoji} {agent.name}</h3>
                      </div>
                      <Link className="button button-primary inline-button" to={`/agents/${agent.agentId}`}>
                        {copy.openCommander}
                      </Link>
                    </div>

                    <p className="highlight-text">{agent.title}</p>
                    <p className="agent-description">{agent.intro}</p>

                    <div className="agent-kpi-grid">
                      <div className="agent-kpi-card">
                        <span>{copy.currentTask}</span>
                        <strong>{agent.currentTask ? agent.currentTask.title : copy.noTask}</strong>
                        <span className="muted-text">{agent.currentTask ? agent.currentTask.projectName : agent.responsibility}</span>
                      </div>
                      <div className="agent-kpi-card">
                        <span>{copy.sessions}</span>
                        <strong>{agent.sessionCount}</strong>
                        <span className="muted-text">{copy.blocked} {agent.blockedTaskCount}</span>
                      </div>
                    </div>

                    <div className="pill-row">
                      {agent.availableModels.slice(0, 3).map((model) => (
                        <span className="pill" key={model.id}>
                          {model.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="agent-roster-side">
                    <MiniMeta label={copy.currentModel} value={agent.commander.selectedModel} />
                    <MiniMeta label={copy.executionMode} value={agent.commander.executionMode} />
                    <MiniMeta label={copy.tasksLabel} value={String(agent.taskCount)} />
                    <MiniMeta label={copy.allowed} value={String(agent.allowedAgentIds.length)} />
                    <MiniMeta label={copy.updatedLabel} value={agent.lastActiveAt ? formatTime(agent.lastActiveAt, isEnglish ? "en-US" : "zh-CN") : "-"} />
                  </div>
                </article>
              ))}
            </div>
          </article>
        </div>

        <aside className="agent-workbench-side">
          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.workloadTitle}</p>
                <h3>{copy.workloadTitle}</h3>
              </div>
            </div>
            <p className="hero-copy">{copy.workloadCopy}</p>
            <div className="attention-list">
              {overloadedAgents.map((agent) => (
                <article className="attention-card attention-warning" key={agent.agentId}>
                  <div className="timeline-head">
                    <strong>{agent.name}</strong>
                    <span className="pill pill-warning">{agent.taskCount}</span>
                  </div>
                  <p>{agent.currentTask?.title ?? agent.responsibility}</p>
                  <p>
                    {copy.blocked} {agent.blockedTaskCount} · {copy.sessions} {agent.sessionCount}
                  </p>
                </article>
              ))}
              {overloadedAgents.length === 0 ? (
                <p className="muted-text">{isEnglish ? "No overloaded agents right now." : "当前没有高负载 Agent。"}</p>
              ) : null}
            </div>
          </article>

          {health ? (
            <article className="card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">{copy.runtimeWatch}</p>
                  <h3>{copy.serviceHealth}</h3>
                </div>
              </div>
              <div className="agent-mini-list">
                {health.services.map((service) => (
                  <div key={service.name} className="agent-mini-card">
                    <div>
                      <strong>{service.name}</strong>
                      <p>{service.detail}</p>
                    </div>
                    <span className={`status-badge status-${service.status === "healthy" ? "completed" : "paused"}`}>
                      {service.status}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.governanceTitle}</p>
                <h3>{copy.createAgent}</h3>
              </div>
            </div>
            <p className="hero-copy">{copy.governanceCopy}</p>
            {!hasJeremy ? (
              <div className="attention-card attention-warning">
                <strong>{copy.missingDesignLead}</strong>
                <div className="action-row">
                  <button className="button button-ghost inline-button" onClick={applyJeremyPreset} type="button">
                    {copy.fillJeremy}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="form-grid">
              <label className="form-field">
                <span>{copy.agentId}</span>
                <input value={newAgentId} onChange={(event) => setNewAgentId(event.target.value)} placeholder="design_lead" />
              </label>
              <label className="form-field">
                <span>{copy.name}</span>
                <input value={newAgentName} onChange={(event) => setNewAgentName(event.target.value)} placeholder="Jeremy" />
              </label>
              <label className="form-field">
                <span>{copy.titleLabel}</span>
                <input value={newAgentTitle} onChange={(event) => setNewAgentTitle(event.target.value)} placeholder={isEnglish ? "Design Director" : "设计总监"} />
              </label>
              <label className="form-field">
                <span>{copy.modelLabel}</span>
                <input value={newAgentModel} onChange={(event) => setNewAgentModel(event.target.value)} placeholder="gpt-5.2" />
              </label>
              <label className="form-field">
                <span>{copy.introLabel}</span>
                <input value={newAgentIntro} onChange={(event) => setNewAgentIntro(event.target.value)} placeholder={isEnglish ? "Design reviews, UI system, design quality." : "负责设计评审、界面系统和体验质量。"} />
              </label>
              <label className="form-field">
                <span>{copy.responsibilityLabel}</span>
                <input value={newAgentResponsibility} onChange={(event) => setNewAgentResponsibility(event.target.value)} placeholder={isEnglish ? "Lead product design and review visual consistency." : "负责产品设计统筹与视觉一致性把控。"} />
              </label>
              <label className="form-field">
                <span>{copy.toolsLabel}</span>
                <input value={newAgentTools} onChange={(event) => setNewAgentTools(event.target.value)} placeholder="openclaw, rg, pnpm" />
              </label>
              <label className="form-field">
                <span>{copy.collaboratorsLabel}</span>
                <input value={newAgentAllowedAgents} onChange={(event) => setNewAgentAllowedAgents(event.target.value)} placeholder="jeremy, product_owner" />
              </label>
            </div>
            <div className="action-row">
              <button className="button button-primary" onClick={() => void handleCreateAgent()} disabled={creating}>
                {creating ? copy.creatingAgent : copy.createAgent}
              </button>
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatTime(timestamp: string, locale = "zh-CN") {
  return new Date(timestamp).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
