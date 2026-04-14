import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  ApiRequestError,
  issuesApi,
  projectsApi,
  productContextApi,
  roleSetsApi,
  type IssueDebateTaskStatus,
  type IssuePreview,
  type IssueSourceType,
  type IndustryRoleSetSummary,
  type IndustryTeamConfig,
} from '../../../lib/api';
import { sendBatchAgentMessage } from '../../../lib/adapters';
import { agents } from '../../../lib/runtimeCollections';
import {
  getTemplateExpectedArtifacts,
  getTemplateInputPreset,
  getTemplateRequiredRoles,
  getTemplateWorkflowSop,
} from '../utils/workflowTemplateMeta';
import type {
  AgentRecommendation,
  ClarificationAnswers,
  IssueEditableDraft,
  ModalStep,
  NewProjectFormData,
  NewProjectModalProps,
  ParsedProjectDraft,
} from '../NewProjectModal.types';
import {
  INITIAL_CLARIFICATION,
  applySuggestedAnswers,
  buildRoleBasedAgentRecommendations,
  buildEditableDraftFromPreview,
  detectDomains,
  fallbackSuggestName,
  formatClarificationBlock,
  formatIssueAnswersBlock,
  getAgentRoleId,
  inferPriorityFromText,
  normalizeRoleId,
  parseMultiline,
  resolveTimelineLabel,
  roleLabel,
  toMultilineText,
} from '../utils/newProjectHelpers';

type UseControllerArgs = NewProjectModalProps;
type ConfirmIssuePayload = Parameters<typeof issuesApi.confirm>[1];

const INITIAL_FORM_DATA: NewProjectFormData = {
  name: '',
  description: '',
  priority: 'Medium',
  dueDate: '',
  agentIds: [],
};

function uniqueNormalizedRoles(input: string[]) {
  return Array.from(new Set(input.map((item) => normalizeRoleId(item)).filter(Boolean)));
}

