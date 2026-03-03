export const PROTOCOL_VERSION = "1.0.0" as const;

export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION] as const;

export type SupportedProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

export function isSupportedProtocolVersion(version: string): version is SupportedProtocolVersion {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version as SupportedProtocolVersion);
}
