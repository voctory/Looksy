import type { CommandResultPayload, WindowInfo } from "../../protocol";
import type { AdapterCommandPayload, AdapterExecutionContext, HostAdapter } from "../types";
import { mimeTypeForFormat, sleepAbortable, type SimulatedAdapterOptions, type SimulatedElement, throwIfAborted } from "./shared";

const MACOS_CAPABILITIES: readonly AdapterCommandPayload["type"][] = [
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

export class MacOSAdapter implements HostAdapter {
  readonly platform = "macos" as const;
  private readonly delayMsByCommand: Partial<Record<AdapterCommandPayload["type"], number>>;
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

  constructor(options: SimulatedAdapterOptions = {}) {
    this.delayMsByCommand = options.delayMsByCommand ?? {};
    this.windows = [
      {
        windowId: "mac-main",
        title: "Looksy Workspace",
        appName: "Finder",
        focused: true,
        bounds: { x: 60, y: 70, width: 1280, height: 820, space: "screen-dip" },
      },
      {
        windowId: "mac-settings",
        title: "Settings",
        appName: "System Settings",
        focused: false,
        bounds: { x: 120, y: 110, width: 920, height: 680, space: "screen-dip" },
      },
    ];

    this.elements = [
      {
        elementId: "mac-btn-save",
        selector: "button.save",
        windowId: "mac-main",
        rect: { x: 1024, y: 742, width: 120, height: 32, space: "window-client" },
      },
      {
        elementId: "mac-input-search",
        selector: "input.search",
        windowId: "mac-main",
        rect: { x: 48, y: 32, width: 380, height: 30, space: "window-client" },
      },
    ];
  }

  getCapabilities(): readonly AdapterCommandPayload["type"][] {
    return MACOS_CAPABILITIES;
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
          capabilities: [...MACOS_CAPABILITIES, "control.cancel", "observability.getMetrics"],
        };
      case "screen.capture": {
        const artifactId = `macos-${context.requestId}`;
        const mimeType = mimeTypeForFormat(command.format);
        const capturedAt = new Date().toISOString();
        context.persistScreenshotArtifact({
          artifactId,
          mimeType,
          bytes: Buffer.from(
            `looksy-screenshot:${this.platform}:${context.requestId}:${command.format ?? "png"}`,
            "utf8",
          ),
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
      case "input.drag":
        throw new Error("MACOS_INPUT_DRAG_UNSUPPORTED");
      case "input.swipe":
        throw new Error("MACOS_INPUT_SWIPE_UNSUPPORTED");
      case "clipboard.read":
        throw new Error("MACOS_CLIPBOARD_READ_UNSUPPORTED");
      case "clipboard.write":
        throw new Error("MACOS_CLIPBOARD_WRITE_UNSUPPORTED");
      case "app.listWindows": {
        const windows = command.desktopOnly
          ? this.windows.filter((windowInfo) => windowInfo.appName !== "System Settings")
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
      case "app.windowMove":
        throw new Error("MACOS_APP_WINDOW_MOVE_UNSUPPORTED");
      case "app.windowResize":
        throw new Error("MACOS_APP_WINDOW_RESIZE_UNSUPPORTED");
      case "app.windowMinimize":
        throw new Error("MACOS_APP_WINDOW_MINIMIZE_UNSUPPORTED");
      case "app.windowMaximize":
        throw new Error("MACOS_APP_WINDOW_MAXIMIZE_UNSUPPORTED");
      case "app.windowClose":
        throw new Error("MACOS_APP_WINDOW_CLOSE_UNSUPPORTED");
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
          confidence: 0.92,
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

function deriveBrowserTitle(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    return url;
  }
}

function buildSnapshotHtml(title: string, url: string, platform: "macos", maxLength?: number): string {
  const html = `<html><head><title>${title}</title></head><body><main data-platform="${platform}">${url}</main></body></html>`;
  if (maxLength === undefined) {
    return html;
  }

  return html.slice(0, maxLength);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}
