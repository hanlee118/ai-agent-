import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  ApiRequestError,
  issuesApi,
  productContextApi,
  projectsApi,
  roleSetsApi,
  type IssueDebateTaskStatus,
  type IssuePreview,
  type IssueSourceType,
  type IndustryRoleSetSummary,
  type IndustryTeamConfig,
  type ParsedProjectIntent,
} from '../../../lib/api';
import { sendBatchAgentMessage } from '../../../lib/adapters';
import { agents } from '../../../lib/runtimeCollections';
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
  buildAgentRecommendations,
  buildEditableDraftFromPreview,
  buildLocalIssuePreview,
  detectDomains,
  fallbackParseNaturalLanguage,
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

const INITIAL_FORM_DATA: NewProjectFormData = {
  name: '',
  description: '',
  priority: 'Medium',
  dueDate: '',
  agentIds: [],
};

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
  const [formData, setFormData] = useState<NewProjectFormData>(INITIAL_FORM_DATA);

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
        setSelectedIndustryCode((prev) => prev || list[0]?.industryCode || '');
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
            discussion: result.discussion?.length ? result.discussion : prev.discussion,
            debate: result.debate ?? prev.debate ?? null,
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
          setIsPollingDebate(false);
          setDiscussionAcknowledged(false);
          addToast('多角色辩论已完成，请确认最新讨论结论', 'success');
          return;
        }
        if (result.status === 'failed') {
          setIsPollingDebate(false);
          addToast(`多角色辩论未完成，已保留初步结论: ${result.error || '未知错误'}`, 'info');
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
      });

      const refreshedRoleIds = (refreshed.recommendedRoleIds || []).map((role) => normalizeRoleId(role));
      const constrainedRoleIds = allowedRoleIds.length > 0
        ? refreshedRoleIds.filter((roleId) => allowedRoleIds.some((allowed) => normalizeRoleId(allowed) === roleId))
        : refreshedRoleIds;
      const refreshedRecommendations = buildAgentRecommendations(input, constrainedRoleIds, {
        allowedRoleIds,
        mustHaveSoulRole: requiresSoulRole,
        soulRoleId,
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

      addToast('已重新生成多角色讨论结论，请确认后继续', 'success');
    } catch (error) {
      addToast(`重新生成讨论失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsRefreshingDebate(false);
    }
  };

  const handleParseInput = async () => {
    const input = sourceInput.trim();
    if (!input) {
      addToast('请先输入项目需求', 'error');
      return;
    }

    setIsParsing(true);
    try {
      let preview: IssuePreview | null = null;
      try {
        preview = await issuesApi.preview({
          input,
          industryCode: selectedIndustryCode || selectedIndustryConfig?.roleSet.industryCode || 'saas',
          sourceType: issueSourceType,
        });
      } catch (error) {
        addToast(`Issue 预分析失败，已降级到本地解析: ${error instanceof Error ? error.message : '未知错误'}`, 'info');
      }

      let parsedIntent: ParsedProjectIntent;
      try {
        parsedIntent = await projectsApi.parse(input);
      } catch {
        parsedIntent = fallbackParseNaturalLanguage(input);
      }

      const parsedTeamRoleIds = (preview?.recommendedRoleIds || parsedIntent.team || []).map((role) => normalizeRoleId(role));
      const constrainedTeamRoleIds = allowedRoleIds.length > 0
        ? parsedTeamRoleIds.filter((roleId) => allowedRoleIds.some((allowed) => normalizeRoleId(allowed) === roleId))
        : parsedTeamRoleIds;

      const recommendations = buildAgentRecommendations(input, constrainedTeamRoleIds, {
        allowedRoleIds,
        mustHaveSoulRole: requiresSoulRole,
        soulRoleId,
      });
      const recommendedNames = recommendations.map((item) => item.name);
      const recommendationRoleIds = Array.from(new Set(recommendations.map((item) => normalizeRoleId(item.roleId))));
      const priority = parsedIntent.priority || inferPriorityFromText(input);
      const domains = detectDomains(input);

      const resolvedPreview = preview ?? buildLocalIssuePreview(
        input,
        selectedIndustryCode || selectedIndustryConfig?.roleSet.industryCode || 'saas',
        recommendationRoleIds,
      );
      const parsedDescription = String(parsedIntent.description || '').trim();
      const fullDescription = parsedDescription.length > input.length ? parsedDescription : input;

      setIssuePreview(resolvedPreview);
      setDebateTaskId(resolvedPreview.debateTask?.taskId ?? null);
      setDebateTaskStatus(
        resolvedPreview.debateTask?.status
          ?? (resolvedPreview.debate ? 'completed' : null),
      );
      setDebatePollingError('');
      setIsPollingDebate(Boolean(
        resolvedPreview.debateTask
          && (resolvedPreview.debateTask.status === 'queued' || resolvedPreview.debateTask.status === 'running'),
      ));
      setEditableDraft(buildEditableDraftFromPreview(resolvedPreview));
      setIssueAnswers(applySuggestedAnswers(resolvedPreview.questions || [], resolvedPreview.suggestedAnswers || []));
      setConflictAcknowledged((resolvedPreview.conflicts || []).every((conflict) => conflict.severity !== 'critical'));
      setDiscussionAcknowledged((resolvedPreview.discussion || []).length === 0);
      setDiscussionOverride('');
      setDetectedDomains(domains);
      setAnalysisRecommendations(recommendations);
      setClarification(INITIAL_CLARIFICATION);
      setParsedProject({
        name: parsedIntent.name || resolvedPreview.title || fallbackSuggestName(input) || '新项目',
        description: fullDescription,
        phase: parsedIntent.phase || '规划中',
        agents: recommendedNames,
        priority,
        team: recommendationRoleIds,
      });
      setStep('analysis');

      if (requiresSoulRole && !recommendationRoleIds.includes(normalizeRoleId(soulRoleId))) {
        addToast(`已完成需求分析，但当前未匹配到灵魂角色 ${roleLabel(soulRoleId)}，请手动补充`, 'error');
      } else {
        addToast('已完成需求分析并自动分配 Agent，请继续澄清确认', 'success');
      }
    } catch (error) {
      addToast(`需求分析失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsParsing(false);
    }
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

      if ((issuePreview.discussion || []).length > 0 && !discussionAcknowledged && !discussionOverride.trim()) {
        addToast('请先确认讨论结论，或填写“不同意时的修正意见”后再继续', 'error');
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

    if (requiresSoulRole && soulRoleId && !nextRoleIds.includes(normalizeRoleId(soulRoleId))) {
      addToast(`当前行业团队必须包含灵魂角色 ${roleLabel(soulRoleId)}，请先补充后再继续`, 'error');
      return;
    }

    const minRoles = selectedIndustryConfig?.assemblyRule.minRoles ?? 0;
    if (minRoles > 0 && nextRoleIds.length < minRoles) {
      addToast(`当前行业最少需要 ${minRoles} 个角色，请继续补充团队`, 'error');
      return;
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

    const artifactsBlock = (issuePreview?.expectedArtifacts || [])
      .map((artifact) => `- ${artifact.name}（${roleLabel(artifact.ownerRoleId)} / ${artifact.stageType}）`)
      .join('\n');

    const alignmentBlock = issuePreview
      ? [
          `产品: ${issuePreview.contextAlignment.productName}`,
          `使命锚点: ${effectiveMissionAnchor || '未填写'}`,
          effectiveGoals.length > 0 ? `对齐目标: ${effectiveGoals.join('；')}` : null,
          effectivePrinciples.length > 0 ? `对齐原则: ${effectivePrinciples.join('；')}` : null,
          effectiveContextNotes.length > 0 ? `上下文参考: ${effectiveContextNotes.join('；')}` : null,
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
      selectedIndustryConfig
        ? `行业角色集: ${selectedIndustryConfig.roleSet.industryName} (${selectedIndustryConfig.roleSet.industryCode})`
        : null,
      selectedIndustryConfig
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
      let created: { id: string; name?: string };
      const canUseIssueConfirm = Boolean(issuePreview?.issueId && !issuePreview.issueId.startsWith('local-'));
      if (canUseIssueConfirm && issuePreview) {
        const confirmation = await issuesApi.confirm(issuePreview.issueId, {
          finalName: parsedProject.name,
          finalDescription,
          clarificationAnswers: {
            ...issueAnswers,
          },
          teamRoleIds: parsedProject.team,
          conflictResolution: conflictResolution.trim() || undefined,
        });
        created = confirmation.project;
      } else {
        created = await projectsApi.create({
          name: parsedProject.name,
          description: finalDescription,
          requirements: sourceInput.trim() || parsedProject.description,
          team: parsedProject.team,
        });
      }

      if (assignedAgentIds.length > 0) {
        const artifactsText = (issuePreview?.expectedArtifacts || [])
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
          artifactsText || '- 客户汇报方案（PPT）\n- 实施方案（Word）\n- 设计审查卡\n- Demo 原型\n- 项目排期',
          '',
          '请按以下节奏执行：',
          '1. 先完成需求分析与任务拆解',
          '2. 输出里程碑、风险与依赖，并明确产出负责人',
          '3. 确认后推进研发并持续回传进度',
        ].join('\n');

        try {
          await sendBatchAgentMessage(assignedAgentIds, executionInstruction);
          addToast(`项目创建成功，已向 ${assignedAgentIds.length} 个 Agent 下发执行指令`, 'success');
        } catch (error) {
          addToast(`项目已创建，但下发执行指令失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
      } else {
        addToast('项目创建成功，暂未匹配到可下发指令的 Agent', 'info');
      }

      await onProjectCreated?.();
      handleClose();
    } catch (error: any) {
      addToast(`创建失败: ${error?.message || '未知错误'}`, 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleManualSubmit = () => {
    if (!formData.name.trim()) {
      addToast('请输入项目名称', 'error');
      return;
    }

    if (!formData.description.trim()) {
      addToast('请输入项目描述', 'error');
      return;
    }

    const manualSelected = formData.agentIds
      .map((id) => agents.find((agent) => agent.id === id))
      .filter(Boolean);
    const manualNames = manualSelected.map((agent) => agent!.name);
    const manualRoleIds = Array.from(
      new Set(manualSelected.map((agent) => normalizeRoleId(getAgentRoleId(agent!)))),
    );

    if (requiresSoulRole && soulRoleId && !manualRoleIds.includes(normalizeRoleId(soulRoleId))) {
      addToast(`当前行业团队必须包含灵魂角色 ${roleLabel(soulRoleId)}`, 'error');
      return;
    }

    const minRoles = selectedIndustryConfig?.assemblyRule.minRoles ?? 0;
    if (minRoles > 0 && manualRoleIds.length < minRoles) {
      addToast(`当前行业最少需要 ${minRoles} 个角色，请继续选择`, 'error');
      return;
    }

    setAnalysisRecommendations(
      manualSelected.map((agent) => ({
        agentId: agent!.id,
        roleId: getAgentRoleId(agent!),
        name: agent!.name,
        role: agent!.role,
        score: 1,
        reason: '手动指定参与该项目',
      })),
    );
    setDetectedDomains(detectDomains(formData.description.trim()));
    setClarification((prev) => ({
      ...prev,
      confirmScope: true,
      confirmExecution: true,
    }));
    setParsedProject({
      name: formData.name.trim(),
      description: formData.description.trim(),
      phase: '规划中',
      agents: manualNames.length > 0 ? manualNames : agents.slice(0, 3).map((agent) => agent.name),
      priority: formData.priority,
      team: manualRoleIds,
    });
    setDiscussionOverride('');
    setStep('team');
    addToast('已生成项目草案，请确认团队分配后继续', 'success');
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
    formData,
    setFormData,
    allowedRoleIds,
    recommendedRoleIds,
    requiresSoulRole,
    soulRoleId,
    hrRoleEnabled,
    industryAgents,
    handleClose,
    handleImportProjectFile,
    handleToggleManualAgent,
    handleToggleAnalysisAgent,
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
