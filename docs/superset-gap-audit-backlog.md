# Looksy Superset Gap Audit and Prioritized Backlog

Last updated: March 4, 2026

## Scope

This audit tracks practical parity across:

- Looksy protocol + host runtime
- OpenClaw browser/computer Looksy routing
- Trope browser/computer Looksy routing

## Implemented State Snapshot (March 4, 2026)

### Directional scope gate

- Active rollout direction is **OS-input-first**.
- Browser-driver/state-heavy families remain deferred from default-on until parity is proven.
- Scope source: `docs/os-input-surface.md`.
- Capability matrix source: `docs/peekaboo-parity-matrix-mar-2026.md`.

### Closed/expanded in current code state

- [x] Protocol now includes drag/swipe, clipboard read/write, and window lifecycle command families.
  - Evidence: `protocol/schema.ts`, `protocol/generated/v1/identifiers.json`
- [x] Windows adapter executes real OS-backed paths for drag/swipe, clipboard, and `app.window*` commands.
  - Evidence: `host/adapters/windows.ts`, `host/__tests__/windows.automation.test.ts`
- [x] OpenClaw Looksy routing now includes `/tabs/open` and `/tabs/action` list/select in addition to existing routes.
  - Evidence: `../openclaw/src/gateway/server-methods/browser.ts`, `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- [x] Trope Looksy mapper now includes `list_windows`, `focus_window`, and `activate_tab`.
  - Evidence: `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

## Remaining Gaps

## Critical

### 1. OpenClaw clipped screenshot command mismatch

Impact:

- OpenClaw region/clip translation emits `screen.capture.region`.
- Looksy protocol command IDs include `screen.capture` only.

Evidence:

- `../openclaw/src/gateway/server-methods/browser.ts`
- `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- `protocol/generated/v1/identifiers.json`

### 2. OpenClaw parity-gap guards still block newly-added command families

Impact:

- `act:drag`, `act:swipe`, and clipboard kinds are rejected with parity-gap errors even though Looksy protocol + Windows backend support these commands.

Evidence:

- `../openclaw/src/gateway/server-methods/browser.ts`
- `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- `protocol/schema.ts`
- `host/adapters/windows.ts`

### 3. Trope Looksy mapper remains partial for newly-added and browser-state families

Impact:

- Trope still rejects drag/swipe/clipboard looksy mappings.
- Trope still has no `browser.pdf` / `browser.console` Looksy mapper paths.

Evidence:

- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

### 4. Browser-state runtime/backend parity remains partial

Impact:

- Looksy Windows adapter browser-state family is still simulated.
- Trope Windows runtime `automation.browser` still executes OS-input/screenshot subset and rejects non-covered browser actions.

Evidence:

- `host/adapters/windows.ts`
- `../trope/apps/windows/WindowsAgent/Program.cs`

### 5. Element family parity is still incomplete

Impact:

- Looksy Windows adapter has UIA-backed element paths with fallback simulation.
- OpenClaw and Trope Looksy browser mappings do not expose Looksy element command family.

Evidence:

- `host/adapters/windows.ts`
- `../openclaw/src/gateway/server-methods/browser.ts`
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

## High

### 6. Window lifecycle commands are not yet routed through OpenClaw/Trope

Impact:

- `app.windowMove`/`Resize`/`Minimize`/`Maximize`/`Close` exist in protocol + Windows backend, but integrations do not map them.

Evidence:

- `protocol/schema.ts`
- `host/adapters/windows.ts`
- `../openclaw/src/gateway/server-methods/browser.ts`
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

### 7. App launch/quit command family is still undefined

Impact:

- `app.launch` / `app.quit` remain absent from Looksy identifiers.

Evidence:

- `protocol/generated/v1/identifiers.json`

### 8. Target-scoped browser semantics remain constrained

Impact:

- Mapped routes/actions still reject many `targetId`/selector/ref/frame/depth/labels variants.

Evidence:

- `../openclaw/src/gateway/server-methods/browser.ts`
- `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

### 9. SDK wrapper surface still lags protocol primitive surface

Evidence:

- `client/csharp/Looksy.Client/LooksyClient.cs`
- `client/rust/src/client.rs`

### 10. Cross-consumer parity assertions remain narrow on long-tail permutations

## Prioritized Backlog

## P0 (practical superset blockers)

- [ ] Align OpenClaw clipped screenshot translation with Looksy `screen.capture` contract.
- [ ] Replace OpenClaw `act:drag`/`act:swipe`/clipboard parity-gap guards with actual Looksy command routing.
- [ ] Add Trope Looksy mappings for drag/swipe/clipboard and browser pdf/console.
- [ ] Replace simulated Looksy Windows browser-state backend behavior with real backend execution.
- [ ] Route element command family through OpenClaw/Trope Looksy paths and harden UIA-first execution.

## P1 (integration quality + ergonomics)

- [ ] Add OpenClaw/Trope mappings for `app.window*` command family.
- [ ] Define and implement `app.launch` / `app.quit` protocol family.
- [ ] Expand target-scoped browser semantics in mapped routes/actions.
- [ ] Add C#/Rust wrapper methods for expanded protocol primitives.
- [ ] Expand cross-consumer regression matrix coverage and route-specific telemetry dimensions (`looksy`, `legacy`, `legacy-fallback`).

## P2 (rollout completion)

- [ ] Execute phases 9-14 readiness gates for both consumer integrations (dogfood, staged rollout, rollback drill, default-on, legacy retirement).

## Exit Criteria

Looksy should be considered a practical superset replacement only when:

1. P0 items are complete and validated in staging with real backends and aligned command contracts.
2. Consumer integrations can run parity-critical browser/computer actions default-on without forced legacy fallback for core workflows.
3. Regression + conformance suites cover success and typed denial/error paths across Looksy, OpenClaw, and Trope surfaces.
