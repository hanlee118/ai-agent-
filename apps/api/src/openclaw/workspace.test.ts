import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOpenClawProviderApis,
  shouldRepairOpenAiProviderApi
} from "./workspace.js";

test("repairs proxied openai provider away from responses api", () => {
  const input = {
    models: {
      providers: {
        openai: {
          baseUrl: "https://ai.unboundtech.cn/v1",
          api: "openai-responses"
        }
      }
    }
  };

  const result = normalizeOpenClawProviderApis(input);
  assert.equal(result.changed, true);
  assert.equal(result.config.models?.providers?.openai?.api, "openai-completions");
  assert.equal(result.repairs.length, 1);
  assert.match(result.repairs[0]?.reason ?? "", /does not expose \/responses/i);
});

test("keeps official openai responses api unchanged", () => {
  assert.equal(shouldRepairOpenAiProviderApi({
    baseUrl: "https://api.openai.com/v1",
    api: "openai-responses"
  }), false);
});

test("ignores already-compatible openai completions config", () => {
  const input = {
    models: {
      providers: {
        openai: {
          baseUrl: "https://ai.unboundtech.cn/v1",
          api: "openai-completions"
        }
      }
    }
  };

  const result = normalizeOpenClawProviderApis(input);
  assert.equal(result.changed, false);
  assert.equal(result.config.models?.providers?.openai?.api, "openai-completions");
});
