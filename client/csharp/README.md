# Looksy C# Client

C# SDK for the local Looksy host API.

## API surface

- `LooksyClient.HandshakeAsync()` -> `POST /v1/handshake`
- `LooksyClient.CommandAsync<T>()` -> `POST /v1/command`
- Convenience wrappers:
  - `HealthAsync()` -> `health.ping`
  - `CapabilitiesAsync()` -> `health.getCapabilities`
  - `ScreenshotAsync()` -> `screen.capture`
  - `ListWindowsAsync()` -> `app.listWindows`

Protocol v1 envelope fields are used directly:
- Handshake: `protocolVersion`, `requestId`, `authToken`, `client`, `requestedCapabilities`
- Command: `protocolVersion`, `requestId`, `sessionId`, `timeoutMs`, `command`

The SDK auto-fills `protocolVersion` and `requestId`. After a successful handshake, it stores `sessionId` and uses it for subsequent commands.

## Usage

```csharp
using Looksy.Client;

var client = new LooksyClient(
  baseUrl: "http://127.0.0.1:4064",
  authToken: Environment.GetEnvironmentVariable("LOOKSY_AUTH_TOKEN")
);

var handshake = await client.HandshakeAsync(new HandshakeRequest(
  Client: new HandshakeClientInfo("example-app", "0.1.0"),
  RequestedCapabilities: new[] { "screen.capture", "health.getCapabilities" }
));

if (!handshake.Ok)
{
  Console.WriteLine($"Handshake failed: {handshake.Error?.Code} {handshake.Error?.Message}");
  return;
}

var capabilities = await client.CapabilitiesAsync();
var screenshot = await client.ScreenshotAsync(new ScreenshotRequest(Format: "png"));
var windows = await client.ListWindowsAsync(new WindowsListRequest(IncludeMinimized: true));
```

## Notes

- Models are aligned to the current protocol v1 envelope shape in `protocol/schema.ts`.
- Keep generated protocol constants in `Looksy.Client/Generated/ProtocolConstants.g.cs` in sync with `protocol/generated/v1/identifiers.json`.
