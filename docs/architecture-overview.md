# Looksy Shared Automation Architecture

## Repository Layout

- `protocol/`
  - Versioned runtime-validated protocol envelopes and payload schemas.
- `host/`
  - Adapter-neutral dispatcher, policy, auth, timeout/cancel handling, loopback HTTP server.
- `host/adapters/`
  - Platform adapter implementations (`macos`, `windows`) behind one interface.
- `client/`
  - SDK surfaces for TypeScript, C#, and Rust consumers.
- `cli/`
  - Operator CLI for handshake and command diagnostics.
- `fixtures/`
  - Golden protocol fixtures used by conformance tests.
- `tests/`
  - Fixture-driven conformance and regression checks.

## Runtime Flow

1. Client sends `POST /v1/handshake` with protocol version, client metadata, and auth token.
2. Host validates protocol compatibility + token, then issues a session.
3. Client sends `POST /v1/command` envelopes with `sessionId`.
4. Host applies policy and timeout/cancel orchestration.
5. Host dispatches to a platform adapter and returns typed result or typed error envelopes.

## Security Model Implemented

- Transport is loopback-only (`127.0.0.1`, `::1`, `localhost`) at server bind.
- Handshake token validation gates session creation.
- Policy deny paths produce typed `POLICY_DENIED` errors.
- Timeout and cancellation produce typed `TIMEOUT` and `CANCELLED` errors.

## Command Families in Protocol v1

- Health and capability introspection.
- Screenshot capture.
- Mouse and keyboard input.
- App/window listing and focus.
- Element discovery, invocation, and value setting.
- In-flight cancellation.

## Test Strategy

- Unit tests in `protocol/` and `host/` validate schema and host behavior.
- Fixture-driven conformance tests run the same matrix on macOS and Windows adapters.
- Regression checks enforce coverage for auth, policy, timeout, and cancel paths.
