import { z } from "zod";
import { ErrorCodeSchema, ProtocolErrorSchema } from "./errors";

export const RequestIdSchema = z.string().min(1).max(128);
export const SessionIdSchema = z.string().min(1).max(128);
export const ProtocolVersionSchema = z.string().min(1).max(32);

export const PlatformSchema = z.enum(["macos", "windows"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const CoordinateSpaceSchema = z.enum(["screen-physical", "screen-dip", "window-client"]);
export type CoordinateSpace = z.infer<typeof CoordinateSpaceSchema>;

export const PointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    space: CoordinateSpaceSchema,
  })
  .strict();

export type Point = z.infer<typeof PointSchema>;

export const RectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    space: CoordinateSpaceSchema,
  })
  .strict();

export type Rect = z.infer<typeof RectSchema>;

export const WindowInfoSchema = z
  .object({
    windowId: z.string().min(1),
    title: z.string().min(1),
    appName: z.string().min(1),
    focused: z.boolean(),
    bounds: RectSchema,
  })
  .strict();

export type WindowInfo = z.infer<typeof WindowInfoSchema>;

export const MouseButtonSchema = z.enum(["left", "right", "middle"]);
export const ImageFormatSchema = z.enum(["png", "jpeg"]);
export const ElementActionSchema = z.enum(["press", "focus", "expand", "collapse"]);

const MetricsCounterRecordSchema = z.record(z.string().min(1), z.number().int().nonnegative());

export const MetricsLatencySummarySchema = z
  .object({
    sampleCount: z.number().int().nonnegative(),
    minMs: z.number().finite().nonnegative(),
    maxMs: z.number().finite().nonnegative(),
    avgMs: z.number().finite().nonnegative(),
  })
  .strict();

export type MetricsLatencySummary = z.infer<typeof MetricsLatencySummarySchema>;

export const MetricsSnapshotSchema = z
  .object({
    successCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    successByCommand: MetricsCounterRecordSchema,
    failureByCommand: MetricsCounterRecordSchema,
    failureByCode: z.record(ErrorCodeSchema, z.number().int().nonnegative()),
    latencyMs: MetricsLatencySummarySchema,
  })
  .strict();

export type MetricsSnapshot = z.infer<typeof MetricsSnapshotSchema>;

const HealthPingCommandSchema = z
  .object({
    type: z.literal("health.ping"),
  })
  .strict();

const HealthGetCapabilitiesCommandSchema = z
  .object({
    type: z.literal("health.getCapabilities"),
  })
  .strict();

const ObservabilityGetMetricsCommandSchema = z
  .object({
    type: z.literal("observability.getMetrics"),
  })
  .strict();

const ScreenCaptureCommandSchema = z
  .object({
    type: z.literal("screen.capture"),
    format: ImageFormatSchema.optional(),
    region: RectSchema.optional(),
  })
  .strict();

const InputMoveMouseCommandSchema = z
  .object({
    type: z.literal("input.moveMouse"),
    point: PointSchema,
  })
  .strict();

const InputClickCommandSchema = z
  .object({
    type: z.literal("input.click"),
    button: MouseButtonSchema,
    point: PointSchema.optional(),
  })
  .strict();

const InputTypeTextCommandSchema = z
  .object({
    type: z.literal("input.typeText"),
    text: z.string(),
  })
  .strict();

const AppListWindowsCommandSchema = z
  .object({
    type: z.literal("app.listWindows"),
    includeMinimized: z.boolean().optional(),
    desktopOnly: z.boolean().optional(),
  })
  .strict();

const AppFocusWindowCommandSchema = z
  .object({
    type: z.literal("app.focusWindow"),
    windowId: z.string().min(1),
  })
  .strict();

const ElementFindCommandSchema = z
  .object({
    type: z.literal("element.find"),
    selector: z.string().min(1),
    windowId: z.string().min(1).optional(),
  })
  .strict();

const ElementInvokeCommandSchema = z
  .object({
    type: z.literal("element.invoke"),
    elementId: z.string().min(1),
    action: ElementActionSchema,
  })
  .strict();

const ElementSetValueCommandSchema = z
  .object({
    type: z.literal("element.setValue"),
    elementId: z.string().min(1),
    value: z.string(),
  })
  .strict();

const ControlCancelCommandSchema = z
  .object({
    type: z.literal("control.cancel"),
    targetRequestId: RequestIdSchema,
  })
  .strict();

export const CommandPayloadSchema = z.discriminatedUnion("type", [
  HealthPingCommandSchema,
  HealthGetCapabilitiesCommandSchema,
  ObservabilityGetMetricsCommandSchema,
  ScreenCaptureCommandSchema,
  InputMoveMouseCommandSchema,
  InputClickCommandSchema,
  InputTypeTextCommandSchema,
  AppListWindowsCommandSchema,
  AppFocusWindowCommandSchema,
  ElementFindCommandSchema,
  ElementInvokeCommandSchema,
  ElementSetValueCommandSchema,
  ControlCancelCommandSchema,
]);

export type CommandPayload = z.infer<typeof CommandPayloadSchema>;
export type CommandType = CommandPayload["type"];

const HealthPongResultSchema = z
  .object({
    type: z.literal("health.pong"),
    status: z.literal("ok"),
    adapter: PlatformSchema,
    now: z.string().datetime(),
  })
  .strict();

