import { execSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";

type SnapshotInput = {
  seedDbPath: string;
  dbPath: string;
  cwd: string;
};

export function snapshotSqliteSeedDatabase(input: SnapshotInput): void {
  rmSync(input.dbPath, { force: true });
  const escapedDbPath = input.dbPath.replace(/'/g, "''");
  try {
    execSync(
      `sqlite3 ${JSON.stringify(input.seedDbPath)} ${JSON.stringify(`VACUUM INTO '${escapedDbPath}';`)}`,
      {
        cwd: input.cwd,
        stdio: "pipe"
      }
    );
  } catch {
    // Fallback for environments where sqlite VACUUM INTO is unavailable.
    copyFileSync(input.seedDbPath, input.dbPath);
  }
}
