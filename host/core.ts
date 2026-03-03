import { randomUUID } from "node:crypto";
import {
  CommandEnvelopeSchema,
  HandshakeRequestSchema,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CommandEnvelope,
  type CommandPayload,
  type CommandResultEnvelope,
  type ErrorCode,
  type HandshakeResultEnvelope,
  createProtocolError,
  isSupportedProtocolVersion,
} from "../protocol";
import { InMemoryMetricsRecorder, type HostMetricsRecorder } from "./metrics";
import { AllowAllPolicy, type CommandPolicy } from "./policy";
import type { AdapterCommandPayload, HostAdapter, SessionRecord } from "./types";

const ABORT_REASON_TIMEOUT = "timeout";
const ABORT_REASON_CANCELLED = "cancelled";

interface InFlightRequest {
  controller: AbortController;
  timeoutHandle?: NodeJS.Timeout;
  sessionId: string;
  commandType: AdapterCommandPayload["type"];
  startedAtMs: number;
}

type CommandErrorEnvelope = Extract<CommandResultEnvelope, { ok: false }>;

export interface HostCoreOptions {
  adapter: HostAdapter;
  authToken: string;
  policy?: CommandPolicy;
  defaultTimeoutMs?: number;
  now?: () => Date;
  sessionIdFactory?: () => string;
  metrics?: HostMetricsRecorder;
}

export class HostCore {
  private readonly adapter: HostAdapter;
  private readonly authToken: string;
  private readonly policy: CommandPolicy;
  private readonly defaultTimeoutMs: number;
  private readonly now: () => Date;
  private readonly sessionIdFactory: () => string;
  private readonly metrics: HostMetricsRecorder;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly inFlight = new Map<string, InFlightRequest>();

  constructor(options: HostCoreOptions) {
    this.adapter = options.adapter;
    this.authToken = options.authToken;
    this.policy = options.policy ?? new AllowAllPolicy();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10_000;
    this.now = options.now ?? (() => new Date());
    this.sessionIdFactory = options.sessionIdFactory ?? randomUUID;
    this.metrics = options.metrics ?? new InMemoryMetricsRecorder();
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

    if (request.authToken !== this.authToken) {
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: false,
        error: createProtocolError("AUTH_FAILED", "Invalid auth token"),
      };
    }

    const capabilities = new Set<CommandPayload["type"]>([...this.adapter.getCapabilities(), "control.cancel"]);
    const negotiatedCapabilities = request.requestedCapabilities
      ? request.requestedCapabilities.filter((capability): capability is CommandPayload["type"] =>
          capabilities.has(capability as CommandPayload["type"]),
        )
      : [...capabilities];

    const sessionId = this.sessionIdFactory();
    const issuedAt = this.now().toISOString();
    this.sessions.set(sessionId, {
      sessionId,
      protocolVersion: request.protocolVersion,
      client: request.client,
      issuedAt,
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
    const parsed = CommandEnvelopeSchema.safeParse(input);
    if (!parsed.success) {
      const unknownCommand = parsed.error.issues.some(
        (issue) => issue.path.join(".") === "command.type" && issue.code === "invalid_union_discriminator",
      );
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: getRequestIdFromUnknown(input),
        ok: false,
        error: createProtocolError(
          unknownCommand ? "UNKNOWN_COMMAND" : "VALIDATION_FAILED",
          unknownCommand ? "Unknown command type" : "Invalid command envelope",
          {
            issues: parsed.error.issues,
          },
        ),
      };
    }

    const envelope = parsed.data;
    if (!isSupportedProtocolVersion(envelope.protocolVersion)) {
      return this.commandError(envelope.requestId, "UNSUPPORTED_VERSION", "Unsupported protocol version", {
        received: envelope.protocolVersion,
        supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      });
    }

    const session = this.sessions.get(envelope.sessionId);
    if (!session) {
      return this.commandError(envelope.requestId, "AUTH_FAILED", "Unknown or expired session");
    }

    const policyDecision = this.policy.evaluate(envelope.command, session);
    if (!policyDecision.allowed) {
      return this.commandError(envelope.requestId, "POLICY_DENIED", policyDecision.reason ?? "Command denied");
    }

    if (envelope.command.type === "control.cancel") {
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: envelope.requestId,
        ok: true,
        result: this.handleCancelCommand(envelope.sessionId, envelope.command.targetRequestId),
      };
    }

    if (this.inFlight.has(envelope.requestId)) {
      return this.commandError(envelope.requestId, "VALIDATION_FAILED", "Duplicate requestId is already in-flight");
    }

    return this.executeAdapterCommand({
      ...envelope,
      command: envelope.command as AdapterCommandPayload,
    });
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
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: envelope.requestId,
        ok: true,
        result,
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown adapter error";
}
