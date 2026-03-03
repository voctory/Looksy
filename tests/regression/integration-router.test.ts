import { describe, expect, it } from "vitest";
import {
  createIntegrationRouter,
  createIntegrationRouterConfig,
  LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR_FEATURE_FLAG,
  LOOKSY_FORCE_LEGACY_EXECUTION_FEATURE_FLAG,
  LOOKSY_INTEGRATION_ENABLED_FEATURE_FLAG,
  type IntegrationCommandContext,
} from "../../client/ts/src/integrationRouter.js";
import type { CommandRequest, CommandResponse, ExtensibleCommandPayload } from "../../client/ts/src/protocol.js";

interface TestCommand extends ExtensibleCommandPayload {
  type: string;
  payload?: string;
}

interface TestContext extends IntegrationCommandContext {
  traceId?: string;
}

interface LegacyExecutionResult {
  source: "legacy";
  traceId?: string;
}

const LOOKSY_SUCCESS_RESPONSE: CommandResponse<{ source: "looksy" }> = {
  protocolVersion: "1.0.0",
  requestId: "req_looksy",
  ok: true,
  result: {
    source: "looksy",
  },
};

describe("integration router", () => {
  it("routes commands through Looksy when integration is enabled", async () => {
    const looksyCalls: Array<CommandRequest<TestCommand>> = [];
    const legacyCalls: Array<{ command: TestCommand; context?: TestContext }> = [];

    const router = createIntegrationRouter<TestCommand, TestContext, LegacyExecutionResult, { source: "looksy" }>({
      looksyClient: {
        async command<TResult, TCommand extends ExtensibleCommandPayload>(request: CommandRequest<TCommand>) {
          looksyCalls.push(request as CommandRequest<TestCommand>);
          return LOOKSY_SUCCESS_RESPONSE as CommandResponse<TResult>;
        },
      },
      legacyExecutor: async (input) => {
        legacyCalls.push(input);
        return { source: "legacy", traceId: input.context?.traceId };
      },
      featureFlags: {
        integrationEnabled: true,
      },
    });

    const result = await router.route({
      command: { type: "health.ping" },
      context: {
        requestId: "req_123",
        sessionId: "sess_123",
        timeoutMs: 1500,
        traceId: "trace_123",
      },
    });

    expect(result.route).toBe("looksy");
    expect(legacyCalls).toHaveLength(0);
    expect(looksyCalls).toHaveLength(1);
    expect(looksyCalls[0]).toMatchObject({
      requestId: "req_123",
      sessionId: "sess_123",
      timeoutMs: 1500,
      command: { type: "health.ping" },
    });
  });

  it("routes commands to legacy executor when integration is disabled", async () => {
    const looksyCalls: Array<CommandRequest<TestCommand>> = [];
    const router = createIntegrationRouter<TestCommand, TestContext, LegacyExecutionResult>({
      looksyClient: {
        async command<TResult, TCommand extends ExtensibleCommandPayload>(request: CommandRequest<TCommand>) {
          looksyCalls.push(request as CommandRequest<TestCommand>);
          return LOOKSY_SUCCESS_RESPONSE as CommandResponse<TResult>;
        },
      },
      legacyExecutor: async (input) => ({
        source: "legacy",
        traceId: input.context?.traceId,
      }),
      featureFlags: {
        integrationEnabled: false,
      },
    });

    const result = await router.route({
      command: { type: "screen.capture" },
      context: { traceId: "trace_disabled" },
    });

    expect(result.route).toBe("legacy");
    if (result.route === "legacy") {
      expect(result.reason).toBe("integration-disabled");
      expect(result.response).toEqual({ source: "legacy", traceId: "trace_disabled" });
    }
    expect(looksyCalls).toHaveLength(0);
  });

  it("uses legacy executor when force-legacy flag is enabled", async () => {
    const looksyCalls: Array<CommandRequest<TestCommand>> = [];
    const router = createIntegrationRouter<TestCommand, TestContext, LegacyExecutionResult>({
      looksyClient: {
        async command<TResult, TCommand extends ExtensibleCommandPayload>(request: CommandRequest<TCommand>) {
          looksyCalls.push(request as CommandRequest<TestCommand>);
          return LOOKSY_SUCCESS_RESPONSE as CommandResponse<TResult>;
        },
      },
      legacyExecutor: async () => ({
        source: "legacy",
      }),
      featureFlags: {
        integrationEnabled: true,
        forceLegacyExecution: true,
      },
    });

    const result = await router.route({
      command: { type: "app.listWindows" },
      context: { traceId: "trace_force_legacy" },
    });

    expect(result.route).toBe("legacy");
    if (result.route === "legacy") {
      expect(result.reason).toBe("force-legacy");
    }
    expect(looksyCalls).toHaveLength(0);
  });

  it("throws Looksy errors when fallback is disabled", async () => {
    const expectedError = new Error("looksy unavailable");
    let legacyCallCount = 0;

    const router = createIntegrationRouter<TestCommand, TestContext, LegacyExecutionResult>({
      looksyClient: {
        async command() {
          throw expectedError;
        },
      },
      legacyExecutor: async () => {
        legacyCallCount += 1;
        return { source: "legacy" };
      },
      featureFlags: {
        integrationEnabled: true,
        fallbackToLegacyOnError: false,
      },
    });

    await expect(
      router.route({
        command: { type: "health.ping" },
        context: {},
      }),
    ).rejects.toThrow("looksy unavailable");

    expect(legacyCallCount).toBe(0);
  });

  it("falls back to legacy executor when Looksy fails and fallback is enabled", async () => {
    const looksyError = new Error("looksy timeout");
    let legacyCallCount = 0;

    const router = createIntegrationRouter<TestCommand, TestContext, LegacyExecutionResult>({
      looksyClient: {
        async command() {
          throw looksyError;
        },
      },
      legacyExecutor: async (input) => {
        legacyCallCount += 1;
        return {
          source: "legacy",
          traceId: input.context?.traceId,
        };
      },
      featureFlags: {
        integrationEnabled: true,
        fallbackToLegacyOnError: true,
      },
    });

    const result = await router.route({
      command: { type: "screen.capture" },
      context: { traceId: "trace_fallback" },
    });

    expect(result.route).toBe("legacy-fallback");
    if (result.route === "legacy-fallback") {
      expect(result.reason).toBe("looksy-error");
      expect(result.response).toEqual({ source: "legacy", traceId: "trace_fallback" });
      expect(result.looksyError).toBe(looksyError);
    }
    expect(legacyCallCount).toBe(1);
  });

  it("resolves integration flags from environment values when explicit booleans are omitted", () => {
    const config = createIntegrationRouterConfig({
      env: {
        [LOOKSY_INTEGRATION_ENABLED_FEATURE_FLAG]: "yes",
        [LOOKSY_FORCE_LEGACY_EXECUTION_FEATURE_FLAG]: "0",
        [LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR_FEATURE_FLAG]: "on",
      },
    });

    expect(config.integrationEnabled).toBe(true);
    expect(config.forceLegacyExecution).toBe(false);
    expect(config.fallbackToLegacyOnError).toBe(true);
  });
});
