# Looksy Integration Guide: Feature Flags and Rollback Toggles

This guide defines a reversible integration pattern for embedding Looksy in consumer applications.

## 1. Required Flags

Define these toggles in the consumer app:

| Flag | Default | Purpose |
| --- | --- | --- |
| `LOOKSY_INTEGRATION_ENABLED` | `false` | Master switch for routing automation through Looksy. |
| `LOOKSY_ENABLE_LEGACY_ACTION_COMPAT` | `false` | Enables TS client-side legacy action name mapping to protocol v1 command names. |
| `LOOKSY_FORCE_LEGACY_EXECUTION` | `false` | Emergency rollback toggle to force legacy execution path even when integration is enabled. |
| `LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR` | `false` | Optional automatic fallback to legacy when Looksy execution throws (transport/runtime failure path). |
| `LOOKSY_OS_INPUT_ONLY` | `false` | Consumer-side safety gate that routes only OS-input-safe actions through Looksy and leaves browser-driver/state actions on legacy paths. |

## 2. Command Name Baseline (Protocol v1)

Use protocol v1 command names as source of truth:

- `health.ping`
- `health.getCapabilities`
- `screen.capture`
- `input.moveMouse`
- `input.click`
- `input.typeText`
- `app.listWindows`
- `app.focusWindow`
- `element.find`
- `element.invoke`
- `element.setValue`
- `control.cancel`

## 3. Integration Routing Pattern

```ts
import {
  LooksyClient,
  createIntegrationRouter,
  type ExtensibleCommandPayload,
  type IntegrationCommandContext,
} from "@looksy/client-ts";

interface AutomationCommand extends ExtensibleCommandPayload {
  type: string;
}

const looksy = new LooksyClient({
  baseUrl: process.env.LOOKSY_BASE_URL ?? "http://127.0.0.1:4064",
  authToken: process.env.LOOKSY_AUTH_TOKEN,
  // Reads LOOKSY_ENABLE_LEGACY_ACTION_COMPAT when omitted.
  legacyActionCompatibility: {},
});

interface AutomationContext extends IntegrationCommandContext {
  traceId: string;
}

const router = createIntegrationRouter<AutomationCommand, AutomationContext, unknown>({
  looksyClient: looksy,
  legacyExecutor: async ({ command, context }) => runLegacyAutomation(command, context),
  // When omitted, router reads these env flags directly:
  // LOOKSY_INTEGRATION_ENABLED
  // LOOKSY_FORCE_LEGACY_EXECUTION
  // LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR
  featureFlags: {},
});

export async function runAutomation(command: AutomationCommand, context: AutomationContext) {
  const routed = await router.route({ command, context });
  telemetry.count("automation.route", 1, { route: routed.route, commandType: command.type });
  return routed.response;
}
```

## 4. Rollout Sequence

1. Deploy with `LOOKSY_INTEGRATION_ENABLED=false`.
2. Enable `LOOKSY_ENABLE_LEGACY_ACTION_COMPAT=true` for migration cohorts still emitting legacy action names.
3. Enable `LOOKSY_INTEGRATION_ENABLED=true` for internal dogfood users only.
4. Enable `LOOKSY_OS_INPUT_ONLY=true` for OS-input-first rollout waves.
5. Keep `LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR=true` only for initial rollout waves if automatic fallback is required.
6. Expand rollout by cohort while monitoring success/error rate and p95 latency.
7. Disable `LOOKSY_ENABLE_LEGACY_ACTION_COMPAT` after consumers send protocol v1 command names natively.
8. Disable `LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR` only after stability targets are met.
9. Disable `LOOKSY_OS_INPUT_ONLY` only after browser-driver/state parity is explicitly validated.

## 5. Rollback Procedure

1. Set `LOOKSY_FORCE_LEGACY_EXECUTION=true`.
2. If needed, set `LOOKSY_INTEGRATION_ENABLED=false`.
3. Keep or set `LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR=true` while triaging Looksy failures.
4. Keep `LOOKSY_OS_INPUT_ONLY=true` until browser-driver/state parity is re-validated.
5. Re-run smoke checks: handshake + `health.ping` + `screen.capture`.
6. Capture incident summary with failing command type, error code, and timestamp.

## 6. Acceptance Checklist

- [ ] Integration path can be turned on without redeploying code.
- [ ] Rollback path can be turned on without redeploying code.
- [ ] Legacy action compatibility can be toggled independently of integration toggle.
- [ ] Automatic fallback toggle can be enabled/disabled independently (`LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR`).
- [ ] OS-input-first scope can be toggled independently (`LOOKSY_OS_INPUT_ONLY`) in consumers that implement this gate.
- [ ] Telemetry tags include integration path (`looksy` vs `legacy`) and command type.
- [ ] Runbook is linked from release docs and owned by on-call.
