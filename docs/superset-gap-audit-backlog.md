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
- [x] Trope browser mapping expanded for Looksy (`screenshot`, `click`, `hover`, `type_text`, `press_key`, `navigate`, `snapshot` family, `scroll`, trace start/stop) with fallback/error matrix coverage.
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

### 2. OpenClaw Looksy translation still has argument-surface gaps

Impact:
- Core parity routes are now translated, but advanced/target-scoped semantics still rely on fallback or return unsupported.

Current constrained translation paths include:
- `/navigate` (no `targetId`)
- `/snapshot` (no aria/labels/depth/selector/frame modes)
- `/pdf` (no `targetId`/custom output path)
- `/console` (no `targetId`)
- `/trace/start` and `/trace/stop` (no advanced target/path controls)

Evidence:
- `../openclaw/src/gateway/server-methods/browser.ts` (`translateBrowserRequestToLooksy`)
- `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`

### 3. Trope Windows browser runtime remains partial

Impact:
- Windows runtime now exposes `automation.browser`, but only an input/screenshot subset is implemented; browser state/trace/pdf/console flows remain unsupported.

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
- OpenClaw routing tests cover translated paths but not all advanced argument permutations.
- Trope mapping tests cover mapper behavior; Windows runtime still has partial `automation.browser` support.

## Prioritized Backlog (Updated)

## P0 (practical superset blockers)

- [ ] Replace simulated adapters with real macOS and Windows automation backends.
- [ ] Expand OpenClaw argument-surface compatibility for translated browser routes.
- [ ] Expand Trope Windows `automation.browser` implementation beyond input/screenshot subset.

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
