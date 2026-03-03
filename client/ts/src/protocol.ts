export interface HandshakeRequest {
  protocolVersion: string;
  requestId: string;
  authToken: string;
  client: {
    name: string;
    version: string;
  };
  requestedCapabilities?: string[];
}

export interface HandshakeSuccessEnvelope {
  protocolVersion: string;
  requestId: string;
  ok: true;
  session: {
    sessionId: string;
    adapter: "macos" | "windows";
    capabilities: string[];
    issuedAt: string;
  };
}

export interface HandshakeErrorEnvelope {
  protocolVersion: string;
  requestId: string;
  ok: false;
  error: {
    code: string;
    message: string;
    retriable: boolean;
    details?: Record<string, unknown>;
  };
}

export type HandshakeResponse = HandshakeSuccessEnvelope | HandshakeErrorEnvelope;

export interface CommandEnvelope<TCommand extends ExtensibleCommandPayload = ExtensibleCommandPayload> {
  protocolVersion: string;
  requestId: string;
  sessionId: string;
  timeoutMs?: number;
  command: TCommand;
}

export type ExtensibleCommandPayload = {
  type: string;
  [key: string]: unknown;
};

export type CommandRequest<TCommand extends ExtensibleCommandPayload = ExtensibleCommandPayload> =
  Partial<Omit<CommandEnvelope<TCommand>, "command">> & {
    command: TCommand;
    requestId?: string;
    timeoutMs?: number;
  };

export type CommandResponse<TResult = unknown> =
  | {
      protocolVersion: string;
      requestId: string;
      ok: true;
      result: TResult;
    }
  | {
      protocolVersion: string;
      requestId: string;
      ok: false;
      error: {
        code: string;
        message: string;
        retriable?: boolean;
        details?: unknown;
      };
    };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  space: "screen-physical" | "screen-dip" | "window-client";
}
