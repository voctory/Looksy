import { afterEach, describe, expect, it } from "vitest";
import { LooksyClient } from "../../client/ts/src/client.js";
import {
  LEGACY_ACTION_COMPAT_FEATURE_FLAG,
  createLegacyActionCompatibilityConfig,
  resolveLegacyActionCommandType,
} from "../../client/ts/src/compatibility.js";

const originalFeatureFlagValue = process.env[LEGACY_ACTION_COMPAT_FEATURE_FLAG];

afterEach(() => {
  if (originalFeatureFlagValue === undefined) {
    delete process.env[LEGACY_ACTION_COMPAT_FEATURE_FLAG];
    return;
  }

  process.env[LEGACY_ACTION_COMPAT_FEATURE_FLAG] = originalFeatureFlagValue;
});

describe("legacy action compatibility mapping", () => {
  it("maps legacy command names to protocol v1 command names when enabled", () => {
    const config = createLegacyActionCompatibilityConfig({ enabled: true });

    expect(resolveLegacyActionCommandType("screenshot", config)).toBe("screen.capture");
    expect(resolveLegacyActionCommandType("windows.list", config)).toBe("app.listWindows");
    expect(resolveLegacyActionCommandType("capabilities", config)).toBe("health.getCapabilities");
  });

  it("leaves command names unchanged when disabled", () => {
    const config = createLegacyActionCompatibilityConfig({ enabled: false });

    expect(resolveLegacyActionCommandType("screenshot", config)).toBe("screenshot");
  });

  it("uses feature flag when enabled is not provided", () => {
    process.env[LEGACY_ACTION_COMPAT_FEATURE_FLAG] = "true";
    const config = createLegacyActionCompatibilityConfig();

    expect(resolveLegacyActionCommandType("screenshot", config)).toBe("screen.capture");
  });

  it("applies mapping to outgoing command envelopes in LooksyClient", async () => {
    const sentBodies: unknown[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? "{}")));

      return new Response(
        JSON.stringify({
          protocolVersion: "1.0.0",
          requestId: "req_test",
          ok: true,
          result: {
            type: "screen.captured",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    };

    const client = new LooksyClient({
      authToken: "token-fixture-valid",
      fetchImpl,
      legacyActionCompatibility: { enabled: true },
    });

    client.setSessionId("sess_123");

    await client.command({
      command: {
        type: "screenshot",
      },
    });

    const firstBody = sentBodies[0] as {
      command: {
        type: string;
      };
    };

    expect(firstBody.command.type).toBe("screen.capture");
  });
});
