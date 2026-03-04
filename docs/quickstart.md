# Looksy Quickstart

## 1. Prerequisites

- Node.js 22+
- Repository checkout

## 2. Install

```bash
npm install
```

## 3. Run Tests

```bash
npm test
```

This runs:
- protocol schema validation tests
- host core + HTTP server tests
- fixture-driven conformance tests across both built-in adapters
- regression coverage checks for auth, policy, timeout, and cancel paths

### Windows real screenshot smoke check (local)

```bash
npm run smoke:windows-screenshot
```

Behavior:
- On Windows: captures a real desktop PNG via OS APIs and fails if output looks synthetic.
- On non-Windows: exits successfully without attempting capture.

### Windows real OS-input/window smoke check (local)

```bash
npm run smoke:windows-os-input
```

Behavior:
- On Windows: validates protocol success envelopes for handshake, `app.listWindows`, optional `app.focusWindow` of the first enumerated window, and `input.moveMouse`.
- Safety: no click, no keypress, no text input. This smoke only lists windows, optionally focuses one, and moves the pointer.
- On non-Windows: exits successfully without attempting OS input/window automation.

## 4. Start Local Host Runtime

Default runtime starts with the macOS adapter on loopback:

```bash
LOOKSY_AUTH_TOKEN=token-fixture-valid npm run host:start
```

Switch to the Windows adapter mock:

```bash
LOOKSY_PLATFORM=windows LOOKSY_AUTH_TOKEN=token-fixture-valid npm run host:start
```

Optional overrides:
- `LOOKSY_HOST` (default `127.0.0.1`)
- `LOOKSY_PORT` (default `4064`)

## 5. Use CLI

```bash
# handshake returns a session id
node cli/looksy.js --host http://127.0.0.1:4064 --token token-fixture-valid handshake --client-name dev --client-version 0.1.0 --json

# run a command with the session id from handshake
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> health --json
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> metrics --json
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> windows list --json
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> focus-window mac-main --json
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> find-element "button.save" --window-id mac-main --json
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> invoke-element mac-btn-save press --json
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> set-element-value mac-input-search "hello world" --json

# generic command mode (protocol v1 command names)
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> command health.getCapabilities --json
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> command app.listWindows --json
```
