# looksy-client (Rust)

Minimal Rust SDK surface for the local Looksy host API.

## Included

- Typed handshake and command models (`models.rs`).
- `LooksyClient` with:
  - `handshake()` -> `POST /v1/handshake`
  - `command()` -> `POST /v1/command`
  - Convenience methods: `health`, `capabilities`, `screenshot`, `windows_list`
- Envelope-aligned request/response shapes:
  - Handshake includes `protocolVersion`, `requestId`, `authToken`, and `client`.
  - Command includes `protocolVersion`, `requestId`, `sessionId`, and `command` payload.

## Command Names Used by Wrappers

- `health()` -> `health.ping`
- `capabilities()` -> `health.getCapabilities`
- `screenshot()` -> `screen.capture`
- `windows_list()` -> `app.listWindows`

## Example

```rust
use looksy_client::{
    HandshakeClientInfo, HandshakeRequest, LooksyClient, ScreenshotRequest,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut client = LooksyClient::new("http://127.0.0.1:4064")
        .with_auth_token("token-fixture-valid");

    let _handshake = client
        .handshake(&HandshakeRequest {
            protocol_version: None,
            request_id: None,
            auth_token: None,
            client: HandshakeClientInfo {
                name: "rust-example".to_string(),
                version: "0.1.0".to_string(),
            },
            requested_capabilities: None,
        })
        .await?;

    let _capabilities = client.capabilities::<serde_json::Value>().await?;
    let _screenshot = client
        .screenshot::<serde_json::Value>(ScreenshotRequest {
            format: Some("png".to_string()),
            region: None,
        })
        .await?;

    Ok(())
}
```
