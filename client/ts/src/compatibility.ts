export const LEGACY_ACTION_COMPAT_FEATURE_FLAG = "LOOKSY_ENABLE_LEGACY_ACTION_COMPAT";

export const DEFAULT_LEGACY_ACTION_TO_V1_COMMAND = {
  health: "health.ping",
  ping: "health.ping",
  capabilities: "health.getCapabilities",
  screenshot: "screen.capture",
  "windows.list": "app.listWindows",
  windowsList: "app.listWindows",
  "windows.focus": "app.focusWindow",
  moveMouse: "input.moveMouse",
  click: "input.click",
  typeText: "input.typeText",
  cancel: "control.cancel",
} as const;

export type LegacyActionMapping = Record<string, string>;

export interface LegacyActionCompatibilityOptions {
  enabled?: boolean;
  featureFlagName?: string;
  actionMap?: LegacyActionMapping;
}

export interface LegacyActionCompatibilityConfig {
  enabled: boolean;
  featureFlagName: string;
  actionMap: Readonly<LegacyActionMapping>;
}

const TRUTHY_FEATURE_FLAG_VALUES = new Set(["1", "true", "on", "yes"]);

type RuntimeEnvironment = {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

export function createLegacyActionCompatibilityConfig(
  options: LegacyActionCompatibilityOptions = {},
): LegacyActionCompatibilityConfig {
  const featureFlagName = options.featureFlagName ?? LEGACY_ACTION_COMPAT_FEATURE_FLAG;
  const enabled = options.enabled ?? parseFeatureFlag(readEnvironmentVariable(featureFlagName));

  return {
    enabled,
    featureFlagName,
    actionMap: Object.freeze({
      ...DEFAULT_LEGACY_ACTION_TO_V1_COMMAND,
      ...(options.actionMap ?? {}),
    }),
  };
}

export function resolveLegacyActionCommandType(
  commandType: string,
  config: LegacyActionCompatibilityConfig,
): string {
  if (!config.enabled) {
    return commandType;
  }

  return config.actionMap[commandType] ?? commandType;
}

function readEnvironmentVariable(name: string): string | undefined {
  return (globalThis as RuntimeEnvironment).process?.env?.[name];
}

function parseFeatureFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return TRUTHY_FEATURE_FLAG_VALUES.has(value.trim().toLowerCase());
}
