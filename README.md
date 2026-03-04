# Looksy

Looksy is a protocol-first, local desktop automation core. This repo contains the protocol schema, host runtime, adapters, SDK surfaces, and CLI.

## Overview

- Protocol v1 with typed request/response envelopes and runtime validation (`protocol/`).
- Local HTTP host runtime (`host/`) with:
  - `POST /v1/handshake`
  - `POST /v1/command`
  - `GET /v1/artifacts/:artifactId?sessionId=...` for screenshot artifacts
- Built-in adapters for `macos` and `windows`.
- CLI in `cli/looksy.js` for handshake and command calls.
- Fixture-driven conformance + regression tests in `tests/`.

## Security Model (Current)

- Host bind is loopback-only (`127.0.0.1`, `::1`, `localhost`).
- Session creation requires a valid handshake auth token.
- Command execution requires a valid `sessionId`.
- Policy denials and auth failures return typed protocol errors.

## Current Capabilities

- Health/capability introspection and host metrics.
- Screenshot capture with retrievable artifacts.
- Input commands (move, click, type, key press, scroll, drag, swipe).
- Clipboard read/write.
- Window commands (list, focus, move, resize, minimize, maximize, close).
- Browser command surface (navigate, snapshot, pdf, console, trace start/stop).
- Element commands (find, invoke, set value).
- In-flight command cancellation.

## Quickstart

```bash
npm install
npm run typecheck
npm test
LOOKSY_AUTH_TOKEN=token-fixture-valid npm run host:start
```

Optional runtime settings:

- `LOOKSY_PLATFORM=windows` to run with the Windows adapter (default is `macos`)
- `LOOKSY_HOST` (default `127.0.0.1`)
- `LOOKSY_PORT` (default `4064`)
- `LOOKSY_WINDOWS_BROWSER_BACKEND=cdp` to enable the Windows CDP browser backend

## Windows Smoke Tests

```bash
npm run smoke:windows-screenshot
npm run smoke:windows-os-input
```

These scripts run real Windows smoke checks when executed on Windows. On non-Windows hosts, they no-op and pass.

## Minimal CLI Examples

Use the CLI directly from this repo:

```bash
# 1) Create a session (returns sessionId)
node cli/looksy.js --host http://127.0.0.1:4064 --token token-fixture-valid handshake --client-name dev --client-version 0.1.0 --json

# 2) Run commands with the sessionId
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> health --json
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> screenshot --format png --json
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> windows list --include-minimized --json
```

## Repo Layout

- `protocol/`: versioned protocol schemas, generated identifiers, error types
- `host/`: host core, policy, metrics, local HTTP server, platform adapters
- `cli/`: local CLI for handshake + command wrappers
- `client/`: SDK surfaces (TypeScript, C#, Rust)
- `fixtures/`: protocol fixtures used by conformance/regression tests
- `tests/`: unit, conformance, regression, CLI, and smoke coverage
- `docs/`: architecture, integration, release, and rollout docs

## Docs

- [Quickstart](docs/quickstart.md)
- [Architecture Overview](docs/architecture-overview.md)
- [OS Input Surface](docs/os-input-surface.md)
- [Integration Feature Flags](docs/integration-feature-flag-guide.md)
- [Release/Rollback Runbook](docs/release-rollback-runbook.md)
