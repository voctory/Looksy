import { spawn } from "node:child_process";
import type { CommandResultPayload, WindowInfo } from "../../protocol";
import type { AdapterCommandPayload, AdapterExecutionContext, HostAdapter } from "../types";
import { mimeTypeForFormat, sleepAbortable, type SimulatedAdapterOptions, type SimulatedElement, throwIfAborted } from "./shared";

type ScreenCaptureCommand = Extract<AdapterCommandPayload, { type: "screen.capture" }>;
type ScreenCaptureRegion = NonNullable<ScreenCaptureCommand["region"]>;
type InputMoveMouseCommand = Extract<AdapterCommandPayload, { type: "input.moveMouse" }>;
type InputClickCommand = Extract<AdapterCommandPayload, { type: "input.click" }>;
type InputTypeTextCommand = Extract<AdapterCommandPayload, { type: "input.typeText" }>;
type InputPressKeyCommand = Extract<AdapterCommandPayload, { type: "input.pressKey" }>;
type InputScrollCommand = Extract<AdapterCommandPayload, { type: "input.scroll" }>;
type AppListWindowsCommand = Extract<AdapterCommandPayload, { type: "app.listWindows" }>;
type AppFocusWindowCommand = Extract<AdapterCommandPayload, { type: "app.focusWindow" }>;
type WindowsCaptureScreenParams = {
  format: "png" | "jpeg";
  region?: ScreenCaptureRegion;
  signal: AbortSignal;
};
type WindowsCaptureScreenFn = (params: WindowsCaptureScreenParams) => Promise<Buffer>;
type WindowsMoveMouseParams = {
  point: InputMoveMouseCommand["point"];
  signal: AbortSignal;
};
type WindowsMoveMouseFn = (params: WindowsMoveMouseParams) => Promise<void>;
type WindowsClickParams = {
  button: InputClickCommand["button"];
  point?: InputClickCommand["point"];
  signal: AbortSignal;
};
type WindowsClickFn = (params: WindowsClickParams) => Promise<void>;
type WindowsTypeTextParams = {
  text: string;
  signal: AbortSignal;
};
type WindowsTypeTextFn = (params: WindowsTypeTextParams) => Promise<void>;
type WindowsPressKeyParams = {
  key: string;
  modifiers?: readonly string[];
  repeat: number;
  signal: AbortSignal;
};
type WindowsPressKeyFn = (params: WindowsPressKeyParams) => Promise<void>;
type WindowsScrollParams = {
  dx: number;
  dy: number;
  point?: InputScrollCommand["point"];
  modifiers?: readonly string[];
  signal: AbortSignal;
};
type WindowsScrollFn = (params: WindowsScrollParams) => Promise<void>;
type WindowsListWindowsParams = {
  includeMinimized: boolean;
  desktopOnly: boolean;
  signal: AbortSignal;
};
type WindowsListWindowsFn = (params: WindowsListWindowsParams) => Promise<WindowInfo[]>;
type WindowsFocusWindowParams = {
  windowId: string;
  signal: AbortSignal;
};
type WindowsFocusWindowFn = (params: WindowsFocusWindowParams) => Promise<boolean>;
type WindowsScreenDipToPhysicalPointParams = {
  point: {
    x: number;
    y: number;
    space: "screen-dip";
  };
  signal: AbortSignal;
};
type WindowsScreenDipToPhysicalPointFn = (params: WindowsScreenDipToPhysicalPointParams) => Promise<{
  x: number;
  y: number;
}>;

interface WindowsAutomationFns {
  moveMouse: WindowsMoveMouseFn;
  click: WindowsClickFn;
  typeText: WindowsTypeTextFn;
  pressKey: WindowsPressKeyFn;
  scroll: WindowsScrollFn;
  listWindows: WindowsListWindowsFn;
  focusWindow: WindowsFocusWindowFn;
}

export interface WindowsAdapterOptions extends SimulatedAdapterOptions {
  captureScreen?: WindowsCaptureScreenFn;
  automation?: Partial<WindowsAutomationFns>;
  screenDipToPhysicalPoint?: WindowsScreenDipToPhysicalPointFn;
}

const WINDOWS_CAPTURE_NON_WIN32_MESSAGE = "WINDOWS_SCREEN_CAPTURE_UNSUPPORTED_ON_NON_WINDOWS";

const WINDOWS_CAPABILITIES: readonly AdapterCommandPayload["type"][] = [
  "health.ping",
  "health.getCapabilities",
  "screen.capture",
  "input.moveMouse",
  "input.click",
  "input.typeText",
  "input.pressKey",
  "input.scroll",
  "app.listWindows",
  "app.focusWindow",
  "browser.navigate",
  "browser.snapshot",
  "browser.pdf",
  "browser.console",
  "browser.trace.start",
  "browser.trace.stop",
  "element.find",
  "element.invoke",
  "element.setValue",
];

export class WindowsAdapter implements HostAdapter {
  readonly platform = "windows" as const;
  private readonly delayMsByCommand: Partial<Record<AdapterCommandPayload["type"], number>>;
  private readonly captureScreen: WindowsCaptureScreenFn;
  private readonly automation: WindowsAutomationFns;
  private readonly screenDipToPhysicalPoint: WindowsScreenDipToPhysicalPointFn;
  private readonly elements: SimulatedElement[];
  private readonly elementValues = new Map<string, string>();
  private browserUrl = "about:blank";
  private browserTitle = "Looksy";
  private readonly browserConsole: Array<{
    level: "debug" | "info" | "warn" | "error";
    text: string;
    timestamp: string;
  }> = [];
  private readonly activeTraceBySession = new Map<
    string,
    {
      traceId: string;
      startedAtMs: number;
      eventCount: number;
    }
  >();

  constructor(options: WindowsAdapterOptions = {}) {
    this.delayMsByCommand = options.delayMsByCommand ?? {};
    this.captureScreen = options.captureScreen ?? captureWindowsScreenViaPowerShell;
    this.automation = {
      moveMouse: options.automation?.moveMouse ?? moveMouseViaPowerShell,
      click: options.automation?.click ?? clickViaPowerShell,
      typeText: options.automation?.typeText ?? typeTextViaPowerShell,
      pressKey: options.automation?.pressKey ?? pressKeyViaPowerShell,
      scroll: options.automation?.scroll ?? scrollViaPowerShell,
      listWindows: options.automation?.listWindows ?? listWindowsViaPowerShell,
      focusWindow: options.automation?.focusWindow ?? focusWindowViaPowerShell,
    };
    this.screenDipToPhysicalPoint = options.screenDipToPhysicalPoint ?? convertScreenDipToPhysicalPoint;

    this.elements = [
      {
        elementId: "win-btn-save",
        selector: "button.save",
        windowId: "win-main",
        rect: { x: 1032, y: 758, width: 128, height: 34, space: "window-client" },
      },
      {
        elementId: "win-input-search",
        selector: "input.search",
        windowId: "win-main",
        rect: { x: 56, y: 36, width: 400, height: 32, space: "window-client" },
      },
    ];
  }

  getCapabilities(): readonly AdapterCommandPayload["type"][] {
    return WINDOWS_CAPABILITIES;
  }

