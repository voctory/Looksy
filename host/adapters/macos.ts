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
  "app.listWindows",
  "app.focusWindow",
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
          capabilities: [...MACOS_CAPABILITIES, "control.cancel"],
        };
      case "screen.capture":
        return {
          type: "screen.captured",
          artifactId: `macos-${context.requestId}`,
          mimeType: mimeTypeForFormat(command.format),
          capturedAt: new Date().toISOString(),
          ...(command.region ? { region: command.region } : {}),
        };
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
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}
