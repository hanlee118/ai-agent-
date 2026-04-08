import {
  applyAllMigrationsFromFiles,
  assert,
  databaseUrlFor,
  makeTempDbPath,
  sqliteQueryRows
} from './lib/task-delegation-testkit.ts';

async function main() {
  const providedDbPath = String(process.env.VERIFY_TASK_DELEGATION_DB_PATH || '').trim();
  const fixture = providedDbPath
    ? { dir: '', dbPath: providedDbPath }
    : makeTempDbPath('task-delegation-acceptance');
  const migrateStdout = providedDbPath ? 'skipped_external_migrate' : 'applied_from_migration_files';
  const appliedMigrations = providedDbPath
    ? sqliteQueryRows<{ migration_name: string }>(
      fixture.dbPath,
      'SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name;'
    ).map((item) => item.migration_name)
    : applyAllMigrationsFromFiles(fixture.dbPath);

  process.env.DATABASE_URL = databaseUrlFor(fixture.dbPath);
  process.env.MODEL_PROVIDER = 'scripted';
  process.env.GITLAB_TOKEN = '';

  const [{ prisma }, delegationService, repository] = await Promise.all([
    import('../apps/api/src/db.ts'),
    import('../apps/api/src/services/task-delegation.ts'),
    import('../apps/api/src/data/repository.ts')
  ]);

  const {
    createDelegation,
    completeDelegation,
    failDelegation,
    expireDelegation,
    cancelDelegation,
    retryDelegation
  } = delegationService;
  const { updateTaskStatus } = repository;

  let sortOrder = 0;
  const project = await prisma.project.create({
    data: {
      id: 'verify-task-delegation-project',
      name: 'Task Delegation Acceptance',
      description: 'Engineering verification for task delegation closure',
      parsedKeywords: ['delegation', 'verification'],
      parsedConstraints: ['db_only'],
      parsedRisks: [],
      parsedSuggestedTeam: ['ROLE_PM', 'ROLE_DEV', 'ROLE_QA'],
      parsedSummary: 'Verify task delegation success/fail/gate/expire/cancel/retry flows',
      status: 'active',
      currentStage: 'DEV',
      progress: 55,
      pendingApproval: false,
      currentRole: 'ROLE_DEV',
      team: ['ROLE_PM', 'ROLE_DEV', 'ROLE_QA'],
      summary: 'Delegation verification in progress',
      liveTitle: 'Delegation verification',
      liveBody: 'Validating task-level delegation closure',
      liveStartedAt: new Date('2026-04-07T00:00:00.000Z'),
      liveProvider: 'scripted'
    }
  });

  const createTask = (title: string) => prisma.task.create({
    data: {
      projectId: project.id,
      stageType: 'DEV',
      title,
      description: `${title} description`,
      assignee: 'ROLE_DEV',
      ownerAgentId: 'rd_manager',
      coordinationMode: 'delegated_execution',
      delegationPolicy: 'manual_only',
      syncPolicy: 'db_only',
      contextScope: 'project',
      status: 'in_progress',
      priority: 'high',
      sortOrder: ++sortOrder
    }
  });

  const successTask = await createTask('Success chain');
  const successDelegation = await createDelegation(successTask.id, 'rd_manager', {
    title: 'success delegation',
    goal: 'Write back a merged delegation result'
  });
  await completeDelegation(successDelegation.id, {
    outputSummary: 'delegation success summary'
  });
  const successTaskDone = await updateTaskStatus(successTask.id, 'done');
  assert(successTaskDone?.status === 'done', 'success task should be done after merge');

  const failTask = await createTask('Fail chain');
  const failDelegationResult = await createDelegation(failTask.id, 'rd_manager', {
    title: 'fail delegation',
    goal: 'Trigger blocked parent task'
  });
  await failDelegation(failDelegationResult.id, 'forced failure for verification');
  const failTaskAfter = await prisma.task.findUniqueOrThrow({ where: { id: failTask.id } });
  assert(failTaskAfter.status === 'blocked', 'failed delegation should block parent task');

  const gateTask = await createTask('Gate chain');
  const gateDelegation = await createDelegation(gateTask.id, 'rd_manager', {
    title: 'gate delegation',
    goal: 'Leave delegation pending to assert completion gate'
  });
  let gateError = '';
  try {
    await updateTaskStatus(gateTask.id, 'done');
  } catch (error) {
    gateError = error instanceof Error ? error.message : String(error);
  }
  assert(gateError === 'TASK_PENDING_DELEGATIONS', 'pending delegation gate should reject task completion');

  const expiredTask = await createTask('Expired chain');
  const expiredDelegation = await createDelegation(expiredTask.id, 'rd_manager', {
    title: 'expired delegation',
    goal: 'Persist expired status'
  });
  await expireDelegation(expiredDelegation.id, 'manual expire verification');
  const expiredDelegationAfter = await prisma.taskDelegation.findUniqueOrThrow({ where: { id: expiredDelegation.id } });
  assert(expiredDelegationAfter.status === 'expired', 'expired delegation should persist expired status');
  assert(Boolean(expiredDelegationAfter.expiredAt), 'expired delegation should persist expiredAt');

  const cancelledTask = await createTask('Cancelled chain');
  const cancelledDelegation = await createDelegation(cancelledTask.id, 'rd_manager', {
    title: 'cancelled delegation',
    goal: 'Persist cancelled status'
  });
  await cancelDelegation(cancelledDelegation.id, 'manual cancel verification');
  const cancelledDelegationAfter = await prisma.taskDelegation.findUniqueOrThrow({ where: { id: cancelledDelegation.id } });
  assert(cancelledDelegationAfter.status === 'cancelled', 'cancelled delegation should persist cancelled status');

  const retryTask = await createTask('Retry chain');
  const retryDelegationCreated = await createDelegation(retryTask.id, 'rd_manager', {
    title: 'retry delegation',
    goal: 'Verify retry budget handling',
    maxRetries: 1
  });
  await failDelegation(retryDelegationCreated.id, 'first retryable failure');
  const retriedDelegation = await retryDelegation(retryDelegationCreated.id);
  assert(retriedDelegation.status === 'queued', 'retry should requeue delegation');
  assert(retriedDelegation.retryCount === 1, 'retryCount should increment after retry');
  await failDelegation(retriedDelegation.id, 'second failure after retry');
  let retryBudgetError = '';
  try {
    await retryDelegation(retriedDelegation.id);
  } catch (error) {
    retryBudgetError = error instanceof Error ? error.message : String(error);
  }
  assert(retryBudgetError === 'Delegation retry budget exhausted', 'retry budget should be enforced');

  const summary = {
    dbPath: fixture.dbPath,
    migrateStdout,
    appliedMigrations,
    success: {
      taskId: successTask.id,
      delegationId: successDelegation.id,
      task: await prisma.task.findUnique({ where: { id: successTask.id } }),
      delegation: await prisma.taskDelegation.findUnique({ where: { id: successDelegation.id } })
    },
    fail: {
      taskId: failTask.id,
      delegationId: failDelegationResult.id,
      task: await prisma.task.findUnique({ where: { id: failTask.id } }),
      delegation: await prisma.taskDelegation.findUnique({ where: { id: failDelegationResult.id } })
    },
    gate: {
      taskId: gateTask.id,
      delegationId: gateDelegation.id,
      error: gateError,
      task: await prisma.task.findUnique({ where: { id: gateTask.id } }),
      delegation: await prisma.taskDelegation.findUnique({ where: { id: gateDelegation.id } })
    },
    expired: {
      taskId: expiredTask.id,
      delegationId: expiredDelegation.id,
      task: await prisma.task.findUnique({ where: { id: expiredTask.id } }),
      delegation: expiredDelegationAfter
    },
    cancelled: {
      taskId: cancelledTask.id,
      delegationId: cancelledDelegation.id,
      task: await prisma.task.findUnique({ where: { id: cancelledTask.id } }),
      delegation: cancelledDelegationAfter
    },
    retry: {
      taskId: retryTask.id,
      delegationId: retryDelegationCreated.id,
      retryBudgetError,
      task: await prisma.task.findUnique({ where: { id: retryTask.id } }),
      delegation: await prisma.taskDelegation.findUnique({ where: { id: retryDelegationCreated.id } })
    },
    taskDelegationRows: sqliteQueryRows(
      fixture.dbPath,
      'SELECT id, taskId, status, retryCount, maxRetries, expiredAt, failureReason FROM \"TaskDelegation\" ORDER BY createdAt;'
    )
  };

  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
