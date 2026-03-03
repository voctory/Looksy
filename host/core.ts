import { randomUUID } from "node:crypto";
import {
  CommandEnvelopeSchema,
  HandshakeRequestSchema,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CommandEnvelope,
  type CommandPayload,
  type CommandResultEnvelope,
  type CommandResultPayload,
  type ErrorCode,
  type HandshakeResultEnvelope,
  createProtocolError,
  isSupportedProtocolVersion,
} from "../protocol";
import { InMemoryMetricsRecorder, type HostMetricsRecorder } from "./metrics";
import { AllowAllPolicy, type CommandPolicy } from "./policy";
import type { AdapterCommandPayload, HostAdapter, ScreenshotArtifactPayload, SessionRecord } from "./types";

const ABORT_REASON_TIMEOUT = "timeout";
const ABORT_REASON_CANCELLED = "cancelled";
const HOST_MANAGED_CAPABILITIES = ["control.cancel", "observability.getMetrics"] as const satisfies readonly CommandPayload["type"][];
const DEFAULT_MAX_SCREENSHOT_ARTIFACTS = 128;

interface InFlightRequest {
  controller: AbortController;
  timeoutHandle?: NodeJS.Timeout;
  sessionId: string;
  commandType: AdapterCommandPayload["type"];
  startedAtMs: number;
}

type CommandErrorEnvelope = Extract<CommandResultEnvelope, { ok: false }>;

interface StoredAuthToken {
  expiresAtMs?: number;
}

interface StoredScreenshotArtifact {
  sessionId: string;
  mimeType: string;
  bytes: Buffer;
  capturedAt: string;
}

export interface HostAuthTokenDefinition {
  token: string;
  expiresAt?: string | Date;
}

export type HostAuthTokenInput = string | HostAuthTokenDefinition;

export interface RotateAuthTokenOptions {
  revokeExisting?: boolean;
}

interface HostCoreBaseOptions {
  adapter: HostAdapter;
  policy?: CommandPolicy;
  defaultTimeoutMs?: number;
  sessionTtlMs?: number;
  maxScreenshotArtifacts?: number;
  now?: () => Date;
  sessionIdFactory?: () => string;
  metrics?: HostMetricsRecorder;
}

type HostCoreAuthOptions =
  | {
      authToken: string;
      authTokens?: readonly HostAuthTokenInput[];
    }
  | {
      authToken?: undefined;
      authTokens: readonly HostAuthTokenInput[];
    };

export type HostCoreOptions = HostCoreBaseOptions & HostCoreAuthOptions;

export class HostCore {
  private readonly adapter: HostAdapter;
  private readonly authTokens = new Map<string, StoredAuthToken>();
  private readonly policy: CommandPolicy;
  private readonly defaultTimeoutMs: number;
  private readonly sessionTtlMs?: number;
  private readonly maxScreenshotArtifacts: number;
  private readonly now: () => Date;
  private readonly sessionIdFactory: () => string;
  private readonly metrics: HostMetricsRecorder;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly inFlight = new Map<string, InFlightRequest>();
  private readonly screenshotArtifacts = new Map<string, StoredScreenshotArtifact>();

  constructor(options: HostCoreOptions) {
    this.adapter = options.adapter;
    this.policy = options.policy ?? new AllowAllPolicy();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10_000;
    this.sessionTtlMs = normalizeSessionTtlMs(options.sessionTtlMs);
    this.maxScreenshotArtifacts = normalizeMaxScreenshotArtifacts(options.maxScreenshotArtifacts);
    this.now = options.now ?? (() => new Date());
    this.sessionIdFactory = options.sessionIdFactory ?? randomUUID;
    this.metrics = options.metrics ?? new InMemoryMetricsRecorder();
    this.initializeAuthTokens(options);
  }

  addAuthToken(tokenInput: HostAuthTokenInput): void {
    const { token, expiresAtMs } = normalizeAuthTokenInput(tokenInput);
    this.authTokens.set(token, { expiresAtMs });
  }

