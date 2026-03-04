# Looksy Shared Automation

Looksy is a protocol-first desktop automation core intended to be embedded by multiple consumer applications.

## Implemented Baseline

- Protocol v1 schemas with runtime validation (`protocol/`).
- Host core with auth, policy, timeout/cancel, and typed error envelopes (`host/`).
- Loopback-only local HTTP transport (`/v1/handshake`, `/v1/command`).
- macOS and Windows adapter implementations behind one interface.
- TypeScript SDK + CLI, plus C# and Rust SDK skeletons.
- Fixture-driven conformance and regression tests.

## Commands

```bash
npm install
npm run typecheck
npm test
npm run host:start
```

See detailed docs:
- `docs/architecture-overview.md`
- `docs/quickstart.md`
- `docs/release-rollback-runbook.md`
- `docs/shared-automation-plan.md`
- `docs/integration-feature-flag-guide.md`
- `docs/os-input-surface.md`
- `docs/phases-9-14-execution-tracker.md`
