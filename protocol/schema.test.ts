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

  it("accepts drag/swipe, clipboard, and window lifecycle command envelopes", () => {
    const drag = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-drag",
      sessionId: "session-1",
      command: {
        type: "input.drag",
        start: {
          x: 20,
          y: 30,
          space: "screen-dip",
        },
        end: {
          x: 260,
          y: 300,
          space: "screen-dip",
        },
        button: "left",
      },
    });
    expect(drag.success).toBe(true);

    const swipe = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-swipe",
      sessionId: "session-1",
      command: {
        type: "input.swipe",
        start: {
          x: 500,
          y: 400,
          space: "screen-physical",
        },
        end: {
          x: 420,
          y: 220,
          space: "screen-physical",
        },
      },
    });
    expect(swipe.success).toBe(true);

    const clipboardRead = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-clipboard-read",
      sessionId: "session-1",
      command: {
        type: "clipboard.read",
      },
    });
    expect(clipboardRead.success).toBe(true);

    const clipboardWrite = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-clipboard-write",
      sessionId: "session-1",
      command: {
        type: "clipboard.write",
        text: "hello clipboard",
      },
    });
    expect(clipboardWrite.success).toBe(true);

    const windowMove = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-window-move",
      sessionId: "session-1",
      command: {
        type: "app.windowMove",
        windowId: "window-1",
        point: {
          x: 120,
          y: 80,
          space: "screen-dip",
        },
      },
    });
    expect(windowMove.success).toBe(true);

    const windowResize = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-window-resize",
      sessionId: "session-1",
      command: {
        type: "app.windowResize",
        windowId: "window-1",
        width: 1280,
        height: 720,
        space: "screen-dip",
      },
    });
    expect(windowResize.success).toBe(true);

    const windowMinimize = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-window-minimize",
      sessionId: "session-1",
      command: {
        type: "app.windowMinimize",
        windowId: "window-1",
      },
    });
    expect(windowMinimize.success).toBe(true);

    const windowMaximize = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-window-maximize",
      sessionId: "session-1",
      command: {
        type: "app.windowMaximize",
        windowId: "window-1",
      },
    });
    expect(windowMaximize.success).toBe(true);

    const windowClose = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-window-close",
      sessionId: "session-1",
      command: {
        type: "app.windowClose",
        windowId: "window-1",
      },
    });
    expect(windowClose.success).toBe(true);
  });

  it("rejects invalid drag/clipboard/window lifecycle command envelopes", () => {
    const invalidDrag = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-drag-invalid",
      sessionId: "session-1",
      command: {
        type: "input.drag",
        start: {
          x: 0,
          y: 0,
          space: "screen-dip",
        },
      },
    });
    expect(invalidDrag.success).toBe(false);

    const invalidClipboardWrite = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-clipboard-write-invalid",
      sessionId: "session-1",
      command: {
        type: "clipboard.write",
        text: 42,
      },
    });
    expect(invalidClipboardWrite.success).toBe(false);

    const invalidWindowResize = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-window-resize-invalid",
      sessionId: "session-1",
      command: {
        type: "app.windowResize",
        windowId: "window-1",
        width: 0,
        height: 720,
        space: "screen-dip",
      },
    });
    expect(invalidWindowResize.success).toBe(false);
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

  it("accepts drag/swipe, clipboard, and window lifecycle result payloads", () => {
    const dragged = CommandResultPayloadSchema.safeParse({
      type: "input.dragged",
      start: {
        x: 10,
        y: 10,
        space: "screen-dip",
      },
      end: {
        x: 90,
        y: 140,
        space: "screen-dip",
      },
      button: "left",
    });
    expect(dragged.success).toBe(true);

    const swiped = CommandResultPayloadSchema.safeParse({
      type: "input.swiped",
      start: {
        x: 200,
        y: 300,
        space: "screen-physical",
      },
      end: {
        x: 140,
        y: 120,
        space: "screen-physical",
      },
    });
    expect(swiped.success).toBe(true);

    const clipboardRead = CommandResultPayloadSchema.safeParse({
      type: "clipboard.read",
      text: "hello clipboard",
    });
    expect(clipboardRead.success).toBe(true);

    const clipboardWritten = CommandResultPayloadSchema.safeParse({
      type: "clipboard.written",
      textLength: 15,
    });
    expect(clipboardWritten.success).toBe(true);

    const windowMoved = CommandResultPayloadSchema.safeParse({
      type: "app.windowMoved",
      windowId: "window-1",
      bounds: {
        x: 20,
        y: 40,
        width: 1280,
        height: 720,
        space: "screen-dip",
      },
    });
    expect(windowMoved.success).toBe(true);

    const windowResized = CommandResultPayloadSchema.safeParse({
      type: "app.windowResized",
      windowId: "window-1",
      bounds: {
        x: 20,
        y: 40,
        width: 1440,
        height: 900,
        space: "screen-dip",
      },
    });
    expect(windowResized.success).toBe(true);

    const windowMinimized = CommandResultPayloadSchema.safeParse({
      type: "app.windowMinimized",
      windowId: "window-1",
      minimized: true,
    });
    expect(windowMinimized.success).toBe(true);

    const windowMaximized = CommandResultPayloadSchema.safeParse({
      type: "app.windowMaximized",
      windowId: "window-1",
      maximized: true,
    });
    expect(windowMaximized.success).toBe(true);

    const windowClosed = CommandResultPayloadSchema.safeParse({
      type: "app.windowClosed",
      windowId: "window-1",
      closed: true,
    });
    expect(windowClosed.success).toBe(true);
  });

  it("rejects invalid drag/clipboard/window lifecycle result payloads", () => {
    const invalidSwipe = CommandResultPayloadSchema.safeParse({
      type: "input.swiped",
      start: {
        x: 200,
        y: 300,
        space: "screen-physical",
      },
    });
    expect(invalidSwipe.success).toBe(false);

    const invalidClipboardWritten = CommandResultPayloadSchema.safeParse({
      type: "clipboard.written",
      textLength: -1,
    });
    expect(invalidClipboardWritten.success).toBe(false);

    const invalidWindowClosed = CommandResultPayloadSchema.safeParse({
      type: "app.windowClosed",
      windowId: "window-1",
      closed: "yes",
    });
    expect(invalidWindowClosed.success).toBe(false);
  });
});
