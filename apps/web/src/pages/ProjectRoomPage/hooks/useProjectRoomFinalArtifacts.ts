import { useCallback, useEffect, useMemo, useState } from 'react';
import { projectsApi, type ProjectFinalArtifactsReport } from '../../../lib/api';
import { isProjectNotFoundError } from '../projectRoomShared';

export function useProjectRoomFinalArtifacts({
  effectiveProjectId,
  addToast,
}: {
  effectiveProjectId: string;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [finalArtifacts, setFinalArtifacts] = useState<ProjectFinalArtifactsReport | null>(null);
  const [isLoadingFinalArtifacts, setIsLoadingFinalArtifacts] = useState(false);
  const [isTriggeringFinalArtifacts, setIsTriggeringFinalArtifacts] = useState(false);

  const finalArtifactsGeneration = finalArtifacts?.generation;
  const finalArtifactsRunning = finalArtifactsGeneration?.status === 'queued' || finalArtifactsGeneration?.status === 'running';

  const finalArtifactsGenerationText = useMemo(() => {
    if (!finalArtifactsGeneration) {
      return null;
    }
    const progress = Number.isFinite(finalArtifactsGeneration.progress)
      ? Math.max(0, Math.min(100, Math.round(finalArtifactsGeneration.progress)))
      : 0;
    const step = finalArtifactsGeneration.step || '处理中';
    if (finalArtifactsGeneration.status === 'failed') {
      return `生成失败：${finalArtifactsGeneration.error || finalArtifactsGeneration.message || '未知错误'}`;
    }
    if (finalArtifactsGeneration.status === 'completed') {
      return '最终产物已生成完成';
    }
    return `${step} · ${progress}%`;
  }, [finalArtifactsGeneration]);

  const quickFinalArtifacts = useMemo(
    () => (finalArtifacts?.artifacts || []).slice(0, 5),
    [finalArtifacts],
  );

  const loadFinalArtifacts = useCallback(async (options?: { silent?: boolean }) => {
    if (!effectiveProjectId) {
      setFinalArtifacts(null);
      return;
    }
    setIsLoadingFinalArtifacts(true);
    try {
      const report = await projectsApi.getFinalArtifacts(effectiveProjectId);
      setFinalArtifacts(report);
    } catch (error) {
      setFinalArtifacts(null);
      if (isProjectNotFoundError(error)) {
        return;
      }
      if (!options?.silent) {
        addToast(`加载最终验收成果失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    } finally {
      setIsLoadingFinalArtifacts(false);
    }
  }, [addToast, effectiveProjectId]);

  useEffect(() => {
    void loadFinalArtifacts({ silent: true });
  }, [loadFinalArtifacts]);

  useEffect(() => {
    if (!effectiveProjectId || !finalArtifactsRunning) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void loadFinalArtifacts({ silent: true });
    }, 2500);
    return () => {
      window.clearInterval(timer);
    };
  }, [effectiveProjectId, finalArtifactsGeneration?.jobId, finalArtifactsRunning, loadFinalArtifacts]);

  const handleGenerateFinalArtifacts = useCallback(async (force = false) => {
    if (!effectiveProjectId) {
      return;
    }
    setIsTriggeringFinalArtifacts(true);
    try {
      await projectsApi.generateFinalArtifacts(effectiveProjectId, force);
      addToast('最终验收产物生成任务已启动', 'success');
      await loadFinalArtifacts({ silent: true });
    } catch (error) {
      addToast(`启动最终产物生成失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsTriggeringFinalArtifacts(false);
    }
  }, [addToast, effectiveProjectId, loadFinalArtifacts]);

  return {
    finalArtifacts,
    isLoadingFinalArtifacts,
    isTriggeringFinalArtifacts,
    finalArtifactsGeneration,
    finalArtifactsRunning,
    finalArtifactsGenerationText,
    quickFinalArtifacts,
    loadFinalArtifacts,
    handleGenerateFinalArtifacts,
  };
}
