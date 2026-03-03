import type { CommandResultPayload, WindowInfo } from "../../protocol";
import type { AdapterCommandPayload, AdapterExecutionContext, HostAdapter } from "../types";
import { mimeTypeForFormat, sleepAbortable, type SimulatedAdapterOptions, type SimulatedElement, throwIfAborted } from "./shared";

const WINDOWS_CAPABILITIES: readonly AdapterCommandPayload["type"][] = [
  "health.ping",
  "health.getCapabilities",
  "screen.capture",
  "input.moveMouse",
  "input.click",
  "input.typeText",
  "app.listWindows",
  "app.focusWindow",
  "element.find",
  "element.invoke",
  "element.setValue",
];

export class WindowsAdapter implements HostAdapter {
  readonly platform = "windows" as const;
  private readonly delayMsByCommand: Partial<Record<AdapterCommandPayload["type"], number>>;
  private readonly windows: WindowInfo[];
  private readonly elements: SimulatedElement[];
  private readonly elementValues = new Map<string, string>();

  constructor(options: SimulatedAdapterOptions = {}) {
    this.delayMsByCommand = options.delayMsByCommand ?? {};
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
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}
