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
        await this.automation.moveMouse({
          point: command.point,
          signal: context.signal,
        });
        return {
          type: "input.mouseMoved",
          point: command.point,
        };
      case "input.click":
        await this.automation.click({
          button: command.button,
          point: command.point,
          signal: context.signal,
        });
        return {
          type: "input.clicked",
          button: command.button,
          ...(command.point ? { point: command.point } : {}),
        };
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
        await this.automation.scroll({
          dx: command.dx,
          dy: command.dy,
          point: command.point,
          modifiers: command.modifiers,
          signal: context.signal,
        });
        return {
          type: "input.scrolled",
          dx: command.dx,
          dy: command.dy,
          ...(command.point ? { point: command.point } : {}),
          ...(command.modifiers && command.modifiers.length > 0 ? { modifiers: command.modifiers } : {}),
        };
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

function buildWindowsPointerTypeDefinitionLines(): string[] {
  return [
    "if (-not (\"LooksyPointerNative\" -as [type])) {",
    "  Add-Type -TypeDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class LooksyPointerNative {",
    "  [DllImport(\"user32.dll\", SetLastError = true)]",
    "  public static extern bool SetCursorPos(int X, int Y);",
    "  [DllImport(\"user32.dll\", SetLastError = true)]",
    "  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);",
    "  [DllImport(\"user32.dll\", SetLastError = true)]",
    "  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);",
    "}",
    "\"@",
    "}",
  ];
}

function buildWindowsMoveMousePowerShellScript(point: InputMoveMouseCommand["point"]): string {
  const normalized = normalizeScreenPoint(point, "WINDOWS_INPUT_MOVE_MOUSE_INVALID_POINT");
  return [
    "$ErrorActionPreference = 'Stop'",
    ...buildWindowsPointerTypeDefinitionLines(),
    `$x = ${normalized.x}`,
    `$y = ${normalized.y}`,
    "if (-not [LooksyPointerNative]::SetCursorPos($x, $y)) { throw 'SetCursorPos failed' }",
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
          "if (-not [LooksyPointerNative]::SetCursorPos($x, $y)) { throw 'SetCursorPos failed' }",
        ];
      })()
    : [];
  return [
    "$ErrorActionPreference = 'Stop'",
    ...buildWindowsPointerTypeDefinitionLines(),
    ...pointLines,
    `[LooksyPointerNative]::mouse_event(${flags.down}, 0, 0, 0, [UIntPtr]::Zero)`,
    `[LooksyPointerNative]::mouse_event(${flags.up}, 0, 0, 0, [UIntPtr]::Zero)`,
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

function escapeTextForSendKeys(text: string): string {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  let escaped = "";
  for (const character of normalized) {
    switch (character) {
      case "+":
        escaped += "{+}";
        break;
      case "^":
        escaped += "{^}";
        break;
      case "%":
        escaped += "{%}";
        break;
      case "~":
        escaped += "{~}";
        break;
      case "(":
        escaped += "{(}";
        break;
      case ")":
        escaped += "{)}";
        break;
      case "[":
        escaped += "{[}";
        break;
      case "]":
        escaped += "{]}";
        break;
      case "{":
        escaped += "{{}";
        break;
      case "}":
        escaped += "{}}";
        break;
      case "\t":
        escaped += "{TAB}";
        break;
      case "\n":
        escaped += "{ENTER}";
        break;
      default:
        escaped += character;
        break;
    }
  }
  return escaped;
}

function buildWindowsSendKeysPowerShellScript(sequence: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    `$sequence = '${escapePowerShellSingleQuotedString(sequence)}'`,
    "[System.Windows.Forms.SendKeys]::SendWait($sequence)",
  ].join("\n");
}

async function typeTextViaPowerShell(params: WindowsTypeTextParams): Promise<void> {
  assertWindowsHost("WINDOWS_INPUT_TYPE_TEXT_UNSUPPORTED_ON_NON_WINDOWS");
  const sequence = escapeTextForSendKeys(params.text);
  const script = buildWindowsSendKeysPowerShellScript(sequence);
  await runPowerShellScript(script, params.signal, "WINDOWS_INPUT_TYPE_TEXT");
}

const SEND_KEYS_MODIFIER_PREFIX_BY_KEY = new Map<string, string>([
  ["ctrl", "^"],
  ["control", "^"],
  ["shift", "+"],
  ["alt", "%"],
]);

const SEND_KEYS_KEY_TOKEN_BY_KEY = new Map<string, string>([
  ["enter", "{ENTER}"],
  ["return", "{ENTER}"],
  ["tab", "{TAB}"],
  ["escape", "{ESC}"],
  ["esc", "{ESC}"],
  ["backspace", "{BACKSPACE}"],
  ["delete", "{DELETE}"],
  ["del", "{DELETE}"],
  ["insert", "{INSERT}"],
  ["home", "{HOME}"],
  ["end", "{END}"],
  ["pageup", "{PGUP}"],
  ["pagedown", "{PGDN}"],
  ["up", "{UP}"],
  ["arrowup", "{UP}"],
  ["down", "{DOWN}"],
  ["arrowdown", "{DOWN}"],
  ["left", "{LEFT}"],
  ["arrowleft", "{LEFT}"],
  ["right", "{RIGHT}"],
  ["arrowright", "{RIGHT}"],
  ["space", " "],
  ["spacebar", " "],
]);

