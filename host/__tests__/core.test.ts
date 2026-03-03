import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../../protocol";
import { MacOSAdapter } from "../adapters/macos";
import { HostCore } from "../core";
import { StaticCommandPolicy } from "../policy";

const AUTH_TOKEN = "test-token";

function createHandshakeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: "hs-1",
    authToken: AUTH_TOKEN,
    client: {
      name: "tests",
      version: "1.0.0",
    },
    ...overrides,
  };
}

async function createSession(core: HostCore, requestId = "hs-1") {
  const handshake = core.handshake(createHandshakeRequest({ requestId }));
  expect(handshake.ok).toBe(true);

  if (!handshake.ok) {
    throw new Error("Expected handshake success");
  }

  return handshake.session.sessionId;
}

describe("HostCore", () => {
  it("accepts handshake with a valid token", () => {
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authToken: AUTH_TOKEN,
      sessionIdFactory: () => "session-1",
      now: () => new Date("2026-03-03T00:00:00.000Z"),
    });

    const response = core.handshake(createHandshakeRequest());
    expect(response.ok).toBe(true);

    if (!response.ok) {
      return;
    }

    expect(response.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(response.session.sessionId).toBe("session-1");
    expect(response.session.adapter).toBe("macos");
    expect(response.session.capabilities).toContain("control.cancel");
  });

  it("rejects handshake with an invalid token", () => {
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authToken: AUTH_TOKEN,
    });

    const response = core.handshake(createHandshakeRequest({ authToken: "wrong" }));
    expect(response.ok).toBe(false);

    if (!response.ok) {
      expect(response.error.code).toBe("AUTH_FAILED");
    }
  });

  it("applies policy allow/deny checks", async () => {
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authToken: AUTH_TOKEN,
      policy: new StaticCommandPolicy({ deny: ["screen.capture"] }),
    });

    const sessionId = await createSession(core);
    const response = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-1",
      sessionId,
      command: {
        type: "screen.capture",
      },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("POLICY_DENIED");
    }
  });

  it("enforces command timeout", async () => {
    const core = new HostCore({
      adapter: new MacOSAdapter({
        delayMsByCommand: {
          "screen.capture": 50,
        },
      }),
      authToken: AUTH_TOKEN,
      defaultTimeoutMs: 5,
    });

    const sessionId = await createSession(core);
    const response = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-timeout",
      sessionId,
      timeoutMs: 10,
      command: {
        type: "screen.capture",
      },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("TIMEOUT");
    }
  });

  it("supports canceling an in-flight command", async () => {
    const core = new HostCore({
      adapter: new MacOSAdapter({
        delayMsByCommand: {
          "screen.capture": 100,
        },
      }),
      authToken: AUTH_TOKEN,
      defaultTimeoutMs: 1_000,
    });

    const sessionId = await createSession(core);

    const inFlightPromise = core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-target",
      sessionId,
      command: {
        type: "screen.capture",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const cancelResponse = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-cancel",
      sessionId,
      command: {
        type: "control.cancel",
        targetRequestId: "cmd-target",
      },
    });

    expect(cancelResponse.ok).toBe(true);
    if (cancelResponse.ok) {
      expect(cancelResponse.result.type).toBe("control.cancelled");
      if (cancelResponse.result.type === "control.cancelled") {
        expect(cancelResponse.result.cancelled).toBe(true);
      }
    }

    const targetResponse = await inFlightPromise;
    expect(targetResponse.ok).toBe(false);
    if (!targetResponse.ok) {
      expect(targetResponse.error.code).toBe("CANCELLED");
    }
  });
});
