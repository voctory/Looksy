import type { CommandPayload, CommandResultPayload, HandshakeRequest, Platform } from "../protocol";

export type RequestId = string;

type HostManagedCommandType = "control.cancel" | "observability.getMetrics";
export type AdapterCommandType = Exclude<CommandPayload["type"], HostManagedCommandType>;
export type AdapterCommandPayload = Extract<CommandPayload, { type: AdapterCommandType }>;

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
