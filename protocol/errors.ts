import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "AUTH_FAILED",
  "POLICY_DENIED",
  "VALIDATION_FAILED",
  "UNSUPPORTED_VERSION",
  "UNKNOWN_COMMAND",
  "TIMEOUT",
  "CANCELLED",
  "ADAPTER_FAILURE",
  "INTERNAL",
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ProtocolErrorSchema = z
  .object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    retriable: z.boolean(),
    details: z.record(z.unknown()).optional(),
  })
  .strict();

export type ProtocolError = z.infer<typeof ProtocolErrorSchema>;

const DEFAULT_RETRIABLE_BY_CODE: Record<ErrorCode, boolean> = {
  AUTH_FAILED: false,
  POLICY_DENIED: false,
  VALIDATION_FAILED: false,
  UNSUPPORTED_VERSION: false,
  UNKNOWN_COMMAND: false,
  TIMEOUT: true,
  CANCELLED: true,
  ADAPTER_FAILURE: true,
  INTERNAL: true,
};

export function createProtocolError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  retriable = DEFAULT_RETRIABLE_BY_CODE[code],
): ProtocolError {
  return {
    code,
    message,
    retriable,
    ...(details ? { details } : {}),
  };
}
