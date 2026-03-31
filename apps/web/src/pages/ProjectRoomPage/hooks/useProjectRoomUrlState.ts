import { useCallback, useEffect, useRef } from 'react';
import {
  PROJECT_ROOM_PARAM_TO_TAB,
  PROJECT_ROOM_TAB_TO_PARAM,
  type ProjectRoomTab,
  type ProjectRoomTabParam,
} from '../projectRoomShared';

export type ProjectRoomSignoffDecisionFilter = 'all' | 'approved' | 'rejected' | 'pending';
export type ProjectRoomSignoffTimeFilter = 'all' | '24h' | '7d' | '30d';
type ProjectRoomModalParam = 'acceptance-report' | null;

type ProjectRoomSignoffFiltersFromUrl = {
  stage: string;
  decision: ProjectRoomSignoffDecisionFilter;
  time: ProjectRoomSignoffTimeFilter;
  keyword: string;
};

export function useProjectRoomUrlState({
  projectId,
  activeTab,
  isAcceptanceReportOpen,
  signoffStageFilter,
  signoffDecisionFilter,
  signoffTimeFilter,
  signoffKeyword,
  onApplyTabFromUrl,
}: {
  projectId: string;
  activeTab: ProjectRoomTab;
  isAcceptanceReportOpen: boolean;
  signoffStageFilter: string;
  signoffDecisionFilter: ProjectRoomSignoffDecisionFilter;
  signoffTimeFilter: ProjectRoomSignoffTimeFilter;
  signoffKeyword: string;
  onApplyTabFromUrl: (tab: ProjectRoomTab) => void;
}) {
  const signoffAutoOpenKeyRef = useRef<string | null>(null);
  const projectRoomUrlStateAppliedRef = useRef<string | null>(null);

  const readSignoffFiltersFromUrl = useCallback((): ProjectRoomSignoffFiltersFromUrl | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    const params = new URLSearchParams(window.location.search);
    const urlProjectId = params.get('signoff_project_id') || params.get('project_id');
    if (urlProjectId && projectId && urlProjectId !== projectId) {
      return null;
    }

    const stage = params.get('signoff_stage') || 'all';
    const decision = params.get('signoff_decision') || 'all';
    const time = params.get('signoff_time') || 'all';
    const keyword = params.get('signoff_keyword') || '';

    const safeDecision = ['all', 'approved', 'rejected', 'pending'].includes(decision)
      ? (decision as ProjectRoomSignoffDecisionFilter)
      : 'all';
    const safeTime = ['all', '24h', '7d', '30d'].includes(time)
      ? (time as ProjectRoomSignoffTimeFilter)
      : 'all';

    return {
      stage: stage || 'all',
      decision: safeDecision,
      time: safeTime,
      keyword: keyword.trim(),
    };
  }, [projectId]);

  const readProjectRoomStateFromUrl = useCallback((): { tab: ProjectRoomTab | null; modal: ProjectRoomModalParam } | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    const params = new URLSearchParams(window.location.search);
    const urlProjectId = params.get('signoff_project_id') || params.get('project_id');
    if (urlProjectId && projectId && urlProjectId !== projectId) {
      return null;
    }

    const tabParam = params.get('pr_tab') as ProjectRoomTabParam | null;
    const modalParam = params.get('pr_modal');
    const tab = tabParam && tabParam in PROJECT_ROOM_PARAM_TO_TAB
      ? PROJECT_ROOM_PARAM_TO_TAB[tabParam]
      : null;
    const modal = modalParam === 'acceptance-report' ? 'acceptance-report' : null;

    return { tab, modal };
  }, [projectId]);

  const shouldAutoOpenAcceptanceReportFromUrl = useCallback(() => {
    if (typeof window === 'undefined' || !projectId) {
      return false;
    }

    const params = new URLSearchParams(window.location.search);
    const urlProjectId = params.get('signoff_project_id') || params.get('project_id');
    if (!urlProjectId || urlProjectId !== projectId) {
      return false;
    }

    if (params.get('pr_modal') === 'acceptance-report') {
      return true;
    }

    return ['signoff_stage', 'signoff_decision', 'signoff_time', 'signoff_keyword']
      .some((key) => params.has(key));
  }, [projectId]);

  const consumeAutoOpenAcceptanceReportSignal = useCallback(() => {
    if (!shouldAutoOpenAcceptanceReportFromUrl()) {
      return false;
    }

    if (typeof window === 'undefined') {
      return false;
    }

    const autoOpenKey = `${projectId}|${window.location.search}`;
    if (signoffAutoOpenKeyRef.current === autoOpenKey) {
      return false;
    }

    signoffAutoOpenKeyRef.current = autoOpenKey;
    return true;
  }, [projectId, shouldAutoOpenAcceptanceReportFromUrl]);

  const buildSignoffFilterShareUrl = useCallback(() => {
    if (typeof window === 'undefined' || !projectId) {
      return null;
    }
    const url = new URL(window.location.href);
    const params = url.searchParams;
    params.set('app_tab', 'project-room');
    params.set('project_id', projectId);
    params.set('pr_tab', PROJECT_ROOM_TAB_TO_PARAM[activeTab]);
    params.set('pr_modal', 'acceptance-report');
    params.set('signoff_project_id', projectId);
    params.set('signoff_stage', signoffStageFilter);
    params.set('signoff_decision', signoffDecisionFilter);
    params.set('signoff_time', signoffTimeFilter);
    const keyword = signoffKeyword.trim();
    if (keyword) {
      params.set('signoff_keyword', keyword);
    } else {
      params.delete('signoff_keyword');
    }
    return url.toString();
  }, [
    activeTab,
    projectId,
    signoffDecisionFilter,
    signoffKeyword,
    signoffStageFilter,
    signoffTimeFilter,
  ]);

  const syncProjectRoomUrlState = useCallback((options?: { withSignoffFilters?: boolean; modal?: ProjectRoomModalParam }) => {
    if (typeof window === 'undefined' || !projectId) {
      return;
    }

    const url = new URL(window.location.href);
    const params = url.searchParams;
    const withFilters = Boolean(options?.withSignoffFilters);

    params.set('app_tab', 'project-room');
    params.set('project_id', projectId);
    params.set('signoff_project_id', projectId);
    params.set('pr_tab', PROJECT_ROOM_TAB_TO_PARAM[activeTab]);

    if (options?.modal === 'acceptance-report') {
      params.set('pr_modal', 'acceptance-report');
    } else if (options?.modal === null) {
      params.delete('pr_modal');
    }

    if (withFilters) {
      params.set('signoff_stage', signoffStageFilter);
      params.set('signoff_decision', signoffDecisionFilter);
      params.set('signoff_time', signoffTimeFilter);
      const keyword = signoffKeyword.trim();
      if (keyword) {
        params.set('signoff_keyword', keyword);
      } else {
        params.delete('signoff_keyword');
      }
    }

    const nextSearch = params.toString();
    const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, [
    activeTab,
    projectId,
    signoffDecisionFilter,
    signoffKeyword,
    signoffStageFilter,
    signoffTimeFilter,
  ]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    syncProjectRoomUrlState({
      withSignoffFilters: isAcceptanceReportOpen,
      modal: isAcceptanceReportOpen ? 'acceptance-report' : null,
    });
  }, [isAcceptanceReportOpen, projectId, syncProjectRoomUrlState]);

  useEffect(() => {
    if (!projectId || typeof window === 'undefined') {
      return;
    }

    const state = readProjectRoomStateFromUrl();
    if (!state?.tab) {
      return;
    }

    const applyKey = `${projectId}|${window.location.search}|${state.tab}`;
    if (projectRoomUrlStateAppliedRef.current === applyKey) {
      return;
    }

    projectRoomUrlStateAppliedRef.current = applyKey;
    onApplyTabFromUrl(state.tab);
  }, [onApplyTabFromUrl, projectId, readProjectRoomStateFromUrl]);

  return {
    readSignoffFiltersFromUrl,
    consumeAutoOpenAcceptanceReportSignal,
    buildSignoffFilterShareUrl,
  };
}
