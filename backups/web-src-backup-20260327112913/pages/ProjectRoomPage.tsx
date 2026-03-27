import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  type PromptTemplate,
  type PromptTemplateChannel,
  type ProjectDetail,
  type ProjectStatus,
  type RoleType,
  type RuntimeMode,
  type StageStatus,
  type StageType,
  type Task,
  type TaskStatus,
  type TimelineEvent
} from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";
import { getRoleLabel, getStageLabel } from "../lib/uiLabels";

type LiveMeta = {
  title: string;
  activeRole: RoleType;
  startedAt: string;
  provider: RuntimeMode;
};

type BusyAction = "approve" | "reject" | "intervene" | "resume" | "message" | "submit" | "task" | null;
type FlashState = { tone: "success" | "error"; message: string } | null;
type TaskStageFilter = "ALL" | StageType;

const PROJECT_ROOM_DEFAULTS = {
  command: {
    "zh-CN": "调整方向：先做单用户 MVP，再逐步接数据库与真实 Agent。",
    "en-US": "Adjust direction: start with a single-user MVP, then connect the database and real agents step by step."
  },
  message: {
    "zh-CN": "请继续推进，但把交付物写得更便于我快速审批。",
    "en-US": "Please keep moving, but write the deliverables in a way that makes approval faster for me."
  },
  rejectReason: {
    "zh-CN": "请补充更清晰的阶段输入输出、验收标准与下一阶段依赖。",
    "en-US": "Please add clearer stage inputs and outputs, acceptance criteria, and next-stage dependencies."
  },
  deliverableContent: {
    "zh-CN": "## 当前阶段交付物\n\n- 已完成本阶段关键分析\n- 已补齐可执行建议\n- 建议进入下一阶段继续推进",
    "en-US": "## Current Stage Deliverable\n\n- Key analysis for this stage is complete\n- Actionable recommendations have been added\n- Recommend moving to the next stage"
  }
} as const;

