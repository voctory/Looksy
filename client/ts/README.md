# @looksy/client-ts

TypeScript SDK for the local Looksy host API.

## API surface

- `LooksyClient.handshake()` -> `POST /v1/handshake`
- `LooksyClient.command()` -> `POST /v1/command`
- Convenience wrappers: `health()`, `capabilities()`, `screenshot()`, `windowsList()`

Protocol v1 command names used by the SDK wrappers:
- `health()` -> `health.ping`
- `capabilities()` -> `health.getCapabilities`
- `screenshot()` -> `screen.capture`
- `windowsList()` -> `app.listWindows`

## Usage

```ts
import { LooksyClient } from "@looksy/client-ts";

const client = new LooksyClient({
  baseUrl: "http://127.0.0.1:4064",
  authToken: process.env.LOOKSY_AUTH_TOKEN,
});

const handshake = await client.handshake({
  client: { name: "example", version: "0.1.0" },
  requestedCapabilities: ["screen.capture", "health.getCapabilities"],
});

if (handshake.ok) {
  const capabilities = await client.capabilities();

  const windows = await client.windowsList({ includeMinimized: true });
  console.log(capabilities, windows);
}
```

## Feature-flagged integration router

Use `createIntegrationRouter()` to route command execution between Looksy and a legacy executor without app-level branching.

- `LOOKSY_INTEGRATION_ENABLED`: route through Looksy when true
- `LOOKSY_FORCE_LEGACY_EXECUTION`: force legacy execution even when integration is enabled
- `LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR`: optional automatic fallback when Looksy command execution throws

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

interface AutomationContext extends IntegrationCommandContext {
  traceId: string;
}

const looksyClient = new LooksyClient({
  baseUrl: process.env.LOOKSY_BASE_URL ?? "http://127.0.0.1:4064",
  authToken: process.env.LOOKSY_AUTH_TOKEN,
});

const router = createIntegrationRouter<AutomationCommand, AutomationContext, unknown>({
  looksyClient,
  legacyExecutor: ({ command, context }) => runLegacyAutomation(command, context),
  featureFlags: {},
});

const routed = await router.route({
  command: { type: "screen.capture" },
  context: { sessionId: "sess_123", traceId: "trace_123" },
});

if (routed.route === "looksy") {
  console.log("Looksy response", routed.response);
} else {
  console.log("Legacy response", routed.response, routed.route);
}
```

## Legacy action compatibility flag

For integrations migrating from legacy action names, the SDK can map legacy names to protocol v1 command names.

- Feature flag env var: `LOOKSY_ENABLE_LEGACY_ACTION_COMPAT`
- Default: disabled
- Enable values: `1`, `true`, `on`, `yes`

```ts
import { LooksyClient } from "@looksy/client-ts";

const client = new LooksyClient({
  authToken: process.env.LOOKSY_AUTH_TOKEN,
  // Explicit override (takes precedence over env var):
  legacyActionCompatibility: { enabled: true },
});

client.setSessionId("sess_123");

// Legacy name:
await client.command({ command: { type: "screenshot" } });
// Sent to host as: screen.capture
```

The SDK keeps protocol envelope types aligned with the shared protocol v1 contract (`/v1/handshake`, `/v1/command`).
