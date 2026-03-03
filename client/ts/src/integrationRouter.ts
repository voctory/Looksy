import type { CommandRequest, CommandResponse, ExtensibleCommandPayload } from "./protocol.js";

export const LOOKSY_INTEGRATION_ENABLED_FEATURE_FLAG = "LOOKSY_INTEGRATION_ENABLED";
export const LOOKSY_FORCE_LEGACY_EXECUTION_FEATURE_FLAG = "LOOKSY_FORCE_LEGACY_EXECUTION";
export const LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR_FEATURE_FLAG = "LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR";

export interface IntegrationCommandContext {
  protocolVersion?: string;
  requestId?: string;
  sessionId?: string;
  timeoutMs?: number;
}

export interface IntegrationRouteInput<
  TCommand extends ExtensibleCommandPayload = ExtensibleCommandPayload,
  TContext extends IntegrationCommandContext = IntegrationCommandContext,
> {
  command: TCommand;
  context?: TContext;
}

export interface IntegrationRouterFeatureFlagOptions {
  integrationEnabled?: boolean;
  integrationFeatureFlagName?: string;
  forceLegacyExecution?: boolean;
  forceLegacyFeatureFlagName?: string;
  fallbackToLegacyOnError?: boolean;
  fallbackFeatureFlagName?: string;
  env?: Record<string, string | undefined>;
}

export interface IntegrationRouterConfig {
  integrationEnabled: boolean;
  integrationFeatureFlagName: string;
  forceLegacyExecution: boolean;
  forceLegacyFeatureFlagName: string;
  fallbackToLegacyOnError: boolean;
  fallbackFeatureFlagName: string;
}

export interface IntegrationRouterLooksyClient {
  command<TResult = unknown, TCommand extends ExtensibleCommandPayload = ExtensibleCommandPayload>(
    request: CommandRequest<TCommand>,
  ): Promise<CommandResponse<TResult>>;
}

export interface IntegrationRouterOptions<
  TCommand extends ExtensibleCommandPayload = ExtensibleCommandPayload,
  TContext extends IntegrationCommandContext = IntegrationCommandContext,
  TLegacyResult = unknown,
  TLooksyResult = unknown,
> {
  looksyClient: IntegrationRouterLooksyClient;
  legacyExecutor: (input: IntegrationRouteInput<TCommand, TContext>) => Promise<TLegacyResult>;
  featureFlags?: IntegrationRouterFeatureFlagOptions;
  createLooksyRequest?: (input: IntegrationRouteInput<TCommand, TContext>) => CommandRequest<TCommand>;
  shouldFallbackOnLooksyError?: (error: unknown, input: IntegrationRouteInput<TCommand, TContext>) => boolean;
}

export interface LooksyRouteResult<TLooksyResult> {
  route: "looksy";
  response: CommandResponse<TLooksyResult>;
  config: IntegrationRouterConfig;
}

export interface LegacyRouteResult<TLegacyResult> {
  route: "legacy";
  reason: "integration-disabled" | "force-legacy";
  response: TLegacyResult;
  config: IntegrationRouterConfig;
}

export interface LegacyFallbackRouteResult<TLegacyResult> {
  route: "legacy-fallback";
  reason: "looksy-error";
  response: TLegacyResult;
  looksyError: unknown;
  config: IntegrationRouterConfig;
}

export type IntegrationRouteResult<TLooksyResult, TLegacyResult> =
  | LooksyRouteResult<TLooksyResult>
  | LegacyRouteResult<TLegacyResult>
  | LegacyFallbackRouteResult<TLegacyResult>;

export interface IntegrationRouter<
  TCommand extends ExtensibleCommandPayload = ExtensibleCommandPayload,
  TContext extends IntegrationCommandContext = IntegrationCommandContext,
  TLegacyResult = unknown,
  TLooksyResult = unknown,
> {
  route(input: IntegrationRouteInput<TCommand, TContext>): Promise<IntegrationRouteResult<TLooksyResult, TLegacyResult>>;
  getConfig(): IntegrationRouterConfig;
}

const TRUTHY_FEATURE_FLAG_VALUES = new Set(["1", "true", "on", "yes"]);