  async execute(command: AdapterCommandPayload, context: AdapterExecutionContext): Promise<CommandResultPayload> {
    const delayMs = this.delayMsByCommand[command.type] ?? 0;
    await sleepAbortable(delayMs, context.signal);
    throwIfAborted(context.signal);

    switch (command.type) {
      case "health.ping":
        return {
          type: "health.pong",
          status: "ok",
          adapter: this.platform,
          now: new Date().toISOString(),
        };
      case "health.getCapabilities":
        return {
          type: "health.capabilities",
          capabilities: [...WINDOWS_CAPABILITIES, "control.cancel", "observability.getMetrics"],
        };
      case "screen.capture": {
        const artifactId = `windows-${context.requestId}`;
        const format = command.format ?? "png";
        const mimeType = mimeTypeForFormat(format);
        const capturedAt = new Date().toISOString();
        const bytes = await this.captureScreen({
          format,
          region: command.region,
          signal: context.signal,
        });
        if (bytes.byteLength === 0) {
          throw new Error("WINDOWS_SCREEN_CAPTURE_EMPTY_BYTES");
        }
        context.persistScreenshotArtifact({
          artifactId,
          mimeType,
          bytes,
          capturedAt,
        });
        return {
          type: "screen.captured",
          artifactId,
          mimeType,
          capturedAt,
          ...(command.region ? { region: command.region } : {}),
        };
      }
      case "input.moveMouse":
        {
          const normalizedPoint = await normalizeGlobalInputPoint(
            command.point,
            context.signal,
            "WINDOWS_INPUT_MOVE_MOUSE",
            this.screenDipToPhysicalPoint,
          );
          await this.automation.moveMouse({
            point: normalizedPoint,
            signal: context.signal,
          });
          return {
            type: "input.mouseMoved",
            point: normalizedPoint,
          };
        }
      case "input.click":
        {
          const normalizedPoint = command.point
            ? await normalizeGlobalInputPoint(
                command.point,
                context.signal,
                "WINDOWS_INPUT_CLICK",
                this.screenDipToPhysicalPoint,
              )
            : undefined;
          await this.automation.click({
            button: command.button,
            point: normalizedPoint,
            signal: context.signal,
          });
          return {
            type: "input.clicked",
            button: command.button,
            ...(normalizedPoint ? { point: normalizedPoint } : {}),
          };
        }
      case "input.typeText":
        await this.automation.typeText({
          text: command.text,
          signal: context.signal,
        });
        return {
          type: "input.typed",
          textLength: command.text.length,
        };
      case "input.pressKey":
        await this.automation.pressKey({
          key: command.key,
          modifiers: command.modifiers,
          repeat: command.repeat ?? 1,
          signal: context.signal,
        });
        return {
          type: "input.keyPressed",
          key: command.key,
          repeat: command.repeat ?? 1,
          ...(command.modifiers && command.modifiers.length > 0 ? { modifiers: command.modifiers } : {}),
        };
      case "input.scroll":
        {
          const normalizedPoint = command.point
            ? await normalizeGlobalInputPoint(
                command.point,
                context.signal,
                "WINDOWS_INPUT_SCROLL",
                this.screenDipToPhysicalPoint,
              )
            : undefined;
          await this.automation.scroll({
            dx: command.dx,
            dy: command.dy,
            point: normalizedPoint,
            modifiers: command.modifiers,
            signal: context.signal,
          });
          return {
            type: "input.scrolled",
            dx: command.dx,
            dy: command.dy,
            ...(normalizedPoint ? { point: normalizedPoint } : {}),
            ...(command.modifiers && command.modifiers.length > 0 ? { modifiers: command.modifiers } : {}),
          };
        }
      case "app.listWindows": {
        const windows = await this.automation.listWindows({
          includeMinimized: command.includeMinimized ?? false,
          desktopOnly: command.desktopOnly ?? false,
          signal: context.signal,
        });
        return {
          type: "app.windowsListed",
          windows,
        };
      }
      case "app.focusWindow": {
        const focused = await this.automation.focusWindow({
          windowId: command.windowId,
          signal: context.signal,
        });
        return {
          type: "app.windowFocused",
          windowId: command.windowId,
          focused,
        };
      }
      case "browser.navigate": {
        const navigatedAt = new Date().toISOString();
        this.browserUrl = command.url;
        this.browserTitle = deriveBrowserTitle(command.url);
        this.pushBrowserConsoleEntry("info", `Navigated to ${command.url}`, navigatedAt);
        this.recordTraceEvent(context.sessionId);
        return {
          type: "browser.navigated",
          url: this.browserUrl,
          title: this.browserTitle,
          navigatedAt,
        };
      }
      case "browser.snapshot": {
        const capturedAt = new Date().toISOString();
        this.pushBrowserConsoleEntry("debug", "Captured browser snapshot", capturedAt);
        this.recordTraceEvent(context.sessionId);
        const html = buildSnapshotHtml(this.browserTitle, this.browserUrl, this.platform, command.maxLength);
        return {
          type: "browser.snapshot",
          url: this.browserUrl,
          title: this.browserTitle,
          capturedAt,
          ...(command.includeHtml === false ? {} : { html }),
        };
      }
      case "browser.pdf": {
        const generatedAt = new Date().toISOString();
        this.pushBrowserConsoleEntry("info", "Generated browser PDF", generatedAt);
        this.recordTraceEvent(context.sessionId);
        const dataBase64 = Buffer.from(
          `looksy-browser-pdf:${this.platform}:${context.requestId}:${this.browserUrl}:${command.landscape ? "landscape" : "portrait"}:${command.pageRanges ?? "all"}`,
          "utf8",
        ).toString("base64");
        return {
          type: "browser.pdf",
          mimeType: "application/pdf",
          dataBase64,
          generatedAt,
        };
      }
      case "browser.console": {
        const limit = command.limit ?? 50;
        const entries = (command.level
          ? this.browserConsole.filter((entry) => entry.level === command.level)
          : this.browserConsole
        ).slice(-limit);
        this.recordTraceEvent(context.sessionId);
        return {
          type: "browser.console",
          entries,
        };
      }
      case "browser.trace.start": {
        const startedAt = new Date().toISOString();
        const traceId = `${this.platform}-${context.sessionId}-${context.requestId}`;
        this.activeTraceBySession.set(context.sessionId, {
          traceId,
          startedAtMs: Date.now(),
          eventCount: 0,
        });
        this.pushBrowserConsoleEntry("info", `Trace started (${command.traceName ?? traceId})`, startedAt);
        return {
          type: "browser.traceStarted",
          traceId,
          startedAt,
        };
      }
      case "browser.trace.stop": {
        const stoppedAt = new Date().toISOString();
        const activeTrace = this.activeTraceBySession.get(context.sessionId);
        if (activeTrace) {
          this.activeTraceBySession.delete(context.sessionId);
        }
        const traceId = command.traceId ?? activeTrace?.traceId ?? `${this.platform}-${context.sessionId}-trace`;
        const durationMs = Math.max(0, activeTrace ? Date.now() - activeTrace.startedAtMs : 0);
        const eventCount = activeTrace?.eventCount ?? 0;
        this.pushBrowserConsoleEntry("info", `Trace stopped (${traceId})`, stoppedAt);
        return {
          type: "browser.traceStopped",
          traceId,
          stoppedAt,
          durationMs,
          eventCount,
        };
      }
      case "element.find": {
        const element = this.elements.find(
          (candidate) =>
            candidate.selector === command.selector &&
            (!command.windowId || candidate.windowId === command.windowId),
        );

        if (!element) {
          return {
            type: "element.found",
            elementId: "not-found",
            confidence: 0,
          };
        }

        return {
          type: "element.found",
          elementId: element.elementId,
          confidence: 0.9,
          rect: element.rect,
        };
      }
      case "element.invoke": {
        const exists = this.elements.some((element) => element.elementId === command.elementId);
        return {
          type: "element.invoked",
          elementId: command.elementId,
          action: command.action,
          invoked: exists,
        };
      }
      case "element.setValue": {
        const exists = this.elements.some((element) => element.elementId === command.elementId);
        if (exists) {
          this.elementValues.set(command.elementId, command.value);
        }
        return {
          type: "element.valueSet",
          elementId: command.elementId,
          valueSet: exists,
        };
      }
      default:
        return assertNever(command);
    }
  }

