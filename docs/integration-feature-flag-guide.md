# Looksy Integration Guide: Feature Flags and Rollback Toggles

This guide defines a reversible integration pattern for embedding Looksy in consumer applications.

## 1. Required Flags

Define three independent toggles in the consumer app:

| Flag | Default | Purpose |
| --- | --- | --- |
| `LOOKSY_INTEGRATION_ENABLED` | `false` | Master switch for routing automation through Looksy. |
| `LOOKSY_ENABLE_LEGACY_ACTION_COMPAT` | `false` | Enables TS client-side legacy action name mapping to protocol v1 command names. |
| `LOOKSY_FORCE_LEGACY_EXECUTION` | `false` | Emergency rollback toggle to force legacy execution path even when integration is enabled. |

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
import { LooksyClient } from "@looksy/client-ts";

const looksyEnabled = process.env.LOOKSY_INTEGRATION_ENABLED === "true";
const forceLegacyExecution = process.env.LOOKSY_FORCE_LEGACY_EXECUTION === "true";

const looksy = new LooksyClient({
  baseUrl: process.env.LOOKSY_BASE_URL ?? "http://127.0.0.1:4064",
  authToken: process.env.LOOKSY_AUTH_TOKEN,
  // Reads LOOKSY_ENABLE_LEGACY_ACTION_COMPAT when omitted.
  legacyActionCompatibility: {},
});

export async function runAutomation(action: { type: string; [key: string]: unknown }) {
  if (!looksyEnabled || forceLegacyExecution) {
    return runLegacyAutomation(action);
  }

  return looksy.command({
    command: action,
  });
}
```

## 4. Rollout Sequence

1. Deploy with `LOOKSY_INTEGRATION_ENABLED=false`.
2. Enable `LOOKSY_ENABLE_LEGACY_ACTION_COMPAT=true` for migration cohorts still emitting legacy action names.
3. Enable `LOOKSY_INTEGRATION_ENABLED=true` for internal dogfood users only.
4. Expand rollout by cohort while monitoring success/error rate and p95 latency.
5. Disable `LOOKSY_ENABLE_LEGACY_ACTION_COMPAT` after consumers send protocol v1 command names natively.

## 5. Rollback Procedure

1. Set `LOOKSY_FORCE_LEGACY_EXECUTION=true`.
2. If needed, set `LOOKSY_INTEGRATION_ENABLED=false`.
3. Re-run smoke checks: handshake + `health.ping` + `screen.capture`.
4. Capture incident summary with failing command type, error code, and timestamp.

## 6. Acceptance Checklist

- [ ] Integration path can be turned on without redeploying code.
- [ ] Rollback path can be turned on without redeploying code.
- [ ] Legacy action compatibility can be toggled independently of integration toggle.
- [ ] Telemetry tags include integration path (`looksy` vs `legacy`) and command type.
- [ ] Runbook is linked from release docs and owned by on-call.
