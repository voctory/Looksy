# Looksy C# Client (Skeleton)

This folder contains a minimal but credible C# SDK surface for the local Looksy host API.

## Included

- Typed models for handshake and command envelopes.
- `LooksyClient` with:
  - `HandshakeAsync` (`POST /v1/handshake`)
  - `CommandAsync` (`POST /v1/command`)
  - Convenience methods for `health`, `capabilities`, `screenshot`, and `windows.list`.

## Notes

- Models are shaped for protocol v1 and should be kept in sync with canonical types generated from `protocol/`.