export function ProjectRoomPage() {
  const { projectId = "" } = useParams();
  const { isEnglish, locale } = useLocale();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [liveOutput, setLiveOutput] = useState("");
  const [liveMeta, setLiveMeta] = useState<LiveMeta | null>(null);
  const [notes, setNotes] = useState<TimelineEvent[]>([]);
  const [taskStageFilter, setTaskStageFilter] = useState<TaskStageFilter>("ALL");
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [command, setCommand] = useState<string>(PROJECT_ROOM_DEFAULTS.command[locale]);
  const [message, setMessage] = useState<string>(PROJECT_ROOM_DEFAULTS.message[locale]);
  const [rejectReason, setRejectReason] = useState<string>(PROJECT_ROOM_DEFAULTS.rejectReason[locale]);
  const [deliverableTitle, setDeliverableTitle] = useState("");
  const [deliverableContent, setDeliverableContent] = useState<string>(PROJECT_ROOM_DEFAULTS.deliverableContent[locale]);
  const [templates, setTemplates] = useState<Record<PromptTemplateChannel, PromptTemplate[]>>({
    project_room_guidance: [],
    project_room_emergency: [],
    project_room_deliverable: [],
    openclaw_agent: [],
    openclaw_batch: []
  });
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [flash, setFlash] = useState<FlashState>(null);

  const copy = isEnglish
    ? {
        loading: "Loading project room...",
        notFound: "Project not found",
        loadFailed: "Failed to load project",
        taskUpdateFailed: "Failed to update task",
        approveFailed: "Approval failed",
        interveneFailed: "Intervention failed",
        rejectFailed: "Rework request failed",
        resumeFailed: "Resume failed",
        messageFailed: "Failed to send message",
        submitFailed: "Failed to submit deliverable",
        back: "Back to dashboard",
        eyebrow: "Project Room",
        refresh: "Refresh status",
        currentRole: "Current role",
        progress: "Progress",
        runtime: "Runtime",
        approval: "Approval",
        updated: "Updated",
        waitingApproval: "Waiting approval",
        advancing: "Advancing",
        project: "Project",
        teamRelay: "Team relay",
        onStage: "On stage",
        taskOverview: "Task overview",
        totalTasks: "Total",
        inProgress: "In progress",
        blocked: "Blocked",
        liveObservation: "Live observation",
        connecting: "Agent is reconnecting to the live stream...",
        currentDeliverables: "Current deliverables",
        noDeliverables: "No deliverables have been submitted for this stage yet.",
        taskBoard: "Task board",
        taskBoardCopy: "Update task states directly and write changes back in real time.",
        all: "All",
        noTasks: "No tasks under the current filter.",
        updatedAt: "Updated",
        understanding: "Intent understanding",
        constraints: "Constraints",
        risks: "Risks",
        keywords: "Keywords",
        gate: "Gate",
        controlArea: "Control area",
        approvalTitle: "This stage is ready and waiting for your decision.",
        approve: "Approve next stage",
        approving: "Approving...",
        reject: "Send back for rework",
        rejecting: "Sending back...",
        sendGuidance: "Send guidance",
        sendToCurrentAgent: "Send to current agent",
        sending: "Sending...",
        submitStage: "Submit current stage",
        deliverableNamePlaceholder: "Deliverable title (optional)",
        submitForApproval: "Submit for approval",
        submitting: "Submitting...",
        emergency: "Emergency intervention",
        pauseAndCommand: "Pause and inject command",
        pausing: "Pausing...",
        resume: "Resume project",
        resuming: "Resuming...",
        live: "Live",
        risk: "Risk",
        timeline: "Ops timeline",
        projectApproved: "Current stage approved. The project has moved on.",
        projectPaused: "Project paused. The intervention command was recorded.",
        projectRejected: "Current stage was sent back for rework and synced to the active agent.",
        projectResumed: "Project resumed.",
        messageSent: "Guidance message was delivered to the active agent.",
        deliverableSubmitted: "Stage deliverable submitted and waiting for approval.",
        taskUpdated: "Task updated to",
        taskStatus: {
          todo: "To do",
          in_progress: "In progress",
          blocked: "Blocked",
          done: "Done"
        } as Record<TaskStatus, string>
      }
    : {
        loading: "正在载入项目观测室...",
        notFound: "项目不存在",
        loadFailed: "加载项目失败",
        taskUpdateFailed: "任务更新失败",
        approveFailed: "批准失败",
        interveneFailed: "介入失败",
        rejectFailed: "退回失败",
        resumeFailed: "恢复失败",
        messageFailed: "发送消息失败",
        submitFailed: "提交失败",
        back: "返回仪表盘",
        eyebrow: "项目作战室",
        refresh: "刷新状态",
        currentRole: "当前角色",
        progress: "进度",
        runtime: "运行时",
        approval: "审批",
        updated: "最近更新",
        waitingApproval: "待审批",
        advancing: "推进中",
        project: "项目",
        teamRelay: "团队接力",
        onStage: "在场",
        taskOverview: "任务总览",
        totalTasks: "总任务",
        inProgress: "进行中",
        blocked: "阻塞",
        liveObservation: "实时观测",
        connecting: "Agent 正在连接实时流，请稍候...",
        currentDeliverables: "当前交付物",
        noDeliverables: "当前阶段还没有交付物。",
        taskBoard: "任务看板",
        taskBoardCopy: "支持直接修改任务状态，实时回写数据库。",
        all: "全部",
        noTasks: "当前筛选下没有任务。",
        updatedAt: "更新于",
        understanding: "理解确认",
        constraints: "约束",
        risks: "风险",
        keywords: "关键词",
        gate: "审批闸口",
        controlArea: "控制区",
        approvalTitle: "当前阶段已完成，等待你的批准。",
        approve: "批准进入下一阶段",
        approving: "批准中...",
        reject: "退回返工",
        rejecting: "退回中...",
        sendGuidance: "发送指导",
        sendToCurrentAgent: "发给当前 Agent",
        sending: "发送中...",
        submitStage: "提交当前阶段",
        deliverableNamePlaceholder: "交付物名称，可选",
        submitForApproval: "提交并进入待审批",
        submitting: "提交中...",
        emergency: "紧急介入",
        pauseAndCommand: "暂停并下发指令",
        pausing: "暂停中...",
        resume: "恢复项目",
        resuming: "恢复中...",
        live: "实时",
        risk: "风险",
        timeline: "战情时间轴",
        projectApproved: "已批准当前阶段，项目已继续推进。",
        projectPaused: "项目已暂停，新的介入指令已经写入时间轴。",
        projectRejected: "当前阶段已退回返工，返工理由已同步给 Agent。",
        projectResumed: "项目已恢复执行。",
        messageSent: "指导消息已发送给当前 Agent。",
        deliverableSubmitted: "阶段交付物已提交，等待审批。",
        taskUpdated: "任务已更新为",
        taskStatus: {
          todo: "待开始",
          in_progress: "进行中",
          blocked: "阻塞",
          done: "完成"
        } as Record<TaskStatus, string>
      };

  useEffect(() => {
    setCommand((current) =>
      Object.values(PROJECT_ROOM_DEFAULTS.command).includes(current as (typeof PROJECT_ROOM_DEFAULTS.command)[keyof typeof PROJECT_ROOM_DEFAULTS.command])
        ? PROJECT_ROOM_DEFAULTS.command[locale]
        : current
    );
    setMessage((current) =>
      Object.values(PROJECT_ROOM_DEFAULTS.message).includes(current as (typeof PROJECT_ROOM_DEFAULTS.message)[keyof typeof PROJECT_ROOM_DEFAULTS.message])
        ? PROJECT_ROOM_DEFAULTS.message[locale]
        : current
    );
    setRejectReason((current) =>
      Object.values(PROJECT_ROOM_DEFAULTS.rejectReason).includes(current as (typeof PROJECT_ROOM_DEFAULTS.rejectReason)[keyof typeof PROJECT_ROOM_DEFAULTS.rejectReason])
        ? PROJECT_ROOM_DEFAULTS.rejectReason[locale]
        : current
    );
    setDeliverableContent((current) =>
      Object.values(PROJECT_ROOM_DEFAULTS.deliverableContent).includes(current as (typeof PROJECT_ROOM_DEFAULTS.deliverableContent)[keyof typeof PROJECT_ROOM_DEFAULTS.deliverableContent])
        ? PROJECT_ROOM_DEFAULTS.deliverableContent[locale]
        : current
    );
  }, [locale]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    void (async () => {
      try {
        const [guidance, emergency, deliverable] = await Promise.all([
          api.getPromptTemplates("project_room_guidance", locale, projectId),
          api.getPromptTemplates("project_room_emergency", locale, projectId),
          api.getPromptTemplates("project_room_deliverable", locale, projectId)
        ]);
        setTemplates((current) => ({
          ...current,
          project_room_guidance: guidance,
          project_room_emergency: emergency,
          project_room_deliverable: deliverable
        }));
      } catch {
        // keep the room usable even if templates fail to load
      }
    })();
  }, [locale, projectId]);

  async function refresh(options?: { resetStream?: boolean; silent?: boolean }) {
    if (!projectId) {
      return;
    }

    try {
      if (!options?.silent) {
        setLoading(true);
      }

      const [detail, tasks] = await Promise.all([api.getProject(projectId), api.getProjectTasks(projectId)]);
      const nextProject: ProjectDetail = {
        ...detail,
        tasks
      };

      setProject(nextProject);
      setNotes(nextProject.timeline);
      setTaskStageFilter((current) => (current === "ALL" ? current : nextProject.currentStage));
      setPageError(null);

      if (options?.resetStream) {
        setLiveOutput("");
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : copy.loadFailed;
      if (project) {
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
    void refresh({ resetStream: true });
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 8000);

    return () => window.clearInterval(timer);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    setLiveOutput("");
    const source = new EventSource(api.liveUrl(projectId));

    source.addEventListener("session", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as LiveMeta;
      setLiveMeta(payload);
    });

    source.addEventListener("agent_typing", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { delta: string };
      setLiveOutput((current) => current + payload.delta);
    });

    source.addEventListener("thinking_step", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { content: string };
      setNotes((current) => [
        {
          id: `live-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: "thinking",
          title: isEnglish ? "Live reasoning" : "实时推演",
          content: payload.content,
          priority: "normal"
        },
        ...current
      ]);
    });

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [projectId, project?.liveSession.startedAt, isEnglish]);

  const currentDeliverables = useMemo(
    () => project?.deliverables.filter((item) => item.stageType === project.currentStage) ?? [],
    [project]
  );

  const visibleTasks = useMemo(() => {
    if (!project) {
      return [];
    }

    if (taskStageFilter === "ALL") {
      return project.tasks;
    }

    return project.tasks.filter((item) => item.stageType === taskStageFilter);
  }, [project, taskStageFilter]);

  const taskSummary = useMemo(() => {
    const items = project?.tasks ?? [];
    return {
      total: items.length,
      todo: items.filter((item) => item.status === "todo").length,
      inProgress: items.filter((item) => item.status === "in_progress").length,
      blocked: items.filter((item) => item.status === "blocked").length,
      done: items.filter((item) => item.status === "done").length
    };
  }, [project?.tasks]);

  const projectRiskTone = useMemo(() => {
    if (!project) {
      return "low" as const;
    }
    if (project.pendingApproval || project.tasks.some((item) => item.status === "blocked")) {
      return "high" as const;
    }
    if (project.tasks.some((item) => item.status === "in_progress")) {
      return "medium" as const;
    }
    return "low" as const;
  }, [project]);

  async function handleApprove() {
    if (!projectId) {
      return;
    }

    setBusyAction("approve");
    setFlash(null);
    try {
      const next = await api.approveProject(projectId);
      setProject(next);
      setNotes(next.timeline);
      setTaskStageFilter(next.currentStage);
      setLiveOutput("");
      setFlash({ tone: "success", message: copy.projectApproved });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : copy.approveFailed
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleIntervene() {
    if (!projectId) {
      return;
    }

    setBusyAction("intervene");
    setFlash(null);
    try {
      const next = await api.interveneProject(projectId, command);
      setProject(next);
      setNotes(next.timeline);
      setFlash({ tone: "success", message: copy.projectPaused });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : copy.interveneFailed
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReject() {
    if (!projectId) {
      return;
    }

    setBusyAction("reject");
    setFlash(null);
    try {
      const next = await api.rejectProject(projectId, { reason: rejectReason });
      setProject(next);
      setNotes(next.timeline);
      setLiveOutput("");
      setFlash({ tone: "success", message: copy.projectRejected });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : copy.rejectFailed
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleResume() {
    if (!projectId) {
      return;
    }

    setBusyAction("resume");
    setFlash(null);
    try {
      const next = await api.resumeProject(projectId);
      setProject(next);
      setNotes(next.timeline);
      setLiveOutput("");
      setFlash({ tone: "success", message: copy.projectResumed });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : copy.resumeFailed
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSendMessage() {
    if (!projectId) {
      return;
    }

    setBusyAction("message");
    setFlash(null);
    try {
      const next = await api.sendMessage(projectId, { message });
      setProject(next);
      setNotes(next.timeline);
      setLiveOutput("");
      setFlash({ tone: "success", message: copy.messageSent });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : copy.messageFailed
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSubmitStage() {
    if (!projectId) {
      return;
    }

    setBusyAction("submit");
    setFlash(null);
    try {
      const next = await api.submitStage(projectId, {
        title: deliverableTitle || undefined,
        content: deliverableContent
      });
      setProject(next);
      setNotes(next.timeline);
      setLiveOutput("");
      setFlash({ tone: "success", message: copy.deliverableSubmitted });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : copy.submitFailed
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTaskStatus(task: Task, status: TaskStatus) {
    if (task.status === status) {
      return;
    }

    setBusyAction("task");
    setUpdatingTaskId(task.id);
    setFlash(null);
    try {
      await api.updateTask(task.id, { status });
      await refresh({ silent: true });
      setFlash({ tone: "success", message: `${task.title} · ${copy.taskUpdated} ${copy.taskStatus[status]}` });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : copy.taskUpdateFailed
      });
    } finally {
      setBusyAction(null);
      setUpdatingTaskId(null);
    }
  }

  async function handleUseTemplate(channel: "project_room_guidance" | "project_room_emergency" | "project_room_deliverable", template: PromptTemplate) {
    await api.markPromptTemplateUsed(template.id);
    if (channel === "project_room_guidance") {
      setMessage(template.content);
      return;
    }
    if (channel === "project_room_deliverable") {
      setDeliverableContent(template.content);
      return;
    }
    setCommand(template.content);
  }

  async function handleSaveTemplate(channel: "project_room_guidance" | "project_room_emergency" | "project_room_deliverable", scope: "project" | "personal") {
    const content = channel === "project_room_guidance"
      ? message
      : channel === "project_room_deliverable"
        ? deliverableContent
        : command;
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }

    const created = await api.createPromptTemplate({
      title: buildTemplateTitle(trimmed, channel, locale),
      content: trimmed,
      scope,
      channel,
      locale,
      projectId: scope === "project" ? projectId : undefined,
      ownerLabel: "Commander"
    });

    setTemplates((current) => ({
      ...current,
      [channel]: [created, ...current[channel]]
    }));
  }

  if (loading) {
    return <div className="card">{copy.loading}</div>;
  }

  if (pageError || !project) {
    return <div className="card error-text">{pageError ?? copy.notFound}</div>;
  }

  return (
    <div className="page project-room">
      <section className="project-room-hero">
        <div className="project-room-hero-main">
          <div className="project-room-hero-topline">
            <Link to="/" className="button button-ghost inline-button">
              {copy.back}
            </Link>
            <span className="pill pill-success">{copy.live}</span>
            <span className={project.pendingApproval ? "pill pill-warning" : "pill pill-primary"}>
              {project.pendingApproval ? copy.waitingApproval : projectStatusLabel(project.status, isEnglish)}
            </span>
            <span className={projectRiskTone === "high" ? "pill pill-danger" : projectRiskTone === "medium" ? "pill pill-warning" : "pill pill-success"}>
              {copy.risk} · {projectRiskTone}
            </span>
          </div>

          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h2>{project.name}</h2>
            <p className="hero-copy">{project.description}</p>
          </div>

          <div className="project-room-hero-meta">
            <div className="project-room-hero-stat">
              <span>{copy.currentRole}</span>
              <strong>{getRoleLabel(project.currentRole, locale)}</strong>
            </div>
            <div className="project-room-hero-stat">
              <span>{copy.progress}</span>
              <strong>{project.progress}%</strong>
            </div>
            <div className="project-room-hero-stat">
              <span>{copy.runtime}</span>
              <strong>{liveMeta?.provider ?? project.liveSession.provider}</strong>
            </div>
          </div>
        </div>

        <div className="project-room-hero-actions">
          <button className="button button-ghost" onClick={() => void refresh({ resetStream: true })}>
            {copy.refresh}
          </button>
          {project.pendingApproval ? (
            <>
              <button className="button button-primary" onClick={() => void handleApprove()} disabled={busyAction !== null}>
                {busyAction === "approve" ? copy.approving : copy.approve}
              </button>
              <button className="button button-ghost" onClick={() => void handleReject()} disabled={busyAction !== null}>
                {busyAction === "reject" ? copy.rejecting : copy.reject}
              </button>
            </>
          ) : (
            <>
              <button className="button button-danger" onClick={() => void handleIntervene()} disabled={busyAction !== null}>
                {busyAction === "intervene" ? copy.pausing : copy.pauseAndCommand}
              </button>
              <button className="button button-ghost" onClick={() => void handleResume()} disabled={busyAction !== null}>
                {busyAction === "resume" ? copy.resuming : copy.resume}
              </button>
            </>
          )}
        </div>
      </section>

      {flash ? (
        <section className={flash.tone === "success" ? "flash-banner flash-success" : "flash-banner flash-error"}>
          {flash.message}
        </section>
      ) : null}

      <section className="meta-strip meta-strip-wide">
        <div className="meta-chip">
          <span className="eyebrow">{copy.currentRole}</span>
          <strong>{getRoleLabel(project.currentRole, locale)}</strong>
        </div>
        <div className="meta-chip">
          <span className="eyebrow">{copy.progress}</span>
          <strong>{project.progress}%</strong>
        </div>
        <div className="meta-chip">
          <span className="eyebrow">{copy.runtime}</span>
          <strong>{liveMeta?.provider ?? project.liveSession.provider}</strong>
        </div>
        <div className="meta-chip">
          <span className="eyebrow">{copy.approval}</span>
          <strong>{project.pendingApproval ? copy.waitingApproval : copy.advancing}</strong>
        </div>
        <div className="meta-chip">
          <span className="eyebrow">{copy.updated}</span>
          <strong>{formatTime(project.updatedAt, locale)}</strong>
        </div>
      </section>

      <div className="room-grid">
        <aside className="card stage-sidebar">
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.project}</p>
              <h3>{project.id}</h3>
            </div>
            <span className={`status-badge status-${project.status}`}>{projectStatusLabel(project.status, isEnglish)}</span>
          </div>

          <div className="stack tight">
            {project.stages.map((stage) => (
              <div
                key={stage.type}
                className={stage.type === project.currentStage ? "stage-item stage-item-active" : "stage-item"}
              >
                <div>
                  <strong>{getStageLabel(stage.type, locale)}</strong>
                  <p>{getRoleLabel(stage.assignee, locale)}</p>
                </div>
                <span className={`pill pill-${stage.status}`}>{stageStatusLabel(stage.status, isEnglish)}</span>
              </div>
            ))}
          </div>

          <div className="sub-card team-panel">
            <p className="group-title">{copy.teamRelay}</p>
            {project.team.map((role) => (
              <div key={role} className="agent-mini-card">
                <strong>{getRoleLabel(role, locale)}</strong>
                <span className={role === project.currentRole ? "pill pill-primary" : "pill"}>{copy.onStage}</span>
              </div>
            ))}
          </div>

          <div className="sub-card">
            <p className="group-title">{copy.taskOverview}</p>
            <div className="metric-inline-grid">
              <MetricInline label={copy.totalTasks} value={String(taskSummary.total)} />
              <MetricInline label={copy.inProgress} value={String(taskSummary.inProgress)} />
              <MetricInline label={copy.blocked} value={String(taskSummary.blocked)} />
            </div>
          </div>
        </aside>

        <section className="card live-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.liveObservation}</p>
              <h3>{liveMeta?.title ?? project.liveSession.title}</h3>
            </div>
            <div className="live-status">
              <span className="status-dot status-live" />
              {getRoleLabel(liveMeta?.activeRole ?? project.currentRole, locale)}
            </div>
          </div>

          <div className="live-console">
            <pre>
              {liveOutput || (project.status === "paused" ? project.liveSession.body : copy.connecting)}
            </pre>
          </div>

          <div className="split-panels">
            <div className="sub-card">
              <p className="group-title">{copy.currentDeliverables}</p>
              {currentDeliverables.map((deliverable) => (
                <article key={deliverable.id} className="deliverable-card">
                  <div className="deliverable-head">
                    <strong>{deliverable.name}</strong>
                    <span className="pill">v{deliverable.version}</span>
                  </div>
                  <div className="deliverable-meta">
                    <span className="pill">{deliverableStatusLabel(deliverable.status, isEnglish)}</span>
                    <span className="pill">{getRoleLabel(deliverable.createdBy, locale)}</span>
                  </div>
                  <p>{deliverable.content}</p>
                </article>
              ))}
              {currentDeliverables.length === 0 ? <p className="muted-text">{copy.noDeliverables}</p> : null}
            </div>

            <div className="sub-card">
              <div className="section-header">
                <div>
                  <p className="group-title">{copy.taskBoard}</p>
                  <p className="muted-text">{copy.taskBoardCopy}</p>
                </div>
              </div>
              <div className="filter-row">
                <button
                  className={taskStageFilter === "ALL" ? "filter-pill filter-pill-active" : "filter-pill"}
                  onClick={() => setTaskStageFilter("ALL")}
                >
                  {copy.all}
                </button>
                {project.stages.map((stage) => (
                  <button
                    key={stage.type}
                    className={taskStageFilter === stage.type ? "filter-pill filter-pill-active" : "filter-pill"}
                    onClick={() => setTaskStageFilter(stage.type)}
                  >
                    {getStageLabel(stage.type, locale)}
                  </button>
                ))}
              </div>
              <div className="task-summary-strip">
                <span className="pill">{taskSummary.todo} {copy.taskStatus.todo}</span>
                <span className="pill pill-primary">{taskSummary.inProgress} {copy.taskStatus.in_progress}</span>
                <span className="pill pill-danger">{taskSummary.blocked} {copy.taskStatus.blocked}</span>
                <span className="pill pill-completed">{taskSummary.done} {copy.taskStatus.done}</span>
              </div>
              <div className="task-list">
                {visibleTasks.map((task) => (
                  <article key={task.id} className="task-card">
                    <div className="deliverable-head">
                      <div>
                        <strong>{task.title}</strong>
                        <p className="muted-text">{getStageLabel(task.stageType, locale)}</p>
                      </div>
                      <span className={`pill pill-task-${task.status}`}>{copy.taskStatus[task.status]}</span>
                    </div>
                    <p>{task.description}</p>
                    <div className="task-meta">
                      <span className="pill">{getRoleLabel(task.assignee, locale)}</span>
                      <span className={task.priority === "high" ? "pill pill-warning" : "pill"}>
                        {taskPriorityLabel(task.priority, isEnglish)}
                      </span>
                      <span className="muted-text">{copy.updatedAt} {formatTime(task.updatedAt, locale)}</span>
                    </div>
                    <div className="action-row action-row-wrap">
                      {(["todo", "in_progress", "blocked", "done"] as TaskStatus[]).map((status) => (
                        <button
                          key={status}
                          className={status === "done" ? "button button-primary" : "button button-ghost"}
                          onClick={() => void handleTaskStatus(task, status)}
                          disabled={busyAction !== null || updatingTaskId === task.id || task.status === status}
                        >
                          {updatingTaskId === task.id && task.status !== status
                            ? isEnglish ? "Updating..." : "更新中..."
                            : copy.taskStatus[status]}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
                {visibleTasks.length === 0 ? <p className="muted-text">{copy.noTasks}</p> : null}
              </div>
            </div>

            <div className="sub-card">
              <p className="group-title">{copy.understanding}</p>
              <p>{project.parsedIntent.summary}</p>
              <p className="group-title">{copy.constraints}</p>
              <div className="pill-row">
                {project.parsedIntent.constraints.map((item) => (
                  <span className="pill pill-warning" key={item}>
                    {item}
                  </span>
                ))}
              </div>
              <p className="group-title">{copy.risks}</p>
              <div className="pill-row">
                {project.parsedIntent.risks.map((item) => (
                  <span className="pill pill-danger" key={item}>
                    {item}
                  </span>
                ))}
              </div>
              <p className="group-title">{copy.keywords}</p>
              <div className="pill-row">
                {project.parsedIntent.keywords.map((keyword) => (
                  <span className="pill" key={keyword}>
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="stack">
          <div className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.gate}</p>
                <h3>{copy.controlArea}</h3>
              </div>
            </div>

            {project.pendingApproval ? (
              <div className="approval-panel">
                <p className="highlight-text">{copy.approvalTitle}</p>
                <textarea
                  className="composer-textarea compact"
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                />
                <div className="action-row action-row-wrap">
                  <button
                    className="button button-primary"
                    onClick={() => void handleApprove()}
                    disabled={busyAction !== null}
                  >
                    {busyAction === "approve" ? copy.approving : copy.approve}
                  </button>
                  <button
                    className="button button-ghost"
                    onClick={() => void handleReject()}
                    disabled={busyAction !== null}
                  >
                    {busyAction === "reject" ? copy.rejecting : copy.reject}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="intervention-panel">
              <p className="group-title">{copy.sendGuidance}</p>
              <PromptTemplateToolbar
                templates={templates.project_room_guidance}
                locale={locale}
                onUse={(template) => void handleUseTemplate("project_room_guidance", template)}
                onSaveProject={() => void handleSaveTemplate("project_room_guidance", "project")}
                onSavePersonal={() => void handleSaveTemplate("project_room_guidance", "personal")}
              />
              <textarea
                className="composer-textarea compact"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <button
                className="button button-primary"
                onClick={() => void handleSendMessage()}
                disabled={busyAction !== null}
              >
                {busyAction === "message" ? copy.sending : copy.sendToCurrentAgent}
              </button>
            </div>

            {!project.pendingApproval ? (
              <div className="intervention-panel">
                <p className="group-title">{copy.submitStage}</p>
                <PromptTemplateToolbar
                  templates={templates.project_room_deliverable}
                  locale={locale}
                  onUse={(template) => void handleUseTemplate("project_room_deliverable", template)}
                  onSaveProject={() => void handleSaveTemplate("project_room_deliverable", "project")}
                  onSavePersonal={() => void handleSaveTemplate("project_room_deliverable", "personal")}
                />
                <input
                  className="composer-input"
                  value={deliverableTitle}
                  onChange={(event) => setDeliverableTitle(event.target.value)}
                  placeholder={copy.deliverableNamePlaceholder}
                />
                <textarea
                  className="composer-textarea compact"
                  value={deliverableContent}
                  onChange={(event) => setDeliverableContent(event.target.value)}
                />
                <button
                  className="button button-primary"
                  onClick={() => void handleSubmitStage()}
                  disabled={busyAction !== null}
                >
                  {busyAction === "submit" ? copy.submitting : copy.submitForApproval}
                </button>
              </div>
            ) : null}

            <div className="intervention-panel">
              <p className="group-title">{copy.emergency}</p>
              <PromptTemplateToolbar
                templates={templates.project_room_emergency}
                locale={locale}
                onUse={(template) => void handleUseTemplate("project_room_emergency", template)}
                onSaveProject={() => void handleSaveTemplate("project_room_emergency", "project")}
                onSavePersonal={() => void handleSaveTemplate("project_room_emergency", "personal")}
              />
              <textarea
                className="composer-textarea compact"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
              />
              <div className="action-row action-row-wrap">
                <button
                  className="button button-danger"
                  onClick={() => void handleIntervene()}
                  disabled={busyAction !== null}
                >
                  {busyAction === "intervene" ? copy.pausing : copy.pauseAndCommand}
                </button>
                <button
                  className="button button-ghost"
                  onClick={() => void handleResume()}
                  disabled={busyAction !== null}
                >
                  {busyAction === "resume" ? copy.resuming : copy.resume}
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Timeline</p>
                <h3>{copy.timeline}</h3>
              </div>
            </div>
            <div className="timeline-list">
              {notes.map((event) => (
                <article key={event.id} className="timeline-item">
                  <div className="timeline-time">{formatTime(event.timestamp, locale)}</div>
                  <div>
                    <div className="timeline-head">
                      <strong>{event.title}</strong>
                      <span className={event.priority === "high" || event.priority === "urgent" ? "pill pill-warning" : "pill"}>
                        {timelinePriorityLabel(event.priority, isEnglish)}
                      </span>
                    </div>
                    <p>{event.content}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MetricInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-inline-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function stageStatusLabel(status: StageStatus, isEnglish: boolean) {
  const labels = isEnglish
    ? { pending: "Pending", active: "Active", completed: "Completed", blocked: "Blocked", rejected: "Rejected" }
    : { pending: "待开始", active: "进行中", completed: "已完成", blocked: "阻塞", rejected: "已退回" };
  return labels[status];
}

function deliverableStatusLabel(status: ProjectDetail["deliverables"][number]["status"], isEnglish: boolean) {
  const labels = isEnglish
    ? { draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected" }
    : { draft: "草稿", submitted: "已提交", approved: "已批准", rejected: "已退回" };
  return labels[status];
}

function taskPriorityLabel(priority: Task["priority"], isEnglish: boolean) {
  const labels = isEnglish
    ? { low: "Low priority", normal: "Normal priority", high: "High priority" }
    : { low: "低优先级", normal: "正常优先级", high: "高优先级" };
  return labels[priority];
}

function projectStatusLabel(status: ProjectStatus, isEnglish: boolean) {
  const labels = isEnglish
    ? { active: "Active", paused: "Paused", blocked: "Blocked", completed: "Completed" }
    : { active: "进行中", paused: "已暂停", blocked: "阻塞", completed: "已完成" };
  return labels[status];
}

function timelinePriorityLabel(priority: TimelineEvent["priority"], isEnglish: boolean) {
  const labels = isEnglish
    ? { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" }
    : { low: "低", normal: "普通", high: "高", urgent: "紧急" };
  return labels[priority];
}

function buildTemplateTitle(content: string, channel: string, locale: "zh-CN" | "en-US") {
  const prefix = locale === "en-US"
    ? channel === "project_room_deliverable"
      ? "Deliverable"
      : channel === "project_room_emergency"
        ? "Emergency"
        : "Guidance"
    : channel === "project_room_deliverable"
      ? "交付模板"
      : channel === "project_room_emergency"
        ? "紧急指令"
        : "指导语";
  return `${prefix} · ${content.replace(/\s+/g, " ").slice(0, 24)}`;
}

function PromptTemplateToolbar({
  templates,
  locale,
  onUse,
  onSaveProject,
  onSavePersonal
}: {
  templates: PromptTemplate[];
  locale: "zh-CN" | "en-US";
  onUse: (template: PromptTemplate) => void;
  onSaveProject: () => void;
  onSavePersonal: () => void;
}) {
  const isEnglish = locale === "en-US";
  return (
    <div className="stack tight">
      <div className="pill-row">
        {templates.slice(0, 4).map((template) => (
          <button key={template.id} className="filter-pill" onClick={() => onUse(template)} type="button">
            {template.title}
          </button>
        ))}
      </div>
      <div className="pill-row">
        <button className="button button-ghost inline-button" onClick={onSaveProject} type="button">
          {isEnglish ? "Save as project template" : "存为项目模板"}
        </button>
        <button className="button button-ghost inline-button" onClick={onSavePersonal} type="button">
          {isEnglish ? "Save as personal phrase" : "存为个人常用语"}
        </button>
      </div>
    </div>
  );
}

function formatTime(timestamp: string, locale: string) {
  return new Date(timestamp).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
