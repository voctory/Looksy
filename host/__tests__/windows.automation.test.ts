import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type WindowInfo } from "../../protocol";
import { __windowsCaptureTestInternals, WindowsAdapter } from "../adapters/windows";
import { HostCore } from "../core";

const AUTH_TOKEN = "test-token";

function createHandshakeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: "hs-windows-automation",
    authToken: AUTH_TOKEN,
    client: {
      name: "tests",
      version: "1.0.0",
    },
    ...overrides,
  };
}

async function createSession(core: HostCore, requestId = "hs-windows-automation") {
  const handshake = core.handshake(createHandshakeRequest({ requestId }));
  expect(handshake.ok).toBe(true);
  if (!handshake.ok) {
    throw new Error("Expected handshake success");
  }
  return handshake.session.sessionId;
}

async function issueCommand(core: HostCore, sessionId: string, requestId: string, command: unknown) {
  return core.command({
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    sessionId,
    command,
  });
}

describe("WindowsAdapter automation commands", () => {
  it("uses injected automation seams for input and app commands", async () => {
    const windows: WindowInfo[] = [
      {
        windowId: "hwnd-111",
        title: "File Explorer",
        appName: "explorer",
        focused: true,
        bounds: {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          space: "screen-physical",
        },
      },
    ];
    const moveMouse = vi.fn(async () => undefined);
    const click = vi.fn(async () => undefined);
    const typeText = vi.fn(async () => undefined);
    const pressKey = vi.fn(async () => undefined);
    const scroll = vi.fn(async () => undefined);
    const listWindows = vi.fn(async () => windows);
    const focusWindow = vi.fn(async () => true);
    const core = new HostCore({
      adapter: new WindowsAdapter({
        automation: {
          moveMouse,
          click,
          typeText,
          pressKey,
          scroll,
          listWindows,
          focusWindow,
        },
      }),
      authToken: AUTH_TOKEN,
    });

    const sessionId = await createSession(core, "hs-windows-automation-seams");

    const moveMouseResponse = await issueCommand(core, sessionId, "cmd-windows-move", {
      type: "input.moveMouse",
      point: {
        x: 10,
        y: 20,
        space: "screen-physical",
      },
    });
    expect(moveMouseResponse.ok).toBe(true);

    const clickResponse = await issueCommand(core, sessionId, "cmd-windows-click", {
      type: "input.click",
      button: "left",
      point: {
        x: 15,
        y: 25,
        space: "screen-physical",
      },
    });
    expect(clickResponse.ok).toBe(true);

    const typeTextResponse = await issueCommand(core, sessionId, "cmd-windows-type", {
      type: "input.typeText",
      text: "hello",
    });
    expect(typeTextResponse.ok).toBe(true);

    const pressKeyResponse = await issueCommand(core, sessionId, "cmd-windows-press", {
      type: "input.pressKey",
      key: "Enter",
      modifiers: ["Control"],
      repeat: 2,
    });
    expect(pressKeyResponse.ok).toBe(true);

    const scrollResponse = await issueCommand(core, sessionId, "cmd-windows-scroll", {
      type: "input.scroll",
      dx: 120,
      dy: -240,
      modifiers: ["Shift"],
    });
    expect(scrollResponse.ok).toBe(true);

    const listWindowsResponse = await issueCommand(core, sessionId, "cmd-windows-list", {
      type: "app.listWindows",
      includeMinimized: true,
      desktopOnly: false,
    });
    expect(listWindowsResponse.ok).toBe(true);
    if (!listWindowsResponse.ok || listWindowsResponse.result.type !== "app.windowsListed") {
      return;
    }
    expect(listWindowsResponse.result.windows).toEqual(windows);

    const focusWindowResponse = await issueCommand(core, sessionId, "cmd-windows-focus", {
      type: "app.focusWindow",
      windowId: "hwnd-111",
    });
    expect(focusWindowResponse.ok).toBe(true);
    if (!focusWindowResponse.ok || focusWindowResponse.result.type !== "app.windowFocused") {
      return;
    }
    expect(focusWindowResponse.result.focused).toBe(true);

    expect(moveMouse).toHaveBeenCalledWith(
      expect.objectContaining({
        point: {
          x: 10,
          y: 20,
          space: "screen-physical",
        },
      }),
    );
    expect(click).toHaveBeenCalledWith(
      expect.objectContaining({
        button: "left",
      }),
    );
    expect(typeText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello",
      }),
    );
    expect(pressKey).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "Enter",
        modifiers: ["Control"],
        repeat: 2,
      }),
    );
    expect(scroll).toHaveBeenCalledWith(
      expect.objectContaining({
        dx: 120,
        dy: -240,
        modifiers: ["Shift"],
      }),
    );
    expect(listWindows).toHaveBeenCalledWith(
      expect.objectContaining({
        includeMinimized: true,
        desktopOnly: false,
      }),
    );
    expect(focusWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "hwnd-111",
      }),
    );
  });

  it("builds PowerShell scripts with Windows API calls", () => {
    const moveScript = __windowsCaptureTestInternals.buildWindowsMoveMousePowerShellScript({
      x: 100,
      y: 240,
      space: "screen-physical",
    });
    expect(moveScript).toContain("SetCursorPos");
    expect(moveScript).toContain("Add-Type -TypeDefinition");

    const listWindowsScript = __windowsCaptureTestInternals.buildWindowsListWindowsPowerShellScript({
      includeMinimized: true,
      desktopOnly: false,
    });
    expect(listWindowsScript).toContain("EnumWindows");
    expect(listWindowsScript).toContain("GetWindowText");
    expect(listWindowsScript).toContain("ConvertTo-Json");

    const focusWindowScript = __windowsCaptureTestInternals.buildWindowsFocusWindowPowerShellScript("hwnd-ABC");
    expect(focusWindowScript).toContain("SetForegroundWindow");
    expect(focusWindowScript).toContain("^hwnd-([0-9A-Fa-f]+)$");
  });

  it.runIf(process.platform !== "win32")(
    "returns ADAPTER_FAILURE for real Windows automation commands on non-Windows hosts",
    async () => {
      const core = new HostCore({
        adapter: new WindowsAdapter(),
        authToken: AUTH_TOKEN,
      });
      const sessionId = await createSession(core, "hs-windows-automation-non-win");
      const commands: Array<{
        requestId: string;
        expectedMessage: string;
        command: Record<string, unknown>;
      }> = [
        {
          requestId: "cmd-non-win-move",
          expectedMessage: "WINDOWS_INPUT_MOVE_MOUSE_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "input.moveMouse",
            point: {
              x: 1,
              y: 2,
              space: "screen-physical",
            },
          },
        },
        {
          requestId: "cmd-non-win-click",
          expectedMessage: "WINDOWS_INPUT_CLICK_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "input.click",
            button: "left",
          },
        },
        {
          requestId: "cmd-non-win-type",
          expectedMessage: "WINDOWS_INPUT_TYPE_TEXT_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "input.typeText",
            text: "hello",
          },
        },
        {
          requestId: "cmd-non-win-press",
          expectedMessage: "WINDOWS_INPUT_PRESS_KEY_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "input.pressKey",
            key: "Enter",
          },
        },
        {
          requestId: "cmd-non-win-scroll",
          expectedMessage: "WINDOWS_INPUT_SCROLL_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "input.scroll",
            dx: 0,
            dy: -120,
          },
        },
        {
          requestId: "cmd-non-win-list",
          expectedMessage: "WINDOWS_APP_LIST_WINDOWS_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "app.listWindows",
          },
        },
        {
          requestId: "cmd-non-win-focus",
          expectedMessage: "WINDOWS_APP_FOCUS_WINDOW_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "app.focusWindow",
            windowId: "hwnd-1",
          },
        },
      ];

      for (const testCase of commands) {
        const response = await issueCommand(core, sessionId, testCase.requestId, testCase.command);
        expect(response.ok).toBe(false);
        if (response.ok) {
          continue;
        }
        expect(response.error.code).toBe("ADAPTER_FAILURE");
        expect(response.error.details).toEqual(
          expect.objectContaining({
            message: testCase.expectedMessage,
          }),
        );
      }
    },
  );
});
