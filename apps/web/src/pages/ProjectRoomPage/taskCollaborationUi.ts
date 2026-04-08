import { ApiRequestError } from '../../lib/api';

export function normalizeTaskActionError(error: unknown) {
  if (!(error instanceof ApiRequestError)) {
    return error instanceof Error ? error.message : '任务操作失败';
  }

  if (error.code === 'TASK_BLOCKED_BY_DEPENDENCIES') {
    return '当前任务仍受 blocks 依赖限制，请先完成前置任务后再继续。';
  }

  if (error.message === 'Task reviewer is not set') {
    return '请先设置 reviewer，再提交审阅。';
  }

  if (error.message === 'Task still has pending delegations') {
    return '当前仍有未完成 delegation，需先等待回收或取消后再提交审阅。';
  }

  if (error.message === 'Delegation retry budget exhausted') {
    return '当前 delegation 的重试预算已用尽，请重新创建或改为人工接管。';
  }

  return error.message || '任务操作失败';
}

export function getReadyForReviewBlockReason(task: {
  reviewAgentId?: string;
  pendingDelegationCount: number;
  blockedReason?: {
    code?: string;
  };
} | null) {
  if (!task) {
    return null;
  }
  if (!task.reviewAgentId) {
    return '请先设置 reviewer';
  }
  if (task.pendingDelegationCount > 0) {
    return `当前仍有 ${task.pendingDelegationCount} 条 delegation 待回收`;
  }
  if (task.blockedReason?.code === 'dependency_blocked') {
    return '当前存在 blocks 依赖，需先解除依赖阻塞';
  }
  if (task.blockedReason?.code === 'pending_approval') {
    return '当前任务正在等待审批结果';
  }
  return null;
}
