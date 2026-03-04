import { describe, expect, it } from "vitest";
import { createPresetPolicy, POLICY_PRESET_ALLOWLISTS } from "../policy";
import type { CommandPayload } from "../../protocol";
import type { SessionRecord } from "../types";

const SESSION: SessionRecord = {
  sessionId: "session-1",
  protocolVersion: "1.0.0",
  client: {
    name: "tests",
    version: "1.0.0",
  },
  issuedAt: "2026-03-03T00:00:00.000Z",
};

function evaluate(command: CommandPayload, preset: keyof typeof POLICY_PRESET_ALLOWLISTS): boolean {
  return createPresetPolicy(preset).evaluate(command, SESSION).allowed;
}

describe("policy presets", () => {
  it("applies diagnostics-only restrictions", () => {
    expect(
      evaluate(
        {
          type: "health.ping",
        },
        "diagnostics-only",
      ),
    ).toBe(true);

    expect(
      evaluate(
        {
          type: "observability.getMetrics",
        },
        "diagnostics-only",
      ),
    ).toBe(true);

    expect(
      evaluate(
        {
          type: "input.click",
          button: "left",
        },
        "diagnostics-only",
      ),
    ).toBe(false);
  });

  it("applies input-only restrictions", () => {
    expect(
      evaluate(
        {
          type: "input.typeText",
          text: "hello",
        },
        "input-only",
      ),
    ).toBe(true);

    expect(
      evaluate(
        {
          type: "screen.capture",
        },
        "input-only",
      ),
    ).toBe(false);
  });

  it("applies capture-only restrictions", () => {
    expect(
      evaluate(
        {
          type: "screen.capture",
        },
        "capture-only",
      ),
    ).toBe(true);

    expect(
      evaluate(
        {
          type: "input.moveMouse",
          point: {
            x: 10,
            y: 20,
            space: "screen-dip",
          },
        },
        "capture-only",
      ),
    ).toBe(false);
  });

  it("allows all protocol commands in full preset", () => {
    for (const commandType of POLICY_PRESET_ALLOWLISTS.full) {
      const command = commandForType(commandType);
      expect(evaluate(command, "full"), `Expected '${commandType}' to be allowed by full preset`).toBe(true);
    }
  });
});

function commandForType(type: CommandPayload["type"]): CommandPayload {
  switch (type) {
    case "health.ping":
      return { type };
    case "health.getCapabilities":
      return { type };
    case "observability.getMetrics":
      return { type };
    case "screen.capture":
      return { type };
    case "input.moveMouse":
      return {
        type,
        point: {
          x: 1,
          y: 1,
          space: "screen-dip",
        },
      };
    case "input.click":
      return {
        type,
        button: "left",
      };
    case "input.typeText":
      return {
        type,
        text: "x",
      };
    case "input.pressKey":
      return {
        type,
        key: "Enter",
        modifiers: ["Control"],
      };
    case "input.scroll":
      return {
        type,
        dx: 0,
        dy: 120,
        point: {
          x: 4,
          y: 8,
          space: "window-client",
        },
      };
    case "input.drag":
      return {
        type,
        start: {
          x: 1,
          y: 2,
          space: "screen-dip",
        },
        end: {
          x: 5,
          y: 6,
          space: "screen-dip",
        },
      };
    case "input.swipe":
      return {
        type,
        start: {
          x: 1,
          y: 2,
          space: "screen-dip",
        },
        end: {
          x: 5,
          y: 6,
          space: "screen-dip",
        },
      };
    case "clipboard.read":
      return { type };
    case "clipboard.write":
      return {
        type,
        text: "hello",
      };
    case "app.listWindows":
      return { type };
    case "app.focusWindow":
      return {
        type,
        windowId: "window-1",
      };
    case "app.windowMove":
      return {
        type,
        windowId: "window-1",
        point: {
          x: 100,
          y: 120,
          space: "screen-dip",
        },
      };
    case "app.windowResize":
      return {
        type,
        windowId: "window-1",
        width: 1280,
        height: 720,
        space: "screen-dip",
      };
    case "app.windowMinimize":
      return {
        type,
        windowId: "window-1",
      };
    case "app.windowMaximize":
      return {
        type,
        windowId: "window-1",
      };
    case "app.windowClose":
      return {
        type,
        windowId: "window-1",
      };
    case "browser.navigate":
      return {
        type,
        url: "https://example.com",
      };
    case "browser.snapshot":
      return { type };
    case "browser.pdf":
      return { type };
    case "browser.console":
      return { type };
    case "browser.trace.start":
      return { type };
    case "browser.trace.stop":
      return { type };
    case "element.find":
      return {
        type,
        selector: "button.save",
      };
    case "element.invoke":
      return {
        type,
        elementId: "element-1",
        action: "press",
      };
    case "element.setValue":
      return {
        type,
        elementId: "element-1",
        value: "hello",
      };
    case "control.cancel":
      return {
        type,
        targetRequestId: "req-1",
      };
    default:
      return assertNever(type);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected command type: ${value}`);
}
