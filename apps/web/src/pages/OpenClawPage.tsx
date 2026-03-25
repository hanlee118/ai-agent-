import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  AuditLogItem,
  OpenClawBatchAgentCommandResult,
  OpenClawAgentCommandResult,
  OpenClawAgentDetail,
  OpenClawAgentPresence,
  OpenClawAgentSlaItem,
  OpenClawProjectDetail,
  OpenClawProjectReport,
  OpenClawProjectState,
  OpenClawSlaState,
  OpenClawStatusSummary,
  OpenClawTaskItem,
  OpenClawTaskState,
  OpenClawWorkspaceOverview
} from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

type EditorMode = "soul" | "sop";
type FlashState = { tone: "success" | "error"; message: string } | null;
type BatchTaskStatusDraft = OpenClawTaskState | "keep";

export function OpenClawPage() {
  const { locale, isEnglish } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const [workspace, setWorkspace] = useState<OpenClawWorkspaceOverview | null>(null);
  const [statusSummary, setStatusSummary] = useState<OpenClawStatusSummary | null>(null);
  const [slaItems, setSlaItems] = useState<OpenClawAgentSlaItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [projectDetail, setProjectDetail] = useState<OpenClawProjectDetail | null>(null);
  const [projectReport, setProjectReport] = useState<OpenClawProjectReport | null>(null);
  const [agentDetail, setAgentDetail] = useState<OpenClawAgentDetail | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [agentQuery, setAgentQuery] = useState("");
  const [projectAgentFilter, setProjectAgentFilter] = useState<"all" | "project-related">("all");
  const [agentProjectFilter, setAgentProjectFilter] = useState<"all" | "agent-related">("all");
  const [editorMode, setEditorMode] = useState<EditorMode>("soul");
  const [editorContent, setEditorContent] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [taskStatusDraft, setTaskStatusDraft] = useState<OpenClawTaskState>("todo");
  const [taskAgentDraft, setTaskAgentDraft] = useState("");
  const [taskAgentNameDraft, setTaskAgentNameDraft] = useState("");
  const [taskTitleDraft, setTaskTitleDraft] = useState("");
  const [taskProgressDraft, setTaskProgressDraft] = useState(0);
  const [taskBlockersDraft, setTaskBlockersDraft] = useState("");
  const [taskDeadlineDraft, setTaskDeadlineDraft] = useState("");
  const [taskSaving, setTaskSaving] = useState(false);
  const [batchTaskStatusDraft, setBatchTaskStatusDraft] = useState<BatchTaskStatusDraft>("keep");
  const [batchTaskProgressDraft, setBatchTaskProgressDraft] = useState("");
  const [batchTaskSaving, setBatchTaskSaving] = useState(false);
  const [agentMessage, setAgentMessage] = useState("请汇报你当前手上的任务、阻塞点和下一步计划。");
  const [bulkMessage, setBulkMessage] = useState("请同步当前进展、阻塞点和下一步计划，30分钟内回复。");
  const [messageSending, setMessageSending] = useState(false);
  const [commandResult, setCommandResult] = useState<OpenClawAgentCommandResult | null>(null);
  const [batchResult, setBatchResult] = useState<OpenClawBatchAgentCommandResult | null>(null);
  const [batchSending, setBatchSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<FlashState>(null);

  const pageCopy = isEnglish
    ? {
        title: "Run your OpenClaw team like an operating room",
        hero: "This workbench reads the real `~/.openclaw` workspace, not a demo mirror. Projects, agents, sessions, SOUL, SOP, and task files all stay connected to the actual team runtime.",
        lastSynced: "Last sync",
        refresh: "Refresh",
        slaTitle: "Agent SLA Watch",
        slaEmpty: "No SLA data yet.",
        teamPrograms: "Team Program Board",
        teamProgramsCopy: "See which structured projects are active, which agents are assigned, and which specialists are currently off-project.",
        specialists: "Specialists Without Structured Project",
        specialistsEmpty: "All visible agents are currently linked to a structured project.",
        allProjects: "All Projects",
        currentAgentRelated: "Current Agent Only",
        allAgents: "All Agents",
        currentProjectRelated: "Current Project Only",
        projectSearch: "Search project / path / focus",
        agentSearch: "Search name / agent id / role",
        noProjects: "No projects match the current filters.",
        noAgents: "No agents match the current filters.",
        projectReport: "Project Report",
        copyMarkdown: "Copy Markdown",
        generating: "Generating report...",
        taskBatch: "Batch Task Update",
        selectedTasks: "selected",
        keep: "Keep current",
        saveBatch: "Apply Batch Update",
        saveBatchBusy: "Applying...",
        docs: "Documents",
        blockers: "Blockers",
        taskBoard: "Task Assignments",
        taskEditor: "Task Editor",
        agentDesk: "Agent Console",
        recentSessions: "Recent Sessions",
        recentMessages: "Recent Messages",
        currentTasks: "Current Tasks",
        saveSoul: "Save",
        sendInstruction: "Send Instruction",
        batchMessage: "Broadcast To Project Agents",
        platformSupport: "Platform Support",
        metricProjectCount: "Projects",
        metricActiveProjects: "Active Projects",
        metricBlockedProjects: "Blocked Projects",
        metricActiveAgents: "Active Agents",
        metricBlockedTasks: "Blocked Tasks",
        metricCriticalAlerts: "Critical Alerts",
        metricStaleAgents: "Stale Agents",
        runtimeGuard: "Runtime Guard",
        runtimeWatch: "OpenClaw Runtime Monitor",
        defaultAgent: "Default Agent",
        sessionCount: "Sessions",
        heartbeatAgents: "Heartbeat Agents",
        systemEvents: "System Events",
        noRuntimeAlerts: "No new runtime alerts detected.",
        auditTitle: "OpenClaw Audit Trail",
        auditEmpty: "No OpenClaw audit entries yet.",
        projectOverview: "OpenClaw Project Overview",
        projectCountLabel: "projects",
        projectRoom: "Project Room",
        selectProject: "Select a project",
        path: "Path",
        updatedAt: "Updated",
        blockerCount: "Blockers",
        docCount: "Docs",
        projectBrief: "Project Brief",
        projectBriefCopy: "Core narrative extracted from the live workspace documents so you can inspect what the team is actually building.",
        overviewDoc: "Overview",
        requirementsDoc: "Requirements",
        deliverablesTitle: "Deliverables & Docs",
        deliverablesCopy: "These files come directly from the project folder, including demos, prototypes, architecture notes, and test reports.",
        noDocs: "No project documents were discovered.",
        teamBroadcast: "Team Broadcast",
        teamBroadcastCopy: "Send one instruction to every agent currently assigned to this project.",
        teamBroadcastHint: "Useful for sync checks, delivery reminders, and asking for blockers.",
        batchSelected: "selected",
        batchStatus: "Batch Status",
        batchProgress: "Batch Progress",
        keepPlaceholder: "Leave empty to keep unchanged",
        batchWritebackHint: "Changes are written back to the project's tasks.json file.",
        taskTitle: "Task Title",
        assignee: "Assignee",
        status: "Status",
        progressLabel: "Progress",
        deadline: "Deadline",
        blockersLabel: "Blockers",
        blockersPlaceholder: "One blocker per line",
        saveTask: "Write Back Task",
        savingTask: "Saving...",
        taskWritebackHint: "This updates the project's tasks.json and blockers_summary directly.",
        selectProjectHint: "Choose a project on the left to inspect tasks, deliverables, and blockers.",
        teamMembersTitle: "Team Members & Current Load",
        agentCountLabel: "agents",
        model: "Model",
        taskCount: "Tasks",
        heartbeat: "Heartbeat",
        heartbeatOn: "On",
        heartbeatOff: "Off",
        currentTaskLabel: "Current task",
        noStructuredTask: "No current structured task was detected.",
        specialistMode: "Currently serving as a specialist or platform support role.",
        selectAgent: "Select an agent",
        role: "Role",
        responsibility: "Responsibility",
        lastActive: "Last active",
        openId: "OpenID",
        notConfigured: "Not configured",
        noAgentTasks: "This agent has no structured tasks right now.",
        noSessions: "No sessions detected yet.",
        agentDeskCopy: "Directly runs `openclaw agent --agent {agentId}` instructions.",
        agentInputPlaceholder: "Enter an instruction for this agent",
        agentDeskHint: "Use this for nudges, progress requests, or deliverable clarification.",
        latestReply: "Latest Reply",
        summary: "Summary",
        duration: "Duration",
        unknown: "unknown",
        noReply: "The agent returned no text reply.",
        noRecentMessages: "No recent messages were parsed.",
        docPath: "Document Path",
        exists: "Exists",
        willCreate: "Will create",
        editorPlaceholder: "Enter",
        saveDocHint: "Saving writes directly to the OpenClaw workspace and can create a missing SOP file automatically.",
        selectAgentHint: "Choose an agent to inspect sessions, tasks, and edit SOUL / SOP.",
        success: "Saved successfully",
        failure: "Action failed",
        moduleJump: "Jump by module",
        modulePrograms: "Programs",
        moduleProjectRoom: "Project Room",
        moduleAgents: "Agents"
      }
    : {
        title: "把 OpenClaw 团队当成一个真正的运营中台来管理",
        hero: "这个工作台直接读取真实 `~/.openclaw` 工作区，不是演示镜像。项目、Agent、会话、SOUL、SOP、任务文件都会与真实团队运行态保持联动。",
        lastSynced: "最近同步",
        refresh: "刷新",
        slaTitle: "Agent SLA 时效看板",
        slaEmpty: "尚未获取到 SLA 数据。",
        teamPrograms: "团队项目总览",
        teamProgramsCopy: "直接查看当前有哪些结构化项目在跑、哪些 Agent 已挂靠项目、哪些专家角色暂时还没进入结构化任务。",
        specialists: "未挂结构化项目的专家位",
        specialistsEmpty: "当前可见 Agent 都已经挂靠在结构化项目中。",
        allProjects: "全部项目",
        currentAgentRelated: "当前 Agent 相关",
        allAgents: "全部 Agent",
        currentProjectRelated: "当前项目相关",
        projectSearch: "搜索项目 / 路径 / 焦点",
        agentSearch: "搜索姓名 / agent id / 角色",
        noProjects: "当前筛选条件下没有项目。",
        noAgents: "当前筛选条件下没有 Agent。",
        projectReport: "项目报告",
        copyMarkdown: "复制 Markdown",
        generating: "报告生成中...",
        taskBatch: "批量推进任务",
        selectedTasks: "已选",
        keep: "保持不变",
        saveBatch: "批量回写任务",
        saveBatchBusy: "批量保存中...",
        docs: "项目文档",
        blockers: "当前阻塞",
        taskBoard: "任务分配",
        taskEditor: "任务编辑",
        agentDesk: "Agent 操作台",
        recentSessions: "最近会话",
        recentMessages: "最近消息",
        currentTasks: "当前任务",
        saveSoul: "保存",
        sendInstruction: "下发指令",
        batchMessage: "批量催办项目 Agent",
        platformSupport: "平台支持",
        metricProjectCount: "项目总数",
        metricActiveProjects: "进行中项目",
        metricBlockedProjects: "阻塞项目",
        metricActiveAgents: "活跃 Agent",
        metricBlockedTasks: "阻塞任务",
        metricCriticalAlerts: "关键告警",
        metricStaleAgents: "超时 Agent",
        runtimeGuard: "Runtime Guard",
        runtimeWatch: "OpenClaw 运行监控",
        defaultAgent: "默认 Agent",
        sessionCount: "会话总数",
        heartbeatAgents: "心跳 Agent",
        systemEvents: "系统事件",
        noRuntimeAlerts: "当前没有检测到新的运行告警。",
        auditTitle: "OpenClaw 操作审计",
        auditEmpty: "当前还没有 OpenClaw 相关操作审计。",
        projectOverview: "OpenClaw 项目总览",
        projectCountLabel: "个项目",
        projectRoom: "项目作战室",
        selectProject: "请选择项目",
        path: "路径",
        updatedAt: "更新时间",
        blockerCount: "阻塞项",
        docCount: "文档",
        projectBrief: "项目简报",
        projectBriefCopy: "从真实工作区文档提取出的核心上下文，方便你快速判断团队到底在构建什么、缺什么、交付到了哪一步。",
        overviewDoc: "总览",
        requirementsDoc: "需求",
        deliverablesTitle: "交付物与文档",
        deliverablesCopy: "这些文件都直接来自项目目录，包含演示页、原型、架构说明、测试报告等真实产物。",
        noDocs: "还没有发现项目文档。",
        teamBroadcast: "批量催办",
        teamBroadcastCopy: "向本项目相关 Agent 批量下发统一指令。",
        teamBroadcastHint: "适合项目巡检、同步进展、催交付。",
        batchSelected: "已选",
        batchStatus: "批量状态",
        batchProgress: "批量进度",
        keepPlaceholder: "留空表示不改",
        batchWritebackHint: "保存后会统一回写到项目 tasks.json。",
        taskTitle: "任务标题",
        assignee: "负责人",
        status: "状态",
        progressLabel: "进度",
        deadline: "截止时间",
        blockersLabel: "阻塞项",
        blockersPlaceholder: "每行一个阻塞项",
        saveTask: "回写任务",
        savingTask: "保存中...",
        taskWritebackHint: "保存后会直接更新该项目下的 tasks.json 与 blockers_summary。",
        selectProjectHint: "从左侧选择一个项目，查看任务分配、交付物与阻塞详情。",
        teamMembersTitle: "团队成员与当前承载",
        agentCountLabel: "个 Agent",
        model: "模型",
        taskCount: "任务数",
        heartbeat: "心跳",
        heartbeatOn: "开启",
        heartbeatOff: "关闭",
        currentTaskLabel: "手头任务",
        noStructuredTask: "当前没有识别到明确任务。",
        specialistMode: "当前处于专家支持位或平台支持位。",
        selectAgent: "请选择 Agent",
        role: "角色",
        responsibility: "职责",
        lastActive: "最近活跃",
        openId: "OpenID",
        notConfigured: "未配置",
        noAgentTasks: "该 Agent 当前未绑定结构化任务。",
        noSessions: "还没有检测到会话记录。",
        agentDeskCopy: "直接调用 `openclaw agent --agent {agentId}` 下发指令。",
        agentInputPlaceholder: "输入要发给该 Agent 的指令",
        agentDeskHint: "适合催办、要求汇报、要求补充交付说明。",
        latestReply: "最新回复",
        summary: "摘要",
        duration: "耗时",
        unknown: "未知",
        noReply: "Agent 未返回文本回复",
        noRecentMessages: "还没有解析到最近消息。",
        docPath: "文档路径",
        exists: "已存在",
        willCreate: "将创建",
        editorPlaceholder: "请输入",
        saveDocHint: "保存后会直接写回 OpenClaw 工作区文件，并自动创建缺失的 SOP 文件。",
        selectAgentHint: "从上方选择一个 Agent，查看会话、任务并直接编辑 SOUL / SOP。",
        success: "保存成功",
        failure: "处理失败",
        moduleJump: "模块跳转",
        modulePrograms: "项目组合",
        moduleProjectRoom: "项目作战室",
        moduleAgents: "Agent 面板"
      };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 15000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectDetail(null);
      setProjectReport(null);
      return;
    }

    void api
      .getOpenClawProject(selectedProjectId)
      .then(setProjectDetail)
      .catch((requestError) => {
        setFlash({
          tone: "error",
          message: requestError instanceof Error ? requestError.message : "加载 OpenClaw 项目详情失败"
        });
      });
  }, [selectedProjectId]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    const requestedProjectId = searchParams.get("projectId");
    const requestedAgentId = searchParams.get("agentId");

    if (requestedProjectId && workspace.projects.some((project) => project.id === requestedProjectId)) {
      setSelectedProjectId(requestedProjectId);
    }

    if (requestedAgentId && workspace.agents.some((agent) => agent.agentId === requestedAgentId)) {
      setSelectedAgentId(requestedAgentId);
    }
  }, [searchParams, workspace]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectReport(null);
      return;
    }

    setReportLoading(true);
    void api
      .getOpenClawProjectReport(selectedProjectId)
      .then(setProjectReport)
      .catch((requestError) => {
        setFlash({
          tone: "error",
          message: requestError instanceof Error ? requestError.message : "加载项目报告失败"
        });
      })
      .finally(() => {
        setReportLoading(false);
      });
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedAgentId) {
      setAgentDetail(null);
      return;
    }

    void api
      .getOpenClawAgent(selectedAgentId)
      .then(setAgentDetail)
      .catch((requestError) => {
        setFlash({
          tone: "error",
          message: requestError instanceof Error ? requestError.message : "加载 OpenClaw Agent 详情失败"
        });
      });
  }, [selectedAgentId]);

  useEffect(() => {
    if (!agentDetail) {
      setEditorContent("");
      setCommandResult(null);
      return;
    }

    setEditorContent(editorMode === "soul" ? agentDetail.soul.content : agentDetail.sop.content);
  }, [agentDetail, editorMode]);

  useEffect(() => {
    const tasks = projectDetail?.tasks ?? [];
    const currentTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];

    setSelectedTaskId(currentTask?.id ?? null);
    setTaskStatusDraft(currentTask?.status ?? "todo");
    setTaskAgentDraft(currentTask?.agentId ?? "");
    setTaskAgentNameDraft(currentTask?.agentName ?? "");
    setTaskTitleDraft(currentTask?.title ?? "");
    setTaskProgressDraft(currentTask?.progress ?? 0);
    setTaskBlockersDraft((currentTask?.blockers ?? []).join("\n"));
    setTaskDeadlineDraft(currentTask?.deadline ?? "");
    setSelectedTaskIds((current) => current.filter((taskId) => tasks.some((task) => task.id === taskId)));
  }, [projectDetail, selectedTaskId]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);

    if (selectedProjectId) {
      nextParams.set("projectId", selectedProjectId);
    } else {
      nextParams.delete("projectId");
    }

    if (selectedAgentId) {
      nextParams.set("agentId", selectedAgentId);
    } else {
      nextParams.delete("agentId");
    }

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, selectedAgentId, selectedProjectId, setSearchParams]);

  async function refresh(options?: { silent?: boolean }) {
    try {
      if (!options?.silent) {
        setLoading(true);
        setError(null);
      }

      const [overview, runtimeStatus, logs, nextSlaItems] = await Promise.all([
        api.getOpenClawWorkspace(),
        api.getOpenClawStatus(false),
        api.getAuditLogs(40),
        api.getOpenClawSla()
      ]);
      setWorkspace(overview);
      setStatusSummary(runtimeStatus);
      setSlaItems(nextSlaItems);
      setAuditLogs(logs.filter((log) => log.action.startsWith("openclaw.")).slice(0, 12));
      setLastSyncedAt(new Date().toISOString());
      const requestedProjectId = searchParams.get("projectId");
      const requestedAgentId = searchParams.get("agentId");
      setSelectedProjectId((current) =>
        requestedProjectId && overview.projects.some((project) => project.id === requestedProjectId)
          ? requestedProjectId
          : current && overview.projects.some((project) => project.id === current)
            ? current
            : pickDefaultProjectId(overview.projects)
      );
      setSelectedAgentId((current) =>
        requestedAgentId && overview.agents.some((agent) => agent.agentId === requestedAgentId)
          ? requestedAgentId
          : current && overview.agents.some((agent) => agent.agentId === current)
            ? current
            : overview.agents[0]?.agentId ?? null
      );
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "OpenClaw 工作台加载失败";
      setError(message);
      setFlash({ tone: "error", message });
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  async function handleSaveDocument() {
    if (!agentDetail) {
      return;
    }

    setSaving(true);
    setFlash(null);
    try {
      const nextAgent =
        editorMode === "soul"
          ? await api.updateOpenClawSoul(agentDetail.agentId, { content: editorContent, createIfMissing: true })
          : await api.updateOpenClawSop(agentDetail.agentId, { content: editorContent, createIfMissing: true });

      setAgentDetail(nextAgent);
      await refresh({ silent: true });
      setFlash({
        tone: "success",
        message: `${agentDetail.name} 的 ${editorMode.toUpperCase()} 已保存到 OpenClaw 工作区。`
      });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : "保存失败"
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTask() {
    const task = projectDetail?.tasks.find((item) => item.id === selectedTaskId);
    if (!projectDetail || !task) {
      return;
    }

    setTaskSaving(true);
    setFlash(null);
    try {
      const nextProject = await api.updateOpenClawTask(projectDetail.id, task.id, {
        agentId: taskAgentDraft,
        agentName: taskAgentNameDraft,
        title: taskTitleDraft,
        status: taskStatusDraft,
        progress: taskProgressDraft,
        blockers: taskBlockersDraft.split("\n").map((item) => item.trim()).filter(Boolean),
        deadline: taskDeadlineDraft.trim() || undefined
      });

      setProjectDetail(nextProject);
      setProjectReport(await api.getOpenClawProjectReport(projectDetail.id));
      await refresh({ silent: true });
      setFlash({
        tone: "success",
        message: `任务“${task.title}”已回写到 OpenClaw 项目任务文件。`
      });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : "任务保存失败"
      });
    } finally {
      setTaskSaving(false);
    }
  }

  async function handleBatchSaveTasks() {
    if (!projectDetail || selectedTaskIds.length === 0) {
      return;
    }

    const patch: { status?: OpenClawTaskState; progress?: number } = {};
    if (batchTaskStatusDraft !== "keep") {
      patch.status = batchTaskStatusDraft;
    }

    if (batchTaskProgressDraft.trim()) {
      patch.progress = Number(batchTaskProgressDraft);
    }

    if (!("status" in patch) && !("progress" in patch)) {
      setFlash({
        tone: "error",
        message: isEnglish ? "Set at least one batch update field." : "请至少设置一个批量更新字段。"
      });
      return;
    }

    setBatchTaskSaving(true);
    setFlash(null);
    try {
      const nextProject = await api.updateOpenClawTasks(projectDetail.id, {
        updates: selectedTaskIds.map((taskId) => ({
          taskId,
          patch: {
            status: patch.status as OpenClawTaskState | undefined,
            progress: patch.progress as number | undefined
          }
        }))
      });

      setProjectDetail(nextProject);
      setSelectedTaskIds([]);
      setBatchTaskStatusDraft("keep");
      setBatchTaskProgressDraft("");
      setProjectReport(await api.getOpenClawProjectReport(projectDetail.id));
      await refresh({ silent: true });
      setFlash({
        tone: "success",
        message: isEnglish
          ? `Wrote back ${selectedTaskIds.length} tasks in batch.`
          : `已批量回写 ${selectedTaskIds.length} 个任务。`
      });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : (isEnglish ? "Batch task save failed" : "批量任务保存失败")
      });
    } finally {
      setBatchTaskSaving(false);
    }
  }

  async function handleSendAgentMessage() {
    if (!agentDetail) {
      return;
    }

    setMessageSending(true);
    setFlash(null);
    try {
      const result = await api.sendOpenClawAgentMessage(agentDetail.agentId, { message: agentMessage });
      setCommandResult(result);
      setBatchResult(null);
      setAgentDetail(await api.getOpenClawAgent(agentDetail.agentId));
      await refresh({ silent: true });
      setFlash({
        tone: "success",
        message: `已向 ${agentDetail.name} 下发指令，并收到回复。`
      });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : "Agent 指令发送失败"
      });
    } finally {
      setMessageSending(false);
    }
  }

  async function handleBatchProjectMessage() {
    if (!projectDetail || projectDetail.agentIds.length === 0) {
      return;
    }

    setBatchSending(true);
    setFlash(null);
    try {
      const result = await api.sendOpenClawBatchAgentMessage({
        agentIds: projectDetail.agentIds,
        message: bulkMessage
      });
      setBatchResult(result);
      await refresh({ silent: true });
      setFlash({
        tone: result.ok ? "success" : "error",
        message: isEnglish
          ? `Broadcast was sent to ${result.requestedAgentIds.length} project agents.`
          : `已向 ${result.requestedAgentIds.length} 个项目相关 Agent 发出批量指令。`
      });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : (isEnglish ? "Batch broadcast failed" : "批量催办失败")
      });
    } finally {
      setBatchSending(false);
    }
  }

  async function handleCopyReport() {
    if (!projectReport?.markdown) {
      return;
    }

    try {
      await navigator.clipboard.writeText(projectReport.markdown);
      setFlash({
        tone: "success",
        message: isEnglish ? "Project report Markdown copied to clipboard." : "项目报告 Markdown 已复制到剪贴板。"
      });
    } catch {
      setFlash({
        tone: "error",
        message: isEnglish ? "Copy failed. Please select the report manually." : "复制失败，请手动选中报告内容。"
      });
    }
  }

  function toggleTaskSelection(taskId: string) {
    setSelectedTaskIds((current) =>
      current.includes(taskId) ? current.filter((item) => item !== taskId) : [...current, taskId]
    );
  }

  const metrics = useMemo(() => {
    const projects = workspace?.projects ?? [];
    const agents = workspace?.agents ?? [];

    return {
      projectCount: projects.length,
      activeProjectCount: projects.filter((project) => project.status === "active").length,
      blockedProjectCount: projects.filter((project) => project.status === "blocked").length,
      activeAgentCount: agents.filter((agent) => agent.status === "active" || agent.status === "attention").length,
      blockedTaskCount: projects.reduce((sum, project) => sum + project.blockedTaskCount, 0),
      criticalFindingCount: (statusSummary?.findings ?? []).filter((item) => item.severity === "critical").length,
      staleAgentCount: slaItems.filter((item) => item.slaState === "stale").length
    };
  }, [slaItems, statusSummary?.findings, workspace]);

  const projects = workspace?.projects ?? [];
  const agents = workspace?.agents ?? [];
  const projectQueryValue = projectQuery.trim().toLowerCase();
  const agentQueryValue = agentQuery.trim().toLowerCase();
  const projectsByAgent = useMemo(() => {
    const nextMap = new Map<string, OpenClawWorkspaceOverview["projects"]>();

    for (const project of projects) {
      for (const agentId of project.agentIds) {
        const bucket = nextMap.get(agentId) ?? [];
        bucket.push(project);
        nextMap.set(agentId, bucket);
      }
    }

    return nextMap;
  }, [projects]);

  if (loading && !workspace) {
    return <div className="card">{isEnglish ? "Syncing the OpenClaw team console..." : "正在同步 OpenClaw 团队工作台..."}</div>;
  }

  if (error && !workspace) {
    return <div className="card error-text">{error}</div>;
  }

  const selectedTask = projectDetail?.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const visibleProjects = (agentProjectFilter === "agent-related" && selectedAgentId
    ? projects.filter((project) => project.agentIds.includes(selectedAgentId))
    : projects)
    .filter((project) => {
      if (!projectQueryValue) {
        return true;
      }

      return [project.name, project.relativePath, project.currentFocus, project.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(projectQueryValue));
    });
  const visibleAgents = (projectAgentFilter === "project-related" && projectDetail
    ? agents.filter((agent) => projectDetail.agentIds.includes(agent.agentId))
    : agents)
    .filter((agent) => {
      if (!agentQueryValue) {
        return true;
      }

      return [agent.name, agent.agentId, agent.title, agent.responsibility]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(agentQueryValue));
    });
  const benchAgents = visibleAgents.filter((agent) => (projectsByAgent.get(agent.agentId)?.length ?? 0) === 0);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">OpenClaw Team Console</p>
          <h2>{pageCopy.title}</h2>
          <p className="hero-copy">{pageCopy.hero}</p>
        </div>
        <div className="hero-inline-meta">
          <span className="muted-text">{pageCopy.lastSynced}: {lastSyncedAt ? formatTime(lastSyncedAt, locale) : "n/a"}</span>
          <button className="button button-ghost inline-button" onClick={() => void refresh()}>
            {pageCopy.refresh}
          </button>
        </div>
      </header>

      <section className="agent-summary-grid">
        <MetricTile label={pageCopy.metricProjectCount} value={String(metrics.projectCount)} />
        <MetricTile label={pageCopy.metricActiveProjects} value={String(metrics.activeProjectCount)} />
        <MetricTile label={pageCopy.metricBlockedProjects} value={String(metrics.blockedProjectCount)} tone="warning" />
        <MetricTile label={pageCopy.metricActiveAgents} value={String(metrics.activeAgentCount)} />
        <MetricTile label={pageCopy.metricBlockedTasks} value={String(metrics.blockedTaskCount)} tone="warning" />
        <MetricTile label={pageCopy.metricCriticalAlerts} value={String(metrics.criticalFindingCount)} tone="warning" />
        <MetricTile label={pageCopy.metricStaleAgents} value={String(metrics.staleAgentCount)} tone="warning" />
      </section>

      {flash ? (
        <section className={`card ${flash.tone === "error" ? "outline-danger" : "outline-success"}`}>
          <strong>{flash.tone === "error" ? pageCopy.failure : pageCopy.success}</strong>
          <p className="muted-text">{flash.message}</p>
        </section>
      ) : null}

      <section className="card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Modules</p>
            <h3>{pageCopy.moduleJump}</h3>
          </div>
        </div>
        <div className="module-grid">
          <a className="module-card" href="#programs-section">
            <div className="module-card-head">
              <strong>{pageCopy.modulePrograms}</strong>
              <span className="pill">{projects.length}</span>
            </div>
            <p>{isEnglish ? "Structured project portfolio, demo workspaces, and specialist bench." : "结构化项目组合、演示项目和专家支援席位。"}</p>
            <span className="module-link">{pageCopy.modulePrograms}</span>
          </a>
          <a className="module-card" href="#project-room-section">
            <div className="module-card-head">
              <strong>{pageCopy.moduleProjectRoom}</strong>
              <span className="pill">{projectDetail?.tasks.length ?? 0}</span>
            </div>
            <p>{isEnglish ? "Task editing, reports, deliverables, and project broadcast control." : "任务编辑、项目报告、交付物和团队催办入口。"}</p>
            <span className="module-link">{pageCopy.moduleProjectRoom}</span>
          </a>
          <a className="module-card" href="#agents-section">
            <div className="module-card-head">
              <strong>{pageCopy.moduleAgents}</strong>
              <span className="pill">{visibleAgents.length}</span>
            </div>
            <p>{isEnglish ? "SOUL / SOP management, sessions, and direct agent command delivery." : "SOUL / SOP 管理、会话轨迹和 Agent 直接指令控制。"}</p>
            <span className="module-link">{pageCopy.moduleAgents}</span>
          </a>
        </div>
      </section>

      <section className="openclaw-grid">
        <div className="stack">
          {statusSummary ? (
            <section className="card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">{pageCopy.runtimeGuard}</p>
                  <h3>{pageCopy.runtimeWatch}</h3>
                </div>
                <span className="muted-text">{isEnglish ? "Version" : "版本"} {statusSummary.runtimeVersion}</span>
              </div>
              <div className="meta-strip meta-strip-compact">
                <MiniMeta label={pageCopy.defaultAgent} value={statusSummary.defaultAgentId || pageCopy.unknown} />
                <MiniMeta label={pageCopy.sessionCount} value={String(statusSummary.sessionCount)} />
                <MiniMeta label={pageCopy.heartbeatAgents} value={String(statusSummary.heartbeatAgents.length)} />
                <MiniMeta label={pageCopy.systemEvents} value={String(statusSummary.queuedSystemEventCount)} />
              </div>
              <div className="pill-row">
                {statusSummary.configuredChannels.map((channel) => (
                  <span className="pill" key={channel}>{channel}</span>
                ))}
              </div>
              <div className="openclaw-session-list">
                {statusSummary.findings.slice(0, 6).map((finding) => (
                  <div key={finding.id} className={`finding-card finding-${finding.severity}`}>
                    <strong>{finding.title}</strong>
                    <p>{finding.detail}</p>
                    {finding.remediation ? <p className="muted-text">{isEnglish ? `Suggested action: ${finding.remediation}` : `建议：${finding.remediation}`}</p> : null}
                  </div>
                ))}
                {statusSummary.findings.length === 0 ? <p className="muted-text">{pageCopy.noRuntimeAlerts}</p> : null}
              </div>
            </section>
          ) : null}

          <section className="card" id="programs-section">
            <div className="section-header">
              <div>
                <p className="eyebrow">SLA</p>
                <h3>{pageCopy.slaTitle}</h3>
              </div>
              <span className="muted-text">{slaItems.length} 个成员</span>
            </div>
            <div className="openclaw-session-list">
              {slaItems.slice(0, 8).map((item) => (
                <div key={item.agentId} className="session-row">
                  <div>
                    <strong>{item.name}</strong>
                    <p>
                      {item.currentTaskTitle || (isEnglish ? "No clearly assigned task" : "当前无明确任务")}
                      {" · "}
                      {item.minutesSinceActive !== undefined
                        ? isEnglish
                          ? `${item.minutesSinceActive} min ago`
                          : `${item.minutesSinceActive} 分钟前活跃`
                        : isEnglish
                          ? "No activity signal yet"
                          : "暂无活跃记录"}
                    </p>
                  </div>
                  <span className={`pill ${slaPillClassName(item.slaState)}`}>{slaStateLabel(item.slaState, isEnglish)}</span>
                </div>
              ))}
              {slaItems.length === 0 ? <p className="muted-text">{pageCopy.slaEmpty}</p> : null}
            </div>
          </section>

          <section className="card" id="project-room-section">
            <div className="section-header">
              <div>
                <p className="eyebrow">Programs</p>
                <h3>{pageCopy.teamPrograms}</h3>
              </div>
              <span className="muted-text">{projects.length} / {agents.length}</span>
            </div>
            <p className="muted-text">{pageCopy.teamProgramsCopy}</p>
            <div className="program-board-grid">
              {projects.slice(0, 6).map((project) => (
                <article key={project.id} className="program-card">
                  <div className="section-header">
                    <div>
                      <strong>{project.name}</strong>
                      <p className="muted-text">{project.relativePath}</p>
                    </div>
                    <StatusPill tone={project.status}>{projectStatusLabel(project.status, isEnglish)}</StatusPill>
                  </div>
                  <div className="pill-row">
                    {project.agentIds.slice(0, 6).map((agentId) => {
                      const agent = agents.find((item) => item.agentId === agentId);
                      return (
                        <span key={agentId} className="pill">
                          {agent?.name || agentId}
                        </span>
                      );
                    })}
                    {project.agentIds.length === 0 ? (
                      <span className="pill pill-warning">{pageCopy.platformSupport}</span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            <div className="sub-card">
              <div className="section-header">
                <div>
                  <p className="group-title">{pageCopy.specialists}</p>
                  <p className="muted-text">{pageCopy.teamProgramsCopy}</p>
                </div>
              </div>
              <div className="pill-row">
                {benchAgents.map((agent) => (
                  <span key={agent.agentId} className="pill pill-warning">
                    {agent.name} / {agent.agentId}
                  </span>
                ))}
                {benchAgents.length === 0 ? <span className="muted-text">{pageCopy.specialistsEmpty}</span> : null}
              </div>
            </div>
          </section>

          <section className="card" id="agents-section">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Audit</p>
                  <h3>{pageCopy.auditTitle}</h3>
                </div>
              </div>
            <div className="openclaw-session-list">
              {auditLogs.map((log) => (
                <div key={log.id} className="session-row">
                  <div>
                    <strong>{log.summary}</strong>
                    <p>{log.action} · {log.actorLabel}</p>
                  </div>
                  <span className="muted-text">{formatTime(log.createdAt)}</span>
                </div>
              ))}
              {auditLogs.length === 0 ? <p className="muted-text">{pageCopy.auditEmpty}</p> : null}
            </div>
          </section>

          <section className="card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Projects</p>
                  <h3>{pageCopy.projectOverview}</h3>
                </div>
              <div className="hero-inline-meta">
                <span className="muted-text">{visibleProjects.length} {pageCopy.projectCountLabel}</span>
                <input
                  className="composer-input toolbar-input"
                  value={projectQuery}
                  onChange={(event) => setProjectQuery(event.target.value)}
                  placeholder={pageCopy.projectSearch}
                />
                <button
                  className={agentProjectFilter === "all" ? "filter-pill filter-pill-active" : "filter-pill"}
                  onClick={() => setAgentProjectFilter("all")}
                >
                  {pageCopy.allProjects}
                </button>
                <button
                  className={agentProjectFilter === "agent-related" ? "filter-pill filter-pill-active" : "filter-pill"}
                  onClick={() => setAgentProjectFilter("agent-related")}
                >
                  {pageCopy.currentAgentRelated}
                </button>
              </div>
            </div>

            <div className="openclaw-list">
              {visibleProjects.map((project) => (
                <button
                  key={project.id}
                  className={project.id === selectedProjectId ? "openclaw-card is-selected" : "openclaw-card"}
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <div className="section-header">
                    <div>
                      <h4>{project.name}</h4>
                      <p className="muted-text">{project.relativePath}</p>
                    </div>
                    <StatusPill tone={project.status}>{projectStatusLabel(project.status, isEnglish)}</StatusPill>
                  </div>
                  <p className="project-summary">{project.description}</p>
                  <div className="meta-strip meta-strip-compact">
                    <MiniMeta label={pageCopy.progressLabel} value={`${project.progress}%`} />
                    <MiniMeta label={pageCopy.taskCount} value={String(project.taskCount)} />
                    <MiniMeta label={pageCopy.blockers} value={String(project.blockedTaskCount)} />
                    <MiniMeta label={isEnglish ? "Agents" : "参与 Agent"} value={String(project.agentCount)} />
                  </div>
                  {project.currentFocus ? <p className="highlight-text">{isEnglish ? `Current focus: ${project.currentFocus}` : `当前焦点：${project.currentFocus}`}</p> : null}
                </button>
              ))}
              {visibleProjects.length === 0 ? <p className="muted-text">{pageCopy.noProjects}</p> : null}
            </div>
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Project Room</p>
                <h3>{projectDetail?.name ?? pageCopy.selectProject}</h3>
              </div>
              {projectDetail ? <StatusPill tone={projectDetail.status}>{projectStatusLabel(projectDetail.status, isEnglish)}</StatusPill> : null}
            </div>

            {projectDetail ? (
              <div className="stack">
                <p className="project-summary">{projectDetail.description}</p>
                <div className="meta-strip meta-strip-compact">
                  <MiniMeta label={pageCopy.path} value={projectDetail.relativePath} />
                  <MiniMeta label={pageCopy.updatedAt} value={formatTime(projectDetail.updatedAt, locale)} />
                  <MiniMeta label={pageCopy.blockerCount} value={String(projectDetail.blockerCount)} />
                  <MiniMeta label={pageCopy.docCount} value={String(projectDetail.docs.length)} />
                </div>

                <div className="doc-spotlight-grid">
                  {projectDetail.readmeExcerpt ? (
                    <div className="doc-spotlight-card">
                      <p className="group-title">{pageCopy.overviewDoc}</p>
                      <strong>{pageCopy.projectBrief}</strong>
                      <p>{projectDetail.readmeExcerpt}</p>
                    </div>
                  ) : null}
                  {projectDetail.requirementsExcerpt ? (
                    <div className="doc-spotlight-card">
                      <p className="group-title">{pageCopy.requirementsDoc}</p>
                      <strong>{pageCopy.projectBrief}</strong>
                      <p>{projectDetail.requirementsExcerpt}</p>
                    </div>
                  ) : null}
                </div>

                <div className="sub-card">
                  <div className="section-header">
                    <div>
                      <p className="group-title">{pageCopy.projectReport}</p>
                      <p className="muted-text">
                        {isEnglish ? "Auto-generated summary of progress, blockers, next actions, and participating agents." : "自动汇总当前进展、阻塞、下一步动作与参与 Agent 态势"}
                      </p>
                    </div>
                    <button className="button button-ghost" onClick={() => void handleCopyReport()} disabled={!projectReport?.markdown}>
                      {pageCopy.copyMarkdown}
                    </button>
                  </div>
                  {reportLoading ? <p className="muted-text">{pageCopy.generating}</p> : null}
                  {projectReport ? (
                    <div className="stack tight">
                      <p>{projectReport.summary}</p>
                      <div className="meta-strip meta-strip-compact">
                        <MiniMeta label={isEnglish ? "Highlights" : "亮点"} value={String(projectReport.highlights.length)} />
                        <MiniMeta label={pageCopy.blockers} value={String(projectReport.blockers.length)} />
                        <MiniMeta label={isEnglish ? "Actions" : "动作"} value={String(projectReport.nextActions.length)} />
                        <MiniMeta label={isEnglish ? "Agents" : "成员"} value={String(projectReport.agentSummaries.length)} />
                      </div>
                      <pre className="command-result">{projectReport.markdown}</pre>
                    </div>
                  ) : (
                    <p className="muted-text">{isEnglish ? "No project report has been generated yet." : "还没有生成项目报告。"}</p>
                  )}
                </div>

                <div className="sub-card">
                  <div className="section-header">
                    <div>
                      <p className="group-title">{pageCopy.deliverablesTitle}</p>
                      <p className="muted-text">{pageCopy.deliverablesCopy}</p>
                    </div>
                  </div>
                  <div className="doc-grid">
                    {projectDetail.docs.map((doc) => (
                      <article key={doc.id} className="doc-card">
                        <div className="deliverable-head">
                          <strong>{doc.label}</strong>
                          <span className="pill">{docKindLabel(doc.kind, isEnglish)}</span>
                        </div>
                        <div className="pill-row">
                          <span className="pill">{doc.extension.toUpperCase() || "FILE"}</span>
                          <span className="pill">{formatTime(doc.updatedAt, locale)}</span>
                        </div>
                        {doc.excerpt ? <p>{doc.excerpt}</p> : null}
                        <span className="doc-path">{doc.path}</span>
                      </article>
                    ))}
                    {projectDetail.docs.length === 0 ? <p className="muted-text">{pageCopy.noDocs}</p> : null}
                  </div>
                </div>

                {projectDetail.blockers.length > 0 ? (
                  <div className="sub-card">
                    <p className="group-title">{pageCopy.blockers}</p>
                    {projectDetail.blockers.map((blocker) => (
                      <p key={blocker}>{blocker}</p>
                    ))}
                  </div>
                ) : null}

                <div className="sub-card">
                  <p className="group-title">{pageCopy.taskBoard}</p>
                  <div className="openclaw-task-list">
                    {projectDetail.tasks.map((task) => (
                      <div
                        key={task.id}
                        className={task.id === selectedTaskId ? "task-row is-selected" : "task-row"}
                      >
                        <label className="task-check">
                          <input
                            type="checkbox"
                            checked={selectedTaskIds.includes(task.id)}
                            onChange={() => toggleTaskSelection(task.id)}
                          />
                          <span>{isEnglish ? "Batch" : "批量"}</span>
                        </label>
                        <button className="task-row-button" onClick={() => setSelectedTaskId(task.id)}>
                          <TaskRow task={task} isEnglish={isEnglish} />
                        </button>
                      </div>
                    ))}
                    {projectDetail.tasks.length === 0 ? <p className="muted-text">{isEnglish ? "No structured task list was discovered for this project yet." : "该项目尚未发现结构化任务清单。"}</p> : null}
                  </div>
                </div>

                <div className="sub-card">
                  <div className="section-header">
                    <div>
                      <p className="group-title">{pageCopy.taskBatch}</p>
                      <p className="muted-text">
                        {isEnglish
                          ? `${selectedTaskIds.length} tasks selected for batch status or progress update`
                          : `已选择 ${selectedTaskIds.length} 个任务，适合批量切换状态或推进进度`}
                      </p>
                    </div>
                    <span className="pill">{selectedTaskIds.length} {pageCopy.batchSelected}</span>
                  </div>
                  <div className="form-grid">
                    <label className="form-field">
                      <span>{pageCopy.batchStatus}</span>
                      <select
                        value={batchTaskStatusDraft}
                        onChange={(event) => setBatchTaskStatusDraft(event.target.value as BatchTaskStatusDraft)}
                      >
                        <option value="keep">{pageCopy.keep}</option>
                        <option value="todo">{taskStatusLabel("todo", isEnglish)}</option>
                        <option value="in_progress">{taskStatusLabel("in_progress", isEnglish)}</option>
                        <option value="blocked">{taskStatusLabel("blocked", isEnglish)}</option>
                        <option value="done">{taskStatusLabel("done", isEnglish)}</option>
                      </select>
                    </label>
                    <label className="form-field">
                      <span>{pageCopy.batchProgress}</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={batchTaskProgressDraft}
                        onChange={(event) => setBatchTaskProgressDraft(event.target.value)}
                        placeholder={pageCopy.keepPlaceholder}
                      />
                    </label>
                  </div>
                  <div className="action-row">
                    <button
                      className="button button-primary"
                      onClick={() => void handleBatchSaveTasks()}
                      disabled={batchTaskSaving || selectedTaskIds.length === 0}
                    >
                      {batchTaskSaving ? pageCopy.saveBatchBusy : pageCopy.saveBatch}
                    </button>
                    <span className="muted-text">{pageCopy.batchWritebackHint}</span>
                  </div>
                </div>

                <div className="sub-card">
                  <div className="section-header">
                    <div>
                      <p className="group-title">{pageCopy.teamBroadcast}</p>
                      <p className="muted-text">{pageCopy.teamBroadcastCopy}</p>
                    </div>
                    <span className="pill">{projectDetail.agentIds.length} {isEnglish ? "agents" : "人"}</span>
                  </div>
                  <textarea
                    className="composer-textarea compact"
                    value={bulkMessage}
                    onChange={(event) => setBulkMessage(event.target.value)}
                    placeholder={isEnglish ? "Enter the broadcast instruction" : "输入批量催办内容"}
                  />
                  <div className="action-row">
                    <button className="button button-primary" onClick={() => void handleBatchProjectMessage()} disabled={batchSending}>
                      {batchSending ? (isEnglish ? "Sending..." : "发送中...") : pageCopy.batchMessage}
                    </button>
                    <span className="muted-text">{pageCopy.teamBroadcastHint}</span>
                  </div>
                  {batchResult ? (
                    <div className="openclaw-session-list">
                      {batchResult.results.map((result) => (
                        <div key={result.agentId} className="session-row">
                          <div>
                            <strong>{result.agentId}</strong>
                            <p>{result.summary}</p>
                          </div>
                          <span className={result.ok ? "pill pill-success" : "pill pill-danger"}>
                            {result.ok ? (isEnglish ? "Success" : "成功") : (isEnglish ? "Failed" : "失败")}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                {selectedTask ? (
                  <div className="sub-card">
                    <div className="section-header">
                      <div>
                        <p className="group-title">{pageCopy.taskEditor}</p>
                        <p className="muted-text">{selectedTask.agentName} / {selectedTask.title}</p>
                      </div>
                      <StatusPill tone={taskStatusDraft}>{taskStatusLabel(taskStatusDraft, isEnglish)}</StatusPill>
                    </div>

                    <div className="form-grid">
                      <label className="form-field">
                        <span>{pageCopy.taskTitle}</span>
                        <input value={taskTitleDraft} onChange={(event) => setTaskTitleDraft(event.target.value)} />
                      </label>
                      <label className="form-field">
                        <span>{pageCopy.assignee}</span>
                        <select
                          value={taskAgentDraft}
                          onChange={(event) => {
                            const nextAgentId = event.target.value;
                            setTaskAgentDraft(nextAgentId);
                            const nextAgent = agents.find((item) => item.agentId === nextAgentId);
                            setTaskAgentNameDraft(nextAgent?.name || "");
                          }}
                        >
                          <option value="">{isEnglish ? "Unassigned" : "未分配"}</option>
                          {agents.map((agent) => (
                            <option key={agent.agentId} value={agent.agentId}>
                              {agent.name} / {agent.agentId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field">
                        <span>{pageCopy.status}</span>
                        <select value={taskStatusDraft} onChange={(event) => setTaskStatusDraft(event.target.value as OpenClawTaskState)}>
                          <option value="todo">{taskStatusLabel("todo", isEnglish)}</option>
                          <option value="in_progress">{taskStatusLabel("in_progress", isEnglish)}</option>
                          <option value="blocked">{taskStatusLabel("blocked", isEnglish)}</option>
                          <option value="done">{taskStatusLabel("done", isEnglish)}</option>
                        </select>
                      </label>
                      <label className="form-field">
                        <span>{pageCopy.progressLabel}</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={taskProgressDraft}
                          onChange={(event) => setTaskProgressDraft(Number(event.target.value))}
                        />
                      </label>
                      <label className="form-field">
                        <span>{pageCopy.deadline}</span>
                        <input value={taskDeadlineDraft} onChange={(event) => setTaskDeadlineDraft(event.target.value)} />
                      </label>
                    </div>

                    <label className="form-field">
                      <span>{pageCopy.blockersLabel}</span>
                      <textarea
                        className="composer-textarea compact"
                        value={taskBlockersDraft}
                        onChange={(event) => setTaskBlockersDraft(event.target.value)}
                        placeholder={pageCopy.blockersPlaceholder}
                      />
                    </label>

                    <div className="action-row">
                      <button className="button button-primary" onClick={() => void handleSaveTask()} disabled={taskSaving}>
                        {taskSaving ? pageCopy.savingTask : pageCopy.saveTask}
                      </button>
                      <span className="muted-text">{pageCopy.taskWritebackHint}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="muted-text">{pageCopy.selectProjectHint}</p>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Agents</p>
                <h3>{pageCopy.teamMembersTitle}</h3>
              </div>
              <div className="hero-inline-meta">
                <span className="muted-text">{visibleAgents.length} {pageCopy.agentCountLabel}</span>
                <input
                  className="composer-input toolbar-input"
                  value={agentQuery}
                  onChange={(event) => setAgentQuery(event.target.value)}
                  placeholder={pageCopy.agentSearch}
                />
                <button
                  className={projectAgentFilter === "all" ? "filter-pill filter-pill-active" : "filter-pill"}
                  onClick={() => setProjectAgentFilter("all")}
                >
                  {pageCopy.allAgents}
                </button>
                <button
                  className={projectAgentFilter === "project-related" ? "filter-pill filter-pill-active" : "filter-pill"}
                  onClick={() => setProjectAgentFilter("project-related")}
                >
                  {pageCopy.currentProjectRelated}
                </button>
              </div>
            </div>

            <div className="openclaw-list">
              {visibleAgents.map((agent) => (
                <button
                  key={agent.agentId}
                  className={agent.agentId === selectedAgentId ? "openclaw-card is-selected" : "openclaw-card"}
                  onClick={() => setSelectedAgentId(agent.agentId)}
                >
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">{agent.agentId}</p>
                      <h4>{agent.emoji} {agent.name}</h4>
                    </div>
                    <StatusPill tone={agent.status}>{agentStatusLabel(agent.status, isEnglish)}</StatusPill>
                  </div>
                  <p className="highlight-text">{agent.title}</p>
                  <p className="agent-description">{agent.intro}</p>
                  <div className="pill-row">
                    {(projectsByAgent.get(agent.agentId) ?? []).slice(0, 4).map((project) => (
                      <span key={project.id} className="pill">
                        {project.name}
                      </span>
                    ))}
                    {(projectsByAgent.get(agent.agentId)?.length ?? 0) === 0 ? (
                      <span className="pill pill-warning">
                        {agent.agentId === "jeremy" ? "Jeremy / Design Director" : pageCopy.platformSupport}
                      </span>
                    ) : null}
                  </div>
                  <div className="meta-strip meta-strip-compact">
                    <MiniMeta label={pageCopy.model} value={agent.model} />
                    <MiniMeta label={pageCopy.taskCount} value={String(agent.taskCount)} />
                    <MiniMeta label={pageCopy.sessionCount} value={String(agent.sessionCount)} />
                    <MiniMeta label={pageCopy.heartbeat} value={agent.heartbeatEnabled ? pageCopy.heartbeatOn : pageCopy.heartbeatOff} />
                  </div>
                  {agent.currentTask ? (
                    <p className="muted-text">{pageCopy.currentTaskLabel}: {agent.currentTask.projectName} / {agent.currentTask.title}</p>
                  ) : (
                    <p className="muted-text">
                      {(projectsByAgent.get(agent.agentId)?.length ?? 0) > 0
                        ? pageCopy.noStructuredTask
                        : pageCopy.specialistMode}
                    </p>
                  )}
                </button>
              ))}
              {visibleAgents.length === 0 ? <p className="muted-text">{pageCopy.noAgents}</p> : null}
            </div>
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Agent Editor</p>
                <h3>{agentDetail ? `${agentDetail.emoji} ${agentDetail.name}` : pageCopy.selectAgent}</h3>
              </div>
            </div>

            {agentDetail ? (
              <div className="stack">
                <div className="meta-strip meta-strip-compact">
                  <MiniMeta label={pageCopy.role} value={agentDetail.title} />
                  <MiniMeta label={pageCopy.responsibility} value={agentDetail.responsibility} />
                  <MiniMeta label={pageCopy.lastActive} value={agentDetail.lastActiveAt ? formatTime(agentDetail.lastActiveAt, locale) : pageCopy.unknown} />
                  <MiniMeta label={pageCopy.openId} value={agentDetail.openId || pageCopy.notConfigured} />
                </div>

                <div className="sub-card">
                  <p className="group-title">{pageCopy.currentTasks}</p>
                  <div className="openclaw-task-list">
                    {agentDetail.tasks.map((task) => (
                      <TaskRow key={task.id} task={task} isEnglish={isEnglish} />
                    ))}
                    {agentDetail.tasks.length === 0 ? <p className="muted-text">{pageCopy.noAgentTasks}</p> : null}
                  </div>
                </div>

                <div className="sub-card">
                  <p className="group-title">{pageCopy.recentSessions}</p>
                  <div className="openclaw-session-list">
                    {agentDetail.sessions.map((session) => (
                      <div key={session.key} className="session-row">
                        <div>
                          <strong>{session.label}</strong>
                          <p>{session.channel || pageCopy.unknown} / {session.kind}</p>
                        </div>
                        <span className="muted-text">{formatTime(session.updatedAt, locale)}</span>
                      </div>
                    ))}
                    {agentDetail.sessions.length === 0 ? <p className="muted-text">{pageCopy.noSessions}</p> : null}
                  </div>
                </div>

                <div className="sub-card">
                  <div className="section-header">
                    <div>
                      <p className="group-title">{pageCopy.agentDesk}</p>
                      <p className="muted-text">{pageCopy.agentDeskCopy.replace("{agentId}", agentDetail.agentId)}</p>
                    </div>
                  </div>

                  <textarea
                    className="composer-textarea compact"
                    value={agentMessage}
                    onChange={(event) => setAgentMessage(event.target.value)}
                    placeholder={pageCopy.agentInputPlaceholder}
                  />
                  <div className="action-row">
                    <button className="button button-primary" onClick={() => void handleSendAgentMessage()} disabled={messageSending}>
                      {messageSending ? (isEnglish ? "Sending..." : "发送中...") : pageCopy.sendInstruction}
                    </button>
                    <span className="muted-text">{pageCopy.agentDeskHint}</span>
                  </div>

                  {commandResult ? (
                    <div className="sub-card">
                      <p className="group-title">{pageCopy.latestReply}</p>
                      <p><strong>{pageCopy.summary}:</strong> {commandResult.summary}</p>
                      <p><strong>{pageCopy.model}:</strong> {commandResult.model || pageCopy.unknown} / {commandResult.provider || pageCopy.unknown}</p>
                      <p><strong>{pageCopy.duration}:</strong> {commandResult.durationMs ? `${Math.round(commandResult.durationMs / 1000)}s` : pageCopy.unknown}</p>
                      <pre className="command-result">{commandResult.reply || pageCopy.noReply}</pre>
                    </div>
                  ) : null}
                </div>

                <div className="sub-card">
                  <p className="group-title">{pageCopy.recentMessages}</p>
                  <div className="openclaw-session-list">
                    {agentDetail.recentMessages.map((message) => (
                      <div key={message.id} className="session-row">
                        <div>
                          <strong>{message.role}</strong>
                          <p>{message.text}</p>
                        </div>
                        <span className="muted-text">{formatTime(message.timestamp, locale)}</span>
                      </div>
                    ))}
                    {agentDetail.recentMessages.length === 0 ? <p className="muted-text">{pageCopy.noRecentMessages}</p> : null}
                  </div>
                </div>

                <div className="editor-tabs">
                  <button
                    className={editorMode === "soul" ? "button button-primary" : "button button-ghost"}
                    onClick={() => setEditorMode("soul")}
                  >
                    {isEnglish ? "Edit SOUL" : "编辑 SOUL"}
                  </button>
                  <button
                    className={editorMode === "sop" ? "button button-primary" : "button button-ghost"}
                    onClick={() => setEditorMode("sop")}
                  >
                    {isEnglish ? "Edit SOP" : "编辑 SOP"}
                  </button>
                </div>

                <div className="sub-card">
                  <div className="section-header">
                    <div>
                      <p className="group-title">{pageCopy.docPath}</p>
                      <p className="muted-text">
                        {editorMode === "soul" ? agentDetail.soul.path : agentDetail.sop.path}
                      </p>
                    </div>
                    <span className="pill">
                      {editorMode === "soul"
                        ? agentDetail.soul.exists ? pageCopy.exists : pageCopy.willCreate
                        : agentDetail.sop.exists ? pageCopy.exists : pageCopy.willCreate}
                    </span>
                  </div>

                  <textarea
                    className="composer-textarea openclaw-editor"
                    value={editorContent}
                    onChange={(event) => setEditorContent(event.target.value)}
                    placeholder={`${pageCopy.editorPlaceholder} ${editorMode.toUpperCase()} ${isEnglish ? "content" : "内容"}`}
                  />

                  <div className="action-row">
                    <button className="button button-primary" onClick={() => void handleSaveDocument()} disabled={saving}>
                      {saving ? (isEnglish ? "Saving..." : "保存中...") : `${pageCopy.saveSoul} ${editorMode.toUpperCase()}`}
                    </button>
                    <span className="muted-text">{pageCopy.saveDocHint}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="muted-text">{pageCopy.selectAgentHint}</p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function TaskRow({ task, isEnglish }: { task: OpenClawTaskItem; isEnglish: boolean }) {
  return (
    <>
      <div>
        <strong>{task.agentName}</strong>
        <p>{task.projectName} / {task.title}</p>
        {task.blockers.length > 0 ? <p className="error-text">{isEnglish ? "Blocked: " : "阻塞："}{task.blockers.join(isEnglish ? "; " : "；")}</p> : null}
      </div>
      <div className="task-row-meta">
        <StatusPill tone={task.status}>{taskStatusLabel(task.status, isEnglish)}</StatusPill>
        <strong>{task.progress}%</strong>
      </div>
    </>
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

function StatusPill({
  tone,
  children
}: {
  tone: OpenClawProjectState | OpenClawAgentPresence | OpenClawTaskState;
  children: string;
}) {
  return <span className={`pill ${pillClassName(tone)}`}>{children}</span>;
}

function pillClassName(tone: OpenClawProjectState | OpenClawAgentPresence | OpenClawTaskState) {
  if (tone === "blocked" || tone === "attention") {
    return "pill-danger";
  }

  if (tone === "active" || tone === "in_progress") {
    return "pill-primary";
  }

  if (tone === "completed" || tone === "done") {
    return "pill-success";
  }

  return "pill-warning";
}

function slaPillClassName(state: OpenClawSlaState) {
  if (state === "stale") {
    return "pill-danger";
  }

  if (state === "warning") {
    return "pill-warning";
  }

  return "pill-success";
}

function projectStatusLabel(status: OpenClawProjectState, isEnglish: boolean) {
  const labels = isEnglish
    ? { active: "Active", blocked: "Blocked", completed: "Completed", planned: "Planned" }
    : { active: "进行中", blocked: "阻塞", completed: "已完成", planned: "规划中" };
  return labels[status];
}

function agentStatusLabel(status: OpenClawAgentPresence, isEnglish: boolean) {
  const labels = isEnglish
    ? { active: "Active", idle: "Idle", offline: "Offline", attention: "Needs Attention" }
    : { active: "活跃", idle: "待命", offline: "离线", attention: "需关注" };
  return labels[status];
}

function taskStatusLabel(status: OpenClawTaskState, isEnglish: boolean) {
  const labels = isEnglish
    ? { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done", unknown: "Unknown" }
    : { todo: "待处理", in_progress: "进行中", blocked: "阻塞", done: "已完成", unknown: "未知" };
  return labels[status];
}

function slaStateLabel(state: OpenClawSlaState, isEnglish: boolean) {
  const labels = isEnglish
    ? { healthy: "Healthy", warning: "Warning", stale: "Stale" }
    : { healthy: "健康", warning: "预警", stale: "超时" };
  return labels[state];
}

function docKindLabel(kind: string, isEnglish: boolean) {
  const zhLabels: Record<string, string> = {
    overview: "总览",
    requirements: "需求",
    prototype: "原型",
    architecture: "架构",
    qa: "测试",
    planning: "计划",
    team: "团队",
    demo: "演示",
    document: "文档",
    artifact: "交付物"
  };
  const enLabels: Record<string, string> = {
    overview: "Overview",
    requirements: "Requirements",
    prototype: "Prototype",
    architecture: "Architecture",
    qa: "QA",
    planning: "Plan",
    team: "Team",
    demo: "Demo",
    document: "Document",
    artifact: "Artifact"
  };

  return (isEnglish ? enLabels : zhLabels)[kind] || kind;
}

function pickDefaultProjectId(projects: OpenClawWorkspaceOverview["projects"]) {
  const preferred =
    projects.find((project) => project.relativePath.includes("test-saas-demo-20260325")) ||
    projects.find((project) => project.relativePath.includes("acceptance-workbench-20260325")) ||
    projects.find((project) => project.status === "active") ||
    projects[0];

  return preferred?.id ?? null;
}

function formatTime(timestamp: string, locale = "zh-CN") {
  return new Date(timestamp).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
