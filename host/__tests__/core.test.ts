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

  it("expires sessions when session ttl elapses", async () => {
    let now = new Date("2026-03-03T00:00:00.000Z");
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authToken: AUTH_TOKEN,
      sessionTtlMs: 1_000,
      now: () => now,
      sessionIdFactory: () => "session-expiring",
    });

    const sessionId = await createSession(core, "hs-expiring");
    const beforeExpiry = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-before-expiry",
      sessionId,
      command: {
        type: "health.ping",
      },
    });
    expect(beforeExpiry.ok).toBe(true);

    now = new Date("2026-03-03T00:00:02.000Z");
    const expired = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-after-expiry",
      sessionId,
      command: {
        type: "health.ping",
      },
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.error.code).toBe("AUTH_FAILED");
    }
  });

  it("denies screenshot artifact reads after session expiry", async () => {
    let now = new Date("2026-03-03T00:00:00.000Z");
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authToken: AUTH_TOKEN,
      sessionTtlMs: 1_000,
      now: () => now,
      sessionIdFactory: () => "session-artifact-expiring",
    });

    const sessionId = await createSession(core, "hs-artifact-expiring");
    const response = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-artifact-expiring",
      sessionId,
      command: {
        type: "screen.capture",
      },
    });
    expect(response.ok).toBe(true);
    if (!response.ok || response.result.type !== "screen.captured") {
      return;
    }

    now = new Date("2026-03-03T00:00:02.000Z");
    const denied = core.readScreenshotArtifact({
      artifactId: response.result.artifactId,
      sessionId,
    });
    expect(denied).toBeNull();
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

  it("records non-adapter command failures in metrics", async () => {
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authToken: AUTH_TOKEN,
      policy: new StaticCommandPolicy({ deny: ["input.click"] }),
    });

    const sessionId = await createSession(core, "hs-failure-metrics");

    const policyDeniedResponse = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-policy-denied",
      sessionId,
      command: {
        type: "input.click",
        button: "left",
      },
    });
    expect(policyDeniedResponse.ok).toBe(false);
    if (!policyDeniedResponse.ok) {
      expect(policyDeniedResponse.error.code).toBe("POLICY_DENIED");
    }

    const authFailedResponse = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-auth-failed",
      sessionId: "missing-session",
      command: {
        type: "health.ping",
      },
    });
    expect(authFailedResponse.ok).toBe(false);
    if (!authFailedResponse.ok) {
      expect(authFailedResponse.error.code).toBe("AUTH_FAILED");
    }

    const unknownCommandResponse = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-unknown-command",
      sessionId,
      command: {
        type: "legacy.screenshot",
      },
    });
    expect(unknownCommandResponse.ok).toBe(false);
    if (!unknownCommandResponse.ok) {
      expect(unknownCommandResponse.error.code).toBe("UNKNOWN_COMMAND");
    }

    const metricsResponse = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-failure-metrics",
      sessionId,
      command: {
        type: "observability.getMetrics",
      },
    });

    expect(metricsResponse.ok).toBe(true);
    if (!metricsResponse.ok || metricsResponse.result.type !== "observability.metrics") {
      return;
    }

    expect(metricsResponse.result.snapshot.successCount).toBe(0);
    expect(metricsResponse.result.snapshot.failureCount).toBe(3);
    expect(metricsResponse.result.snapshot.failureByCommand["input.click"]).toBe(1);
    expect(metricsResponse.result.snapshot.failureByCommand["health.ping"]).toBe(1);
    expect(metricsResponse.result.snapshot.failureByCommand["legacy.screenshot"]).toBe(1);
    expect(metricsResponse.result.snapshot.failureByCode.POLICY_DENIED).toBe(1);
    expect(metricsResponse.result.snapshot.failureByCode.AUTH_FAILED).toBe(1);
    expect(metricsResponse.result.snapshot.failureByCode.UNKNOWN_COMMAND).toBe(1);
    expect(metricsResponse.result.snapshot.latencyMs.sampleCount).toBe(3);
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