export function useNewProjectModalController({
  isOpen,
  onClose,
  addToast,
  onProjectCreated,
}: UseControllerArgs) {
  const [isImporting, setIsImporting] = useState(false);
  const [step, setStep] = useState<ModalStep>('input');
  const [rawInput, setRawInput] = useState('');
  const [prdInput, setPrdInput] = useState('');
  const [importedFileName, setImportedFileName] = useState('');
  const [industryRoleSets, setIndustryRoleSets] = useState<IndustryRoleSetSummary[]>([]);
  const [selectedIndustryCode, setSelectedIndustryCode] = useState('');
  const [issueSourceType, setIssueSourceType] = useState<IssueSourceType>('text');
  const [selectedIndustryConfig, setSelectedIndustryConfig] = useState<IndustryTeamConfig | null>(null);
  const [isLoadingRoleSets, setIsLoadingRoleSets] = useState(false);
  const [isLoadingIndustryConfig, setIsLoadingIndustryConfig] = useState(false);
  const [parsedProject, setParsedProject] = useState<ParsedProjectDraft | null>(null);
  const [issuePreview, setIssuePreview] = useState<IssuePreview | null>(null);
  const [editableDraft, setEditableDraft] = useState<IssueEditableDraft | null>(null);
  const [issueAnswers, setIssueAnswers] = useState<Record<string, string>>({});
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);
  const [conflictResolution, setConflictResolution] = useState('');
  const [discussionAcknowledged, setDiscussionAcknowledged] = useState(false);
  const [discussionOverride, setDiscussionOverride] = useState('');
  const [debateTaskId, setDebateTaskId] = useState<string | null>(null);
  const [debateTaskStatus, setDebateTaskStatus] = useState<IssueDebateTaskStatus | null>(null);
  const [debatePollingError, setDebatePollingError] = useState('');
  const [isPollingDebate, setIsPollingDebate] = useState(false);
  const [isRefreshingDebate, setIsRefreshingDebate] = useState(false);
  const [analysisRecommendations, setAnalysisRecommendations] = useState<AgentRecommendation[]>([]);
  const [detectedDomains, setDetectedDomains] = useState<string[]>([]);
  const [clarification, setClarification] = useState<ClarificationAnswers>(INITIAL_CLARIFICATION);
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingAlignment, setIsSavingAlignment] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [projectType, setProjectType] = useState<'complete' | 'standalone' | 'relay'>('complete');
  const [parentProjectId, setParentProjectId] = useState('');
  const [relaySourceStageId, setRelaySourceStageId] = useState('');
  const [standaloneInputName, setStandaloneInputName] = useState('raw_requirements');
  const [standaloneInputType, setStandaloneInputType] = useState('document');
  const [standaloneInputContent, setStandaloneInputContent] = useState('');
  const [workflowTemplateKey, setWorkflowTemplateKey] = useState('standard_software_development');
  const [autoStartWorkflow, setAutoStartWorkflow] = useState(true);
  const [formData, setFormData] = useState<NewProjectFormData>(INITIAL_FORM_DATA);
  const enforceIndustryAssemblyRule = workflowTemplateKey === 'none';

  const allowedRoleIds = useMemo(
    () => selectedIndustryConfig?.roleSet.roleIds || [],
    [selectedIndustryConfig],
  );

  const recommendedRoleIds = useMemo(() => {
    if (!selectedIndustryConfig) {
      return [] as string[];
    }
    const defaultWorkflow = selectedIndustryConfig.workflows.find((item) => item.isDefault)
      || selectedIndustryConfig.workflows[0];
    const merged = [
      selectedIndustryConfig.assemblyRule.soulRoleId,
      ...(defaultWorkflow?.requiredRoleIds ?? []),
    ];
    return Array.from(new Set(merged));
  }, [selectedIndustryConfig]);

  const requiresSoulRole = Boolean(selectedIndustryConfig?.assemblyRule.mustHaveSoulRole);
  const soulRoleId = selectedIndustryConfig?.assemblyRule.soulRoleId
    || selectedIndustryConfig?.roleSet.defaultSoulRoleId
    || '';

  const hrRoleEnabled = useMemo(
    () => (selectedIndustryConfig?.roleSet.roleIds || []).some((roleId) => normalizeRoleId(roleId) === 'ROLE_HR'),
    [selectedIndustryConfig],
  );

  const sourceInput = useMemo(
    () => (issueSourceType === 'prd' ? prdInput : rawInput),
    [issueSourceType, prdInput, rawInput],
  );

  const industryAgents = useMemo(() => {
    const pool = agents || [];
    if (allowedRoleIds.length === 0) {
      return pool;
    }
    const allowed = new Set(allowedRoleIds.map((role) => normalizeRoleId(role)));
    const filtered = pool.filter((agent) => allowed.has(getAgentRoleId(agent)));
    return filtered.length > 0 ? filtered : pool;
  }, [allowedRoleIds]);

  const requiredWorkflowRoles = useMemo(() => {
    if (workflowTemplateKey === 'none') {
      return [] as string[];
    }
    const explicit = getTemplateRequiredRoles(workflowTemplateKey);
    const fallbackByMode = projectType === 'complete'
      ? getTemplateRequiredRoles('standard_software_development')
      : getTemplateRequiredRoles('requirements_design');
    const merged = uniqueNormalizedRoles(explicit.length > 0 ? explicit : fallbackByMode);
    if (enforceIndustryAssemblyRule && requiresSoulRole && soulRoleId) {
      return uniqueNormalizedRoles([soulRoleId, ...merged]);
    }
    return merged;
  }, [workflowTemplateKey, projectType, enforceIndustryAssemblyRule, requiresSoulRole, soulRoleId]);

  const applyTemplateRolePlan = (seedRoleIds: string[]) => {
    const normalizedSeed = uniqueNormalizedRoles(seedRoleIds);
    if (workflowTemplateKey === 'none') {
      return normalizedSeed;
    }
    if (projectType === 'complete') {
      return uniqueNormalizedRoles([...requiredWorkflowRoles, ...normalizedSeed]);
    }
    return requiredWorkflowRoles.length > 0
      ? requiredWorkflowRoles
      : normalizedSeed;
  };

  const selectedWorkflowRoleIds = useMemo(
    () => uniqueNormalizedRoles(analysisRecommendations.map((item) => item.roleId)),
    [analysisRecommendations],
  );

  const missingWorkflowRoles = useMemo(
    () => requiredWorkflowRoles.filter((roleId) => !selectedWorkflowRoleIds.includes(normalizeRoleId(roleId))),
    [requiredWorkflowRoles, selectedWorkflowRoleIds],
  );

  const activeExpectedArtifacts = useMemo(
    () => getTemplateExpectedArtifacts(workflowTemplateKey, issuePreview?.expectedArtifacts || []),
    [workflowTemplateKey, issuePreview],
  );

  const activeWorkflowSop = useMemo(
    () => getTemplateWorkflowSop(workflowTemplateKey, issuePreview?.workflow || null),
    [workflowTemplateKey, issuePreview],
  );

  useEffect(() => {
    if (!(projectType === 'standalone' || projectType === 'relay')) {
      return;
    }
    const preset = getTemplateInputPreset(workflowTemplateKey);
    const normalizedName = String(standaloneInputName || '').trim().toLowerCase();
    if (!normalizedName || normalizedName === 'rawrequirements' || normalizedName === 'raw_requirements') {
      setStandaloneInputName(preset.name);
    }
    const normalizedType = String(standaloneInputType || '').trim().toLowerCase();
    if (!normalizedType || normalizedType === 'document' || normalizedType === 'text') {
      setStandaloneInputType(preset.type);
    }
  }, [projectType, workflowTemplateKey]);

  useEffect(() => {
    if (!parsedProject) {
      return;
    }

    const seedRoleIds = analysisRecommendations.length > 0
      ? analysisRecommendations.map((item) => item.roleId)
      : parsedProject.team;
    const nextPlannedRoles = applyTemplateRolePlan(seedRoleIds);
    if (nextPlannedRoles.length === 0) {
      return;
    }

    const nextRecommendations = buildRoleBasedAgentRecommendations(nextPlannedRoles, {
      allowedRoleIds,
      mustHaveSoulRole: enforceIndustryAssemblyRule && requiresSoulRole,
      soulRoleId: enforceIndustryAssemblyRule ? soulRoleId : '',
    });
    if (nextRecommendations.length === 0) {
      return;
    }

    const prevAgentIds = analysisRecommendations.map((item) => item.agentId).join('|');
    const nextAgentIds = nextRecommendations.map((item) => item.agentId).join('|');
    if (prevAgentIds !== nextAgentIds) {
      setAnalysisRecommendations(nextRecommendations);
    }

    const nextRoleIds = uniqueNormalizedRoles(nextRecommendations.map((item) => item.roleId));
    const prevRoleIds = uniqueNormalizedRoles(parsedProject.team);
    if (nextRoleIds.join('|') !== prevRoleIds.join('|')) {
      setParsedProject((prev) => (prev
        ? {
            ...prev,
            team: nextRoleIds,
            agents: nextRecommendations.map((item) => item.name),
          }
        : prev));
    }
  }, [
    workflowTemplateKey,
    projectType,
    allowedRoleIds,
    enforceIndustryAssemblyRule,
    requiresSoulRole,
    soulRoleId,
    parsedProject,
    analysisRecommendations,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    const loadRoleSets = async () => {
      setIsLoadingRoleSets(true);
      try {
        const list = await roleSetsApi.list();
        if (cancelled) {
          return;
        }
        setIndustryRoleSets(list);
        setSelectedIndustryCode((prev) => {
          if (prev && list.some((item) => item.industryCode === prev)) {
            return prev;
          }
          return list.find((item) => item.industryCode === 'saas')?.industryCode || list[0]?.industryCode || '';
        });
      } catch (error) {
        if (!cancelled) {
          addToast(`加载行业角色集失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRoleSets(false);
        }
      }
    };

    void loadRoleSets();
    return () => {
      cancelled = true;
    };
  }, [isOpen, addToast]);

  useEffect(() => {
    if (!isOpen || !selectedIndustryCode) {
      return;
    }

    let cancelled = false;
    const loadIndustryConfig = async () => {
      setIsLoadingIndustryConfig(true);
      try {
        const config = await roleSetsApi.get(selectedIndustryCode);
        if (!cancelled) {
          setSelectedIndustryConfig(config);
        }
      } catch (error) {
        if (!cancelled) {
          setSelectedIndustryConfig(null);
          addToast(`加载行业团队编排失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingIndustryConfig(false);
        }
      }
    };

    void loadIndustryConfig();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedIndustryCode, addToast]);

  useEffect(() => {
    if (!isOpen || !issuePreview?.issueId || !debateTaskId || !debateTaskStatus) {
      return;
    }
    if (debateTaskStatus === 'completed' || debateTaskStatus === 'failed') {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      setIsPollingDebate(true);
      try {
        const result = await issuesApi.getDebate(issuePreview.issueId, debateTaskId);
        if (cancelled) {
          return;
        }
        setDebateTaskStatus(result.status);
        setDebatePollingError(result.error || '');
        setIssuePreview((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            summary: result.summary || prev.summary,
            refinement: result.refinement ?? prev.refinement,
            contextAlignment: result.contextAlignment ?? prev.contextAlignment,
            designBlueprint: result.designBlueprint ?? prev.designBlueprint,
            suggestedAnswers: Array.isArray(result.suggestedAnswers) ? result.suggestedAnswers : prev.suggestedAnswers,
            requirementContract: result.requirementContract ?? prev.requirementContract,
            discussion: Array.isArray(result.discussion) ? result.discussion : prev.discussion,
            discussionDraft: Array.isArray(result.discussionDraft) ? result.discussionDraft : prev.discussionDraft,
            debate: result.debate ?? prev.debate ?? null,
            contentProvenance: result.contentProvenance ?? prev.contentProvenance,
            analysisGate: result.analysisGate ?? prev.analysisGate,
            debateTask: result.taskId
              ? {
                  taskId: result.taskId,
                  status: result.status,
                  pollAfterMs: result.pollAfterMs,
                }
              : prev.debateTask ?? null,
          };
        });

        if (result.status === 'completed') {
          setEditableDraft((prev) => {
            const pendingMarker = '真实模型多角色讨论尚未完成';
            const hasPlaceholder = !prev
              || [
                prev.summary,
                prev.problemStatement,
                prev.expectedOutcome,
                prev.missionAnchor,
                prev.valueNarrative,
                prev.contractObjective,
              ].some((item) => String(item || '').includes(pendingMarker));
            if (!hasPlaceholder) {
              return prev;
            }

            return {
              summary: result.summary || prev?.summary || '',
              problemStatement: result.refinement?.problemStatement || '',
              expectedOutcome: result.refinement?.expectedOutcome || '',
              inScopeDraft: toMultilineText(result.refinement?.inScopeDraft || []),
              outOfScopeDraft: toMultilineText(result.refinement?.outOfScopeDraft || []),
              acceptanceDraft: toMultilineText(result.refinement?.acceptanceDraft || []),
              missionAnchor: result.contextAlignment?.missionAnchor || '',
              matchedGoals: toMultilineText(result.contextAlignment?.matchedGoals || []),
              matchedPrinciples: toMultilineText(result.contextAlignment?.matchedPrinciples || []),
              contextNotes: toMultilineText(result.contextAlignment?.contextNotes || []),
              designTheme: result.designBlueprint?.designTheme || '',
              valueNarrative: result.designBlueprint?.valueNarrative || '',
              targetUsers: toMultilineText(result.designBlueprint?.targetUsers || []),
              coreScenarios: toMultilineText(result.designBlueprint?.coreScenarios || []),
              contractObjective: result.requirementContract?.objective || '',
              contractInScope: toMultilineText(result.requirementContract?.inScope || []),
              contractOutOfScope: toMultilineText(result.requirementContract?.outOfScope || []),
              contractAcceptance: toMultilineText(result.requirementContract?.acceptanceCriteria || []),
            };
          });
          setIsPollingDebate(false);
          setDiscussionAcknowledged(false);
          addToast('真实多角色讨论已完成，请确认正式讨论结论', 'success');
          return;
        }
        if (result.status === 'failed') {
          setIsPollingDebate(false);
          addToast(`真实多角色讨论失败，当前阶段已阻断: ${result.error || '未知错误'}`, 'error');
          return;
        }

        const nextInterval = Math.max(800, Number(result.pollAfterMs ?? 1500));
        timer = setTimeout(() => {
          void poll();
        }, nextInterval);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setDebatePollingError(error instanceof Error ? error.message : '轮询失败');
        timer = setTimeout(() => {
          void poll();
        }, 2000);
      }
    };

    timer = setTimeout(() => {
      void poll();
    }, Math.max(400, Number(issuePreview.debateTask?.pollAfterMs ?? 800)));

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isOpen, issuePreview?.issueId, issuePreview?.debateTask?.pollAfterMs, debateTaskId, debateTaskStatus, addToast]);

  const resetState = () => {
    setIsImporting(false);
    setStep('input');
    setRawInput('');
    setPrdInput('');
    setImportedFileName('');
    setIssueSourceType('text');
    setParsedProject(null);
    setIssuePreview(null);
    setEditableDraft(null);
    setIssueAnswers({});
    setDeletingHistoryId(null);
    setConflictAcknowledged(false);
    setConflictResolution('');
    setDiscussionAcknowledged(false);
    setDiscussionOverride('');
    setDebateTaskId(null);
    setDebateTaskStatus(null);
    setDebatePollingError('');
    setIsPollingDebate(false);
    setIsRefreshingDebate(false);
    setAnalysisRecommendations([]);
    setDetectedDomains([]);
    setClarification(INITIAL_CLARIFICATION);
    setIsParsing(false);
    setIsCreating(false);
    setIsSavingAlignment(false);
    setShowManualForm(false);
    setProjectType('complete');
    setParentProjectId('');
    setRelaySourceStageId('');
    setStandaloneInputName('raw_requirements');
    setStandaloneInputType('document');
    setStandaloneInputContent('');
    setWorkflowTemplateKey('standard_software_development');
    setAutoStartWorkflow(true);
    setFormData(INITIAL_FORM_DATA);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleImportProjectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const raw = await file.text();
      const normalized = raw.trim();
      if (!normalized) {
        addToast('文件内容为空，请重新选择', 'error');
        return;
      }
      const nextInput = normalized.slice(0, 6000);
      setRawInput(nextInput);
      setIssueSourceType('file_import');
      setImportedFileName(file.name);
      setIsImporting(false);
      setStep('input');
      addToast(`已导入文件: ${file.name}`, 'success');
    } catch (error) {
      addToast(`文件读取失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      event.target.value = '';
    }
  };

  const handleToggleManualAgent = (agentId: string) => {
    setFormData((prev) => ({
      ...prev,
      agentIds: prev.agentIds.includes(agentId)
        ? prev.agentIds.filter((id) => id !== agentId)
        : [...prev.agentIds, agentId],
    }));
  };

  const buildManualRecommendation = (agentId: string): AgentRecommendation | null => {
    const matched = agents.find((item) => item.id === agentId);
    if (!matched) {
      return null;
    }
    return {
      agentId: matched.id,
      roleId: getAgentRoleId(matched),
      name: matched.name,
      role: matched.role,
      score: 1,
      reason: '手动补充参与该项目',
    };
  };

  const handleToggleAnalysisAgent = (agentId: string) => {
    setAnalysisRecommendations((prev) => {
      const exists = prev.some((item) => item.agentId === agentId);
      if (exists) {
        const target = prev.find((item) => item.agentId === agentId);
        const targetRoleId = normalizeRoleId(target?.roleId || '');
        if (targetRoleId && requiredWorkflowRoles.includes(targetRoleId)) {
          const roleCount = prev.filter((item) => normalizeRoleId(item.roleId) === targetRoleId).length;
          if (roleCount <= 1) {
            addToast(`当前模板要求保留角色 ${roleLabel(targetRoleId)}，请先调整模板或补充同角色 Agent`, 'error');
            return prev;
          }
        }
        return prev.filter((item) => item.agentId !== agentId);
      }
      const manual = buildManualRecommendation(agentId);
      return manual ? [...prev, manual] : prev;
    });
  };

  const handleRefreshDebate = async () => {
    const input = sourceInput.trim() || parsedProject?.description.trim() || issuePreview?.summary.trim() || '';
    if (!input) {
      addToast('请先补充需求描述后再重新生成讨论', 'error');
      return;
    }

    setIsRefreshingDebate(true);
    try {
      const refreshed = await issuesApi.preview({
        input,
        industryCode: selectedIndustryCode || selectedIndustryConfig?.roleSet.industryCode || 'saas',
        sourceType: issueSourceType,
        debateMode: 'model',
        workflowTemplateKey,
      });

      const refreshedRoleIds = (refreshed.recommendedRoleIds || []).map((role) => normalizeRoleId(role));
      const constrainedRoleIds = allowedRoleIds.length > 0
        ? refreshedRoleIds.filter((roleId) => allowedRoleIds.some((allowed) => normalizeRoleId(allowed) === roleId))
        : refreshedRoleIds;
      const refreshedRecommendations = buildRoleBasedAgentRecommendations(applyTemplateRolePlan(constrainedRoleIds), {
        allowedRoleIds,
        mustHaveSoulRole: enforceIndustryAssemblyRule && requiresSoulRole,
        soulRoleId: enforceIndustryAssemblyRule ? soulRoleId : '',
      });

      setIssuePreview(refreshed);
      setEditableDraft(buildEditableDraftFromPreview(refreshed));
      setIssueAnswers(applySuggestedAnswers(refreshed.questions || [], refreshed.suggestedAnswers || []));
      setConflictAcknowledged((refreshed.conflicts || []).every((conflict) => conflict.severity !== 'critical'));
      setConflictResolution('');
      setDiscussionAcknowledged((refreshed.discussion || []).length === 0);
      setDiscussionOverride('');
      setDebateTaskId(refreshed.debateTask?.taskId ?? null);
      setDebateTaskStatus(
        refreshed.debateTask?.status
          ?? (refreshed.debate ? 'completed' : null),
      );
      setDebatePollingError('');
      setIsPollingDebate(Boolean(
        refreshed.debateTask
          && (refreshed.debateTask.status === 'queued' || refreshed.debateTask.status === 'running'),
      ));
      setAnalysisRecommendations(refreshedRecommendations);

      const refreshedNames = refreshedRecommendations.map((item) => item.name);
      const refreshedTeamRoleIds = Array.from(
        new Set(refreshedRecommendations.map((item) => normalizeRoleId(item.roleId))),
      );
      setParsedProject((prev) => (prev
        ? {
            ...prev,
            agents: refreshedNames.length > 0 ? refreshedNames : prev.agents,
            team: refreshedTeamRoleIds.length > 0 ? refreshedTeamRoleIds : prev.team,
          }
        : prev));

      addToast('已重新触发真实多角色讨论，请等待正式结论生成', 'success');
    } catch (error) {
      addToast(`重新生成讨论失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsRefreshingDebate(false);
    }
  };

  const resolveDirectCreateAgents = (plannedRoleIds: string[]) => {
    const manualSelected = formData.agentIds
      .map((id) => agents.find((agent) => agent.id === id))
      .filter(Boolean);
    if (manualSelected.length > 0) {
      return {
        assignedAgentIds: Array.from(new Set(manualSelected.map((agent) => agent!.id))),
        agentNames: manualSelected.map((agent) => agent!.name),
        teamRoleIds: uniqueNormalizedRoles(manualSelected.map((agent) => getAgentRoleId(agent!))),
      };
    }

    const autoRecommendations = buildRoleBasedAgentRecommendations(plannedRoleIds, {
      allowedRoleIds,
      mustHaveSoulRole: enforceIndustryAssemblyRule && requiresSoulRole,
      soulRoleId: enforceIndustryAssemblyRule ? soulRoleId : '',
    });
    return {
      assignedAgentIds: Array.from(new Set(autoRecommendations.map((item) => item.agentId))),
      agentNames: autoRecommendations.map((item) => item.name),
      teamRoleIds: uniqueNormalizedRoles(autoRecommendations.map((item) => item.roleId)),
    };
  };

  const handleCreateProjectNow = async (manualMode = false) => {
    const textInput = sourceInput.trim();
    const manualDescription = formData.description.trim();
    const projectDescription = (manualMode ? manualDescription || textInput : textInput || manualDescription).trim();
    if (!projectDescription) {
      addToast('请先输入项目需求或在手动表单填写项目描述', 'error');
      return;
    }

    if (projectType === 'relay' && !parentProjectId.trim()) {
      addToast('接力模式需要填写来源项目 ID', 'error');
      return;
    }

    const roleSeed = formData.agentIds.length > 0
      ? formData.agentIds
          .map((id) => agents.find((agent) => agent.id === id))
          .filter(Boolean)
          .map((agent) => getAgentRoleId(agent!))
      : (recommendedRoleIds.length > 0 ? recommendedRoleIds : requiredWorkflowRoles);
    let plannedRoleIds = applyTemplateRolePlan(roleSeed);
    if (workflowTemplateKey !== 'none') {
      plannedRoleIds = uniqueNormalizedRoles([...requiredWorkflowRoles, ...plannedRoleIds]);
    }
    if (enforceIndustryAssemblyRule && requiresSoulRole && soulRoleId) {
      plannedRoleIds = uniqueNormalizedRoles([soulRoleId, ...plannedRoleIds]);
    }

    const { assignedAgentIds, agentNames, teamRoleIds } = resolveDirectCreateAgents(plannedRoleIds);
    const effectiveTeamRoleIds = teamRoleIds.length > 0 ? teamRoleIds : plannedRoleIds;
    const projectName = (manualMode ? formData.name.trim() : '').trim()
      || fallbackSuggestName(projectDescription)
      || '新项目';
    const projectPriority = manualMode ? formData.priority : inferPriorityFromText(projectDescription);
    const projectDomains = detectDomains(projectDescription);

    const effectiveStandaloneInputContent = standaloneInputContent.trim()
      || ((projectType === 'standalone' || projectType === 'relay') ? projectDescription : '');
    const projectInputs: NonNullable<Parameters<typeof projectsApi.create>[0]['projectInputs']> = effectiveStandaloneInputContent
      ? [{
          name: standaloneInputName.trim() || 'raw_requirements',
          type: standaloneInputType.trim() || 'document',
          content: effectiveStandaloneInputContent,
          inputSource: standaloneInputContent.trim()
            ? (projectType === 'relay' ? 'imported_from_project' : 'manual')
            : 'manual',
        }]
      : [];

    setIsCreating(true);
    try {
      const created = await projectsApi.create({
        name: projectName,
        description: projectDescription,
        requirements: projectDescription,
        team: effectiveTeamRoleIds,
        projectType,
        parentProjectId: parentProjectId.trim() || undefined,
        relaySourceStageId: relaySourceStageId.trim() || undefined,
        projectInputs,
        workflowTemplateKey: workflowTemplateKey.trim() || undefined,
        autoStartWorkflow,
      });

      setParsedProject({
        name: projectName,
        description: projectDescription,
        phase: '规划中',
        agents: agentNames,
        priority: projectPriority,
        team: effectiveTeamRoleIds,
      });
      setDetectedDomains(projectDomains);
      setAnalysisRecommendations(buildRoleBasedAgentRecommendations(effectiveTeamRoleIds, {
        allowedRoleIds,
        mustHaveSoulRole: enforceIndustryAssemblyRule && requiresSoulRole,
        soulRoleId: enforceIndustryAssemblyRule ? soulRoleId : '',
      }));

      addToast(`项目已创建: ${created.name || projectName}`, 'success');
      addToast('已切换为“先创建项目，后在项目详情执行分析与实施”流程', 'success');

      if (assignedAgentIds.length > 0) {
        const stageHint = workflowTemplateKey === 'none' ? '手动初始化阶段后开始执行' : `按模板 ${workflowTemplateKey} 执行`;
        const instruction = [
          `【新项目创建】${created.name || projectName}`,
          `项目ID: ${created.id}`,
          `需求摘要: ${projectDescription}`,
          `阶段策略: ${stageHint}`,
          '',
          '执行要求：',
          '1. 进入项目详情页后先完成需求分析与补齐',
          '2. 再根据当前阶段模板推进实施与交付',
          '3. 持续沉淀知识到项目知识库并标注来源',
        ].join('\n');
        try {
          await sendBatchAgentMessage(assignedAgentIds, instruction);
          addToast(`已向 ${assignedAgentIds.length} 个 Agent 下发启动指令`, 'success');
        } catch (error) {
          addToast(`项目已创建，但 Agent 指令下发失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
      }

      await onProjectCreated?.(created);
      handleClose();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'PROJECT_ISSUE_FIRST_REQUIRED') {
        addToast('后端仍启用旧的 issue-first 门禁，请先切换后端配置或更新后端路由。', 'error');
        return;
      }
      addToast(`创建失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleParseInput = async () => {
    await handleCreateProjectNow(false);
  };

  const handleContinueFromAnalysis = () => {
    if (!parsedProject) {
      return;
    }

    if (issuePreview) {
      const hasSceneValidationFailure = issuePreview.conflicts.some(
        (conflict) => conflict.id === 'crossborder-scene-not-hit',
      );
      if (hasSceneValidationFailure) {
        addToast('场景命中校验未通过：请在需求中补充跨境选品/跟品关键词后再继续', 'error');
        return;
      }

      const missingRequiredQuestion = issuePreview.questions.find(
        (question) => question.required && !String(issueAnswers[question.id] ?? '').trim(),
      );
      if (missingRequiredQuestion) {
        addToast(`请先补充问题: ${missingRequiredQuestion.question}`, 'error');
        return;
      }

      const hasCriticalConflict = issuePreview.conflicts.some((conflict) => conflict.severity === 'critical');
      if (hasCriticalConflict && !conflictAcknowledged) {
        addToast('检测到关键冲突，请先确认冲突处理意见后再继续', 'error');
        return;
      }
      if (hasCriticalConflict && !conflictResolution.trim()) {
        addToast('请补充关键冲突的解决说明后再继续', 'error');
        return;
      }

      if (!issuePreview.analysisGate.canProceed) {
        addToast(issuePreview.analysisGate.blockers[0] || '分析阶段尚未满足推进条件', 'error');
        return;
      }

      if ((issuePreview.discussion || []).length > 0 && !discussionAcknowledged && !discussionOverride.trim()) {
        addToast('请先确认正式讨论结论，或填写“不同意时的修正意见”后再继续', 'error');
        return;
      }
    }

    setStep('team');
    addToast('分析完成，请确认团队分配与可选扩展信息', 'success');
  };

  const handleContinueFromTeam = () => {
    if (!parsedProject) {
      return;
    }

    const roleIds = Array.from(new Set(analysisRecommendations.map((item) => normalizeRoleId(item.roleId))));
    const names = analysisRecommendations.map((item) => item.name);
    const nextRoleIds = roleIds.length > 0 ? roleIds : parsedProject.team.map((role) => normalizeRoleId(role));

    if (enforceIndustryAssemblyRule && requiresSoulRole && soulRoleId && !nextRoleIds.includes(normalizeRoleId(soulRoleId))) {
      addToast(`当前行业团队必须包含灵魂角色 ${roleLabel(soulRoleId)}，请先补充后再继续`, 'error');
      return;
    }

    if (enforceIndustryAssemblyRule) {
      const minRoles = selectedIndustryConfig?.assemblyRule.minRoles ?? 0;
      if (minRoles > 0 && nextRoleIds.length < minRoles) {
        addToast(`当前行业最少需要 ${minRoles} 个角色，请继续补充团队`, 'error');
        return;
      }
    }

    if (workflowTemplateKey !== 'none') {
      const missingTemplateRoles = requiredWorkflowRoles.filter((roleId) => !nextRoleIds.includes(normalizeRoleId(roleId)));
      if (missingTemplateRoles.length > 0) {
        addToast(
          `当前阶段模板缺少关键角色: ${missingTemplateRoles.map((roleId) => roleLabel(roleId)).join('、')}`,
          'error',
        );
        return;
      }
    }

    setParsedProject((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        agents: names.length > 0 ? names : prev.agents,
        team: nextRoleIds.length > 0 ? nextRoleIds : prev.team,
      };
    });
    setStep('confirm');
    addToast('团队分配完成，请确认创建并启动执行', 'success');
  };

  const handleCreateFromParsed = async () => {
    if (!parsedProject) {
      return;
    }
    if (!issuePreview?.issueId) {
      addToast('当前缺少需求 Issue 上下文，请先完成需求分析后再创建项目', 'error');
      return;
    }
    if (!issuePreview.analysisGate.canProceed) {
      addToast(issuePreview.analysisGate.blockers[0] || '分析阶段尚未满足推进条件，请等待正式讨论完成', 'info');
      return;
    }
    if (workflowTemplateKey !== 'none') {
      const currentRoleIds = uniqueNormalizedRoles(
        analysisRecommendations.length > 0
          ? analysisRecommendations.map((item) => item.roleId)
          : parsedProject.team,
      );
      const missingTemplateRoles = requiredWorkflowRoles.filter((roleId) => !currentRoleIds.includes(normalizeRoleId(roleId)));
      if (missingTemplateRoles.length > 0) {
        addToast(
          `无法创建：当前阶段模板缺少角色 ${missingTemplateRoles.map((roleId) => roleLabel(roleId)).join('、')}`,
          'error',
        );
        return;
      }
    }

    const effectiveSummary = String(editableDraft?.summary || issuePreview?.summary || parsedProject.description).trim();
    const effectiveProblemStatement = String(editableDraft?.problemStatement || issuePreview?.refinement.problemStatement || '').trim();
    const effectiveExpectedOutcome = String(editableDraft?.expectedOutcome || issuePreview?.refinement.expectedOutcome || '').trim();
    const effectiveInScopeDraft = parseMultiline(
      editableDraft?.inScopeDraft ?? toMultilineText(issuePreview?.refinement.inScopeDraft),
    );
    const effectiveOutOfScopeDraft = parseMultiline(
      editableDraft?.outOfScopeDraft ?? toMultilineText(issuePreview?.refinement.outOfScopeDraft),
    );
    const effectiveAcceptanceDraft = parseMultiline(
      editableDraft?.acceptanceDraft ?? toMultilineText(issuePreview?.refinement.acceptanceDraft),
    );
    const effectiveMissionAnchor = String(editableDraft?.missionAnchor || issuePreview?.contextAlignment.missionAnchor || '').trim();
    const effectiveGoals = parseMultiline(
      editableDraft?.matchedGoals ?? toMultilineText(issuePreview?.contextAlignment.matchedGoals),
    );
    const effectivePrinciples = parseMultiline(
      editableDraft?.matchedPrinciples ?? toMultilineText(issuePreview?.contextAlignment.matchedPrinciples),
    );
    const effectiveContextNotes = parseMultiline(
      editableDraft?.contextNotes ?? toMultilineText(issuePreview?.contextAlignment.contextNotes),
    );
    const conciseContextNotes = effectiveContextNotes
      .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((item) => (item.length > 90 ? `${item.slice(0, 89)}…` : item))
      .slice(0, 2);
    const effectiveDesignTheme = String(editableDraft?.designTheme || issuePreview?.designBlueprint.designTheme || '').trim();
    const effectiveValueNarrative = String(
      editableDraft?.valueNarrative || issuePreview?.designBlueprint.valueNarrative || '',
    ).trim();
    const effectiveTargetUsers = parseMultiline(
      editableDraft?.targetUsers ?? toMultilineText(issuePreview?.designBlueprint.targetUsers),
    );
    const effectiveCoreScenarios = parseMultiline(
      editableDraft?.coreScenarios ?? toMultilineText(issuePreview?.designBlueprint.coreScenarios),
    );
    const effectiveContractObjective = String(
      editableDraft?.contractObjective || issuePreview?.requirementContract.objective || '',
    ).trim();
    const effectiveContractInScope = parseMultiline(
      editableDraft?.contractInScope ?? toMultilineText(issuePreview?.requirementContract.inScope),
    );
    const effectiveContractOutOfScope = parseMultiline(
      editableDraft?.contractOutOfScope ?? toMultilineText(issuePreview?.requirementContract.outOfScope),
    );
    const effectiveContractAcceptance = parseMultiline(
      editableDraft?.contractAcceptance ?? toMultilineText(issuePreview?.requirementContract.acceptanceCriteria),
    );

    const clarificationBlock = formatClarificationBlock(clarification);
    const issueAnswersBlock = formatIssueAnswersBlock(issueAnswers);
    const optionalBlock = [
      clarification.deliveryDepth ? `交付深度: ${clarification.deliveryDepth}` : null,
      clarification.timeline ? `期望周期: ${resolveTimelineLabel(clarification)}` : null,
      clarification.collaboration ? `协作方式: ${clarification.collaboration}` : null,
      clarification.successCriteria.trim() ? `补充成功标准: ${clarification.successCriteria.trim()}` : null,
      clarification.extraConstraints.trim() ? `补充约束: ${clarification.extraConstraints.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const discussionBlock = discussionOverride.trim()
      ? `讨论分歧处理: ${discussionOverride.trim()}`
      : '';

    const artifactsBlock = activeExpectedArtifacts
      .map((artifact) => `- ${artifact.name}（${roleLabel(artifact.ownerRoleId)} / ${artifact.stageType}）`)
      .join('\n');

    const alignmentBlock = issuePreview
      ? [
          effectiveMissionAnchor ? `使命锚点: ${effectiveMissionAnchor}` : null,
          effectiveGoals.length > 0 ? `对齐目标: ${effectiveGoals.join('；')}` : null,
          effectivePrinciples.length > 0 ? `对齐原则: ${effectivePrinciples.join('；')}` : null,
          conciseContextNotes.length > 0 ? `上下文参考: ${conciseContextNotes.join('；')}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : '';

    const blueprintBlock = issuePreview
      ? [
          `主题: ${effectiveDesignTheme || '未填写'}`,
          `价值叙事: ${effectiveValueNarrative || '未填写'}`,
          `目标用户: ${effectiveTargetUsers.join('、') || '未填写'}`,
          `核心场景: ${effectiveCoreScenarios.join('；') || '未填写'}`,
        ].join('\n')
      : '';

    const requirementContractBlock = issuePreview
      ? [
          `目标: ${effectiveContractObjective || '未填写'}`,
          `In Scope: ${effectiveContractInScope.join('；') || '未填写'}`,
          `Out of Scope: ${effectiveContractOutOfScope.join('；') || '未填写'}`,
          `验收: ${effectiveContractAcceptance.join('；') || '未填写'}`,
        ].join('\n')
      : '';

    const historyReferenceBlock = issuePreview && issuePreview.relatedHistory.length > 0
      ? issuePreview.relatedHistory
          .map((item) => `- ${item.title}（${item.validationStatus} / ${item.relevance}%）`)
          .join('\n')
      : '';

    const finalDescription = [
      parsedProject.description || effectiveSummary,
      '',
      effectiveSummary ? `需求摘要: ${effectiveSummary}` : null,
      (effectiveProblemStatement || effectiveExpectedOutcome || effectiveInScopeDraft.length > 0 || effectiveOutOfScopeDraft.length > 0 || effectiveAcceptanceDraft.length > 0)
        ? [
            '需求细化草案:',
            effectiveProblemStatement ? `问题定义: ${effectiveProblemStatement}` : null,
            effectiveExpectedOutcome ? `预期结果: ${effectiveExpectedOutcome}` : null,
            effectiveInScopeDraft.length > 0 ? `建议范围: ${effectiveInScopeDraft.join('；')}` : null,
            effectiveOutOfScopeDraft.length > 0 ? `明确不做: ${effectiveOutOfScopeDraft.join('；')}` : null,
            effectiveAcceptanceDraft.length > 0 ? `初始验收: ${effectiveAcceptanceDraft.join('；')}` : null,
          ].filter(Boolean).join('\n')
        : null,
      selectedIndustryConfig && enforceIndustryAssemblyRule
        ? `行业角色集: ${selectedIndustryConfig.roleSet.industryName} (${selectedIndustryConfig.roleSet.industryCode})`
        : null,
      selectedIndustryConfig && enforceIndustryAssemblyRule
        ? `灵魂角色: ${roleLabel(selectedIndustryConfig.assemblyRule.soulRoleId)}`
        : null,
      issuePreview ? `Issue: ${issuePreview.title}` : null,
      '',
      issueAnswersBlock ? `需求固定结果:\n${issueAnswersBlock}` : null,
      discussionBlock ? `\n讨论结论补充:\n${discussionBlock}` : null,
      alignmentBlock ? `\n文档对齐结论:\n${alignmentBlock}` : null,
      blueprintBlock ? `\n产品设计草案:\n${blueprintBlock}` : null,
      requirementContractBlock ? `\n需求确认单:\n${requirementContractBlock}` : null,
      historyReferenceBlock ? `\n可复用历史经验:\n${historyReferenceBlock}` : null,
      artifactsBlock ? `\n目标产出物:\n${artifactsBlock}` : null,
      optionalBlock ? `\n可选扩展信息:\n${optionalBlock}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const assignedAgentIds = analysisRecommendations.length > 0
      ? Array.from(new Set(analysisRecommendations.map((item) => item.agentId)))
      : Array.from(
          new Set(
            parsedProject.team
              .map((roleId) =>
                agents.find((agent) => normalizeRoleId(getAgentRoleId(agent)) === normalizeRoleId(roleId))?.id,
              )
              .filter(Boolean),
          ),
        ) as string[];

    setIsCreating(true);
    try {
      if (projectType === 'relay' && !parentProjectId.trim()) {
        addToast('接力模式需要填写来源项目 ID', 'error');
        setIsCreating(false);
        return;
      }
      const effectiveStandaloneInputContent = standaloneInputContent.trim()
        || ((projectType === 'standalone' || projectType === 'relay') ? sourceInput.trim() : '');
      const projectInputs: NonNullable<ConfirmIssuePayload['projectInputs']> = effectiveStandaloneInputContent
        ? [{
            name: standaloneInputName.trim() || 'raw_requirements',
            type: standaloneInputType.trim() || 'document',
            content: effectiveStandaloneInputContent,
            inputSource: standaloneInputContent.trim()
              ? (projectType === 'relay' ? 'imported_from_project' : 'manual')
              : 'manual',
          }]
        : [];
      const confirmation = await issuesApi.confirm(issuePreview.issueId, {
        finalName: parsedProject.name,
        finalDescription,
        clarificationAnswers: {
          ...issueAnswers,
        },
        teamRoleIds: parsedProject.team,
        conflictResolution: conflictResolution.trim() || undefined,
        projectType,
        parentProjectId: parentProjectId.trim() || undefined,
        relaySourceStageId: relaySourceStageId.trim() || undefined,
        projectInputs,
        workflowTemplateKey: workflowTemplateKey.trim() || undefined,
        autoStartWorkflow,
      });
      const created = confirmation.project;
      addToast(`项目已创建: ${created.name || parsedProject.name}`, 'success');

      if (assignedAgentIds.length > 0) {
        const artifactsText = activeExpectedArtifacts
          .map((artifact) => `- ${artifact.name}（${roleLabel(artifact.ownerRoleId)}）`)
          .join('\n');
        const executionInstruction = [
          `【新项目启动】${parsedProject.name}`,
          `项目ID: ${created.id}`,
          `需求摘要: ${effectiveSummary || parsedProject.description}`,
          '',
          '需求固定结论：',
          issueAnswersBlock || clarificationBlock,
          '',
          '需求确认单：',
          requirementContractBlock || '按确认卡中的目标、范围、验收执行',
          historyReferenceBlock ? `\n历史参考:\n${historyReferenceBlock}` : '',
          '',
          '目标产出物：',
          artifactsText || '- 需求分析文档\n- 项目排期\n- 设计审查卡\n- 视觉定稿单页\n- 技术方案与选型\n- 实现结果说明\n- 运行地址与部署说明\n- 测试报告',
          '',
          '请按以下节奏执行：',
          '1. 先完成需求分析与任务拆解',
          '2. 输出里程碑、风险与依赖，并明确产出负责人',
          '3. 确认后推进研发并持续回传进度',
        ].join('\n');

        try {
          await sendBatchAgentMessage(assignedAgentIds, executionInstruction);
          addToast(`已向 ${assignedAgentIds.length} 个 Agent 下发启动指令`, 'success');
        } catch (error) {
          addToast(`项目已创建，但 Agent 启动指令下发失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
      } else {
        addToast('项目已创建，但当前未匹配到可直接启动的 Agent', 'info');
      }

      await onProjectCreated?.(created);
      handleClose();
    } catch (error: any) {
      addToast(`创建失败: ${error?.message || '未知错误'}`, 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleManualSubmit = async () => {
    await handleCreateProjectNow(true);
  };

  const handleUseManualFromParsed = () => {
    if (!parsedProject) {
      return;
    }

    const selectedIds = agents
      .filter((agent) => parsedProject.team.includes(normalizeRoleId(getAgentRoleId(agent))))
      .map((agent) => agent.id);

    setFormData({
      name: parsedProject.name,
      description: parsedProject.description,
      priority: parsedProject.priority,
      dueDate: '',
      agentIds: selectedIds,
    });
    setShowManualForm(true);
    setStep('input');
  };

  const handleDeleteHistoryReference = async (item: { id: string; issueId?: string; projectId?: string }) => {
    const identifiers = [item.id, item.issueId, item.projectId].filter(Boolean) as string[];
    if (identifiers.length === 0) {
      return;
    }
    const confirmed = window.confirm('确认删除这条长期记忆吗？删除后将不再用于需求对齐。');
    if (!confirmed) {
      return;
    }

    setDeletingHistoryId(item.id);
    try {
      let deleted = false;
      let lastError: unknown;
      for (const identifier of identifiers) {
        try {
          await productContextApi.deleteHistory(identifier);
          deleted = true;
          break;
        } catch (error) {
          lastError = error;
          if (!(error instanceof ApiRequestError) || error.status !== 404) {
            throw error;
          }
        }
      }

      if (!deleted) {
        throw (lastError instanceof Error ? lastError : new Error('History not found'));
      }

      setIssuePreview((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          relatedHistory: prev.relatedHistory.filter((history) => history.id !== item.id),
        };
      });
      addToast('长期记忆已删除', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        setIssuePreview((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            relatedHistory: prev.relatedHistory.filter((history) => history.id !== item.id),
          };
        });
        addToast('长期记忆不存在，已从列表移除', 'info');
        return;
      }
      addToast(`删除长期记忆失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const handleSaveAlignmentToMemory = async () => {
    if (!issuePreview) {
      addToast('请先完成需求分析后再保存对齐修正', 'error');
      return;
    }
    if (!issuePreview.contentProvenance?.formalReady) {
      addToast('当前仍是规则草稿/降级结果，请等待真实模型正式结论后再写入长期记忆', 'info');
      return;
    }

    const nextMission = String(editableDraft?.missionAnchor ?? issuePreview.contextAlignment.missionAnchor ?? '').trim();
    const nextGoals = parseMultiline(
      editableDraft?.matchedGoals ?? toMultilineText(issuePreview.contextAlignment.matchedGoals),
    );
    const nextPrinciples = parseMultiline(
      editableDraft?.matchedPrinciples ?? toMultilineText(issuePreview.contextAlignment.matchedPrinciples),
    );

    if (!nextMission && nextGoals.length === 0 && nextPrinciples.length === 0) {
      addToast('请至少填写使命锚点/目标对齐/原则对齐中的一项', 'error');
      return;
    }

    setIsSavingAlignment(true);
    try {
      const current = await productContextApi.get();
      const updated = await productContextApi.update({
        productName: current.productName,
        background: current.background,
        mission: nextMission || current.mission,
        goals: nextGoals.length > 0 ? nextGoals : current.goals,
        principles: nextPrinciples.length > 0 ? nextPrinciples : current.principles,
        constraints: current.constraints,
        forbiddenKeywords: current.forbiddenKeywords,
        requiredKeywords: current.requiredKeywords,
      });

      const savedGoals = nextGoals.length > 0 ? nextGoals : updated.goals;
      const savedPrinciples = nextPrinciples.length > 0 ? nextPrinciples : updated.principles;
      const savedMission = nextMission || updated.mission;
      setEditableDraft((prev) => (prev
        ? {
            ...prev,
            missionAnchor: savedMission,
            matchedGoals: savedGoals.join('\n'),
            matchedPrinciples: savedPrinciples.join('\n'),
          }
        : prev));
      setIssuePreview((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          contextAlignment: {
            ...prev.contextAlignment,
            missionAnchor: savedMission,
            matchedGoals: savedGoals,
            matchedPrinciples: savedPrinciples,
            contextNotes: [
              ...prev.contextAlignment.contextNotes.filter((item) => !item.startsWith('已保存对齐修正时间')),
              `已保存对齐修正时间: ${new Date().toLocaleString('zh-CN')}`,
            ],
          },
        };
      });
      addToast('已保存三项对齐修正到长期记忆', 'success');
    } catch (error) {
      addToast(`保存对齐修正失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsSavingAlignment(false);
    }
  };

  return {
    isOpen,
    isImporting,
    setIsImporting,
    step,
    setStep,
    rawInput,
    setRawInput,
    prdInput,
    setPrdInput,
    sourceInput,
    importedFileName,
    industryRoleSets,
    selectedIndustryCode,
    setSelectedIndustryCode,
    issueSourceType,
    setIssueSourceType,
    selectedIndustryConfig,
    isLoadingRoleSets,
    isLoadingIndustryConfig,
    parsedProject,
    setParsedProject,
    issuePreview,
    setIssuePreview,
    activeExpectedArtifacts,
    activeWorkflowSop,
    editableDraft,
    setEditableDraft,
    issueAnswers,
    setIssueAnswers,
    deletingHistoryId,
    conflictAcknowledged,
    setConflictAcknowledged,
    conflictResolution,
    setConflictResolution,
    discussionAcknowledged,
    setDiscussionAcknowledged,
    discussionOverride,
    setDiscussionOverride,
    debateTaskId,
    debateTaskStatus,
    debatePollingError,
    isPollingDebate,
    isRefreshingDebate,
    analysisRecommendations,
    detectedDomains,
    clarification,
    setClarification,
    isParsing,
    isCreating,
    isSavingAlignment,
    showManualForm,
    setShowManualForm,
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
    requiredWorkflowRoles,
    missingWorkflowRoles,
    autoStartWorkflow,
    setAutoStartWorkflow,
    formData,
    setFormData,
    allowedRoleIds,
    recommendedRoleIds,
    requiresSoulRole,
    soulRoleId,
    enforceIndustryAssemblyRule,
    hrRoleEnabled,
    industryAgents,
    handleClose,
    handleImportProjectFile,
    handleToggleManualAgent,
    handleToggleAnalysisAgent,
    handleCreateProjectNow,
    handleParseInput,
    handleRefreshDebate,
    handleContinueFromAnalysis,
    handleContinueFromTeam,
    handleCreateFromParsed,
    handleManualSubmit,
    handleUseManualFromParsed,
    handleDeleteHistoryReference,
    handleSaveAlignmentToMemory,
  };
}

export type NewProjectModalController = ReturnType<typeof useNewProjectModalController>;
