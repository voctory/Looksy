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
    const screenDipToPhysicalPoint = vi.fn(async ({ point }: { point: { x: number; y: number; space: "screen-dip" } }) => ({
      x: point.x * 2,
      y: point.y * 3,
    }));
    const core = new HostCore({
      adapter: new WindowsAdapter({
        screenDipToPhysicalPoint,
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
        space: "screen-dip",
      },
    });
    expect(moveMouseResponse.ok).toBe(true);

    const clickResponse = await issueCommand(core, sessionId, "cmd-windows-click", {
      type: "input.click",
      button: "left",
      point: {
        x: 15,
        y: 25,
        space: "screen-dip",
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
      point: {
        x: 30,
        y: 40,
        space: "screen-dip",
      },
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
          x: 20,
          y: 60,
          space: "screen-physical",
        },
      }),
    );
    expect(click).toHaveBeenCalledWith(
      expect.objectContaining({
        button: "left",
        point: {
          x: 30,
          y: 75,
          space: "screen-physical",
        },
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
        point: {
          x: 60,
          y: 120,
          space: "screen-physical",
        },
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
    expect(screenDipToPhysicalPoint).toHaveBeenCalledTimes(3);
    expect(screenDipToPhysicalPoint).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        point: {
          x: 10,
          y: 20,
          space: "screen-dip",
        },
      }),
    );
    expect(screenDipToPhysicalPoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        point: {
          x: 15,
          y: 25,
          space: "screen-dip",
        },
      }),
    );
    expect(screenDipToPhysicalPoint).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        point: {
          x: 30,
          y: 40,
          space: "screen-dip",
        },
      }),
    );
  });

  it("rejects window-client point space for global input commands", async () => {
    const moveMouse = vi.fn(async () => undefined);
    const click = vi.fn(async () => undefined);
    const scroll = vi.fn(async () => undefined);
    const core = new HostCore({
      adapter: new WindowsAdapter({
        automation: {
          moveMouse,
          click,
          scroll,
        },
      }),
      authToken: AUTH_TOKEN,
    });

    const sessionId = await createSession(core, "hs-windows-window-client-rejection");
    const commands: Array<{
      requestId: string;
      expectedMessage: string;
      command: Record<string, unknown>;
    }> = [
      {
        requestId: "cmd-window-client-move",
        expectedMessage: "WINDOWS_INPUT_MOVE_MOUSE_WINDOW_CLIENT_UNSUPPORTED",
        command: {
          type: "input.moveMouse",
          point: {
            x: 1,
            y: 2,
            space: "window-client",
          },
        },
      },
      {
        requestId: "cmd-window-client-click",
        expectedMessage: "WINDOWS_INPUT_CLICK_WINDOW_CLIENT_UNSUPPORTED",
        command: {
          type: "input.click",
          button: "left",
          point: {
            x: 3,
            y: 4,
            space: "window-client",
          },
        },
      },
      {
        requestId: "cmd-window-client-scroll",
        expectedMessage: "WINDOWS_INPUT_SCROLL_WINDOW_CLIENT_UNSUPPORTED",
        command: {
          type: "input.scroll",
          dx: 0,
          dy: -120,
          point: {
            x: 5,
            y: 6,
            space: "window-client",
          },
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

    expect(moveMouse).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("builds PowerShell scripts for pointer, windowing, and SendInput execution", () => {
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
    expect(focusWindowScript).toContain("GetForegroundWindow");
    expect(focusWindowScript).toContain("BringWindowToTop");
    expect(focusWindowScript).toContain("for ($attempt = 1; $attempt -le $maxAttempts; $attempt++)");
    expect(focusWindowScript).toContain("status = 'focusNotAcquired'");
    expect(focusWindowScript).toContain("errorCode = 'setForegroundWindowReturnedFalse'");
    expect(focusWindowScript).toContain("^hwnd-([0-9A-Fa-f]+)$");

    const clickScript = __windowsCaptureTestInternals.buildWindowsClickPowerShellScript({
      button: "left",
      point: {
        x: 300,
        y: 400,
        space: "screen-physical",
      },
    });
    expect(clickScript).toContain("function Send-LooksyInput {");
    expect(clickScript).toContain("[LooksyInputNative]::SendInput");
    expect(clickScript).toContain("Send-LooksyInput -inputs $inputs");
    expect(clickScript).toContain("New-LooksyMouseInput");
    expect(clickScript).not.toContain("mouse_event");

    const typeTextScript = __windowsCaptureTestInternals.buildWindowsTypeTextPowerShellScript("O'Brien{ENTER}");
    expect(typeTextScript).toContain("function Send-LooksyInput {");
    expect(typeTextScript).toContain("FromBase64String");
    expect(typeTextScript).toContain("Send-LooksyInput -inputs $inputs.ToArray()");
    expect(typeTextScript).toContain("New-LooksyKeyInput -wVk 0 -wScan $scanCode -flags 0x0004");
    expect(typeTextScript).not.toContain("SendKeys");

    const pressScript = __windowsCaptureTestInternals.buildWindowsPressKeyPowerShellScript({
      key: "Enter",
      modifiers: ["Control", "Shift"],
      repeat: 2,
    });
    expect(pressScript).toContain("function Send-LooksyInput {");
    expect(pressScript).toContain("[LooksyInputNative]::SendInput");
    expect(pressScript).toContain("$modifierVirtualKeys = @(17, 16)");
    expect(pressScript).toContain("$keyVirtualKey = [uint16]13");
    expect(pressScript).toContain("Send-LooksyInput -inputs $inputs.ToArray()");
    expect(pressScript).not.toContain("SendKeys");

    const spacePlan = __windowsCaptureTestInternals.buildWindowsPressKeySendInputPlan({
      key: "Space",
      repeat: 3,
    });
    expect(spacePlan).toEqual({
      mode: "virtual-key",
      repeat: 3,
      modifierVirtualKeys: [],
      keyVirtualKey: 0x20,
    });

    const scrollScript = __windowsCaptureTestInternals.buildWindowsScrollPowerShellScript({
      dx: 120,
      dy: -240,
      modifiers: ["Shift"],
    });
    expect(scrollScript).toContain("function Send-LooksyInput {");
    expect(scrollScript).toContain("[LooksyInputNative]::SendInput");
    expect(scrollScript).toContain("New-LooksyMouseInput -flags 0x1000");
    expect(scrollScript).toContain("New-LooksyMouseInput -flags 0x0800");
    expect(scrollScript).toContain("Send-LooksyInput -inputs $inputs.ToArray()");
    expect(scrollScript).not.toContain("keybd_event");

    const dipPointScript = __windowsCaptureTestInternals.buildWindowsScreenDipToPhysicalPointPowerShellScript({
      x: 111,
      y: 222,
      space: "screen-dip",
    });
    expect(dipPointScript).toContain("[LooksyDipConversionNative]::MonitorFromPoint");
    expect(dipPointScript).toContain("[LooksyDipConversionNative]::GetDpiForMonitor");
    expect(dipPointScript).toContain("[LooksyDipConversionNative]::GetDpiForSystem()");
    expect(dipPointScript).toContain(
      "[LooksyDipConversionNative]::GetDeviceCaps($desktopDc, [LooksyDipConversionNative]::LOGPIXELSX)",
    );
    expect(dipPointScript).toContain("Resolve-LooksyFallbackScale");
    expect(dipPointScript).toContain("[PSCustomObject]@{ x = [int]$x; y = [int]$y; scale = [double]$scale } | ConvertTo-Json -Compress");
  });

  it("parses focus and dip conversion payloads with typed errors", () => {
    expect(
      __windowsCaptureTestInternals.parseFocusWindowPayload({
        focused: true,
        status: "focused",
      }),
    ).toBe(true);
    expect(
      __windowsCaptureTestInternals.parseFocusWindowPayload({
        focused: false,
      }),
    ).toBe(false);
    expect(() =>
      __windowsCaptureTestInternals.parseFocusWindowPayload({
        focused: false,
        status: "invalidWindowId",
      }),
    ).toThrowError("WINDOWS_APP_FOCUS_WINDOW_INVALID_WINDOW_ID");
    expect(() =>
      __windowsCaptureTestInternals.parseFocusWindowPayload({
        focused: false,
        status: "windowNotFound",
      }),
    ).toThrowError("WINDOWS_APP_FOCUS_WINDOW_WINDOW_NOT_FOUND");
    expect(() =>
      __windowsCaptureTestInternals.parseFocusWindowPayload({
        focused: false,
        status: "focusNotAcquired",
        errorCode: "foregroundWindowDidNotMatch",
      }),
    ).toThrowError("WINDOWS_APP_FOCUS_WINDOW_FOCUS_NOT_ACQUIRED:foregroundWindowDidNotMatch");

    expect(
      __windowsCaptureTestInternals.parseWindowsScreenDipToPhysicalPointPayload({
        x: 120.4,
        y: 481.7,
        scale: 1.5,
      }),
    ).toEqual({
      x: 120,
      y: 482,
    });
    expect(() =>
      __windowsCaptureTestInternals.parseWindowsScreenDipToPhysicalPointPayload({
        x: Number.NaN,
        y: 2,
      }),
    ).toThrowError("WINDOWS_SCREEN_DIP_CONVERSION_INVALID_JSON");
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
              space: "screen-dip",
            },
          },
        },
        {
          requestId: "cmd-non-win-click",
          expectedMessage: "WINDOWS_INPUT_CLICK_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "input.click",
            button: "left",
            point: {
              x: 3,
              y: 4,
              space: "screen-dip",
            },
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
            point: {
              x: 5,
              y: 6,
              space: "screen-dip",
            },
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
