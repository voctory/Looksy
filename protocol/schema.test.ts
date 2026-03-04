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

  it("accepts input pressKey and scroll command envelopes", () => {
    const pressKey = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-press-key",
      sessionId: "session-1",
      command: {
        type: "input.pressKey",
        key: "Enter",
        modifiers: ["Control", "Shift"],
        repeat: 2,
      },
    });
    expect(pressKey.success).toBe(true);

    const scroll = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-scroll",
      sessionId: "session-1",
      command: {
        type: "input.scroll",
        dx: 0,
        dy: -120.5,
        point: {
          x: 400,
          y: 220,
          space: "window-client",
        },
      },
    });
    expect(scroll.success).toBe(true);
  });

  it("rejects invalid input pressKey and scroll command envelopes", () => {
    const missingKey = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-press-key-invalid",
      sessionId: "session-1",
      command: {
        type: "input.pressKey",
        key: "",
      },
    });
    expect(missingKey.success).toBe(false);

    const invalidScroll = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-scroll-invalid",
      sessionId: "session-1",
      command: {
        type: "input.scroll",
        dx: "fast",
        dy: 100,
      },
    });
    expect(invalidScroll.success).toBe(false);
  });

  it("accepts browser command envelopes", () => {
    const navigate = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-browser-navigate",
      sessionId: "session-1",
      command: {
        type: "browser.navigate",
        url: "https://example.com",
      },
    });
    expect(navigate.success).toBe(true);

    const traceStart = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-browser-trace-start",
      sessionId: "session-1",
      command: {
        type: "browser.trace.start",
        traceName: "smoke",
      },
    });
    expect(traceStart.success).toBe(true);
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

  it("validates browser result payloads", () => {
    const snapshot = CommandResultPayloadSchema.safeParse({
      type: "browser.snapshot",
      url: "https://example.com",
      title: "example.com",
      html: "<html></html>",
      capturedAt: "2026-03-03T00:00:00.000Z",
    });
    expect(snapshot.success).toBe(true);

    const traceStop = CommandResultPayloadSchema.safeParse({
      type: "browser.traceStopped",
      traceId: "trace-1",
      stoppedAt: "2026-03-03T00:00:01.000Z",
      durationMs: 1250,
      eventCount: 4,
    });
    expect(traceStop.success).toBe(true);
  });

  it("accepts input keyPressed and scrolled result payloads", () => {
    const keyPressed = CommandResultPayloadSchema.safeParse({
      type: "input.keyPressed",
      key: "Enter",
      modifiers: ["Control"],
      repeat: 1,
    });
    expect(keyPressed.success).toBe(true);

    const scrolled = CommandResultPayloadSchema.safeParse({
      type: "input.scrolled",
      dx: 0,
      dy: -120,
      point: {
        x: 50,
        y: 75,
        space: "window-client",
      },
      modifiers: ["Alt"],
    });
    expect(scrolled.success).toBe(true);
  });
});