function getSendKeysModifierPrefix(modifier: string): string {
  const normalized = modifier.trim().toLowerCase();
  const prefix = SEND_KEYS_MODIFIER_PREFIX_BY_KEY.get(normalized);
  if (!prefix) {
    throw new Error(`WINDOWS_INPUT_PRESS_KEY_UNSUPPORTED_MODIFIER:${modifier}`);
  }
  return prefix;
}

function getSendKeysKeyToken(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    throw new Error("WINDOWS_INPUT_PRESS_KEY_INVALID_KEY");
  }

  const mapped = SEND_KEYS_KEY_TOKEN_BY_KEY.get(normalized);
  if (mapped) {
    return mapped;
  }

  const functionKey = /^f([1-9]|1\d|2[0-4])$/i.exec(normalized);
  if (functionKey) {
    return `{${functionKey[0].toUpperCase()}}`;
  }

  if (key.length === 1) {
    return escapeTextForSendKeys(key);
  }

  throw new Error(`WINDOWS_INPUT_PRESS_KEY_UNSUPPORTED_KEY:${key}`);
}

function buildWindowsPressKeySequence(params: Omit<WindowsPressKeyParams, "signal">): string {
  const repeat = Math.round(params.repeat);
  if (!Number.isFinite(repeat) || repeat <= 0) {
    throw new Error("WINDOWS_INPUT_PRESS_KEY_INVALID_REPEAT");
  }
  const modifierPrefix = (params.modifiers ?? []).map(getSendKeysModifierPrefix).join("");
  const keyToken = getSendKeysKeyToken(params.key);
  let sequence = "";
  for (let index = 0; index < repeat; index += 1) {
    sequence += `${modifierPrefix}${keyToken}`;
  }
  return sequence;
}

async function pressKeyViaPowerShell(params: WindowsPressKeyParams): Promise<void> {
  assertWindowsHost("WINDOWS_INPUT_PRESS_KEY_UNSUPPORTED_ON_NON_WINDOWS");
  const sequence = buildWindowsPressKeySequence({
    key: params.key,
    modifiers: params.modifiers,
    repeat: params.repeat,
  });
  const script = buildWindowsSendKeysPowerShellScript(sequence);
  await runPowerShellScript(script, params.signal, "WINDOWS_INPUT_PRESS_KEY");
}

const SCROLL_MODIFIER_VK_BY_KEY = new Map<string, number>([
  ["shift", 0x10],
  ["ctrl", 0x11],
  ["control", 0x11],
  ["alt", 0x12],
]);

function buildWindowsScrollPowerShellScript(params: Omit<WindowsScrollParams, "signal">): string {
  const dx = Math.round(params.dx);
  const dy = Math.round(params.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new Error("WINDOWS_INPUT_SCROLL_INVALID_DELTA");
  }
  const pointLines = params.point
    ? (() => {
        const normalized = normalizeScreenPoint(params.point, "WINDOWS_INPUT_SCROLL_INVALID_POINT");
        return [
          `$x = ${normalized.x}`,
          `$y = ${normalized.y}`,
          "if (-not [LooksyPointerNative]::SetCursorPos($x, $y)) { throw 'SetCursorPos failed' }",
        ];
      })()
    : [];
  const modifierVirtualKeys = (params.modifiers ?? []).map((modifier) => {
    const normalized = modifier.trim().toLowerCase();
    const vk = SCROLL_MODIFIER_VK_BY_KEY.get(normalized);
    if (!vk) {
      throw new Error(`WINDOWS_INPUT_SCROLL_UNSUPPORTED_MODIFIER:${modifier}`);
    }
    return vk;
  });
  const modifierArray = modifierVirtualKeys.length > 0 ? modifierVirtualKeys.join(", ") : "";
  return [
    "$ErrorActionPreference = 'Stop'",
    ...buildWindowsPointerTypeDefinitionLines(),
    ...pointLines,
    `$dx = ${dx}`,
    `$dy = ${dy}`,
    `$modifierVirtualKeys = @(${modifierArray})`,
    "foreach ($vk in $modifierVirtualKeys) {",
    "  [LooksyPointerNative]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)",
    "}",
    "try {",
    "  if ($dx -ne 0) { [LooksyPointerNative]::mouse_event(0x1000, 0, 0, $dx, [UIntPtr]::Zero) }",
    "  if ($dy -ne 0) { [LooksyPointerNative]::mouse_event(0x0800, 0, 0, $dy, [UIntPtr]::Zero) }",
    "} finally {",
    "  for ($i = $modifierVirtualKeys.Length - 1; $i -ge 0; $i--) {",
    "    [LooksyPointerNative]::keybd_event([byte]$modifierVirtualKeys[$i], 0, 0x0002, [UIntPtr]::Zero)",
    "  }",
    "}",
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
    "$windows = New-Object System.Collections.Generic.List[object]",
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
    "  $windows.Add([PSCustomObject]@{",
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
    "@($windows) | ConvertTo-Json -Compress -Depth 6",
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
  buildWindowsSendKeysPowerShellScript,
  buildWindowsPressKeySequence,
  buildWindowsScrollPowerShellScript,
  buildWindowsListWindowsPowerShellScript,
  buildWindowsFocusWindowPowerShellScript,
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