  private pushBrowserConsoleEntry(
    level: "debug" | "info" | "warn" | "error",
    text: string,
    timestamp: string,
  ): void {
    this.browserConsole.push({ level, text, timestamp });
    if (this.browserConsole.length > 200) {
      this.browserConsole.splice(0, this.browserConsole.length - 200);
    }
  }

  private recordTraceEvent(sessionId: string): void {
    const activeTrace = this.activeTraceBySession.get(sessionId);
    if (activeTrace) {
      activeTrace.eventCount += 1;
    }
  }
}

function assertWindowsHost(message: string): void {
  if (process.platform !== "win32") {
    throw new Error(message);
  }
}

function toPowerShellBoolean(value: boolean): "$true" | "$false" {
  return value ? "$true" : "$false";
}

function escapePowerShellSingleQuotedString(value: string): string {
  return value.replaceAll("'", "''");
}

function normalizeScreenPoint(
  point:
    | InputMoveMouseCommand["point"]
    | NonNullable<InputClickCommand["point"]>
    | NonNullable<InputScrollCommand["point"]>,
  errorCode: string,
): { x: number; y: number } {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(errorCode);
  }
  return { x, y };
}

async function normalizeGlobalInputPoint(
  point:
    | InputMoveMouseCommand["point"]
    | NonNullable<InputClickCommand["point"]>
    | NonNullable<InputScrollCommand["point"]>,
  signal: AbortSignal,
  errorPrefix: string,
  screenDipToPhysicalPoint: WindowsScreenDipToPhysicalPointFn,
): Promise<{ x: number; y: number; space: "screen-physical" }> {
  if (point.space === "window-client") {
    throw new Error(`${errorPrefix}_WINDOW_CLIENT_UNSUPPORTED`);
  }

  const normalized = normalizeScreenPoint(point, `${errorPrefix}_INVALID_POINT`);
  if (point.space === "screen-physical") {
    return {
      x: normalized.x,
      y: normalized.y,
      space: "screen-physical",
    };
  }

  const converted = await screenDipToPhysicalPoint({
    point: {
      x: normalized.x,
      y: normalized.y,
      space: "screen-dip",
    },
    signal,
  });
  const normalizedConverted = normalizeScreenPoint(
    {
      x: converted.x,
      y: converted.y,
      space: "screen-physical",
    },
    `${errorPrefix}_SCREEN_DIP_CONVERSION_FAILED`,
  );
  return {
    x: normalizedConverted.x,
    y: normalizedConverted.y,
    space: "screen-physical",
  };
}

