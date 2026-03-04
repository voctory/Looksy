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
  it("uses injected automation seams for input, clipboard, and app commands", async () => {
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
    const drag = vi.fn(async () => undefined);
    const swipe = vi.fn(async () => undefined);
    const clipboardRead = vi.fn(async () => "clip-text");
    const clipboardWrite = vi.fn(async () => undefined);
    const listWindows = vi.fn(async () => windows);
    const focusWindow = vi.fn(async () => true);
    const windowMove = vi.fn(async () => ({
      moved: true,
      bounds: {
        x: 160,
        y: 240,
        width: 1200,
        height: 900,
        space: "screen-physical" as const,
      },
    }));
    const windowResize = vi.fn(async () => ({
      resized: true,
      bounds: {
        x: 160,
        y: 240,
        width: 900,
        height: 600,
        space: "screen-physical" as const,
      },
    }));
    const windowMinimize = vi.fn(async () => true);
    const windowMaximize = vi.fn(async () => true);
    const windowClose = vi.fn(async () => false);
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
          drag,
          swipe,
          clipboardRead,
          clipboardWrite,
          listWindows,
          focusWindow,
          windowMove,
          windowResize,
          windowMinimize,
          windowMaximize,
          windowClose,
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

    const dragResponse = await issueCommand(core, sessionId, "cmd-windows-drag", {
      type: "input.drag",
      start: {
        x: 30,
        y: 10,
        space: "screen-dip",
      },
      end: {
        x: 40,
        y: 20,
        space: "screen-dip",
      },
      button: "left",
      modifiers: ["Shift"],
    });
    expect(dragResponse.ok).toBe(true);
    if (!dragResponse.ok || dragResponse.result.type !== "input.dragged") {
      return;
    }
    expect(dragResponse.result.start).toEqual({
      x: 60,
      y: 30,
      space: "screen-physical",
    });
    expect(dragResponse.result.end).toEqual({
      x: 80,
      y: 60,
      space: "screen-physical",
    });
    expect(dragResponse.result.button).toBe("left");
    expect(dragResponse.result.modifiers).toEqual(["Shift"]);

    const swipeResponse = await issueCommand(core, sessionId, "cmd-windows-swipe", {
      type: "input.swipe",
      start: {
        x: 2,
        y: 3,
        space: "screen-dip",
      },
      end: {
        x: 10,
        y: 12,
        space: "screen-dip",
      },
      modifiers: ["Control"],
    });
    expect(swipeResponse.ok).toBe(true);
    if (!swipeResponse.ok || swipeResponse.result.type !== "input.swiped") {
      return;
    }
    expect(swipeResponse.result.start).toEqual({
      x: 4,
      y: 9,
      space: "screen-physical",
    });
    expect(swipeResponse.result.end).toEqual({
      x: 20,
      y: 36,
      space: "screen-physical",
    });
    expect(swipeResponse.result.modifiers).toEqual(["Control"]);

    const clipboardReadResponse = await issueCommand(core, sessionId, "cmd-windows-clipboard-read", {
      type: "clipboard.read",
    });
    expect(clipboardReadResponse.ok).toBe(true);
    if (!clipboardReadResponse.ok || clipboardReadResponse.result.type !== "clipboard.read") {
      return;
    }
    expect(clipboardReadResponse.result.text).toBe("clip-text");

    const clipboardWriteResponse = await issueCommand(core, sessionId, "cmd-windows-clipboard-write", {
      type: "clipboard.write",
      text: "new-clip",
    });
    expect(clipboardWriteResponse.ok).toBe(true);
    if (!clipboardWriteResponse.ok || clipboardWriteResponse.result.type !== "clipboard.written") {
      return;
    }
    expect(clipboardWriteResponse.result.textLength).toBe(8);

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

    const windowMoveResponse = await issueCommand(core, sessionId, "cmd-windows-window-move", {
      type: "app.windowMove",
      windowId: "hwnd-111",
      point: {
        x: 80,
        y: 80,
        space: "screen-dip",
      },
    });
    expect(windowMoveResponse.ok).toBe(true);
    if (!windowMoveResponse.ok || windowMoveResponse.result.type !== "app.windowMoved") {
      return;
    }
    expect(windowMoveResponse.result.bounds).toEqual({
      x: 160,
      y: 240,
      width: 1200,
      height: 900,
      space: "screen-physical",
    });

    const windowResizeResponse = await issueCommand(core, sessionId, "cmd-windows-window-resize", {
      type: "app.windowResize",
      windowId: "hwnd-111",
      width: 450,
      height: 200,
      space: "screen-dip",
    });
    expect(windowResizeResponse.ok).toBe(true);
    if (!windowResizeResponse.ok || windowResizeResponse.result.type !== "app.windowResized") {
      return;
    }
    expect(windowResizeResponse.result.bounds).toEqual({
      x: 160,
      y: 240,
      width: 900,
      height: 600,
      space: "screen-physical",
    });

    const windowMinimizeResponse = await issueCommand(core, sessionId, "cmd-windows-window-minimize", {
      type: "app.windowMinimize",
      windowId: "hwnd-111",
    });
    expect(windowMinimizeResponse.ok).toBe(true);
    if (!windowMinimizeResponse.ok || windowMinimizeResponse.result.type !== "app.windowMinimized") {
      return;
    }
    expect(windowMinimizeResponse.result.minimized).toBe(true);

    const windowMaximizeResponse = await issueCommand(core, sessionId, "cmd-windows-window-maximize", {
      type: "app.windowMaximize",
      windowId: "hwnd-111",
    });
    expect(windowMaximizeResponse.ok).toBe(true);
    if (!windowMaximizeResponse.ok || windowMaximizeResponse.result.type !== "app.windowMaximized") {
      return;
    }
    expect(windowMaximizeResponse.result.maximized).toBe(true);

    const windowCloseResponse = await issueCommand(core, sessionId, "cmd-windows-window-close", {
      type: "app.windowClose",
      windowId: "hwnd-111",
    });
    expect(windowCloseResponse.ok).toBe(true);
    if (!windowCloseResponse.ok || windowCloseResponse.result.type !== "app.windowClosed") {
      return;
    }
    expect(windowCloseResponse.result.closed).toBe(false);

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
    expect(drag).toHaveBeenCalledWith(
      expect.objectContaining({
        start: {
          x: 60,
          y: 30,
          space: "screen-physical",
        },
        end: {
          x: 80,
          y: 60,
          space: "screen-physical",
        },
        button: "left",
        modifiers: ["Shift"],
      }),
    );
    expect(swipe).toHaveBeenCalledWith(
      expect.objectContaining({
        start: {
          x: 4,
          y: 9,
          space: "screen-physical",
        },
        end: {
          x: 20,
          y: 36,
          space: "screen-physical",
        },
        modifiers: ["Control"],
      }),
    );
    expect(clipboardRead).toHaveBeenCalledTimes(1);
    expect(clipboardWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "new-clip",
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
    expect(windowMove).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "hwnd-111",
        point: {
          x: 160,
          y: 240,
          space: "screen-physical",
        },
      }),
    );
    expect(windowResize).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "hwnd-111",
        width: 900,
        height: 600,
      }),
    );
    expect(windowMinimize).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "hwnd-111",
      }),
    );
    expect(windowMaximize).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "hwnd-111",
      }),
    );
    expect(windowClose).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "hwnd-111",
      }),
    );
    expect(screenDipToPhysicalPoint).toHaveBeenCalledTimes(9);
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
    expect(screenDipToPhysicalPoint).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        point: {
          x: 30,
          y: 10,
          space: "screen-dip",
        },
      }),
    );
    expect(screenDipToPhysicalPoint).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        point: {
          x: 40,
          y: 20,
          space: "screen-dip",
        },
      }),
    );
    expect(screenDipToPhysicalPoint).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({
        point: {
          x: 2,
          y: 3,
          space: "screen-dip",
        },
      }),
    );
    expect(screenDipToPhysicalPoint).toHaveBeenNthCalledWith(
      7,
      expect.objectContaining({
        point: {
          x: 10,
          y: 12,
          space: "screen-dip",
        },
      }),
    );
    expect(screenDipToPhysicalPoint).toHaveBeenNthCalledWith(
      8,
      expect.objectContaining({
        point: {
          x: 80,
          y: 80,
          space: "screen-dip",
        },
      }),
    );
    expect(screenDipToPhysicalPoint).toHaveBeenNthCalledWith(
      9,
      expect.objectContaining({
        point: {
          x: 450,
          y: 200,
          space: "screen-dip",
        },
      }),
    );
  });

  it("rejects window-client point space for global input commands", async () => {
    const moveMouse = vi.fn(async () => undefined);
    const click = vi.fn(async () => undefined);
    const scroll = vi.fn(async () => undefined);
    const drag = vi.fn(async () => undefined);
    const swipe = vi.fn(async () => undefined);
    const windowMove = vi.fn(async () => ({
      moved: true,
      bounds: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        space: "screen-physical" as const,
      },
    }));
    const windowResize = vi.fn(async () => ({
      resized: true,
      bounds: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        space: "screen-physical" as const,
      },
    }));
    const core = new HostCore({
      adapter: new WindowsAdapter({
        automation: {
          moveMouse,
          click,
          scroll,
          drag,
          swipe,
          windowMove,
          windowResize,
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
      {
        requestId: "cmd-window-client-drag-start",
        expectedMessage: "WINDOWS_INPUT_DRAG_START_WINDOW_CLIENT_UNSUPPORTED",
        command: {
          type: "input.drag",
          start: {
            x: 7,
            y: 8,
            space: "window-client",
          },
          end: {
            x: 9,
            y: 10,
            space: "screen-dip",
          },
        },
      },
      {
        requestId: "cmd-window-client-swipe-end",
        expectedMessage: "WINDOWS_INPUT_SWIPE_END_WINDOW_CLIENT_UNSUPPORTED",
        command: {
          type: "input.swipe",
          start: {
            x: 11,
            y: 12,
            space: "screen-dip",
          },
          end: {
            x: 13,
            y: 14,
            space: "window-client",
          },
        },
      },
      {
        requestId: "cmd-window-client-window-move",
        expectedMessage: "WINDOWS_APP_WINDOW_MOVE_WINDOW_CLIENT_UNSUPPORTED",
        command: {
          type: "app.windowMove",
          windowId: "hwnd-111",
          point: {
            x: 1,
            y: 2,
            space: "window-client",
          },
        },
      },
      {
        requestId: "cmd-window-client-window-resize",
        expectedMessage: "WINDOWS_APP_WINDOW_RESIZE_WINDOW_CLIENT_UNSUPPORTED",
        command: {
          type: "app.windowResize",
          windowId: "hwnd-111",
          width: 100,
          height: 200,
          space: "window-client",
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
    expect(drag).not.toHaveBeenCalled();
    expect(swipe).not.toHaveBeenCalled();
    expect(windowMove).not.toHaveBeenCalled();
    expect(windowResize).not.toHaveBeenCalled();
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

    const dragScript = __windowsCaptureTestInternals.buildWindowsDragPowerShellScript({
      start: {
        x: 10,
        y: 20,
        space: "screen-physical",
      },
      end: {
        x: 300,
        y: 440,
        space: "screen-physical",
      },
      button: "left",
      modifiers: ["Control"],
    });
    expect(dragScript).toContain("WINDOWS_INPUT_DRAG");
    expect(dragScript).toContain("SetCursorPos");
    expect(dragScript).toContain("$steps = [int][Math]::Ceiling($distance / 18.0)");
    expect(dragScript).toContain("New-LooksyMouseInput -flags $mouseDownFlag");
    expect(dragScript).toContain("Send-LooksyInput -inputs $modifierDownInputs.ToArray()");

    const swipeScript = __windowsCaptureTestInternals.buildWindowsSwipePowerShellScript({
      start: {
        x: 10,
        y: 20,
        space: "screen-physical",
      },
      end: {
        x: 30,
        y: 40,
        space: "screen-physical",
      },
      modifiers: ["Shift"],
    });
    expect(swipeScript).toContain("WINDOWS_INPUT_SWIPE");
    expect(swipeScript).toContain("New-LooksyMouseInput -flags $mouseDownFlag");

    const clipboardReadScript = __windowsCaptureTestInternals.buildWindowsClipboardReadPowerShellScript();
    expect(clipboardReadScript).toContain("Get-Clipboard -Raw");
    expect(clipboardReadScript).toContain("ConvertTo-Json -Compress");

    const clipboardWriteScript = __windowsCaptureTestInternals.buildWindowsClipboardWritePowerShellScript("O'Brien");
    expect(clipboardWriteScript).toContain("FromBase64String");
    expect(clipboardWriteScript).toContain("Set-Clipboard -Value $text -ErrorAction Stop");

    const windowMoveScript = __windowsCaptureTestInternals.buildWindowsWindowMovePowerShellScript({
      windowId: "hwnd-ABC",
      point: {
        x: 10,
        y: 20,
        space: "screen-physical",
      },
    });
    expect(windowMoveScript).toContain("SetWindowPos");
    expect(windowMoveScript).toContain("status = if ($setPos) { 'moved' } else { 'moveFailed' }");
    expect(windowMoveScript).toContain("^hwnd-([0-9A-Fa-f]+)$");

    const windowResizeScript = __windowsCaptureTestInternals.buildWindowsWindowResizePowerShellScript({
      windowId: "hwnd-ABC",
      width: 800,
      height: 600,
    });
    expect(windowResizeScript).toContain("SetWindowPos");
    expect(windowResizeScript).toContain("status = if ($setPos) { 'resized' } else { 'resizeFailed' }");

    const windowMinScript = __windowsCaptureTestInternals.buildWindowsWindowMinimizePowerShellScript("hwnd-ABC");
    expect(windowMinScript).toContain("ShowWindowAsync($hWnd, 6)");
    expect(windowMinScript).toContain("IsIconic");

    const windowMaxScript = __windowsCaptureTestInternals.buildWindowsWindowMaximizePowerShellScript("hwnd-ABC");
    expect(windowMaxScript).toContain("ShowWindowAsync($hWnd, 3)");
    expect(windowMaxScript).toContain("IsZoomed");

    const windowCloseScript = __windowsCaptureTestInternals.buildWindowsWindowClosePowerShellScript("hwnd-ABC");
    expect(windowCloseScript).toContain("PostMessageW");
    expect(windowCloseScript).toContain("status = if ($closed) { 'closed' } else { 'closePending' }");

    const elementFindScript = __windowsCaptureTestInternals.buildWindowsElementFindPowerShellScript({
      selector: "button.save",
      windowId: "hwnd-ABC",
    });
    expect(elementFindScript).toContain("Add-Type -AssemblyName UIAutomationClient");
    expect(elementFindScript).toContain("FindAll([System.Windows.Automation.TreeScope]::Subtree");
    expect(elementFindScript).toContain("$tokens = @()");

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

  it("parses focus, window, clipboard, element, and dip payloads with typed errors", () => {
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
      __windowsCaptureTestInternals.parseWindowsClipboardReadPayload({
        text: "hello",
      }),
    ).toBe("hello");
    expect(() =>
      __windowsCaptureTestInternals.parseWindowsClipboardReadPayload({
        text: 123,
      }),
    ).toThrowError("WINDOWS_CLIPBOARD_READ_INVALID_JSON");

    expect(
      __windowsCaptureTestInternals.parseWindowMovePayload({
        moved: true,
        status: "moved",
        bounds: {
          x: 1,
          y: 2,
          width: 300,
          height: 400,
          space: "screen-physical",
        },
      }),
    ).toEqual({
      moved: true,
      bounds: {
        x: 1,
        y: 2,
        width: 300,
        height: 400,
        space: "screen-physical",
      },
    });
    expect(() =>
      __windowsCaptureTestInternals.parseWindowMovePayload({
        moved: false,
        status: "invalidWindowId",
      }),
    ).toThrowError("WINDOWS_APP_WINDOW_MOVE_INVALID_WINDOW_ID");
    expect(() =>
      __windowsCaptureTestInternals.parseWindowMovePayload({
        moved: false,
        status: "moveFailed",
        errorCode: "5",
      }),
    ).toThrowError("WINDOWS_APP_WINDOW_MOVE_FAILED:5");

    expect(
      __windowsCaptureTestInternals.parseWindowResizePayload({
        resized: true,
        status: "resized",
        bounds: {
          x: 10,
          y: 20,
          width: 640,
          height: 480,
          space: "screen-physical",
        },
      }),
    ).toEqual({
      resized: true,
      bounds: {
        x: 10,
        y: 20,
        width: 640,
        height: 480,
        space: "screen-physical",
      },
    });
    expect(() =>
      __windowsCaptureTestInternals.parseWindowResizePayload({
        resized: false,
        status: "windowNotFound",
      }),
    ).toThrowError("WINDOWS_APP_WINDOW_RESIZE_WINDOW_NOT_FOUND");

    expect(
      __windowsCaptureTestInternals.parseWindowMinimizePayload({
        minimized: true,
        status: "minimized",
      }),
    ).toBe(true);
    expect(() =>
      __windowsCaptureTestInternals.parseWindowMinimizePayload({
        minimized: false,
        status: "minimizeFailed",
      }),
    ).toThrowError("WINDOWS_APP_WINDOW_MINIMIZE_FAILED");

    expect(
      __windowsCaptureTestInternals.parseWindowMaximizePayload({
        maximized: true,
        status: "maximized",
      }),
    ).toBe(true);
    expect(() =>
      __windowsCaptureTestInternals.parseWindowMaximizePayload({
        maximized: false,
        status: "invalidWindowId",
      }),
    ).toThrowError("WINDOWS_APP_WINDOW_MAXIMIZE_INVALID_WINDOW_ID");

    expect(
      __windowsCaptureTestInternals.parseWindowClosePayload({
        closed: false,
        status: "closePending",
      }),
    ).toBe(false);
    expect(() =>
      __windowsCaptureTestInternals.parseWindowClosePayload({
        closed: false,
        status: "closeFailed",
        errorCode: "3",
      }),
    ).toThrowError("WINDOWS_APP_WINDOW_CLOSE_FAILED:3");

    expect(
      __windowsCaptureTestInternals.parseWindowsElementFindPayload(
        {
          found: true,
          elementId: "uia-1.2.3",
          runtimeId: "1.2.3",
          rect: {
            x: 0,
            y: 0,
            width: 120,
            height: 34,
          },
        },
        "button.save",
        undefined,
      ),
    ).toEqual(
      expect.objectContaining({
        elementId: "uia-1.2.3",
        runtimeId: "1.2.3",
      }),
    );
    expect(
      __windowsCaptureTestInternals.parseWindowsElementFindPayload(
        {
          found: false,
        },
        "button.save",
        "hwnd-1",
      ),
    ).toBeNull();
    expect(() =>
      __windowsCaptureTestInternals.parseWindowsElementFindPayload(
        {
          found: true,
          elementId: "",
          runtimeId: "",
        },
        "button.save",
        undefined,
      ),
    ).toThrowError("WINDOWS_ELEMENT_FIND_INVALID_JSON");

    expect(
      __windowsCaptureTestInternals.parseWindowsElementInvokePayload({
        invoked: true,
      }),
    ).toBe(true);
    expect(() =>
      __windowsCaptureTestInternals.parseWindowsElementInvokePayload({
        invoked: "yes",
      }),
    ).toThrowError("WINDOWS_ELEMENT_INVOKE_INVALID_JSON");

    expect(
      __windowsCaptureTestInternals.parseWindowsElementSetValuePayload({
        valueSet: false,
      }),
    ).toBe(false);
    expect(() =>
      __windowsCaptureTestInternals.parseWindowsElementSetValuePayload({
        valueSet: "no",
      }),
    ).toThrowError("WINDOWS_ELEMENT_SET_VALUE_INVALID_JSON");

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
          requestId: "cmd-non-win-drag",
          expectedMessage: "WINDOWS_INPUT_DRAG_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "input.drag",
            start: {
              x: 5,
              y: 6,
              space: "screen-dip",
            },
            end: {
              x: 7,
              y: 8,
              space: "screen-dip",
            },
          },
        },
        {
          requestId: "cmd-non-win-swipe",
          expectedMessage: "WINDOWS_INPUT_SWIPE_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "input.swipe",
            start: {
              x: 1,
              y: 2,
              space: "screen-dip",
            },
            end: {
              x: 3,
              y: 4,
              space: "screen-dip",
            },
          },
        },
        {
          requestId: "cmd-non-win-clipboard-read",
          expectedMessage: "WINDOWS_CLIPBOARD_READ_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "clipboard.read",
          },
        },
        {
          requestId: "cmd-non-win-clipboard-write",
          expectedMessage: "WINDOWS_CLIPBOARD_WRITE_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "clipboard.write",
            text: "hello",
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
        {
          requestId: "cmd-non-win-window-move",
          expectedMessage: "WINDOWS_APP_WINDOW_MOVE_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "app.windowMove",
            windowId: "hwnd-1",
            point: {
              x: 1,
              y: 2,
              space: "screen-dip",
            },
          },
        },
        {
          requestId: "cmd-non-win-window-resize",
          expectedMessage: "WINDOWS_APP_WINDOW_RESIZE_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "app.windowResize",
            windowId: "hwnd-1",
            width: 640,
            height: 480,
            space: "screen-dip",
          },
        },
        {
          requestId: "cmd-non-win-window-minimize",
          expectedMessage: "WINDOWS_APP_WINDOW_MINIMIZE_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "app.windowMinimize",
            windowId: "hwnd-1",
          },
        },
        {
          requestId: "cmd-non-win-window-maximize",
          expectedMessage: "WINDOWS_APP_WINDOW_MAXIMIZE_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "app.windowMaximize",
            windowId: "hwnd-1",
          },
        },
        {
          requestId: "cmd-non-win-window-close",
          expectedMessage: "WINDOWS_APP_WINDOW_CLOSE_UNSUPPORTED_ON_NON_WINDOWS",
          command: {
            type: "app.windowClose",
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
