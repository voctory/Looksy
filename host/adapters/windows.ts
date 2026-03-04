import { spawn } from "node:child_process";
import type { CommandResultPayload, WindowInfo } from "../../protocol";
import type { AdapterCommandPayload, AdapterExecutionContext, HostAdapter } from "../types";
import { mimeTypeForFormat, sleepAbortable, type SimulatedAdapterOptions, type SimulatedElement, throwIfAborted } from "./shared";

type ScreenCaptureCommand = Extract<AdapterCommandPayload, { type: "screen.capture" }>;
type ScreenCaptureRegion = NonNullable<ScreenCaptureCommand["region"]>;
type WindowsCaptureScreenParams = {
  format: "png" | "jpeg";
  region?: ScreenCaptureRegion;
  signal: AbortSignal;
};
type WindowsCaptureScreenFn = (params: WindowsCaptureScreenParams) => Promise<Buffer>;

export interface WindowsAdapterOptions extends SimulatedAdapterOptions {
  captureScreen?: WindowsCaptureScreenFn;
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
  private readonly windows: WindowInfo[];
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
    this.windows = [
      {
        windowId: "win-main",
        title: "Looksy Console",
        appName: "File Explorer",
        focused: true,
        bounds: { x: 80, y: 90, width: 1320, height: 860, space: "screen-dip" },
      },
      {
        windowId: "win-settings",
        title: "Settings",
        appName: "Settings",
        focused: false,
        bounds: { x: 160, y: 120, width: 940, height: 700, space: "screen-dip" },
      },
    ];

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
        return {
          type: "input.mouseMoved",
          point: command.point,
        };
      case "input.click":
        return {
          type: "input.clicked",
          button: command.button,
          ...(command.point ? { point: command.point } : {}),
        };
      case "input.typeText":
        return {
          type: "input.typed",
          textLength: command.text.length,
        };
      case "input.pressKey":
        return {
          type: "input.keyPressed",
          key: command.key,
          repeat: command.repeat ?? 1,
          ...(command.modifiers && command.modifiers.length > 0 ? { modifiers: command.modifiers } : {}),
        };
      case "input.scroll":
        return {
          type: "input.scrolled",
          dx: command.dx,
          dy: command.dy,
          ...(command.point ? { point: command.point } : {}),
          ...(command.modifiers && command.modifiers.length > 0 ? { modifiers: command.modifiers } : {}),
        };
      case "app.listWindows": {
        const windows = command.desktopOnly
          ? this.windows.filter((windowInfo) => windowInfo.appName !== "Settings")
          : this.windows;
        return {
          type: "app.windowsListed",
          windows,
        };
      }
      case "app.focusWindow": {
        const existing = this.windows.find((windowInfo) => windowInfo.windowId === command.windowId);
        for (const windowInfo of this.windows) {
          windowInfo.focused = windowInfo.windowId === command.windowId;
        }
        return {
          type: "app.windowFocused",
          windowId: command.windowId,
          focused: Boolean(existing),
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

async function captureWindowsScreenViaPowerShell(params: WindowsCaptureScreenParams): Promise<Buffer> {
  if (process.platform !== "win32") {
    throw new Error(WINDOWS_CAPTURE_NON_WIN32_MESSAGE);
  }

  const script = buildWindowsCapturePowerShellScript(params);
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  const bytes = await runPowerShellCapture(encodedCommand, params.signal);
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

async function runPowerShellCapture(encodedCommand: string, signal: AbortSignal): Promise<Buffer> {
  const candidates = ["powershell.exe", "pwsh.exe", "pwsh"] as const;
  let lastNotFoundError: unknown;

  for (const executable of candidates) {
    try {
      return await runEncodedPowerShell(executable, encodedCommand, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        lastNotFoundError = error;
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `WINDOWS_SCREEN_CAPTURE_POWERSHELL_NOT_FOUND${
      lastNotFoundError ? `: ${String(lastNotFoundError)}` : ""
    }`,
  );
}

function runEncodedPowerShell(
  executable: string,
  encodedCommand: string,
  signal: AbortSignal,
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
          `WINDOWS_SCREEN_CAPTURE_POWERSHELL_FAILED (${executable}, exit=${String(code)}${
            stderr ? `, stderr=${stderr}` : ""
          })`,
        ),
      );
    });
  });
}

export const __windowsCaptureTestInternals = {
  buildWindowsCapturePowerShellScript,
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
