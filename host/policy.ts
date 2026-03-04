import type { CommandPayload } from "../protocol";
import type { SessionRecord } from "./types";

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface CommandPolicy {
  evaluate(command: CommandPayload, session: SessionRecord): PolicyDecision;
}

export class AllowAllPolicy implements CommandPolicy {
  evaluate(_command: CommandPayload, _session: SessionRecord): PolicyDecision {
    return { allowed: true };
  }
}

export interface StaticPolicyOptions {
  allow?: readonly CommandPayload["type"][];
  deny?: readonly CommandPayload["type"][];
}

export class StaticCommandPolicy implements CommandPolicy {
  private readonly allow: Set<CommandPayload["type"]>;
  private readonly deny: Set<CommandPayload["type"]>;

  constructor(options: StaticPolicyOptions = {}) {
    this.allow = new Set(options.allow ?? []);
    this.deny = new Set(options.deny ?? []);
  }

  evaluate(command: CommandPayload, _session: SessionRecord): PolicyDecision {
    if (this.deny.has(command.type)) {
      return {
        allowed: false,
        reason: `Command '${command.type}' is denied by policy`,
      };
    }

    if (this.allow.size > 0 && !this.allow.has(command.type)) {
      return {
        allowed: false,
        reason: `Command '${command.type}' is not in the policy allow list`,
      };
    }

    return { allowed: true };
  }
}

export type PolicyPresetName = "diagnostics-only" | "input-only" | "capture-only" | "full";

const DIAGNOSTICS_ONLY_COMMANDS = [
  "health.ping",
  "health.getCapabilities",
  "observability.getMetrics",
  "control.cancel",
] as const satisfies readonly CommandPayload["type"][];

const INPUT_ONLY_COMMANDS = [
  ...DIAGNOSTICS_ONLY_COMMANDS,
  "input.moveMouse",
  "input.click",
  "input.typeText",
  "input.pressKey",
  "input.scroll",
  "input.drag",
  "input.swipe",
] as const satisfies readonly CommandPayload["type"][];

const CAPTURE_ONLY_COMMANDS = [
  ...DIAGNOSTICS_ONLY_COMMANDS,
  "screen.capture",
] as const satisfies readonly CommandPayload["type"][];

const FULL_COMMANDS = [
  "health.ping",
  "health.getCapabilities",
  "observability.getMetrics",
  "screen.capture",
  "input.moveMouse",
  "input.click",
  "input.typeText",
  "input.pressKey",
  "input.scroll",
  "input.drag",
  "input.swipe",
  "clipboard.read",
  "clipboard.write",
  "app.listWindows",
  "app.focusWindow",
  "app.windowMove",
  "app.windowResize",
  "app.windowMinimize",
  "app.windowMaximize",
  "app.windowClose",
  "browser.navigate",
  "browser.snapshot",
  "browser.pdf",
  "browser.console",
  "browser.trace.start",
  "browser.trace.stop",
  "element.find",
  "element.invoke",
  "element.setValue",
  "control.cancel",
] as const satisfies readonly CommandPayload["type"][];

export const POLICY_PRESET_ALLOWLISTS: Record<PolicyPresetName, readonly CommandPayload["type"][]> = {
  "diagnostics-only": DIAGNOSTICS_ONLY_COMMANDS,
  "input-only": INPUT_ONLY_COMMANDS,
  "capture-only": CAPTURE_ONLY_COMMANDS,
  full: FULL_COMMANDS,
};

export function createPresetPolicy(preset: PolicyPresetName): StaticCommandPolicy {
  return new StaticCommandPolicy({ allow: POLICY_PRESET_ALLOWLISTS[preset] });
}
