import test from "node:test";
import assert from "node:assert/strict";
import {
  applyScopedAgentModelConfig,
  applyOpenClawAgentMainSessionModelSync,
  classifyOpenClawAttemptFailure,
  isDesignAgentProfile,
  normalizeOpenClawProviderApis,
  parseOpenClawJson,
  parseOpenClawStatusJson,
  prioritizeFallbackModels,
  selectOpenClawFallbackModel,
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

test("prioritizes openai family for generic fallback chains", () => {
  const result = prioritizeFallbackModels([
    "anthropic/claude-sonnet-4-6",
    "openai/gpt-5.3-codex",
    "minima/MiniMax-M2.7-highspeed",
    "openai/gpt-5.4"
  ]);

  assert.deepEqual(result, [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "anthropic/claude-sonnet-4-6",
    "minima/MiniMax-M2.7-highspeed"
  ]);
});

test("classifies model unavailability and transport failures for retry decisions", () => {
  const unavailable = classifyOpenClawAttemptFailure("HTTP 503 bad_response_status_code: no available channel for model");
  assert.equal(unavailable.kind, "model_unavailable");
  assert.equal(unavailable.isModelUnavailableError, true);

  const transport = classifyOpenClawAttemptFailure("gateway connect failed: socket hang up");
  assert.equal(transport.kind, "gateway_repairable");
  assert.equal(transport.isTransportError, true);
  assert.equal(transport.isGatewayRepairableError, true);
});

test("prefers non-anthropic fallback when claude_code channel is unavailable", () => {
  const next = selectOpenClawFallbackModel({
    activeModel: "anthropic/claude-sonnet-4-6",
    fallbackQueue: [
      "anthropic/claude-opus-4-6",
      "openai/gpt-5.4",
      "openai/gpt-5.3-codex"
    ],
    fallbackCursor: 0,
    errorText: "claude_code: no available channel"
  });

  assert.equal(next, "openai/gpt-5.4");
});

test("synchronizes agent main session runtime model with provider-qualified target", () => {
  const result = applyOpenClawAgentMainSessionModelSync({
    "agent:requirements_analyst:main": {
      model: "gpt-5.3-codex",
      modelProvider: "openai",
      sessionId: "abc"
    },
    "agent:requirements_analyst:feishu:chat-1": {
      model: "claude-opus-4-6",
      modelProvider: "anthropic"
    }
  }, {
    agentId: "requirements_analyst",
    model: "openai/gpt-5.4"
  });

  assert.equal(result.changed, true);
  assert.equal(result.sessionStore["agent:requirements_analyst:main"]?.model, "gpt-5.4");
  assert.equal(result.sessionStore["agent:requirements_analyst:main"]?.modelProvider, "openai");
  assert.equal(result.sessionStore["agent:requirements_analyst:main"]?.modelOverride, "gpt-5.4");
  assert.equal(result.sessionStore["agent:requirements_analyst:main"]?.providerOverride, "openai");
  assert.equal(result.sessionStore["agent:requirements_analyst:feishu:chat-1"]?.model, "claude-opus-4-6");
  assert.equal(result.sessionStore["agent:requirements_analyst:feishu:chat-1"]?.modelProvider, "anthropic");
});

test("builds scoped config for process-local agent model override", () => {
  const input = {
    agents: {
      list: [
        {
          id: "requirements_analyst",
          model: {
            primary: "openai/gpt-5.3-codex",
            fallbacks: ["anthropic/claude-sonnet-4-6"]
          }
        },
        {
          id: "jeremy",
          model: "anthropic/claude-opus-4-6"
        }
      ]
    }
  };

  const result = applyScopedAgentModelConfig(input, {
    agentId: "requirements_analyst",
    model: "openai/gpt-5.4",
    fallbackModels: []
  });

  assert.deepEqual(result.agents?.list?.[0]?.model, {
    primary: "openai/gpt-5.4",
    fallbacks: []
  });
  assert.equal(result.agents?.list?.[1]?.model, "anthropic/claude-opus-4-6");
  assert.deepEqual(input.agents.list[0]?.model, {
    primary: "openai/gpt-5.3-codex",
    fallbacks: ["anthropic/claude-sonnet-4-6"]
  });
});

test("does not misclassify requirements analyst as design agent because of ui substring", () => {
  assert.equal(isDesignAgentProfile("requirements_analyst 需求分析师 需求清单、需求评审"), false);
  assert.equal(isDesignAgentProfile("jeremy ui designer"), true);
  assert.equal(isDesignAgentProfile("product-design 设计负责人"), true);
});

test("parses last valid OpenClaw json object from mixed stdout noise", () => {
  const payload = [
    "[plugin] booting...",
    "{\"debug\":true}",
    "{\"status\":\"ok\",\"summary\":\"done\",\"result\":{\"payloads\":[{\"text\":\"hello\"}]}}",
    "[plugin] trailing log"
  ].join("\n");

  const result = parseOpenClawJson(payload);
  assert.equal(result.status, "ok");
  assert.equal(result.result?.payloads?.[0]?.text, "hello");
});

test("parses OpenClaw status json from mixed output", () => {
  const payload = [
    "INFO gateway restarted",
    "{\"runtimeVersion\":\"1.2.3\",\"heartbeat\":{\"defaultAgentId\":\"main\"}}",
    "WARN plugin finished"
  ].join("\n");

  const result = parseOpenClawStatusJson(payload);
  assert.equal(result.runtimeVersion, "1.2.3");
  assert.equal(result.heartbeat?.defaultAgentId, "main");
});
