# looksy-client (Rust skeleton)

Minimal Rust SDK surface for the local Looksy host API.

## Included

- Typed handshake and command models (`models.rs`).
- `LooksyClient` with:
  - `handshake()` -> `POST /v1/handshake`
  - `command()` -> `POST /v1/command`
  - Convenience methods: `health`, `capabilities`, `screenshot`, `windows_list`

## Notes

- Shapes are aligned to expected protocol v1 envelope fields and should be replaced/validated against generated protocol bindings when `protocol/` is available in the workspace.
