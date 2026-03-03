# Looksy CLI

CLI for interacting with a local Looksy host API.

## Commands

- `handshake`
- `health`
- `capabilities`
- `metrics`
- `screenshot`
- `windows list`
- `focus-window <window-id>`
- `find-element <selector>`
- `invoke-element <element-id> <press|focus|expand|collapse>`
- `set-element-value <element-id> <value>`
- `command <type>`

## Global options

- `--host` / `--base-url`
- `--token`
- `--timeout-ms`
- `--json` (compact machine-readable output)

## Examples

```bash
looksy --host http://127.0.0.1:4064 handshake --client-name ci-smoke --client-version 1.0.0
looksy --session-id <SESSION_ID> --json health
looksy --session-id <SESSION_ID> --json metrics
looksy --session-id <SESSION_ID> screenshot --format png
looksy --session-id <SESSION_ID> windows list --include-minimized
looksy --session-id <SESSION_ID> focus-window mac-main --json
looksy --session-id <SESSION_ID> find-element "button.save" --window-id mac-main --json
looksy --session-id <SESSION_ID> invoke-element mac-btn-save press --json
looksy --session-id <SESSION_ID> set-element-value mac-input-search "hello world" --json
looksy --session-id <SESSION_ID> command app.focusWindow --payload '{"windowId":"mac-main"}'
```
