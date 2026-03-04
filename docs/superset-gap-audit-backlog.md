# Looksy Superset Gap Audit and Prioritized Backlog

Last updated: March 3, 2026

## Scope

This audit tracks practical parity for:
- Looksy protocol + host runtime
- OpenClaw browser/computer integration routing
- Trope browser/computer integration routing

## Implemented State Snapshot (March 3, 2026)

### Closed in this wave

- [x] OpenClaw browser entrypoint routes to Looksy behind feature flags and emits route metadata.
  - Evidence: `../openclaw/src/gateway/server-methods/browser.ts`, `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- [x] Trope browser mapping expanded for Looksy (`screenshot`, `click`, `hover`, `type_text`, constrained `press_key`) with fallback/error matrix coverage.
  - Evidence: `../trope/packages/rust/trope-daemon/src/tools/mod.rs`
- [x] Protocol primitives expanded and validated (`input.pressKey`, `input.scroll`, browser family, element family, metrics, cancel, artifact retrieval metadata).
  - Evidence: `protocol/schema.ts`, `protocol/schema.test.ts`, `host/__tests__/core.test.ts`, `host/httpServer.ts`
- [x] Generated command/error identifiers include new protocol command IDs in C# and Rust generated constants.
  - Evidence: `client/csharp/Looksy.Client/Generated/ProtocolConstants.g.cs`, `client/rust/src/generated.rs`, `protocol/generated/v1/identifiers.json`

## Remaining Gaps (After This Wave)

## Critical

### 1. Real adapter/backend parity is still missing

Impact:
- Host behavior is still simulated and cannot be treated as production automation parity.

Evidence:
- `host/adapters/macos.ts`
- `host/adapters/windows.ts`

### 2. OpenClaw Looksy translation still covers only a subset of browser routes

Impact:
- Many browser parity operations continue to rely on fallback or return unsupported.

Current unsupported translation paths include:
- `/navigate`, `/snapshot`, `/pdf`, `/console`, `/trace/start`, `/trace/stop`

Evidence:
- `../openclaw/src/gateway/server-methods/browser.ts` (`translateBrowserRequestToLooksy`)
- `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`

### 3. Trope Windows execution path still blocks browser capability end-to-end

Impact:
- Looksy/Trope browser mapping exists in daemon, but Windows runtime capability exposure blocks execution.

Evidence:
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs` (browser routes use `automation.browser`)
- `../trope/apps/windows/WindowsAgent/Program.cs` (default capabilities and extension handling)
- `../trope/docs/WINDOWS_AUTOMATION_LOOKSY_CAPABILITY_MATRIX_MAR_2026.md`

## High

### 4. SDK wrapper surface lags protocol primitive surface

Impact:
- C#/Rust users can call generic command APIs, but convenience wrappers for expanded primitives are incomplete.

Evidence:
- `client/csharp/Looksy.Client/LooksyClient.cs`
- `client/rust/src/client.rs`

### 5. Cross-consumer parity assertions are still narrow

Impact:
- Route-level compatibility confidence remains strongest for covered paths, weaker for long-tail browser actions.

Evidence:
- OpenClaw routing tests cover key matrix paths but not all browser semantics.
- Trope mapping tests cover mapper behavior, while Windows runtime capability still blocks full execution.

## Prioritized Backlog (Updated)

## P0 (practical superset blockers)

- [ ] Replace simulated adapters with real macOS and Windows automation backends.
- [ ] Expand OpenClaw translation coverage for parity-critical browser routes.
- [ ] Unblock Trope Windows browser capability execution path (`automation.browser`).

## P1 (integration quality and developer ergonomics)

- [ ] Add C#/Rust wrapper methods for newly-added primitives (`input.pressKey`, `input.scroll`, browser and element families, metrics).
- [ ] Add cross-consumer regression matrix for routed behavior and error envelopes.
- [ ] Add explicit telemetry dimensions for routed path (`looksy` vs `legacy` vs `legacy-fallback`) in downstream rollout dashboards.

## P2 (rollout completion)

- [ ] Execute phases 9-14 readiness gates for both consumer integrations (dogfood, staged rollout, rollback drill, default-on, legacy retirement).

## Exit Criteria

Looksy should be considered a practical superset replacement only when:
1. P0 items above are completed and validated in staging with real backends.
2. Consumer integrations can run parity-critical browser/computer actions default-on without forced legacy fallback for core workflows.
3. Regression and conformance suites cover both success and denial/error paths across Looksy, OpenClaw, and Trope surfaces.
