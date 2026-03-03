# Looksy CLI

CLI for interacting with a local Looksy host API.

## Commands

- `handshake`
- `health`
- `capabilities`
- `screenshot`
- `windows list`
- `command <type>`

## Global options

- `--host` / `--base-url`
- `--token`
- `--timeout-ms`
- `--json` (compact machine-readable output)

## Examples

```bash
looksy --host http://127.0.0.1:4064 handshake --client-name ci-smoke --client-version 1.0.0
looksy --json health
looksy screenshot --format png --include-cursor
looksy windows list --include-minimized
looksy command app.focusWindow --payload '{"windowId":"mac-main"}'
```
