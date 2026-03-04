import { describe, expect, it } from "vitest";
import {
  CommandResultEnvelopeSchema,
  HandshakeResultEnvelopeSchema,
  PROTOCOL_VERSION,
  type Point,
  type WindowInfo,
} from "../../protocol";
import { WindowsAdapter } from "../../host/adapters/windows";
import { HostCore } from "../../host/core";

const RUN_REAL_OS_INPUT_SMOKE = process.env.LOOKSY_WINDOWS_REAL_OS_INPUT_SMOKE === "1";
const AUTH_TOKEN = "smoke-token";

function createHandshakeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: "hs-windows-real-os-input-smoke",
    authToken: AUTH_TOKEN,
    client: {
      name: "smoke",
      version: "1.0.0",
    },
    ...overrides,
  };
}

function buildSafeMovePoint(window: WindowInfo | undefined): Point {
  if (!window) {
    return {
      x: 0,
      y: 0,
      space: "screen-physical",
    };
  }

  return {
    x: Math.round(window.bounds.x + Math.max(0, Math.min(50, window.bounds.width - 1))),
    y: Math.round(window.bounds.y + Math.max(0, Math.min(50, window.bounds.height - 1))),
    space: "screen-physical",
  };
}

describe("windows real os-input smoke", () => {
  it("validates handshake + app/window/input success envelopes on Windows when smoke mode is enabled", async () => {
    if (!RUN_REAL_OS_INPUT_SMOKE) {
      expect(true).toBe(true);
      return;
    }

    if (process.platform !== "win32") {
      expect(true).toBe(true);
      return;
    }

    const core = new HostCore({
      adapter: new WindowsAdapter(),
      authToken: AUTH_TOKEN,
    });

    const handshake = core.handshake(createHandshakeRequest());
    const parsedHandshake = HandshakeResultEnvelopeSchema.safeParse(handshake);
    expect(parsedHandshake.success).toBe(true);
    expect(handshake.ok).toBe(true);
    if (!handshake.ok) {
      throw new Error("Expected handshake success");
    }
    expect(handshake.session.adapter).toBe("windows");
    expect(handshake.session.capabilities).toContain("app.listWindows");
    expect(handshake.session.capabilities).toContain("input.moveMouse");

    const listWindowsResponse = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-windows-real-os-input-list",
      sessionId: handshake.session.sessionId,
      command: {
        type: "app.listWindows",
        includeMinimized: true,
        desktopOnly: false,
      },
    });
    const parsedListWindowsResponse = CommandResultEnvelopeSchema.safeParse(listWindowsResponse);
    expect(parsedListWindowsResponse.success).toBe(true);
    expect(listWindowsResponse.ok).toBe(true);
    if (!listWindowsResponse.ok || listWindowsResponse.result.type !== "app.windowsListed") {
      throw new Error("Expected app.windowsListed success envelope");
    }

    const [firstWindow] = listWindowsResponse.result.windows;
    if (firstWindow) {
      const focusResponse = await core.command({
        protocolVersion: PROTOCOL_VERSION,
        requestId: "cmd-windows-real-os-input-focus",
        sessionId: handshake.session.sessionId,
        command: {
          type: "app.focusWindow",
          windowId: firstWindow.windowId,
        },
      });
      const parsedFocusResponse = CommandResultEnvelopeSchema.safeParse(focusResponse);
      expect(parsedFocusResponse.success).toBe(true);
      expect(focusResponse.ok).toBe(true);
      if (!focusResponse.ok || focusResponse.result.type !== "app.windowFocused") {
        throw new Error("Expected app.windowFocused success envelope");
      }
      expect(focusResponse.result.windowId).toBe(firstWindow.windowId);
      expect(typeof focusResponse.result.focused).toBe("boolean");
    }

    const movePoint = buildSafeMovePoint(firstWindow);
    const moveMouseResponse = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-windows-real-os-input-move",
      sessionId: handshake.session.sessionId,
      command: {
        type: "input.moveMouse",
        point: movePoint,
      },
    });
    const parsedMoveMouseResponse = CommandResultEnvelopeSchema.safeParse(moveMouseResponse);
    expect(parsedMoveMouseResponse.success).toBe(true);
    expect(moveMouseResponse.ok).toBe(true);
    if (!moveMouseResponse.ok || moveMouseResponse.result.type !== "input.mouseMoved") {
      throw new Error("Expected input.mouseMoved success envelope");
    }
    expect(moveMouseResponse.result.point).toEqual(movePoint);
  });
});
