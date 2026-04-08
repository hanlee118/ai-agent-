import { useCallback, useState } from 'react';
import { ApiRequestError, projectsApi, type ProjectAcceptanceReport } from '../../../lib/api';

export function useProjectRoomAcceptanceReportActions({
  projectId,
  addToast,
  refreshProjectView,
  loadFinalArtifacts,
  setAcceptanceReport,
}: {
  projectId: string;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  refreshProjectView: () => Promise<void>;
  loadFinalArtifacts: (options?: { silent?: boolean }) => Promise<void>;
  setAcceptanceReport: (report: ProjectAcceptanceReport | null) => void;
}) {
  const [isExportingAcceptanceReport, setIsExportingAcceptanceReport] = useState(false);
  const [isArchivingAcceptanceReport, setIsArchivingAcceptanceReport] = useState(false);

  const handleExportAcceptanceReport = useCallback(async () => {
    if (!projectId) {
      addToast('当前项目不可用，无法导出验收报告', 'error');
      return;
    }

    setIsExportingAcceptanceReport(true);
    try {
      const markdown = await projectsApi.exportAcceptanceReportMarkdown(projectId);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `acceptance-report-${projectId}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      addToast('验收报告已导出', 'success');
    } catch (error) {
      addToast(`导出验收报告失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsExportingAcceptanceReport(false);
    }
  }, [addToast, projectId]);

  const handleArchiveAcceptanceReport = useCallback(async () => {
    if (!projectId) {
      addToast('当前项目不可用，无法归档验收报告', 'error');
      return;
    }

    setIsArchivingAcceptanceReport(true);
    try {
      const response = await projectsApi.archiveAcceptanceReport(projectId);
      await refreshProjectView();
      addToast(`验收报告已归档: ${response.deliverableName}`, 'success');
      const [report] = await Promise.all([
        projectsApi.getAcceptanceReport(projectId),
        loadFinalArtifacts({ silent: true }),
      ]);
      setAcceptanceReport(report);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'ACCEPTANCE_QUALITY_GATE_BLOCKED') {
        const rawGate = (error.details as { error?: { qualityGate?: { blockingIssues?: string[] } } } | undefined)
          ?.error?.qualityGate;
        const blockingText = (rawGate?.blockingIssues || []).slice(0, 2).join('；');
        addToast(
          blockingText
            ? `归档已阻断：${blockingText}`
            : `归档已阻断：${error.message}`,
          'error',
        );
      } else {
        addToast(`归档验收报告失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    } finally {
      setIsArchivingAcceptanceReport(false);
    }
  }, [addToast, loadFinalArtifacts, projectId, refreshProjectView, setAcceptanceReport]);

  return {
    isExportingAcceptanceReport,
    isArchivingAcceptanceReport,
    handleExportAcceptanceReport,
    handleArchiveAcceptanceReport,
  };
}
