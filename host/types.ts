import type { CommandPayload, CommandResultPayload, HandshakeRequest, Platform } from "../protocol";

export type RequestId = string;

export type AdapterCommandPayload = Exclude<CommandPayload, { type: "control.cancel" }>;
export type AdapterCommandType = AdapterCommandPayload["type"];

export interface AdapterExecutionContext {
  signal: AbortSignal;
  sessionId: string;
  requestId: RequestId;
}

export interface HostAdapter {
  readonly platform: Platform;
  getCapabilities(): readonly AdapterCommandType[];
  execute(command: AdapterCommandPayload, context: AdapterExecutionContext): Promise<CommandResultPayload>;
}

export interface SessionRecord {
  sessionId: string;
  protocolVersion: string;
  client: HandshakeRequest["client"];
  issuedAt: string;
}
