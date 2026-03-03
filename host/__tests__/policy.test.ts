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
    case "app.listWindows":
      return { type };
    case "app.focusWindow":
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