  revokeAuthToken(token: string): boolean {
    return this.authTokens.delete(token);
  }

  rotateAuthToken(nextToken: HostAuthTokenInput, options: RotateAuthTokenOptions = {}): void {
    if (options.revokeExisting ?? true) {
      this.authTokens.clear();
    }

    this.addAuthToken(nextToken);
  }

  pruneExpiredAuthTokens(referenceTime: Date = this.now()): number {
    const referenceMs = referenceTime.getTime();
    let removed = 0;

    for (const [token, record] of this.authTokens.entries()) {
      if (record.expiresAtMs !== undefined && record.expiresAtMs <= referenceMs) {
        this.authTokens.delete(token);
        removed += 1;
      }
    }

    return removed;
  }

  handshake(input: unknown): HandshakeResultEnvelope {
    const parsed = HandshakeRequestSchema.safeParse(input);
    if (!parsed.success) {
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: getRequestIdFromUnknown(input),
        ok: false,
        error: createProtocolError("VALIDATION_FAILED", "Invalid handshake payload", {
          issues: parsed.error.issues,
        }),
      };
    }

    const request = parsed.data;
    if (!isSupportedProtocolVersion(request.protocolVersion)) {
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: false,
        error: createProtocolError("UNSUPPORTED_VERSION", "Unsupported protocol version", {
          received: request.protocolVersion,
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
        }),
      };
    }

    if (!this.isAuthTokenValid(request.authToken)) {
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: false,
        error: createProtocolError("AUTH_FAILED", "Invalid auth token"),
      };
    }

    const capabilities = new Set<CommandPayload["type"]>([...this.adapter.getCapabilities(), ...HOST_MANAGED_CAPABILITIES]);
    const negotiatedCapabilities = request.requestedCapabilities
      ? request.requestedCapabilities.filter((capability): capability is CommandPayload["type"] =>
          capabilities.has(capability as CommandPayload["type"]),
        )
      : [...capabilities];

    const sessionId = this.sessionIdFactory();
    const now = this.now();
    const issuedAt = now.toISOString();
    const expiresAt = this.sessionTtlMs !== undefined ? new Date(now.getTime() + this.sessionTtlMs).toISOString() : undefined;
    this.sessions.set(sessionId, {
      sessionId,
      protocolVersion: request.protocolVersion,
      client: request.client,
      issuedAt,
      ...(expiresAt ? { expiresAt } : {}),
    });

    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      session: {
        sessionId,
        adapter: this.adapter.platform,
        capabilities: negotiatedCapabilities,
        issuedAt,
      },
    };
  }

  async command(input: unknown): Promise<CommandResultEnvelope> {
    const startedAtMs = Date.now();
    const parsed = CommandEnvelopeSchema.safeParse(input);
    if (!parsed.success) {
      const unknownCommand = parsed.error.issues.some(
        (issue) => issue.path.join(".") === "command.type" && issue.code === "invalid_union_discriminator",
      );
      const errorCode: ErrorCode = unknownCommand ? "UNKNOWN_COMMAND" : "VALIDATION_FAILED";
      this.recordCommandFailure(getCommandTypeFromUnknown(input), startedAtMs, errorCode);
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: getRequestIdFromUnknown(input),
        ok: false,
        error: createProtocolError(
          errorCode,
          unknownCommand ? "Unknown command type" : "Invalid command envelope",
          {
            issues: parsed.error.issues,
          },
        ),
      };
    }

    const envelope = parsed.data;
    if (!isSupportedProtocolVersion(envelope.protocolVersion)) {
      return this.commandErrorWithMetrics({
        requestId: envelope.requestId,
        commandType: envelope.command.type,
        startedAtMs,
        code: "UNSUPPORTED_VERSION",
        message: "Unsupported protocol version",
        details: {
          received: envelope.protocolVersion,
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
        },
      });
    }

    const session = this.getActiveSession(envelope.sessionId);
    if (!session) {
      return this.commandErrorWithMetrics({
        requestId: envelope.requestId,
        commandType: envelope.command.type,
        startedAtMs,
        code: "AUTH_FAILED",
        message: "Unknown or expired session",
      });
    }

    const policyDecision = this.policy.evaluate(envelope.command, session);
    if (!policyDecision.allowed) {
      return this.commandErrorWithMetrics({
        requestId: envelope.requestId,
        commandType: envelope.command.type,
        startedAtMs,
        code: "POLICY_DENIED",
        message: policyDecision.reason ?? "Command denied",
      });
    }

    if (envelope.command.type === "control.cancel") {
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: envelope.requestId,
        ok: true,
        result: this.handleCancelCommand(envelope.sessionId, envelope.command.targetRequestId),
      };
    }

    if (envelope.command.type === "observability.getMetrics") {
      return this.handleGetMetricsCommand(envelope.requestId, startedAtMs);
    }

    if (this.inFlight.has(envelope.requestId)) {
      return this.commandErrorWithMetrics({
        requestId: envelope.requestId,
        commandType: envelope.command.type,
        startedAtMs,
        code: "VALIDATION_FAILED",
        message: "Duplicate requestId is already in-flight",
      });
    }

    return this.executeAdapterCommand({
      ...envelope,
      command: envelope.command as AdapterCommandPayload,
    });
  }

  readScreenshotArtifact(params: {
    artifactId: string;
    sessionId: string;
  }): { bytes: Buffer; mimeType: string; capturedAt: string } | null {
    const artifactId = params.artifactId.trim();
    const sessionId = params.sessionId.trim();
    if (!artifactId || !sessionId || !this.getActiveSession(sessionId)) {
      return null;
    }

    const stored = this.screenshotArtifacts.get(artifactId);
    if (!stored || stored.sessionId !== sessionId) {
      return null;
    }

    return {
      bytes: Buffer.from(stored.bytes),
      mimeType: stored.mimeType,
      capturedAt: stored.capturedAt,
    };
  }

  private getActiveSession(sessionId: string): SessionRecord | undefined {
    this.pruneExpiredSessions();
    return this.sessions.get(sessionId);
  }

  private pruneExpiredSessions(referenceTime: Date = this.now()): number {
    const referenceMs = referenceTime.getTime();
    let removed = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (!session.expiresAt) {
        continue;
      }

      const expiresAtMs = Date.parse(session.expiresAt);
      if (!Number.isFinite(expiresAtMs)) {
        this.sessions.delete(sessionId);
        removed += 1;
        continue;
      }

      if (expiresAtMs <= referenceMs) {
        this.sessions.delete(sessionId);
        removed += 1;
      }
    }

    return removed;
  }

  private initializeAuthTokens(options: HostCoreOptions): void {
    const initialTokens: HostAuthTokenInput[] = [];
    if ("authToken" in options && typeof options.authToken === "string") {
      initialTokens.push(options.authToken);
    }

    if (options.authTokens) {
      initialTokens.push(...options.authTokens);
    }

    if (initialTokens.length === 0) {
      throw new Error("HostCore requires at least one auth token");
    }

    for (const tokenInput of initialTokens) {
      this.addAuthToken(tokenInput);
    }
  }

  private isAuthTokenValid(token: string): boolean {
    this.pruneExpiredAuthTokens();
    return this.authTokens.has(token);
  }

  private handleGetMetricsCommand(requestId: string, startedAtMs: number): CommandResultEnvelope {
    try {
      const snapshot = this.metrics.snapshot?.();
      if (!snapshot) {
        return this.commandErrorWithMetrics({
          requestId,
          commandType: "observability.getMetrics",
          startedAtMs,
          code: "INTERNAL",
          message: "Metrics snapshot unavailable",
        });
      }

      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        ok: true,
        result: {
          type: "observability.metrics",
          snapshot,
        },
      };
    } catch {
      return this.commandErrorWithMetrics({
        requestId,
        commandType: "observability.getMetrics",
        startedAtMs,
        code: "INTERNAL",
        message: "Metrics snapshot unavailable",
      });
    }
  }

  private async executeAdapterCommand(
    envelope: Omit<CommandEnvelope, "command"> & { command: AdapterCommandPayload },
  ): Promise<CommandResultEnvelope> {
    const controller = new AbortController();
    const timeoutMs = envelope.timeoutMs ?? this.defaultTimeoutMs;
    const startedAtMs = Date.now();
    const timeoutHandle = setTimeout(() => {
      controller.abort(ABORT_REASON_TIMEOUT);
    }, timeoutMs);

    this.inFlight.set(envelope.requestId, {
      controller,
      timeoutHandle,
      sessionId: envelope.sessionId,
      commandType: envelope.command.type,
      startedAtMs,
    });

    try {
      const result = await this.adapter.execute(envelope.command, {
        signal: controller.signal,
        sessionId: envelope.sessionId,
        requestId: envelope.requestId,
        persistScreenshotArtifact: (artifact) => {
          this.persistScreenshotArtifact(envelope.sessionId, artifact);
        },
      });

      if (controller.signal.aborted) {
        const abortedEnvelope = this.commandErrorFromAbort(envelope.requestId, controller.signal.reason);
        this.metrics.recordFailure(
          envelope.command.type,
          Date.now() - startedAtMs,
          this.adapter.platform,
          abortedEnvelope.error.code,
        );
        return abortedEnvelope;
      }

      this.metrics.recordSuccess(envelope.command.type, Date.now() - startedAtMs, this.adapter.platform);
      const responseResult = this.withArtifactRetrievalMetadata(envelope.sessionId, result);
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: envelope.requestId,
        ok: true,
        result: responseResult,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        const abortedEnvelope = this.commandErrorFromAbort(envelope.requestId, controller.signal.reason);
        this.metrics.recordFailure(
          envelope.command.type,
          Date.now() - startedAtMs,
          this.adapter.platform,
          abortedEnvelope.error.code,
        );
        return abortedEnvelope;
      }

      const adapterEnvelope = this.commandError(envelope.requestId, "ADAPTER_FAILURE", "Adapter execution failed", {
        message: toErrorMessage(error),
      });
      this.metrics.recordFailure(
        envelope.command.type,
        Date.now() - startedAtMs,
        this.adapter.platform,
        adapterEnvelope.error.code,
      );
      return adapterEnvelope;
    } finally {
      clearTimeout(timeoutHandle);
      this.inFlight.delete(envelope.requestId);
    }
  }

  private persistScreenshotArtifact(sessionId: string, artifact: ScreenshotArtifactPayload): void {
    const artifactId = artifact.artifactId.trim();
    const mimeType = artifact.mimeType.trim();
    if (!artifactId || !mimeType) {
      return;
    }

    const bytes = Buffer.from(artifact.bytes);
    if (bytes.byteLength === 0) {
      return;
    }

    const capturedAtRaw = artifact.capturedAt?.trim();
    const capturedAt = capturedAtRaw || this.now().toISOString();

    if (this.screenshotArtifacts.has(artifactId)) {
      this.screenshotArtifacts.delete(artifactId);
    }

    this.screenshotArtifacts.set(artifactId, {
      sessionId,
      mimeType,
      bytes,
      capturedAt,
    });

    while (this.screenshotArtifacts.size > this.maxScreenshotArtifacts) {
      const oldest = this.screenshotArtifacts.keys().next();
      if (oldest.done) {
        break;
      }

      this.screenshotArtifacts.delete(oldest.value);
    }
  }

  private withArtifactRetrievalMetadata(sessionId: string, result: CommandResultPayload): CommandResultPayload {
    if (result.type !== "screen.captured") {
      return result;
    }

    const artifact = this.screenshotArtifacts.get(result.artifactId);
    if (!artifact || artifact.sessionId !== sessionId) {
      return result;
    }

    return {
      ...result,
      artifactUrl: buildArtifactUrl(result.artifactId, sessionId),
    };
  }

  private handleCancelCommand(sessionId: string, targetRequestId: string) {
    const inFlight = this.inFlight.get(targetRequestId);
    if (!inFlight || inFlight.sessionId !== sessionId) {
      return {
        type: "control.cancelled" as const,
        targetRequestId,
        cancelled: false,
      };
    }

    inFlight.controller.abort(ABORT_REASON_CANCELLED);
    return {
      type: "control.cancelled" as const,
      targetRequestId,
      cancelled: true,
    };
  }

  private commandErrorFromAbort(requestId: string, reason: unknown): CommandErrorEnvelope {
    if (reason === ABORT_REASON_TIMEOUT) {
      return this.commandError(requestId, "TIMEOUT", "Command timed out");
    }

    return this.commandError(requestId, "CANCELLED", "Command cancelled");
  }

  private commandError(
    requestId: string,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): CommandErrorEnvelope {
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      ok: false,
      error: createProtocolError(code, message, details),
    };
  }

  private commandErrorWithMetrics(params: {
    requestId: string;
    commandType: string;
    startedAtMs: number;
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  }): CommandErrorEnvelope {
    const envelope = this.commandError(params.requestId, params.code, params.message, params.details);
    this.recordCommandFailure(params.commandType, params.startedAtMs, params.code);
    return envelope;
  }

  private recordCommandFailure(commandType: string, startedAtMs: number, errorCode: ErrorCode): void {
    this.metrics.recordFailure(commandType, Date.now() - startedAtMs, this.adapter.platform, errorCode);
  }
}