const HealthCapabilitiesResultSchema = z
  .object({
    type: z.literal("health.capabilities"),
    capabilities: z.array(z.string().min(1)),
  })
  .strict();

const ObservabilityMetricsResultSchema = z
  .object({
    type: z.literal("observability.metrics"),
    snapshot: MetricsSnapshotSchema,
  })
  .strict();

const ScreenCapturedResultSchema = z
  .object({
    type: z.literal("screen.captured"),
    artifactId: z.string().min(1),
    mimeType: z.string().min(1),
    capturedAt: z.string().datetime(),
    artifactUrl: z.string().min(1).optional(),
    region: RectSchema.optional(),
  })
  .strict();

const InputMouseMovedResultSchema = z
  .object({
    type: z.literal("input.mouseMoved"),
    point: PointSchema,
  })
  .strict();

const InputClickedResultSchema = z
  .object({
    type: z.literal("input.clicked"),
    button: MouseButtonSchema,
    point: PointSchema.optional(),
  })
  .strict();

const InputTypedResultSchema = z
  .object({
    type: z.literal("input.typed"),
    textLength: z.number().int().nonnegative(),
  })
  .strict();

const AppWindowsListedResultSchema = z
  .object({
    type: z.literal("app.windowsListed"),
    windows: z.array(WindowInfoSchema),
  })
  .strict();

const AppWindowFocusedResultSchema = z
  .object({
    type: z.literal("app.windowFocused"),
    windowId: z.string().min(1),
    focused: z.boolean(),
  })
  .strict();

const ElementFoundResultSchema = z
  .object({
    type: z.literal("element.found"),
    elementId: z.string().min(1),
    confidence: z.number().min(0).max(1),
    rect: RectSchema.optional(),
  })
  .strict();

const ElementInvokedResultSchema = z
  .object({
    type: z.literal("element.invoked"),
    elementId: z.string().min(1),
    action: ElementActionSchema,
    invoked: z.boolean(),
  })
  .strict();

const ElementValueSetResultSchema = z
  .object({
    type: z.literal("element.valueSet"),
    elementId: z.string().min(1),
    valueSet: z.boolean(),
  })
  .strict();

const ControlCancelledResultSchema = z
  .object({
    type: z.literal("control.cancelled"),
    targetRequestId: RequestIdSchema,
    cancelled: z.boolean(),
  })
  .strict();

export const CommandResultPayloadSchema = z.discriminatedUnion("type", [
  HealthPongResultSchema,
  HealthCapabilitiesResultSchema,
  ObservabilityMetricsResultSchema,
  ScreenCapturedResultSchema,
  InputMouseMovedResultSchema,
  InputClickedResultSchema,
  InputTypedResultSchema,
  AppWindowsListedResultSchema,
  AppWindowFocusedResultSchema,
  ElementFoundResultSchema,
  ElementInvokedResultSchema,
  ElementValueSetResultSchema,
  ControlCancelledResultSchema,
]);

export type CommandResultPayload = z.infer<typeof CommandResultPayloadSchema>;

export const ClientInfoSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
  })
  .strict();

export const HandshakeRequestSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    requestId: RequestIdSchema,
    authToken: z.string().min(1),
    client: ClientInfoSchema,
    requestedCapabilities: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type HandshakeRequest = z.infer<typeof HandshakeRequestSchema>;

const SessionInfoSchema = z
  .object({
    sessionId: SessionIdSchema,
    adapter: PlatformSchema,
    capabilities: z.array(z.string().min(1)),
    issuedAt: z.string().datetime(),
  })
  .strict();

const HandshakeSuccessEnvelopeSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    requestId: RequestIdSchema,
    ok: z.literal(true),
    session: SessionInfoSchema,
  })
  .strict();

const HandshakeErrorEnvelopeSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    requestId: RequestIdSchema,
    ok: z.literal(false),
    error: ProtocolErrorSchema,
  })
  .strict();

export const HandshakeResultEnvelopeSchema = z.discriminatedUnion("ok", [
  HandshakeSuccessEnvelopeSchema,
  HandshakeErrorEnvelopeSchema,
]);

export type HandshakeResultEnvelope = z.infer<typeof HandshakeResultEnvelopeSchema>;

export const CommandEnvelopeSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    requestId: RequestIdSchema,
    sessionId: SessionIdSchema,
    timeoutMs: z.number().int().positive().max(300_000).optional(),
    command: CommandPayloadSchema,
  })
  .strict();

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

const CommandSuccessEnvelopeSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    requestId: RequestIdSchema,
    ok: z.literal(true),
    result: CommandResultPayloadSchema,
  })
  .strict();

const CommandErrorEnvelopeSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    requestId: RequestIdSchema,
    ok: z.literal(false),
    error: ProtocolErrorSchema,
  })
  .strict();

export const CommandResultEnvelopeSchema = z.discriminatedUnion("ok", [
  CommandSuccessEnvelopeSchema,
  CommandErrorEnvelopeSchema,
]);

export type CommandResultEnvelope = z.infer<typeof CommandResultEnvelopeSchema>;

export function parseHandshakeRequest(input: unknown): HandshakeRequest {
  return HandshakeRequestSchema.parse(input);
}

export function parseCommandEnvelope(input: unknown): CommandEnvelope {
  return CommandEnvelopeSchema.parse(input);
}
