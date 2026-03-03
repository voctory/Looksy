import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../../protocol";
import { MacOSAdapter } from "../adapters/macos";
import { HostCore } from "../core";
import { StaticCommandPolicy } from "../policy";

const AUTH_TOKEN = "test-token";
const AUTH_TOKEN_ROTATED = "test-token-rotated";

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

  it("accepts handshake from any configured active token", () => {
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authTokens: [AUTH_TOKEN, "secondary-token"],
    });

    const primary = core.handshake(createHandshakeRequest({ requestId: "hs-primary", authToken: AUTH_TOKEN }));
    expect(primary.ok).toBe(true);

    const secondary = core.handshake(createHandshakeRequest({ requestId: "hs-secondary", authToken: "secondary-token" }));
    expect(secondary.ok).toBe(true);
  });

  it("rejects expired auth tokens", () => {
    let now = new Date("2026-03-03T00:00:00.000Z");
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authTokens: [
        {
          token: AUTH_TOKEN,
          expiresAt: "2026-03-03T00:00:02.000Z",
        },
      ],
      now: () => now,
    });

    const activeResponse = core.handshake(createHandshakeRequest({ requestId: "hs-active" }));
    expect(activeResponse.ok).toBe(true);

    now = new Date("2026-03-03T00:00:03.000Z");
    const expiredResponse = core.handshake(createHandshakeRequest({ requestId: "hs-expired" }));
    expect(expiredResponse.ok).toBe(false);
    if (!expiredResponse.ok) {
      expect(expiredResponse.error.code).toBe("AUTH_FAILED");
    }
  });

  it("rotates auth tokens while preserving backward-compatible single-token setup", () => {
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authToken: AUTH_TOKEN,
    });

    const initialResponse = core.handshake(createHandshakeRequest({ requestId: "hs-initial", authToken: AUTH_TOKEN }));
    expect(initialResponse.ok).toBe(true);

    core.rotateAuthToken(AUTH_TOKEN_ROTATED);

    const previousTokenResponse = core.handshake(
      createHandshakeRequest({ requestId: "hs-previous", authToken: AUTH_TOKEN }),
    );
    expect(previousTokenResponse.ok).toBe(false);
    if (!previousTokenResponse.ok) {
      expect(previousTokenResponse.error.code).toBe("AUTH_FAILED");
    }

    const rotatedTokenResponse = core.handshake(
      createHandshakeRequest({ requestId: "hs-rotated", authToken: AUTH_TOKEN_ROTATED }),
    );
    expect(rotatedTokenResponse.ok).toBe(true);
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

  it("persists screenshot artifacts and returns retrieval metadata", async () => {
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authToken: AUTH_TOKEN,
    });

    const sessionId = await createSession(core, "hs-artifacts");
    const alternateSessionId = await createSession(core, "hs-artifacts-alt");
    const response = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-artifact",
      sessionId,
      command: {
        type: "screen.capture",
      },
    });

    expect(response.ok).toBe(true);
    if (!response.ok || response.result.type !== "screen.captured") {
      return;
    }

    const expectedUrl = `/v1/artifacts/${encodeURIComponent(response.result.artifactId)}?sessionId=${encodeURIComponent(sessionId)}`;
    expect(response.result.artifactUrl).toBe(expectedUrl);

    const stored = core.readScreenshotArtifact({
      artifactId: response.result.artifactId,
      sessionId,
    });
    expect(stored).not.toBeNull();
    expect(stored?.mimeType).toBe(response.result.mimeType);
    expect(stored?.bytes).toEqual(Buffer.from("looksy-screenshot:macos:cmd-artifact:png", "utf8"));

    const denied = core.readScreenshotArtifact({
      artifactId: response.result.artifactId,
      sessionId: alternateSessionId,
    });
    expect(denied).toBeNull();
  });

  it("returns a metrics snapshot through observability.getMetrics", async () => {
    const core = new HostCore({
      adapter: new MacOSAdapter({
        delayMsByCommand: {
          "screen.capture": 50,
        },
      }),
      authToken: AUTH_TOKEN,
      defaultTimeoutMs: 10,
    });

    const sessionId = await createSession(core, "hs-metrics");

    const successResponse = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-success",
      sessionId,
      command: {
        type: "input.moveMouse",
        point: {
          x: 1,
          y: 2,
          space: "screen-dip",
        },
      },
    });
    expect(successResponse.ok).toBe(true);

    const timeoutResponse = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-timeout-metrics",
      sessionId,
      command: {
        type: "screen.capture",
      },
    });
    expect(timeoutResponse.ok).toBe(false);
    if (!timeoutResponse.ok) {
      expect(timeoutResponse.error.code).toBe("TIMEOUT");
    }

    const metricsResponse = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-metrics",
      sessionId,
      command: {
        type: "observability.getMetrics",
      },
    });

    expect(metricsResponse.ok).toBe(true);
    if (metricsResponse.ok) {
      expect(metricsResponse.result.type).toBe("observability.metrics");
      if (metricsResponse.result.type === "observability.metrics") {
        expect(metricsResponse.result.snapshot.successCount).toBe(1);
        expect(metricsResponse.result.snapshot.failureCount).toBe(1);
        expect(metricsResponse.result.snapshot.successByCommand["input.moveMouse"]).toBe(1);
        expect(metricsResponse.result.snapshot.failureByCommand["screen.capture"]).toBe(1);
        expect(metricsResponse.result.snapshot.failureByCode.TIMEOUT).toBe(1);
        expect(metricsResponse.result.snapshot.latencyMs.sampleCount).toBe(2);
      }
    }
  });

  it("returns INTERNAL when metrics snapshots are unavailable", async () => {
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authToken: AUTH_TOKEN,
      metrics: {
        recordSuccess: () => undefined,
        recordFailure: () => undefined,
      },
    });

    const sessionId = await createSession(core, "hs-no-metrics-snapshot");
    const response = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-no-metrics-snapshot",
      sessionId,
      command: {
        type: "observability.getMetrics",
      },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("INTERNAL");
    }
  });
});