function buildWindowsInputTypeDefinitionLines(): string[] {
  return [
    "if (-not (\"LooksyInputNative\" -as [type])) {",
    "  Add-Type -TypeDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class LooksyInputNative {",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct INPUT {",
    "    public uint type;",
    "    public InputUnion U;",
    "  }",
    "  [StructLayout(LayoutKind.Explicit)]",
    "  public struct InputUnion {",
    "    [FieldOffset(0)] public MOUSEINPUT mi;",
    "    [FieldOffset(0)] public KEYBDINPUT ki;",
    "    [FieldOffset(0)] public HARDWAREINPUT hi;",
    "  }",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct MOUSEINPUT {",
    "    public int dx;",
    "    public int dy;",
    "    public uint mouseData;",
    "    public uint dwFlags;",
    "    public uint time;",
    "    public UIntPtr dwExtraInfo;",
    "  }",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct KEYBDINPUT {",
    "    public ushort wVk;",
    "    public ushort wScan;",
    "    public uint dwFlags;",
    "    public uint time;",
    "    public UIntPtr dwExtraInfo;",
    "  }",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct HARDWAREINPUT {",
    "    public uint uMsg;",
    "    public ushort wParamL;",
    "    public ushort wParamH;",
    "  }",
    "  [DllImport(\"user32.dll\", SetLastError = true)]",
    "  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);",
    "  [DllImport(\"user32.dll\", SetLastError = true)]",
    "  public static extern bool SetCursorPos(int X, int Y);",
    "}",
    "\"@",
    "}",
  ];
}

function buildWindowsSendInputHelperLines(errorPrefix: string): string[] {
  const escapedErrorPrefix = escapePowerShellSingleQuotedString(errorPrefix);
  return [
    "$looksyInputSize = [Runtime.InteropServices.Marshal]::SizeOf([type]'LooksyInputNative+INPUT')",
    "function New-LooksyMouseInput {",
    "  param([uint32]$flags, [uint32]$mouseData)",
    "  $input = New-Object LooksyInputNative+INPUT",
    "  $input.type = 0",
    "  $input.U.mi.dx = 0",
    "  $input.U.mi.dy = 0",
    "  $input.U.mi.mouseData = $mouseData",
    "  $input.U.mi.dwFlags = $flags",
    "  $input.U.mi.time = 0",
    "  $input.U.mi.dwExtraInfo = [UIntPtr]::Zero",
    "  return $input",
    "}",
    "function New-LooksyKeyInput {",
    "  param([uint16]$wVk, [uint16]$wScan, [uint32]$flags)",
    "  $input = New-Object LooksyInputNative+INPUT",
    "  $input.type = 1",
    "  $input.U.ki.wVk = $wVk",
    "  $input.U.ki.wScan = $wScan",
    "  $input.U.ki.dwFlags = $flags",
    "  $input.U.ki.time = 0",
    "  $input.U.ki.dwExtraInfo = [UIntPtr]::Zero",
    "  return $input",
    "}",
    "function Send-LooksyInput {",
    "  param([LooksyInputNative+INPUT[]]$inputs)",
    "  if (-not $inputs -or $inputs.Length -eq 0) { return }",
    "  $sent = [LooksyInputNative]::SendInput([uint32]$inputs.Length, $inputs, $looksyInputSize)",
    "  if ($sent -ne $inputs.Length) {",
    `    throw '${escapedErrorPrefix}_SEND_INPUT_FAILED'`,
    "  }",
    "}",
  ];
}

function buildWindowsMoveMousePowerShellScript(point: InputMoveMouseCommand["point"]): string {
  const normalized = normalizeScreenPoint(point, "WINDOWS_INPUT_MOVE_MOUSE_INVALID_POINT");
  return [
    "$ErrorActionPreference = 'Stop'",
    ...buildWindowsInputTypeDefinitionLines(),
    `$x = ${normalized.x}`,
    `$y = ${normalized.y}`,
    "if (-not [LooksyInputNative]::SetCursorPos($x, $y)) { throw 'SetCursorPos failed' }",
  ].join("\n");
}

async function moveMouseViaPowerShell(params: WindowsMoveMouseParams): Promise<void> {
  assertWindowsHost("WINDOWS_INPUT_MOVE_MOUSE_UNSUPPORTED_ON_NON_WINDOWS");
  const script = buildWindowsMoveMousePowerShellScript(params.point);
  await runPowerShellScript(script, params.signal, "WINDOWS_INPUT_MOVE_MOUSE");
}

function buildWindowsClickPowerShellScript(params: Omit<WindowsClickParams, "signal">): string {
  const buttonFlags: Record<InputClickCommand["button"], { down: number; up: number }> = {
    left: { down: 0x0002, up: 0x0004 },
    right: { down: 0x0008, up: 0x0010 },
    middle: { down: 0x0020, up: 0x0040 },
  };
  const flags = buttonFlags[params.button];
  const pointLines = params.point
    ? (() => {
        const normalized = normalizeScreenPoint(params.point, "WINDOWS_INPUT_CLICK_INVALID_POINT");
        return [
          `$x = ${normalized.x}`,
          `$y = ${normalized.y}`,
          "if (-not [LooksyInputNative]::SetCursorPos($x, $y)) { throw 'SetCursorPos failed' }",
        ];
      })()
    : [];
  return [
    "$ErrorActionPreference = 'Stop'",
    ...buildWindowsInputTypeDefinitionLines(),
    ...buildWindowsSendInputHelperLines("WINDOWS_INPUT_CLICK"),
    ...pointLines,
    `$mouseDownFlag = [uint32]${flags.down}`,
    `$mouseUpFlag = [uint32]${flags.up}`,
    "$inputs = @(",
    "  (New-LooksyMouseInput -flags $mouseDownFlag -mouseData 0),",
    "  (New-LooksyMouseInput -flags $mouseUpFlag -mouseData 0)",
    ")",
    "Send-LooksyInput -inputs $inputs",
  ].join("\n");
}

async function clickViaPowerShell(params: WindowsClickParams): Promise<void> {
  assertWindowsHost("WINDOWS_INPUT_CLICK_UNSUPPORTED_ON_NON_WINDOWS");
  const script = buildWindowsClickPowerShellScript({
    button: params.button,
    point: params.point,
  });
  await runPowerShellScript(script, params.signal, "WINDOWS_INPUT_CLICK");
}

function buildWindowsTypeTextPowerShellScript(text: string): string {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const textBase64 = Buffer.from(normalized, "utf16le").toString("base64");
  return [
    "$ErrorActionPreference = 'Stop'",
    ...buildWindowsInputTypeDefinitionLines(),
    ...buildWindowsSendInputHelperLines("WINDOWS_INPUT_TYPE_TEXT"),
    `$textBase64 = '${textBase64}'`,
    "$text = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($textBase64))",
    "$inputs = New-Object System.Collections.Generic.List[LooksyInputNative+INPUT]",
    "foreach ($character in $text.ToCharArray()) {",
    "  $charCode = [int][char]$character",
    "  if ($charCode -eq 9) {",
    "    $inputs.Add((New-LooksyKeyInput -wVk 0x09 -wScan 0 -flags 0))",
    "    $inputs.Add((New-LooksyKeyInput -wVk 0x09 -wScan 0 -flags 0x0002))",
    "    continue",
    "  }",
    "  if ($charCode -eq 10) {",
    "    $inputs.Add((New-LooksyKeyInput -wVk 0x0D -wScan 0 -flags 0))",
    "    $inputs.Add((New-LooksyKeyInput -wVk 0x0D -wScan 0 -flags 0x0002))",
    "    continue",
    "  }",
    "  $scanCode = [uint16]$charCode",
    "  $inputs.Add((New-LooksyKeyInput -wVk 0 -wScan $scanCode -flags 0x0004))",
    "  $inputs.Add((New-LooksyKeyInput -wVk 0 -wScan $scanCode -flags 0x0006))",
    "}",
    "Send-LooksyInput -inputs $inputs.ToArray()",
  ].join("\n");
}

async function typeTextViaPowerShell(params: WindowsTypeTextParams): Promise<void> {
  assertWindowsHost("WINDOWS_INPUT_TYPE_TEXT_UNSUPPORTED_ON_NON_WINDOWS");
  const script = buildWindowsTypeTextPowerShellScript(params.text);
  await runPowerShellScript(script, params.signal, "WINDOWS_INPUT_TYPE_TEXT");
}

const INPUT_MODIFIER_VK_BY_KEY = new Map<string, number>([
  ["shift", 0x10],
  ["ctrl", 0x11],
  ["control", 0x11],
  ["alt", 0x12],
]);

const PRESS_KEY_VK_BY_KEY = new Map<string, number>([
  ["enter", 0x0d],
  ["return", 0x0d],
  ["tab", 0x09],
  ["escape", 0x1b],
  ["esc", 0x1b],
  ["backspace", 0x08],
  ["delete", 0x2e],
  ["del", 0x2e],
  ["insert", 0x2d],
  ["home", 0x24],
  ["end", 0x23],
  ["pageup", 0x21],
  ["pagedown", 0x22],
  ["up", 0x26],
  ["arrowup", 0x26],
  ["down", 0x28],
  ["arrowdown", 0x28],
  ["left", 0x25],
  ["arrowleft", 0x25],
  ["right", 0x27],
  ["arrowright", 0x27],
  ["space", 0x20],
  ["spacebar", 0x20],
]);

function getInputModifierVirtualKey(modifier: string, errorPrefix: string): number {
  const normalized = modifier.trim().toLowerCase();
  const virtualKey = INPUT_MODIFIER_VK_BY_KEY.get(normalized);
  if (!virtualKey) {
    throw new Error(`${errorPrefix}_UNSUPPORTED_MODIFIER:${modifier}`);
  }
  return virtualKey;
}

function dedupeVirtualKeys(virtualKeys: readonly number[]): number[] {
  const deduped: number[] = [];
  for (const virtualKey of virtualKeys) {
    if (!deduped.includes(virtualKey)) {
      deduped.push(virtualKey);
    }
  }
  return deduped;
}

function resolvePressKeyVirtualKeyFromSingleCharacter(key: string): {
  virtualKey: number;
  requiredModifiers: readonly number[];
} {
  const codePoint = key.codePointAt(0);
  if (codePoint === undefined || codePoint > 0x7f) {
    throw new Error(`WINDOWS_INPUT_PRESS_KEY_UNSUPPORTED_KEY:${key}`);
  }
  if (key >= "a" && key <= "z") {
    return {
      virtualKey: key.toUpperCase().charCodeAt(0),
      requiredModifiers: [],
    };
  }
  if (key >= "A" && key <= "Z") {
    return {
      virtualKey: key.charCodeAt(0),
      requiredModifiers: [],
    };
  }
  if (key >= "0" && key <= "9") {
    return {
      virtualKey: key.charCodeAt(0),
      requiredModifiers: [],
    };
  }

  const shifted = [0x10];
  const unshifted: readonly number[] = [];
  const symbolMapping = new Map<string, { virtualKey: number; requiredModifiers: readonly number[] }>([
    ["`", { virtualKey: 0xc0, requiredModifiers: unshifted }],
    ["~", { virtualKey: 0xc0, requiredModifiers: shifted }],
    ["-", { virtualKey: 0xbd, requiredModifiers: unshifted }],
    ["_", { virtualKey: 0xbd, requiredModifiers: shifted }],
    ["=", { virtualKey: 0xbb, requiredModifiers: unshifted }],
    ["+", { virtualKey: 0xbb, requiredModifiers: shifted }],
    ["[", { virtualKey: 0xdb, requiredModifiers: unshifted }],
    ["{", { virtualKey: 0xdb, requiredModifiers: shifted }],
    ["]", { virtualKey: 0xdd, requiredModifiers: unshifted }],
    ["}", { virtualKey: 0xdd, requiredModifiers: shifted }],
    ["\\", { virtualKey: 0xdc, requiredModifiers: unshifted }],
    ["|", { virtualKey: 0xdc, requiredModifiers: shifted }],
    [";", { virtualKey: 0xba, requiredModifiers: unshifted }],
    [":", { virtualKey: 0xba, requiredModifiers: shifted }],
    ["'", { virtualKey: 0xde, requiredModifiers: unshifted }],
    ['"', { virtualKey: 0xde, requiredModifiers: shifted }],
    [",", { virtualKey: 0xbc, requiredModifiers: unshifted }],
    ["<", { virtualKey: 0xbc, requiredModifiers: shifted }],
    [".", { virtualKey: 0xbe, requiredModifiers: unshifted }],
    [">", { virtualKey: 0xbe, requiredModifiers: shifted }],
    ["/", { virtualKey: 0xbf, requiredModifiers: unshifted }],
    ["?", { virtualKey: 0xbf, requiredModifiers: shifted }],
    ["!", { virtualKey: 0x31, requiredModifiers: shifted }],
    ["@", { virtualKey: 0x32, requiredModifiers: shifted }],
    ["#", { virtualKey: 0x33, requiredModifiers: shifted }],
    ["$", { virtualKey: 0x34, requiredModifiers: shifted }],
    ["%", { virtualKey: 0x35, requiredModifiers: shifted }],
    ["^", { virtualKey: 0x36, requiredModifiers: shifted }],
    ["&", { virtualKey: 0x37, requiredModifiers: shifted }],
    ["*", { virtualKey: 0x38, requiredModifiers: shifted }],
    ["(", { virtualKey: 0x39, requiredModifiers: shifted }],
    [")", { virtualKey: 0x30, requiredModifiers: shifted }],
  ]);
  const mapped = symbolMapping.get(key);
  if (mapped) {
    return mapped;
  }

  throw new Error(`WINDOWS_INPUT_PRESS_KEY_UNSUPPORTED_KEY:${key}`);
}

type WindowsPressKeySendInputPlan =
  | {
      mode: "virtual-key";
      repeat: number;
      modifierVirtualKeys: readonly number[];
      keyVirtualKey: number;
    }
  | {
      mode: "unicode";
      repeat: number;
      modifierVirtualKeys: readonly number[];
      unicodeCodeUnits: readonly number[];
    };

function buildWindowsPressKeySendInputPlan(params: Omit<WindowsPressKeyParams, "signal">): WindowsPressKeySendInputPlan {
  const repeat = Math.round(params.repeat);
  if (!Number.isFinite(repeat) || repeat <= 0) {
    throw new Error("WINDOWS_INPUT_PRESS_KEY_INVALID_REPEAT");
  }

  const normalizedKey = params.key.trim().toLowerCase();
  if (!normalizedKey) {
    throw new Error("WINDOWS_INPUT_PRESS_KEY_INVALID_KEY");
  }

  const explicitModifierVirtualKeys = (params.modifiers ?? []).map((modifier) =>
    getInputModifierVirtualKey(modifier, "WINDOWS_INPUT_PRESS_KEY"),
  );
  const mappedVirtualKey = PRESS_KEY_VK_BY_KEY.get(normalizedKey);
  if (mappedVirtualKey) {
    return {
      mode: "virtual-key",
      repeat,
      modifierVirtualKeys: explicitModifierVirtualKeys,
      keyVirtualKey: mappedVirtualKey,
    };
  }

  const functionKey = /^f([1-9]|1\d|2[0-4])$/i.exec(normalizedKey);
  if (functionKey) {
    const functionKeyNumber = Number.parseInt(functionKey[1] ?? "", 10);
    return {
      mode: "virtual-key",
      repeat,
      modifierVirtualKeys: explicitModifierVirtualKeys,
      keyVirtualKey: 0x70 + functionKeyNumber - 1,
    };
  }

  if (params.key.length === 1 && explicitModifierVirtualKeys.length === 0) {
    return {
      mode: "unicode",
      repeat,
      modifierVirtualKeys: [],
      unicodeCodeUnits: [params.key.charCodeAt(0)],
    };
  }

  if (params.key.length === 1) {
    const singleCharacterMapping = resolvePressKeyVirtualKeyFromSingleCharacter(params.key);
    return {
      mode: "virtual-key",
      repeat,
      modifierVirtualKeys: dedupeVirtualKeys([
        ...explicitModifierVirtualKeys,
        ...singleCharacterMapping.requiredModifiers,
      ]),
      keyVirtualKey: singleCharacterMapping.virtualKey,
    };
  }

  throw new Error(`WINDOWS_INPUT_PRESS_KEY_UNSUPPORTED_KEY:${params.key}`);
}

function buildWindowsPressKeyPowerShellScript(params: Omit<WindowsPressKeyParams, "signal">): string {
  const plan = buildWindowsPressKeySendInputPlan(params);
  const modifierArray = plan.modifierVirtualKeys.length > 0 ? plan.modifierVirtualKeys.join(", ") : "";
  const declarationLines =
    plan.mode === "unicode"
      ? [`$unicodeCodeUnits = @(${plan.unicodeCodeUnits.join(", ")})`]
      : [`$keyVirtualKey = [uint16]${plan.keyVirtualKey}`];
  return [
    "$ErrorActionPreference = 'Stop'",
    ...buildWindowsInputTypeDefinitionLines(),
    ...buildWindowsSendInputHelperLines("WINDOWS_INPUT_PRESS_KEY"),
    `$repeat = ${plan.repeat}`,
    `$modifierVirtualKeys = @(${modifierArray})`,
    ...declarationLines,
    "$inputs = New-Object System.Collections.Generic.List[LooksyInputNative+INPUT]",
    "for ($i = 0; $i -lt $repeat; $i++) {",
    "  foreach ($vk in $modifierVirtualKeys) {",
    "    $inputs.Add((New-LooksyKeyInput -wVk ([uint16]$vk) -wScan 0 -flags 0))",
    "  }",
    ...(plan.mode === "unicode"
      ? [
          "  foreach ($unicodeCodeUnit in $unicodeCodeUnits) {",
          "    $scanCode = [uint16]$unicodeCodeUnit",
          "    $inputs.Add((New-LooksyKeyInput -wVk 0 -wScan $scanCode -flags 0x0004))",
          "    $inputs.Add((New-LooksyKeyInput -wVk 0 -wScan $scanCode -flags 0x0006))",
          "  }",
        ]
      : [
          "  $inputs.Add((New-LooksyKeyInput -wVk $keyVirtualKey -wScan 0 -flags 0))",
          "  $inputs.Add((New-LooksyKeyInput -wVk $keyVirtualKey -wScan 0 -flags 0x0002))",
        ]),
    "  for ($modifierIndex = $modifierVirtualKeys.Length - 1; $modifierIndex -ge 0; $modifierIndex--) {",
    "    $inputs.Add((New-LooksyKeyInput -wVk ([uint16]$modifierVirtualKeys[$modifierIndex]) -wScan 0 -flags 0x0002))",
    "  }",
    "}",
    "Send-LooksyInput -inputs $inputs.ToArray()",
  ].join("\n");
}

async function pressKeyViaPowerShell(params: WindowsPressKeyParams): Promise<void> {
  assertWindowsHost("WINDOWS_INPUT_PRESS_KEY_UNSUPPORTED_ON_NON_WINDOWS");
  const script = buildWindowsPressKeyPowerShellScript({
    key: params.key,
    modifiers: params.modifiers,
    repeat: params.repeat,
  });
  await runPowerShellScript(script, params.signal, "WINDOWS_INPUT_PRESS_KEY");
}

type WindowsScrollSendInputPlan = {
  dx: number;
  dy: number;
  modifierVirtualKeys: readonly number[];
};

function buildWindowsScrollSendInputPlan(params: Omit<WindowsScrollParams, "signal">): WindowsScrollSendInputPlan {
  const dx = Math.round(params.dx);
  const dy = Math.round(params.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new Error("WINDOWS_INPUT_SCROLL_INVALID_DELTA");
  }
  const modifierVirtualKeys = (params.modifiers ?? []).map((modifier) =>
    getInputModifierVirtualKey(modifier, "WINDOWS_INPUT_SCROLL"),
  );
  return {
    dx,
    dy,
    modifierVirtualKeys,
  };
}

function buildWindowsScrollPowerShellScript(params: Omit<WindowsScrollParams, "signal">): string {
  const plan = buildWindowsScrollSendInputPlan(params);
  const pointLines = params.point
    ? (() => {
        const normalized = normalizeScreenPoint(params.point, "WINDOWS_INPUT_SCROLL_INVALID_POINT");
        return [
          `$x = ${normalized.x}`,
          `$y = ${normalized.y}`,
          "if (-not [LooksyInputNative]::SetCursorPos($x, $y)) { throw 'SetCursorPos failed' }",
        ];
      })()
    : [];
  const modifierArray = plan.modifierVirtualKeys.length > 0 ? plan.modifierVirtualKeys.join(", ") : "";
  return [
    "$ErrorActionPreference = 'Stop'",
    ...buildWindowsInputTypeDefinitionLines(),
    ...buildWindowsSendInputHelperLines("WINDOWS_INPUT_SCROLL"),
    ...pointLines,
    `$dx = ${plan.dx}`,
    `$dy = ${plan.dy}`,
    `$modifierVirtualKeys = @(${modifierArray})`,
    "$inputs = New-Object System.Collections.Generic.List[LooksyInputNative+INPUT]",
    "foreach ($vk in $modifierVirtualKeys) {",
    "  $inputs.Add((New-LooksyKeyInput -wVk ([uint16]$vk) -wScan 0 -flags 0))",
    "}",
    "if ($dx -ne 0) {",
    "  $inputs.Add((New-LooksyMouseInput -flags 0x1000 -mouseData ([uint32]([int]$dx))))",
    "}",
    "if ($dy -ne 0) {",
    "  $inputs.Add((New-LooksyMouseInput -flags 0x0800 -mouseData ([uint32]([int]$dy))))",
    "}",
    "for ($i = $modifierVirtualKeys.Length - 1; $i -ge 0; $i--) {",
    "  $inputs.Add((New-LooksyKeyInput -wVk ([uint16]$modifierVirtualKeys[$i]) -wScan 0 -flags 0x0002))",
    "}",
    "Send-LooksyInput -inputs $inputs.ToArray()",
  ].join("\n");
}

async function scrollViaPowerShell(params: WindowsScrollParams): Promise<void> {
  assertWindowsHost("WINDOWS_INPUT_SCROLL_UNSUPPORTED_ON_NON_WINDOWS");
  const script = buildWindowsScrollPowerShellScript({
    dx: params.dx,
    dy: params.dy,
    point: params.point,
    modifiers: params.modifiers,
  });
  await runPowerShellScript(script, params.signal, "WINDOWS_INPUT_SCROLL");
}

function buildWindowsListWindowsPowerShellScript(params: Omit<WindowsListWindowsParams, "signal">): string {
  const includeMinimized = toPowerShellBoolean(params.includeMinimized);
  const desktopOnly = toPowerShellBoolean(params.desktopOnly);
  return [
    "$ErrorActionPreference = 'Stop'",
    "if (-not (\"LooksyWindowNative\" -as [type])) {",
    "  Add-Type -TypeDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "using System.Text;",
    "public static class LooksyWindowNative {",
    "  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct RECT {",
    "    public int Left;",
    "    public int Top;",
    "    public int Right;",
    "    public int Bottom;",
    "  }",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern bool IsWindowVisible(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern int GetWindowTextLength(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)]",
    "  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern bool IsIconic(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern IntPtr GetForegroundWindow();",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern IntPtr GetShellWindow();",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "}",
    "\"@",
    "}",
    `$includeMinimized = ${includeMinimized}`,
    `$desktopOnly = ${desktopOnly}`,
    "$foregroundWindow = [LooksyWindowNative]::GetForegroundWindow()",
    "$shellWindow = [LooksyWindowNative]::GetShellWindow()",
    "$windows = New-Object System.Collections.ArrayList",
    "$enumProc = [LooksyWindowNative+EnumWindowsProc]{",
    "  param([IntPtr]$hWnd, [IntPtr]$lParam)",
    "  if ($hWnd -eq $shellWindow) { return $true }",
    "  if (-not [LooksyWindowNative]::IsWindowVisible($hWnd)) { return $true }",
    "  if (-not $includeMinimized -and [LooksyWindowNative]::IsIconic($hWnd)) { return $true }",
    "  $titleLength = [LooksyWindowNative]::GetWindowTextLength($hWnd)",
    "  if ($titleLength -le 0) { return $true }",
    "  $titleBuilder = New-Object System.Text.StringBuilder($titleLength + 1)",
    "  [void][LooksyWindowNative]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity)",
    "  $title = $titleBuilder.ToString().Trim()",
    "  if ([string]::IsNullOrWhiteSpace($title)) { return $true }",
    "  $rect = New-Object LooksyWindowNative+RECT",
    "  if (-not [LooksyWindowNative]::GetWindowRect($hWnd, [ref]$rect)) { return $true }",
    "  $width = $rect.Right - $rect.Left",
    "  $height = $rect.Bottom - $rect.Top",
    "  if ($width -le 0 -or $height -le 0) { return $true }",
    "  $processId = [uint32]0",
    "  [void][LooksyWindowNative]::GetWindowThreadProcessId($hWnd, [ref]$processId)",
    "  $appName = 'Unknown'",
    "  if ($processId -gt 0) {",
    "    try {",
    "      $appName = [System.Diagnostics.Process]::GetProcessById([int]$processId).ProcessName",
    "    } catch {",
    "      $appName = 'Unknown'",
    "    }",
    "  }",
    "  if ($desktopOnly -and ($appName -eq 'ApplicationFrameHost' -or $appName -eq 'ShellExperienceHost')) { return $true }",
    "  $windowId = ('hwnd-{0:X}' -f $hWnd.ToInt64())",
    "  [void]$windows.Add([PSCustomObject]@{",
    "    windowId = $windowId",
    "    title = $title",
    "    appName = $appName",
    "    focused = ($hWnd -eq $foregroundWindow)",
    "    bounds = [PSCustomObject]@{",
    "      x = [double]$rect.Left",
    "      y = [double]$rect.Top",
    "      width = [double]$width",
    "      height = [double]$height",
    "      space = 'screen-physical'",
    "    }",
    "  })",
    "  return $true",
    "}",
    "[void][LooksyWindowNative]::EnumWindows($enumProc, [IntPtr]::Zero)",
    "$windows | ConvertTo-Json -Compress -Depth 6",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseWindowsListPayload(payload: unknown): WindowInfo[] {
  if (!Array.isArray(payload)) {
    throw new Error("WINDOWS_APP_LIST_WINDOWS_INVALID_JSON");
  }
  const windows: WindowInfo[] = [];
  for (const candidate of payload) {
    if (!isRecord(candidate)) {
      continue;
    }
    const bounds = candidate.bounds;
    if (!isRecord(bounds)) {
      continue;
    }
    if (
      typeof candidate.windowId !== "string" ||
      !candidate.windowId ||
      typeof candidate.title !== "string" ||
      !candidate.title ||
      typeof candidate.appName !== "string" ||
      !candidate.appName ||
      typeof candidate.focused !== "boolean"
    ) {
      continue;
    }
    if (
      typeof bounds.x !== "number" ||
      !Number.isFinite(bounds.x) ||
      typeof bounds.y !== "number" ||
      !Number.isFinite(bounds.y) ||
      typeof bounds.width !== "number" ||
      !Number.isFinite(bounds.width) ||
      bounds.width <= 0 ||
      typeof bounds.height !== "number" ||
      !Number.isFinite(bounds.height) ||
      bounds.height <= 0
    ) {
      continue;
    }
    const spaceRaw = bounds.space;
    if (spaceRaw !== "screen-physical" && spaceRaw !== "screen-dip" && spaceRaw !== "window-client") {
      continue;
    }
    windows.push({
      windowId: candidate.windowId,
      title: candidate.title,
      appName: candidate.appName,
      focused: candidate.focused,
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        space: spaceRaw,
      },
    });
  }
  return windows;
}

async function listWindowsViaPowerShell(params: WindowsListWindowsParams): Promise<WindowInfo[]> {
  assertWindowsHost("WINDOWS_APP_LIST_WINDOWS_UNSUPPORTED_ON_NON_WINDOWS");
  const script = buildWindowsListWindowsPowerShellScript({
    includeMinimized: params.includeMinimized,
    desktopOnly: params.desktopOnly,
  });
  const payload = await runPowerShellJson(script, params.signal, "WINDOWS_APP_LIST_WINDOWS");
  return parseWindowsListPayload(payload);
}

function buildWindowsFocusWindowPowerShellScript(windowId: string): string {
  const escapedWindowId = escapePowerShellSingleQuotedString(windowId);
  return [
    "$ErrorActionPreference = 'Stop'",
    "if (-not (\"LooksyWindowFocusNative\" -as [type])) {",
    "  Add-Type -TypeDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class LooksyWindowFocusNative {",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern bool IsWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern bool IsIconic(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern bool SetForegroundWindow(IntPtr hWnd);",
    "}",
    "\"@",
    "}",
    `$windowId = '${escapedWindowId}'`,
    "$match = [regex]::Match($windowId, '^hwnd-([0-9A-Fa-f]+)$')",
    "if (-not $match.Success) { [PSCustomObject]@{ focused = $false } | ConvertTo-Json -Compress; return }",
    "$hWndValue = [Convert]::ToInt64($match.Groups[1].Value, 16)",
    "$hWnd = [IntPtr]::new($hWndValue)",
    "if (-not [LooksyWindowFocusNative]::IsWindow($hWnd)) { [PSCustomObject]@{ focused = $false } | ConvertTo-Json -Compress; return }",
    "if ([LooksyWindowFocusNative]::IsIconic($hWnd)) { [void][LooksyWindowFocusNative]::ShowWindowAsync($hWnd, 9) }",
    "$focused = [LooksyWindowFocusNative]::SetForegroundWindow($hWnd)",
    "[PSCustomObject]@{ focused = [bool]$focused } | ConvertTo-Json -Compress",
  ].join("\n");
}

function parseFocusWindowPayload(payload: unknown): boolean {
  if (isRecord(payload) && typeof payload.focused === "boolean") {
    return payload.focused;
  }
  throw new Error("WINDOWS_APP_FOCUS_WINDOW_INVALID_JSON");
}

async function focusWindowViaPowerShell(params: WindowsFocusWindowParams): Promise<boolean> {
  assertWindowsHost("WINDOWS_APP_FOCUS_WINDOW_UNSUPPORTED_ON_NON_WINDOWS");
  const script = buildWindowsFocusWindowPowerShellScript(params.windowId);
  const payload = await runPowerShellJson(script, params.signal, "WINDOWS_APP_FOCUS_WINDOW");
  return parseFocusWindowPayload(payload);
}

async function captureWindowsScreenViaPowerShell(params: WindowsCaptureScreenParams): Promise<Buffer> {
  assertWindowsHost(WINDOWS_CAPTURE_NON_WIN32_MESSAGE);

  const script = buildWindowsCapturePowerShellScript(params);
  const bytes = await runPowerShellScript(script, params.signal, "WINDOWS_SCREEN_CAPTURE");
  if (bytes.byteLength === 0) {
    throw new Error("WINDOWS_SCREEN_CAPTURE_EMPTY_BYTES");
  }
  return bytes;
}

let cachedWindowsScreenDipScale: number | null = null;

function buildWindowsScreenDipScalePowerShellScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "if (-not (\"LooksyDpiScaleNative\" -as [type])) {",
    "  Add-Type -TypeDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class LooksyDpiScaleNative {",
    "  public const int LOGPIXELSX = 88;",
    "  [DllImport(\"user32.dll\", SetLastError = true)]",
    "  public static extern uint GetDpiForSystem();",
    "  [DllImport(\"user32.dll\", SetLastError = true)]",
    "  public static extern IntPtr GetDC(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\", SetLastError = true)]",
    "  public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);",
    "  [DllImport(\"gdi32.dll\", SetLastError = true)]",
    "  public static extern int GetDeviceCaps(IntPtr hdc, int index);",
    "}",
    "\"@",
    "}",
    "$dpi = 96.0",
    "$resolvedWithGetDpiForSystem = $false",
    "try {",
    "  $dpiForSystem = [double][LooksyDpiScaleNative]::GetDpiForSystem()",
    "  if ($dpiForSystem -gt 0) {",
    "    $dpi = $dpiForSystem",
    "    $resolvedWithGetDpiForSystem = $true",
    "  }",
    "} catch {",
    "}",
    "if (-not $resolvedWithGetDpiForSystem) {",
    "  $desktopDc = [LooksyDpiScaleNative]::GetDC([IntPtr]::Zero)",
    "  try {",
    "    if ($desktopDc -ne [IntPtr]::Zero) {",
    "      $logPixelsX = [LooksyDpiScaleNative]::GetDeviceCaps($desktopDc, [LooksyDpiScaleNative]::LOGPIXELSX)",
    "      if ($logPixelsX -gt 0) {",
    "        $dpi = [double]$logPixelsX",
    "      }",
    "    }",
    "  } finally {",
    "    if ($desktopDc -ne [IntPtr]::Zero) { [void][LooksyDpiScaleNative]::ReleaseDC([IntPtr]::Zero, $desktopDc) }",
    "  }",
    "}",
    "if ($dpi -le 0) { $dpi = 96.0 }",
    "$scale = $dpi / 96.0",
    "if ([double]::IsNaN($scale) -or [double]::IsInfinity($scale) -or $scale -le 0) { $scale = 1.0 }",
    "[PSCustomObject]@{ scale = [double]$scale } | ConvertTo-Json -Compress",
  ].join("\n");
}

function parseWindowsScreenDipScalePayload(payload: unknown): number {
  if (isRecord(payload) && typeof payload.scale === "number" && Number.isFinite(payload.scale) && payload.scale > 0) {
    return payload.scale;
  }
  throw new Error("WINDOWS_SCREEN_DIP_SCALE_INVALID_JSON");
}

async function getWindowsScreenDipScale(signal: AbortSignal): Promise<number> {
  if (cachedWindowsScreenDipScale !== null) {
    return cachedWindowsScreenDipScale;
  }
  const payload = await runPowerShellJson(
    buildWindowsScreenDipScalePowerShellScript(),
    signal,
    "WINDOWS_SCREEN_DIP_SCALE",
  );
  const scale = parseWindowsScreenDipScalePayload(payload);
  cachedWindowsScreenDipScale = scale;
  return scale;
}

async function convertScreenDipToPhysicalPoint(
  params: WindowsScreenDipToPhysicalPointParams,
): Promise<{ x: number; y: number }> {
  throwIfAborted(params.signal);
  if (process.platform !== "win32") {
    return {
      x: params.point.x,
      y: params.point.y,
    };
  }
  const scale = await getWindowsScreenDipScale(params.signal);
  throwIfAborted(params.signal);
  const x = Math.round(params.point.x * scale);
  const y = Math.round(params.point.y * scale);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("WINDOWS_SCREEN_DIP_SCALE_INVALID_RESULT");
  }
  return {
    x,
    y,
  };
}

function normalizeCaptureRegion(region?: ScreenCaptureRegion): { x: number; y: number; width: number; height: number } | null {
  if (!region) {
    return null;
  }
  const x = Math.round(region.x);
  const y = Math.round(region.y);
  const width = Math.round(region.width);
  const height = Math.round(region.height);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("WINDOWS_SCREEN_CAPTURE_INVALID_REGION");
  }
  if (width <= 0 || height <= 0) {
    throw new Error("WINDOWS_SCREEN_CAPTURE_INVALID_REGION");
  }
  return { x, y, width, height };
}

function buildWindowsCapturePowerShellScript(params: WindowsCaptureScreenParams): string {
  const region = normalizeCaptureRegion(params.region);
  const rectLine = region
    ? `$rect = New-Object System.Drawing.Rectangle(${region.x}, ${region.y}, ${region.width}, ${region.height})`
    : "$rect = [System.Windows.Forms.SystemInformation]::VirtualScreen";
  const imageFormatLine =
    params.format === "jpeg"
      ? "$imageFormat = [System.Drawing.Imaging.ImageFormat]::Jpeg"
      : "$imageFormat = [System.Drawing.Imaging.ImageFormat]::Png";
  return [
    "$ErrorActionPreference = 'Stop'",
    "if (-not (\"LooksyDpiAwareness\" -as [type])) {",
    "  Add-Type -TypeDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class LooksyDpiAwareness {",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern bool SetProcessDPIAware();",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);",
    "  [DllImport(\"shcore.dll\")]",
    "  public static extern int SetProcessDpiAwareness(int awareness);",
    "}",
    "\"@",
    "}",
    "try {",
    "  try {",
    "    [void][LooksyDpiAwareness]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))",
    "  } catch {",
    "    try {",
    "      [void][LooksyDpiAwareness]::SetProcessDpiAwareness(2)",
    "    } catch {",
    "      [void][LooksyDpiAwareness]::SetProcessDPIAware()",
    "    }",
    "  }",
    "} catch {",
    "}",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    rectLine,
    "if ($rect.Width -le 0 -or $rect.Height -le 0) { throw 'Invalid capture rectangle' }",
    imageFormatLine,
    "$bitmap = New-Object System.Drawing.Bitmap $rect.Width, $rect.Height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "try {",
    "  $graphics.CopyFromScreen($rect.X, $rect.Y, 0, 0, $rect.Size)",
    "  $stream = New-Object System.IO.MemoryStream",
    "  try {",
    "    $bitmap.Save($stream, $imageFormat)",
    "    $bytes = $stream.ToArray()",
    "    [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)",
    "  } finally {",
    "    $stream.Dispose()",
    "  }",
    "} finally {",
    "  $graphics.Dispose()",
    "  $bitmap.Dispose()",
    "}",
  ].join("\n");
}

async function runPowerShellScript(script: string, signal: AbortSignal, errorPrefix: string): Promise<Buffer> {
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  return runPowerShellEncodedCommand(encodedCommand, signal, errorPrefix);
}

async function runPowerShellJson(script: string, signal: AbortSignal, errorPrefix: string): Promise<unknown> {
  const stdout = (await runPowerShellScript(script, signal, errorPrefix)).toString("utf8").trim();
  if (!stdout) {
    throw new Error(`${errorPrefix}_EMPTY_STDOUT`);
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${errorPrefix}_INVALID_JSON: ${String(error)}`);
  }
}

async function runPowerShellEncodedCommand(encodedCommand: string, signal: AbortSignal, errorPrefix: string): Promise<Buffer> {
  const candidates = ["powershell.exe", "pwsh.exe", "pwsh"] as const;
  let lastNotFoundError: unknown;

  for (const executable of candidates) {
    try {
      return await runEncodedPowerShell(executable, encodedCommand, signal, errorPrefix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        lastNotFoundError = error;
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `${errorPrefix}_POWERSHELL_NOT_FOUND${
      lastNotFoundError ? `: ${String(lastNotFoundError)}` : ""
    }`,
  );
}

function runEncodedPowerShell(
  executable: string,
  encodedCommand: string,
  signal: AbortSignal,
  errorPrefix: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedCommand,
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        signal,
      },
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once("error", (error) => {
      reject(error);
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(
        new Error(
          `${errorPrefix}_POWERSHELL_FAILED (${executable}, exit=${String(code)}${
            stderr ? `, stderr=${stderr}` : ""
          })`,
        ),
      );
    });
  });
}

export const __windowsCaptureTestInternals = {
  buildWindowsCapturePowerShellScript,
  buildWindowsMoveMousePowerShellScript,
  buildWindowsClickPowerShellScript,
  buildWindowsTypeTextPowerShellScript,
  buildWindowsPressKeyPowerShellScript,
  buildWindowsPressKeySendInputPlan,
  buildWindowsScrollPowerShellScript,
  buildWindowsListWindowsPowerShellScript,
  buildWindowsFocusWindowPowerShellScript,
  buildWindowsScreenDipScalePowerShellScript,
};

function deriveBrowserTitle(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    return url;
  }
}

function buildSnapshotHtml(title: string, url: string, platform: "windows", maxLength?: number): string {
  const html = `<html><head><title>${title}</title></head><body><main data-platform="${platform}">${url}</main></body></html>`;
  if (maxLength === undefined) {
    return html;
  }

  return html.slice(0, maxLength);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}
