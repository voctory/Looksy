export {
  LooksyClient,
  type CommandInvocationOptions,
  type HandshakeInput,
  type LooksyClientOptions,
  type ScreenshotPayload,
  type WindowsListPayload,
} from "./client.js";
export {
  DEFAULT_LEGACY_ACTION_TO_V1_COMMAND,
  LEGACY_ACTION_COMPAT_FEATURE_FLAG,
  createLegacyActionCompatibilityConfig,
  resolveLegacyActionCommandType,
  type LegacyActionCompatibilityConfig,
  type LegacyActionCompatibilityOptions,
  type LegacyActionMapping,
} from "./compatibility.js";
export { LooksyHttpError } from "./http.js";
export type {
  CommandRequest,
  CommandResponse,
  ExtensibleCommandPayload,
  HandshakeRequest,
  HandshakeResponse,
} from "./protocol.js";
