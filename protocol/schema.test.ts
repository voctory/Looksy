import { describe, expect, it } from "vitest";
import { CommandEnvelopeSchema, CommandResultPayloadSchema, HandshakeRequestSchema, PROTOCOL_VERSION } from "./index";

describe("protocol schemas", () => {
  it("validates handshake payloads", () => {
    const payload = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: "hs-1",
      authToken: "token",
      client: {
        name: "tests",
        version: "1.0.0",
      },
    };

    const parsed = HandshakeRequestSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("requires coordinate-space annotations for point payloads", () => {
    const parsed = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-1",
      sessionId: "session-1",
      command: {
        type: "input.moveMouse",
        point: {
          x: 10,
          y: 20,
        },
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts observability metrics commands", () => {
    const parsed = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-metrics",
      sessionId: "session-1",
      command: {
        type: "observability.getMetrics",
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("validates observability metrics result payloads", () => {
    const parsed = CommandResultPayloadSchema.safeParse({
      type: "observability.metrics",
      snapshot: {
        successCount: 2,
        failureCount: 1,
        successByCommand: {
          "input.moveMouse": 2,
        },
        failureByCommand: {
          "screen.capture": 1,
        },
        failureByCode: {
          TIMEOUT: 1,
        },
        latencyMs: {
          sampleCount: 3,
          minMs: 2,
          maxMs: 20,
          avgMs: 10,
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts screen capture retrieval metadata in result payloads", () => {
    const parsed = CommandResultPayloadSchema.safeParse({
      type: "screen.captured",
      artifactId: "artifact-1",
      mimeType: "image/png",
      capturedAt: "2026-03-03T00:00:00.000Z",
      artifactUrl: "/v1/artifacts/artifact-1?sessionId=session-1",
    });

    expect(parsed.success).toBe(true);
  });
});
