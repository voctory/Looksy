# Looksy Superset Gap Audit and Prioritized Backlog

Last updated: March 4, 2026

## Scope

This audit tracks practical parity for:
- Looksy protocol + host runtime
- OpenClaw browser/computer integration routing
- Trope browser/computer integration routing

## Implemented State Snapshot (March 4, 2026)

### Directional scope gate (March 2026)

- Active rollout direction is **OS-input-first**.
- Browser-driver/state-heavy families are treated as deferred scope for this rollout wave.
- Source-of-truth scope + validation commands: `docs/os-input-surface.md`.
- Source-of-truth capability parity matrix: `docs/peekaboo-parity-matrix-mar-2026.md`.

### Closed in this wave

- [x] OpenClaw browser entrypoint routes to Looksy behind feature flags and emits route metadata.
  - Evidence: `../openclaw/src/gateway/server-methods/browser.ts`, `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- [x] Routing flags now include `LOOKSY_OS_INPUT_ONLY` in OpenClaw and Trope for explicit OS-input-first gating.
  - Evidence: `../openclaw/src/gateway/server-methods/browser.ts`, `../trope/packages/rust/trope-daemon/src/tools/mod.rs`
- [x] Trope browser mapping expanded for Looksy (`screenshot`, `click`, `hover`, `type_text`, `press_key`, `navigate`, `snapshot` family, `scroll`, trace start/stop) with fallback/error matrix coverage.
  - Evidence: `../trope/packages/rust/trope-daemon/src/tools/mod.rs`
- [x] Protocol primitives expanded and validated (`input.pressKey`, `input.scroll`, browser family, element family, metrics, cancel, artifact retrieval metadata).
  - Evidence: `protocol/schema.ts`, `protocol/schema.test.ts`, `host/__tests__/core.test.ts`, `host/httpServer.ts`
- [x] Generated command/error identifiers include new protocol command IDs in C# and Rust generated constants.
  - Evidence: `client/csharp/Looksy.Client/Generated/ProtocolConstants.g.cs`, `client/rust/src/generated.rs`, `protocol/generated/v1/identifiers.json`

## Remaining Gaps (After This Wave)

## Critical

### 1. OpenClaw clipped screenshot command-type divergence

Impact:
- OpenClaw region/clip translation emits `screen.capture.region`.
- Looksy protocol command identifiers include `screen.capture` and do not include `screen.capture.region`.

Evidence:
- `../openclaw/src/gateway/server-methods/browser.ts`
- `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- `protocol/schema.ts`
- `protocol/generated/v1/identifiers.json`

### 2. Browser-state backend parity remains partial

Impact:
- Browser command family is protocol-defined (`navigate`, `snapshot`, `pdf`, `console`, `trace`), but Windows adapter behavior is still simulated/in-memory for these flows.

Evidence:
- `protocol/schema.ts`
- `host/adapters/windows.ts`
- `host/adapters/macos.ts`

### 3. Trope Windows browser runtime remains partial

Impact:
- Windows runtime now exposes `automation.browser`, but only an input/screenshot subset is implemented; browser state/trace/pdf/console flows remain unsupported.

Evidence:
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs` (browser routes use `automation.browser`)
- `../trope/apps/windows/WindowsAgent/Program.cs` (default capabilities and extension handling)
- `../trope/docs/WINDOWS_AUTOMATION_LOOKSY_CAPABILITY_MATRIX_MAR_2026.md`

### 4. Element family parity is not practical yet

Impact:
- Looksy protocol includes `element.find`, `element.invoke`, and `element.setValue`, but Windows adapter uses simulated element state.
- OpenClaw and Trope Looksy browser mapping paths do not map element command families.

Evidence:
- `protocol/schema.ts`
- `host/adapters/windows.ts`
- `../openclaw/src/gateway/server-methods/browser.ts`
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

### 5. Drag/swipe gesture family is absent end-to-end

Impact:
- Looksy has no `input.drag`/`input.swipe` command IDs.
- OpenClaw and Trope do not expose Looksy drag/swipe mapping paths.

Evidence:
- `protocol/generated/v1/identifiers.json`
- `../openclaw/src/gateway/server-methods/browser.ts`
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

## High

### 6. Target-scoped semantics remain constrained in consumer mappings

Impact:
- OpenClaw and Trope both reject target/ref/selector-heavy variants on translated routes/actions, limiting parity for complex browser control.

Evidence:
- `../openclaw/src/gateway/server-methods/browser.ts`
- `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

### 7. Missing command families beyond current OS-input scope

Impact:
- Clipboard and broader window lifecycle/app controls are not represented in current Looksy command identifiers.

Evidence:
- `protocol/generated/v1/identifiers.json`

### 8. SDK wrapper surface lags protocol primitive surface

Impact:
- C#/Rust users can call generic command APIs, but convenience wrappers for expanded primitives are incomplete.

Evidence:
- `client/csharp/Looksy.Client/LooksyClient.cs`
- `client/rust/src/client.rs`

### 9. Cross-consumer parity assertions are still narrow

Impact:
- Route-level compatibility confidence remains strongest for covered paths, weaker for long-tail browser actions.

Evidence:
- OpenClaw routing tests cover translated paths but not all advanced argument permutations.
- Trope mapping tests cover mapper behavior; Windows runtime still has partial `automation.browser` support.

## Prioritized Backlog (Updated)

## P0 (practical superset blockers)

- [ ] Align OpenClaw clipped screenshot translation with Looksy `screen.capture` command contract.
- [ ] Replace simulated browser-state adapter behavior with real backend execution.
- [ ] Expand Trope Windows `automation.browser` support for mapped non-OS-input browser actions.
- [ ] Replace simulated Looksy element backend with real implementation and add consumer mappings.
- [ ] Add `input.drag` and `input.swipe` across protocol, backend, and consumer mappings.

## P1 (integration quality and developer ergonomics)

- [ ] Expand target-scoped semantics (target/ref/selector/frame modes) in mapped consumer routes/actions.
- [ ] Add clipboard and broader window lifecycle/app control command families.
- [ ] Add C#/Rust wrapper methods for newly-added primitives (`input.pressKey`, `input.scroll`, browser and element families, metrics).
- [ ] Add cross-consumer regression matrix for routed behavior and error envelopes.
- [ ] Add explicit telemetry dimensions for routed path (`looksy` vs `legacy` vs `legacy-fallback`) in downstream rollout dashboards.

## P2 (rollout completion)

- [ ] Execute phases 9-14 readiness gates for both consumer integrations (dogfood, staged rollout, rollback drill, default-on, legacy retirement).

## Exit Criteria

Looksy should be considered a practical superset replacement only when:
1. P0 items above are completed and validated in staging with real backends and aligned command contracts.
2. Consumer integrations can run parity-critical browser/computer actions default-on without forced legacy fallback for core workflows.
3. Regression and conformance suites cover both success and denial/error paths across Looksy, OpenClaw, and Trope surfaces.
