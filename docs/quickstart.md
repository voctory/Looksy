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
node cli/looksy.js --host http://127.0.0.1:4064 --session-id <SESSION_ID> windows list --json
```
