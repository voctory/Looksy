# @looksy/client-ts

TypeScript SDK for the local Looksy host API.

## API surface

- `LooksyClient.handshake()` -> `POST /v1/handshake`
- `LooksyClient.command()` -> `POST /v1/command`
- Convenience wrappers: `health()`, `capabilities()`, `screenshot()`, `windowsList()`

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

The SDK keeps protocol envelope types aligned with the shared protocol v1 contract (`/v1/handshake`, `/v1/command`).
