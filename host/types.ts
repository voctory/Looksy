import type { CommandPayload, CommandResultPayload, HandshakeRequest, Platform } from "../protocol";

export type RequestId = string;

type HostManagedCommandPayload = Extract<CommandPayload, { type: "control.cancel" | "observability.getMetrics" }>;
type ProtocolOnlyCommandPayload = Extract<
  CommandPayload,
  {
    type:
      | "input.drag"
      | "input.swipe"
      | "clipboard.read"
      | "clipboard.write"
      | "app.windowMove"
      | "app.windowResize"
      | "app.windowMinimize"
      | "app.windowMaximize"
      | "app.windowClose";
  }
>;

export type AdapterCommandPayload = Exclude<CommandPayload, HostManagedCommandPayload | ProtocolOnlyCommandPayload>;
export type AdapterCommandType = AdapterCommandPayload["type"];

export interface ScreenshotArtifactPayload {
  artifactId: string;
  mimeType: string;
  bytes: Uint8Array;
  capturedAt?: string;
}

export interface AdapterExecutionContext {
  signal: AbortSignal;
  sessionId: string;
  requestId: RequestId;
  persistScreenshotArtifact: (artifact: ScreenshotArtifactPayload) => void;
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
  expiresAt?: string;
}