function normalizeAuthTokenInput(tokenInput: HostAuthTokenInput): { token: string; expiresAtMs?: number } {
  if (typeof tokenInput === "string") {
    if (tokenInput.length === 0) {
      throw new Error("Auth token must be non-empty");
    }

    return { token: tokenInput };
  }

  if (tokenInput.token.length === 0) {
    throw new Error("Auth token must be non-empty");
  }

  return {
    token: tokenInput.token,
    expiresAtMs: tokenInput.expiresAt ? parseExpiryToMs(tokenInput.expiresAt) : undefined,
  };
}

function parseExpiryToMs(expiresAt: string | Date): number {
  const expiresAtMs = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error("Invalid token expiry timestamp");
  }

  return expiresAtMs;
}

function normalizeMaxScreenshotArtifacts(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_SCREENSHOT_ARTIFACTS;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeSessionTtlMs(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("sessionTtlMs must be a positive finite number when provided");
  }

  return Math.max(1, Math.floor(value));
}

function buildArtifactUrl(artifactId: string, sessionId: string): string {
  return `/v1/artifacts/${encodeURIComponent(artifactId)}?sessionId=${encodeURIComponent(sessionId)}`;
}

function getRequestIdFromUnknown(input: unknown): string {
  if (typeof input === "object" && input && "requestId" in input) {
    const maybeRequestId = (input as Record<string, unknown>).requestId;
    if (typeof maybeRequestId === "string" && maybeRequestId.length > 0) {
      return maybeRequestId;
    }
  }

  return "unknown";
}

function getCommandTypeFromUnknown(input: unknown): string {
  if (typeof input === "object" && input && "command" in input) {
    const command = (input as Record<string, unknown>).command;
    if (typeof command === "object" && command && "type" in command) {
      const commandType = (command as Record<string, unknown>).type;
      if (typeof commandType === "string" && commandType.length > 0) {
        return commandType;
      }
    }
  }

  return "unknown";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown adapter error";
}
