import { postJson } from "./http.js";
import {
  createLegacyActionCompatibilityConfig,
  resolveLegacyActionCommandType,
  type LegacyActionCompatibilityConfig,
  type LegacyActionCompatibilityOptions,
} from "./compatibility.js";
import type {
  CommandRequest,
  CommandResponse,
  ExtensibleCommandPayload,
  HandshakeRequest,
  HandshakeResponse,
  Rect,
} from "./protocol.js";

export const DEFAULT_HOST_URL = "http://127.0.0.1:4064";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_PROTOCOL_VERSION = "1.0.0";

export const DefaultCommandTypes = {
  health: "health.ping",
  capabilities: "health.getCapabilities",
  screenshot: "screen.capture",
  windowsList: "app.listWindows",
} as const;

export interface LooksyClientOptions {
  baseUrl?: string;
  authToken?: string;
  timeoutMs?: number;
  protocolVersion?: string;
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  commandTypes?: Partial<typeof DefaultCommandTypes>;
  legacyActionCompatibility?: LegacyActionCompatibilityOptions;
}

export type HandshakeInput = Omit<HandshakeRequest, "requestId" | "authToken"> &
  Partial<Pick<HandshakeRequest, "requestId" | "authToken">>;

export interface CommandInvocationOptions {
  protocolVersion?: string;
  requestId?: string;
  sessionId?: string;
  timeoutMs?: number;
}

export interface ScreenshotPayload {
  region?: Rect;
  format?: "png" | "jpeg";
  quality?: number;
  displayId?: string;
  includeCursor?: boolean;
}

export interface WindowsListPayload {
  includeMinimized?: boolean;
  desktopOnly?: boolean;
}

export class LooksyClient {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly defaultHeaders?: Record<string, string>;
  private readonly commandTypes: typeof DefaultCommandTypes;
  private readonly legacyActionCompatibility: LegacyActionCompatibilityConfig;

  private protocolVersion: string;
  private sessionId?: string;

  public constructor(options: LooksyClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_HOST_URL);
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl;
    this.defaultHeaders = options.defaultHeaders;
    this.protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this.commandTypes = {
      ...DefaultCommandTypes,
      ...(options.commandTypes ?? {}),
    };
    this.legacyActionCompatibility = createLegacyActionCompatibilityConfig(options.legacyActionCompatibility);
  }

  public setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  public getSessionId(): string | undefined {
    return this.sessionId;
  }

  public async handshake(request: HandshakeInput): Promise<HandshakeResponse> {
    const authToken = request.authToken ?? this.authToken;
    if (!authToken) {
      throw new Error("Handshake requires authToken. Provide request.authToken or client authToken.");
    }

    const normalizedRequest: HandshakeRequest = {
      ...request,
      protocolVersion: request.protocolVersion ?? this.protocolVersion,
      requestId: request.requestId ?? createRequestId(),
      authToken,
    };

    const response = await postJson<HandshakeResponse>({
      baseUrl: this.baseUrl,
      path: "/v1/handshake",
      body: normalizedRequest,
      authToken: this.authToken,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      defaultHeaders: this.defaultHeaders,
    });

    if (isHandshakeSuccess(response)) {
      this.protocolVersion = response.protocolVersion;
      this.sessionId = response.session.sessionId;
    }

    return response;
  }

  public async command<TResult = unknown, TCommand extends ExtensibleCommandPayload = ExtensibleCommandPayload>(
    request: CommandRequest<TCommand>,
  ): Promise<CommandResponse<TResult>> {
    const envelope = this.normalizeCommandRequest(request);

    return postJson<CommandResponse<TResult>>({
      baseUrl: this.baseUrl,
      path: "/v1/command",
      body: envelope,
      authToken: this.authToken,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      defaultHeaders: this.defaultHeaders,
    });
  }

  public async health<TResult = unknown>(options: CommandInvocationOptions = {}): Promise<CommandResponse<TResult>> {
    return this.namedCommand<TResult, Record<string, never>>(this.commandTypes.health, {}, options);
  }

  public async capabilities<TResult = unknown>(
    options: CommandInvocationOptions = {},
  ): Promise<CommandResponse<TResult>> {
    return this.namedCommand<TResult, Record<string, never>>(this.commandTypes.capabilities, {}, options);
  }

  public async screenshot<TResult = unknown>(
    payload: ScreenshotPayload = {},
    options: CommandInvocationOptions = {},
  ): Promise<CommandResponse<TResult>> {
    return this.namedCommand<TResult, ScreenshotPayload>(this.commandTypes.screenshot, payload, options);
  }

  public async windowsList<TResult = unknown>(
    payload: WindowsListPayload = {},
    options: CommandInvocationOptions = {},
  ): Promise<CommandResponse<TResult>> {
    return this.namedCommand<TResult, WindowsListPayload>(this.commandTypes.windowsList, payload, options);
  }

  private async namedCommand<TResult, TPayload extends object = Record<string, unknown>>(
    commandType: string,
    payload: TPayload,
    options: CommandInvocationOptions,
  ): Promise<CommandResponse<TResult>> {
    return this.command<TResult>({
      protocolVersion: options.protocolVersion,
      requestId: options.requestId,
      sessionId: options.sessionId,
      timeoutMs: options.timeoutMs,
      command: {
        type: commandType,
        ...payload,
      },
    });
  }

  private normalizeCommandRequest<TCommand extends ExtensibleCommandPayload>(
    request: CommandRequest<TCommand>,
  ): Required<Pick<CommandRequest<TCommand>, "protocolVersion" | "requestId" | "sessionId" | "command">> &
    Pick<CommandRequest<TCommand>, "timeoutMs"> {
    const sessionId = request.sessionId ?? this.sessionId;
    if (!sessionId) {
      throw new Error("Command requires sessionId. Call handshake() first or provide request.sessionId.");
    }

    return {
      protocolVersion: request.protocolVersion ?? this.protocolVersion,
      requestId: request.requestId ?? createRequestId(),
      sessionId,
      timeoutMs: request.timeoutMs,
      command: this.normalizeCommandPayload(request.command),
    };
  }

  private normalizeCommandPayload<TCommand extends ExtensibleCommandPayload>(command: TCommand): TCommand {
    const normalizedType = resolveLegacyActionCommandType(command.type, this.legacyActionCompatibility);
    if (normalizedType === command.type) {
      return command;
    }

    return {
      ...command,
      type: normalizedType,
    } as TCommand;
  }
}

function isHandshakeSuccess(response: HandshakeResponse): response is Extract<HandshakeResponse, { ok: true }> {
  return response.ok;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
