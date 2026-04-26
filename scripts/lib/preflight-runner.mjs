import { ensureDatabaseReady } from "./db-self-heal.mjs";
import { ensureApiReady } from "./api-self-heal.mjs";
import { ensureHermesReachableViaApi } from "./hermes-self-heal.mjs";

export async function runPreflight(options = {}) {
  const {
    needDb = false,
    db = {},
    needApi = false,
    api = {},
    needHermes = false,
    hermes = {},
    logger = null,
  } = options;

  const result = {
    db: null,
    api: null,
    hermes: null,
  };

  if (needDb) {
    logger?.("preflight: checking database");
    result.db = await ensureDatabaseReady(db);
  }

  if (needApi) {
    logger?.("preflight: checking api");
    result.api = await ensureApiReady(api);
  }

  if (needHermes) {
    logger?.("preflight: checking hermes");
    result.hermes = await ensureHermesReachableViaApi(hermes);
  }

  return result;
}
