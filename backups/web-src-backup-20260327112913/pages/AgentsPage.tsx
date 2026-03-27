import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BrainCircuit, ChevronRight, Plus, RefreshCw, Search } from "lucide-react";
import type { OpenClawAgentSummary, SystemHealth } from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

type AgentFilter = "all" | "attention" | "autonomous" | "active";

export function AgentsPage() {
  const { isEnglish } = useLocale();
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AgentFilter>("all");
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

      const [agentList, healthInfo] = await Promise.all([api.getOpenClawAgents(), api.getSystemHealth()]);
      setAgents(agentList);
      setHealth(healthInfo);
      setLastSyncedAt(new Date().toISOString());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : (isEnglish ? "Failed to load agents" : "加载 Agent 失败"));
    }
  }

  const sortedAgents = useMemo(
    () =>
      [...agents].sort((left, right) => {
        const rightAttention = scoreAgentAttention(right);
        const leftAttention = scoreAgentAttention(left);
        if (rightAttention !== leftAttention) {
          return rightAttention - leftAttention;
        }

        return right.taskCount - left.taskCount;
      }),
    [agents]
  );

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return sortedAgents
      .filter((agent) => {
        if (filter === "attention") {
          return isAttentionAgent(agent);
        }
        if (filter === "autonomous") {
          return agent.commander.executionMode === "autonomous";
        }
        if (filter === "active") {
          return agent.status === "active";
        }
        return true;
      })
      .filter((agent) => {
        if (!normalizedQuery) {
          return true;
        }

        return `${agent.name} ${agent.title} ${agent.intro} ${agent.responsibility} ${agent.agentId}`.toLowerCase().includes(normalizedQuery);
      });
  }, [filter, query, sortedAgents]);

  const activeTaskTotal = agents.reduce((sum, agent) => sum + agent.taskCount, 0);
  const autonomousCount = agents.filter((agent) => agent.commander.executionMode === "autonomous").length;
  const overloadedCount = agents.filter(isAttentionAgent).length;
  const activeRosterCount = agents.filter((agent) => agent.status === "active").length;
  const overloadedAgents = useMemo(() => sortedAgents.filter(isAttentionAgent).slice(0, 5), [sortedAgents]);

  const hasJeremy = agents.some((agent) => {
    const normalizedId = agent.agentId.toLowerCase();
    const normalizedName = agent.name.toLowerCase();
    return normalizedId === "jeremy" || normalizedId === "design_director" || normalizedName.includes("jeremy");
  });
  const copy = isEnglish
    ? {
        title: "Live OpenClaw agent roster",
        hero: "The new AI Studio flow treats agents like a real operating roster: searchable, filterable, and always one click away from a dedicated command room.",
        lastSynced: "Last sync",
        refresh: "Refresh",
        createWorkspace: "Create agent",
        search: "Search agent, title, responsibility, or ID",
        activeTasks: "Structured tasks",
        autonomous: "Autonomous agents",
        overloaded: "Attention needed",
        liveNow: "Active right now",
        runtimeWatch: "Runtime watch",
        serviceHealth: "Service health",
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
        rosterCopy: "Use cards instead of raw rows so you can immediately read role, model, execution mode, load, and the next best command entry point.",
        orchestrationTitle: "Team orchestration",
        orchestrationCopy: "See how the team is split between autonomous execution, confirm-first work, and attention-required roles.",
        governanceTitle: "Roster governance",
        governanceCopy: "Create or patch team roles here, then open the dedicated commander page for model switching, confirmation mode, and memory setup.",
        workloadTitle: "Attention queue",
        workloadCopy: "These specialists are most likely to need reassignment, intervention, or a progress check.",
        missingDesignLead: "Design Director Jeremy is still missing from the managed roster.",
        fillJeremy: "Fill Jeremy preset",
        currentModel: "Current model",
        executionMode: "Execution",
        confirmFirst: "Confirm first",
        tasksLabel: "Tasks",
        updatedLabel: "Updated",
        all: "All",
        attention: "Attention",
        active: "Active",
        rosterEmpty: "No agents match the current filters."
      }
    : {
        title: "真实 OpenClaw Agent 团队总览",
        hero: "新的 AI Studio 方案把 Agent 页当成真实团队名册来设计，需要支持搜索、筛选、负载识别，以及一键进入专属指挥页。",
        lastSynced: "最近同步",
        refresh: "刷新状态",
        createWorkspace: "创建 Agent",
        search: "搜索 Agent、职位、职责或 ID",
        activeTasks: "结构化任务",
        autonomous: "自主执行 Agent",
        overloaded: "需要关注",
        liveNow: "当前活跃",
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
        rosterCopy: "用卡片而不是死板列表来展示角色、模型、执行模式、负载和下一步入口，这样才更像真正的团队操作台。",
        orchestrationTitle: "团队协作编排",
        orchestrationCopy: "用一张视图看到团队当前如何分布在自主执行、确认优先和重点关注三条协作轨道上。",
        governanceTitle: "团队治理",
        governanceCopy: "在这里补齐角色、创建 Agent，再进入单独指挥页切换模型和确认策略。",
        workloadTitle: "重点关注队列",
        workloadCopy: "这些 Agent 最可能需要改派、介入或被优先询问进展。",
        missingDesignLead: "当前受管团队里还没有设计总监 Jeremy。",
        fillJeremy: "填入 Jeremy 模板",
        currentModel: "当前模型",
        executionMode: "执行方式",
        confirmFirst: "执行前确认",
        tasksLabel: "任务数",
        updatedLabel: "最近更新",
        all: "全部",
        attention: "关注",
        active: "活跃",
        rosterEmpty: "当前筛选条件下没有 Agent。"
      };
  const orchestrationLanes = useMemo(
    () => [
      {
        key: "autonomous",
        title: copy.autonomous,
        agents: sortedAgents.filter((agent) => agent.commander.executionMode === "autonomous").slice(0, 4)
      },
      {
        key: "confirm",
        title: copy.confirmFirst,
        agents: sortedAgents.filter((agent) => agent.commander.executionMode === "confirm_first").slice(0, 4)
      },
      {
        key: "attention",
        title: copy.attention,
        agents: sortedAgents.filter(isAttentionAgent).slice(0, 4)
      }
    ],
    [copy.attention, copy.autonomous, copy.confirmFirst, sortedAgents]
  );

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
      setError(requestError instanceof Error ? requestError.message : (isEnglish ? "Failed to create agent" : "创建 Agent 失败"));
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
      <header className="page-header studio-page-header bg-[#16191E]/70 backdrop-blur-xl rounded-2xl p-6 border border-white/[0.06]">
        <div>
          <p className="eyebrow">Agent Studio</p>
          <h2>{copy.title}</h2>
          <p className="hero-copy">{copy.hero}</p>
        </div>
        <div className="studio-header-actions">
          <label className="studio-search-field" aria-label={copy.search}>
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} />
          </label>
          <span className="muted-text">
            {copy.lastSynced} {lastSyncedAt ? formatTime(lastSyncedAt, isEnglish ? "en-US" : "zh-CN") : "n/a"}
          </span>
          <button className="button button-ghost inline-button" onClick={() => void refresh()}>
            <RefreshCw size={16} />
            {copy.refresh}
          </button>
        </div>
      </header>

      <section className="studio-kpi-grid">
        <MetricTile label={copy.activeTasks} value={String(activeTaskTotal)} />
        <MetricTile label={copy.autonomous} value={String(autonomousCount)} />
        <MetricTile label={copy.overloaded} value={String(overloadedCount)} tone="warning" />
        <MetricTile label={copy.liveNow} value={String(activeRosterCount)} />
      </section>

      <section className="portfolio-command-grid">
        <div className="portfolio-command-main">
          <article className="card studio-command-card studio-catalog-toolbar-card rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.rosterTitle}</p>
                <h3>{copy.rosterTitle}</h3>
                <p className="hero-copy">{copy.rosterCopy}</p>
              </div>
              <span className="pill pill-primary">{filteredAgents.length}</span>
            </div>

            <div className="studio-filter-stack">
              <div className="pill-row">
                {(["all", "attention", "autonomous", "active"] as AgentFilter[]).map((item) => (
                  <button
                    key={item}
                    className={filter === item ? "filter-pill filter-pill-active" : "filter-pill"}
                    onClick={() => setFilter(item)}
                  >
                    {filterLabel(item, copy)}
                  </button>
                ))}
              </div>
            </div>
          </article>

          <div className="studio-catalog-grid">
            {filteredAgents.map((agent) => (
              <AgentStudioCard key={agent.agentId} agent={agent} copy={copy} isEnglish={isEnglish} />
            ))}
            {filteredAgents.length === 0 ? <div className="empty-state">{copy.rosterEmpty}</div> : null}
          </div>
        </div>

        <aside className="portfolio-command-rail">
          <article className="card studio-side-card rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.orchestrationTitle}</p>
                <h3>{copy.orchestrationTitle}</h3>
              </div>
            </div>
            <p className="hero-copy">{copy.orchestrationCopy}</p>
            <div className="orchestration-lanes">
              {orchestrationLanes.map((lane) => (
                <div className="orchestration-lane" key={lane.key}>
                  <div className="timeline-head">
                    <strong>{lane.title}</strong>
                    <span className="pill">{lane.agents.length}</span>
                  </div>
                  <div className="stack tight">
                    {lane.agents.map((agent) => (
                      <Link key={agent.agentId} to={`/agents/${agent.agentId}`} className="orchestration-lane-card">
                        <div className="timeline-head">
                          <strong>{agent.emoji} {agent.name}</strong>
                          <span className={`status-badge status-${agent.status}`}>{presenceLabel(agent.status, isEnglish)}</span>
                        </div>
                        <p>{agent.currentTask?.title ?? agent.responsibility}</p>
                        <span className="muted-text">{agent.commander.selectedModel}</span>
                      </Link>
                    ))}
                    {lane.agents.length === 0 ? <p className="muted-text">{isEnglish ? "No agents in this lane." : "该轨道当前没有 Agent。"}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="card studio-side-card rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
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
            <article className="card studio-side-card rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
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

          <article className="card studio-side-card rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
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
                <Plus size={16} />
                {creating ? copy.creatingAgent : copy.createAgent}
              </button>
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

function AgentStudioCard({
  agent,
  copy,
  isEnglish
}: {
  agent: OpenClawAgentSummary;
  copy: Record<string, string>;
  isEnglish: boolean;
}) {
  const attention = isAttentionAgent(agent);

  return (
    <article className={`studio-catalog-card rounded-2xl bg-[#1C2128]/70 backdrop-blur-md border border-white/[0.06] hover:border-emerald-500/30 hover:shadow-lg hover:shadow-black/20 transition-all duration-200 ${attention ? "border-amber-500/30 studio-catalog-card-warning" : ""}`}>
      <div className={`studio-catalog-accent ${attention ? "studio-catalog-accent-paused" : "studio-catalog-accent-working"}`} />
      <div className="studio-catalog-card-body">
        <div className="studio-catalog-card-head">
          <div className="studio-catalog-icon bg-[#10B981]/10 rounded-2xl">
            <BrainCircuit size={24} />
          </div>
          <div className="studio-catalog-badges">
            <span className={`status-badge status-${agent.status}`}>{presenceLabel(agent.status, isEnglish)}</span>
            {agent.commander.executionMode === "autonomous" ? <span className="pill pill-primary">{copy.autonomous}</span> : null}
          </div>
        </div>

        <div className="studio-catalog-copy">
          <p className="project-id">{agent.agentId}</p>
          <h3>{agent.emoji} {agent.name}</h3>
          <p className="studio-catalog-subtitle">{agent.title}</p>
          <p>{agent.intro || agent.responsibility}</p>
        </div>

        <div className="studio-catalog-focus">
          <span>{copy.currentTask}</span>
          <strong>{agent.currentTask ? agent.currentTask.title : copy.noTask}</strong>
          <span className="muted-text">{agent.currentTask ? agent.currentTask.projectName : agent.responsibility}</span>
        </div>

        <div className="studio-catalog-inline-metrics">
          <MiniMeta label={copy.currentModel} value={agent.commander.selectedModel} />
          <MiniMeta label={copy.tasksLabel} value={String(agent.taskCount)} />
        </div>

        <div className="studio-catalog-footer">
          <div className="studio-catalog-team">
            <div className="studio-mini-chip">
              <span>{copy.sessions} {agent.sessionCount}</span>
            </div>
            <div className="studio-mini-chip">
              <span>{copy.blocked} {agent.blockedTaskCount}</span>
            </div>
          </div>
          <Link className="studio-card-arrow rounded-xl bg-white/5 hover:bg-emerald-500/20" to={`/agents/${agent.agentId}`}>
            <ChevronRight size={18} />
          </Link>
        </div>
      </div>
    </article>
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
    <div className={`metric-card metric-${tone} bg-[#1C2128]/60 backdrop-blur-md rounded-2xl border border-white/[0.06] hover:border-emerald-500/30 transition-all duration-200`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="showcase-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function filterLabel(filter: AgentFilter, copy: Record<string, string>) {
  if (filter === "all") {
    return copy.all;
  }
  if (filter === "attention") {
    return copy.attention;
  }
  if (filter === "active") {
    return copy.active;
  }

  return copy.autonomous;
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

function isAttentionAgent(agent: OpenClawAgentSummary) {
  return agent.status === "attention" || agent.taskCount >= 3 || agent.blockedTaskCount > 0;
}

function scoreAgentAttention(agent: OpenClawAgentSummary) {
  return agent.blockedTaskCount * 10 + agent.taskCount + (agent.status === "attention" ? 5 : 0);
}

function presenceLabel(status: string, isEnglish: boolean) {
  const labels = isEnglish
    ? { active: "Active", idle: "Idle", offline: "Offline", attention: "Attention" }
    : { active: "活跃", idle: "空闲", offline: "离线", attention: "关注" };

  return labels[status as keyof typeof labels] ?? status;
}
