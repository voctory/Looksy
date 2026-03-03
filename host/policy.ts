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
  evaluate(): PolicyDecision {
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

  evaluate(command: CommandPayload): PolicyDecision {
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