type RuntimeEnvironment = {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

export function createIntegrationRouterConfig(
  options: IntegrationRouterFeatureFlagOptions = {},
): IntegrationRouterConfig {
  const integrationFeatureFlagName = options.integrationFeatureFlagName ?? LOOKSY_INTEGRATION_ENABLED_FEATURE_FLAG;
  const forceLegacyFeatureFlagName = options.forceLegacyFeatureFlagName ?? LOOKSY_FORCE_LEGACY_EXECUTION_FEATURE_FLAG;
  const fallbackFeatureFlagName = options.fallbackFeatureFlagName ?? LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR_FEATURE_FLAG;

  return {
    integrationEnabled:
      options.integrationEnabled ?? parseFeatureFlag(readEnvironmentVariable(integrationFeatureFlagName, options.env)),
    integrationFeatureFlagName,
    forceLegacyExecution:
      options.forceLegacyExecution ?? parseFeatureFlag(readEnvironmentVariable(forceLegacyFeatureFlagName, options.env)),
    forceLegacyFeatureFlagName,
    fallbackToLegacyOnError:
      options.fallbackToLegacyOnError ?? parseFeatureFlag(readEnvironmentVariable(fallbackFeatureFlagName, options.env)),
    fallbackFeatureFlagName,
  };
}

export function createIntegrationRouter<
  TCommand extends ExtensibleCommandPayload = ExtensibleCommandPayload,
  TContext extends IntegrationCommandContext = IntegrationCommandContext,
  TLegacyResult = unknown,
  TLooksyResult = unknown,
>(
  options: IntegrationRouterOptions<TCommand, TContext, TLegacyResult, TLooksyResult>,
): IntegrationRouter<TCommand, TContext, TLegacyResult, TLooksyResult> {
  const createLooksyRequest =
    options.createLooksyRequest ??
    ((input: IntegrationRouteInput<TCommand, TContext>): CommandRequest<TCommand> => ({
      protocolVersion: input.context?.protocolVersion,
      requestId: input.context?.requestId,
      sessionId: input.context?.sessionId,
      timeoutMs: input.context?.timeoutMs,
      command: input.command,
    }));

  return {
    getConfig(): IntegrationRouterConfig {
      return createIntegrationRouterConfig(options.featureFlags);
    },
    async route(input: IntegrationRouteInput<TCommand, TContext>): Promise<IntegrationRouteResult<TLooksyResult, TLegacyResult>> {
      const config = createIntegrationRouterConfig(options.featureFlags);

      if (!config.integrationEnabled) {
        return executeLegacy(options, config, input, "integration-disabled");
      }

      if (config.forceLegacyExecution) {
        return executeLegacy(options, config, input, "force-legacy");
      }

      try {
        const response = await options.looksyClient.command<TLooksyResult, TCommand>(createLooksyRequest(input));
        return {
          route: "looksy",
          response,
          config,
        };
      } catch (error) {
        const shouldFallback =
          config.fallbackToLegacyOnError && (options.shouldFallbackOnLooksyError?.(error, input) ?? true);

        if (!shouldFallback) {
          throw error;
        }

        const fallbackResponse = await options.legacyExecutor(input);
        return {
          route: "legacy-fallback",
          reason: "looksy-error",
          response: fallbackResponse,
          looksyError: error,
          config,
        };
      }
    },
  };
}

async function executeLegacy<
  TCommand extends ExtensibleCommandPayload = ExtensibleCommandPayload,
  TContext extends IntegrationCommandContext = IntegrationCommandContext,
  TLegacyResult = unknown,
  TLooksyResult = unknown,
>(
  options: IntegrationRouterOptions<TCommand, TContext, TLegacyResult, TLooksyResult>,
  config: IntegrationRouterConfig,
  input: IntegrationRouteInput<TCommand, TContext>,
  reason: "integration-disabled" | "force-legacy",
): Promise<LegacyRouteResult<TLegacyResult>> {
  const response = await options.legacyExecutor(input);
  return {
    route: "legacy",
    reason,
    response,
    config,
  };
}

function readEnvironmentVariable(name: string, env?: Record<string, string | undefined>): string | undefined {
  if (env) {
    return env[name];
  }

  return (globalThis as RuntimeEnvironment).process?.env?.[name];
}

function parseFeatureFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return TRUTHY_FEATURE_FLAG_VALUES.has(value.trim().toLowerCase());
}
