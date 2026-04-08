import {
  applyAllMigrationsFromFiles,
  applyLegacyUpgradeFromFiles,
  assert,
  bootstrapLegacyDb,
  makeTempDbPath,
  seedLegacyProjectData,
  sqliteQueryRows
} from './lib/task-delegation-testkit.ts';

type SqlRow = { sql: string };
type NameRow = { name: string };
type LegacyTaskRow = {
  id: string;
  ownerAgentId: string | null;
  reviewAgentId: string | null;
  coordinationMode: string;
  delegationPolicy: string;
  syncPolicy: string;
  contextScope: string | null;
  parentTaskId: string | null;
  pendingDelegationCount: number;
  lastDelegatedAt: string | null;
};

function getSingleSql(dbPath: string, type: 'table' | 'index', name: string) {
  const rows = sqliteQueryRows<SqlRow>(dbPath, `SELECT sql FROM sqlite_master WHERE type='${type}' AND name='${name}'`);
  return rows[0]?.sql ?? '';
}

async function main() {
  const expectedMigrations = [
    '20260331000000_baseline',
    '20260331123000_add_gitlab_sync',
    '20260407145000_task_delegation_hybrid',
    '20260407162000_add_project_execution'
  ];
  const providedEmptyDbPath = String(process.env.VERIFY_TASK_DELEGATION_EMPTY_DB_PATH || '').trim();
  const providedLegacyDbPath = String(process.env.VERIFY_TASK_DELEGATION_LEGACY_DB_PATH || '').trim();
  const emptyFixture = providedEmptyDbPath
    ? { dir: '', dbPath: providedEmptyDbPath }
    : makeTempDbPath('task-delegation-empty-migrate');
  const legacyFixture = providedLegacyDbPath
    ? { dir: '', dbPath: providedLegacyDbPath }
    : makeTempDbPath('task-delegation-legacy-migrate');

  const emptyStdout = providedEmptyDbPath ? 'skipped_external_migrate' : 'applied_from_migration_files';
  const emptyApplied = providedEmptyDbPath
    ? sqliteQueryRows<{ migration_name: string }>(
      emptyFixture.dbPath,
      'SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name;'
    ).map((item) => item.migration_name)
    : applyAllMigrationsFromFiles(emptyFixture.dbPath);

  let legacyStdout = providedLegacyDbPath ? 'skipped_external_migrate' : 'applied_from_migration_files';
  let legacyApplied = providedLegacyDbPath
    ? sqliteQueryRows<{ migration_name: string }>(
      legacyFixture.dbPath,
      'SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name;'
    ).map((item) => item.migration_name)
    : [];
  if (!providedLegacyDbPath) {
    bootstrapLegacyDb(legacyFixture.dbPath);
    seedLegacyProjectData(legacyFixture.dbPath, 'legacy-project-before-migration', 'legacy-task-before-migration');
    legacyApplied = [expectedMigrations[0], ...applyLegacyUpgradeFromFiles(legacyFixture.dbPath)];
  }

  assert(JSON.stringify(emptyApplied) === JSON.stringify(expectedMigrations), 'empty DB should apply full migration sequence');
  assert(JSON.stringify(legacyApplied) === JSON.stringify(expectedMigrations), 'legacy DB should resolve baseline then apply full migration sequence');

  const emptyTaskDelegationSql = getSingleSql(emptyFixture.dbPath, 'table', 'TaskDelegation');
  const legacyTaskDelegationSql = getSingleSql(legacyFixture.dbPath, 'table', 'TaskDelegation');
  assert(emptyTaskDelegationSql.includes('"outputPayloadJson" JSONB'), 'empty DB TaskDelegation should use JSONB outputPayloadJson');
  assert(emptyTaskDelegationSql.includes('"outputArtifactsJson" JSONB'), 'empty DB TaskDelegation should use JSONB outputArtifactsJson');
  assert(legacyTaskDelegationSql === emptyTaskDelegationSql, 'legacy DB TaskDelegation schema should match empty DB schema');

  const emptyProjectExecutionSql = getSingleSql(emptyFixture.dbPath, 'table', 'ProjectExecution');
  const legacyProjectExecutionSql = getSingleSql(legacyFixture.dbPath, 'table', 'ProjectExecution');
  assert(Boolean(emptyProjectExecutionSql), 'empty DB should contain ProjectExecution');
  assert(legacyProjectExecutionSql === emptyProjectExecutionSql, 'legacy DB ProjectExecution schema should match empty DB schema');

  const legacyTask = sqliteQueryRows<LegacyTaskRow>(
    legacyFixture.dbPath,
    `SELECT id, ownerAgentId, reviewAgentId, coordinationMode, delegationPolicy, syncPolicy, contextScope, parentTaskId, pendingDelegationCount, lastDelegatedAt FROM "Task" WHERE id='legacy-task-before-migration';`
  )[0];
  assert(Boolean(legacyTask), 'legacy task row should survive migration');
  assert(legacyTask.coordinationMode === 'single_owner', 'legacy task should receive default coordinationMode');
  assert(legacyTask.delegationPolicy === 'manual_only', 'legacy task should receive default delegationPolicy');
  assert(legacyTask.syncPolicy === 'db_plus_gitlab', 'legacy task should receive default syncPolicy');
  assert(legacyTask.pendingDelegationCount === 0, 'legacy task should receive default pendingDelegationCount=0');

  const badLegacyIndex = sqliteQueryRows<NameRow>(
    legacyFixture.dbPath,
    "SELECT name FROM sqlite_master WHERE type='index' AND name='GitLabSyncBinding_projectId_bindingType_key';"
  );
  assert(badLegacyIndex.length === 0, 'legacy DB should not keep incompatible GitLabSyncBinding_projectId_bindingType_key');

  const summary = {
    emptyDbPath: emptyFixture.dbPath,
    legacyDbPath: legacyFixture.dbPath,
    emptyStdout,
    legacyStdout,
    emptyApplied,
    legacyApplied,
    legacyTask,
    taskDelegationSql: emptyTaskDelegationSql,
    projectExecutionSql: emptyProjectExecutionSql,
    gitlabSyncBindingIndexes: sqliteQueryRows<{ name: string; sql: string }>(
      legacyFixture.dbPath,
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='GitLabSyncBinding' ORDER BY name;"
    )
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
