import { useCallback, useEffect, useState } from 'react';
import { systemApi } from '../../lib/api';
import type {
  SystemExecutionProtocolLocks,
  SystemExecutionProtocolSnapshot,
  SystemExecutionProtocolStageRule,
} from '../../lib/api/types';

const DEFAULT_PROTOCOL_SETTINGS = {
  memoryEnabled: true,
  memoryPolicy: 'current_project_or_high_relevance_only' as const,
  criticalStageMode: 'terminal_agent_first' as const,
  allowDirectModelFallbackForCriticalStages: false,
  requireSkillEvidence: true,
  requireCollaborationHandoff: true,
  blockDegradedWrites: true,
};

const DEFAULT_LOCKS: SystemExecutionProtocolLocks = {
  memoryEnabled: true,
  memoryPolicy: true,
  criticalStageMode: true,
  allowDirectModelFallbackForCriticalStages: true,
};

export function useExecutionProtocol() {
  const [isExecutionProtocolLoading, setIsExecutionProtocolLoading] = useState(false);
  const [executionProtocolSource, setExecutionProtocolSource] = useState<'database' | 'default'>('default');
  const [executionProtocolUpdatedAt, setExecutionProtocolUpdatedAt] = useState('');
  const [executionProtocolLocks, setExecutionProtocolLocks] = useState<SystemExecutionProtocolLocks>(DEFAULT_LOCKS);
  const [executionProtocolStageMatrix, setExecutionProtocolStageMatrix] = useState<SystemExecutionProtocolStageRule[]>([]);
  const [requireSkillEvidence, setRequireSkillEvidence] = useState(true);
  const [requireCollaborationHandoff, setRequireCollaborationHandoff] = useState(true);
  const [blockDegradedWrites, setBlockDegradedWrites] = useState(true);

  const applySnapshot = useCallback((snapshot: SystemExecutionProtocolSnapshot) => {
    setExecutionProtocolSource(snapshot.source);
    setExecutionProtocolUpdatedAt(snapshot.updatedAt || '');
    setExecutionProtocolLocks(snapshot.locks || DEFAULT_LOCKS);
    setExecutionProtocolStageMatrix(snapshot.stageMatrix || []);
    setRequireSkillEvidence(snapshot.settings.requireSkillEvidence);
    setRequireCollaborationHandoff(snapshot.settings.requireCollaborationHandoff);
    setBlockDegradedWrites(snapshot.settings.blockDegradedWrites);
  }, []);

  const loadExecutionProtocol = useCallback(async () => {
    setIsExecutionProtocolLoading(true);
    try {
      const snapshot = await systemApi.getExecutionProtocol();
      applySnapshot(snapshot);
      return snapshot;
    } finally {
      setIsExecutionProtocolLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void loadExecutionProtocol();
  }, [loadExecutionProtocol]);

  const saveExecutionProtocol = useCallback(async () => {
    const snapshot = await systemApi.updateExecutionProtocol({
      requireSkillEvidence,
      requireCollaborationHandoff,
      blockDegradedWrites,
    });
    applySnapshot(snapshot);
    return snapshot;
  }, [applySnapshot, blockDegradedWrites, requireCollaborationHandoff, requireSkillEvidence]);

  const resetExecutionProtocol = useCallback(() => {
    setRequireSkillEvidence(DEFAULT_PROTOCOL_SETTINGS.requireSkillEvidence);
    setRequireCollaborationHandoff(DEFAULT_PROTOCOL_SETTINGS.requireCollaborationHandoff);
    setBlockDegradedWrites(DEFAULT_PROTOCOL_SETTINGS.blockDegradedWrites);
  }, []);

  return {
    isExecutionProtocolLoading,
    executionProtocolSource,
    executionProtocolUpdatedAt,
    executionProtocolLocks,
    executionProtocolStageMatrix,
    requireSkillEvidence,
    setRequireSkillEvidence,
    requireCollaborationHandoff,
    setRequireCollaborationHandoff,
    blockDegradedWrites,
    setBlockDegradedWrites,
    loadExecutionProtocol,
    saveExecutionProtocol,
    resetExecutionProtocol,
  };
}
