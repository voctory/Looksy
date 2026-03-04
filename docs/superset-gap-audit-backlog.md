# Looksy Superset Gap Audit and Prioritized Backlog

Last updated: March 4, 2026

## Scope

This audit tracks practical parity across:

- Looksy protocol + host runtime
- OpenClaw browser/computer Looksy routing
- Trope browser/computer Looksy routing
- Integration baselines checked for this refresh: OpenClaw `ca40d4663`, Trope `5cb3808`

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
- [x] OpenClaw now routes screenshot clipping via `screen.capture` + `region`, and maps `act:scroll` -> `input.scroll`.
  - Evidence: `../openclaw/src/gateway/server-methods/browser.ts`, `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- [x] OpenClaw now maps coordinate-based `act:drag`/`act:swipe`, clipboard/copy/paste flows, and `/tabs/action` close -> `app.windowClose`.
  - Evidence: `../openclaw/src/gateway/server-methods/browser.ts`, `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- [x] Trope Looksy mapper now includes `list_windows`, `focus_window`, `activate_tab`, drag/swipe/clipboard mappings, and `window_close` alias routing to `app.windowClose`.
  - Evidence: `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

## Remaining Gaps

## Critical

### 1. Trope Looksy mapper remains partial for browser-state families

Impact:

- Trope still has no `browser.pdf` / `browser.console` Looksy mapper paths.

Evidence:

- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

### 2. Browser-state runtime/backend parity remains partial

Impact:

- Looksy Windows adapter browser-state family is still simulated.
- Trope Windows runtime `automation.browser` still executes OS-input/screenshot subset and rejects non-covered browser actions.

Evidence:

- `host/adapters/windows.ts`
- `../trope/apps/windows/WindowsAgent/Program.cs`

### 3. Element family parity is still incomplete

Impact:

- Looksy Windows adapter has UIA-backed element paths with fallback simulation.
- OpenClaw and Trope Looksy browser mappings do not expose Looksy element command family.

Evidence:

- `host/adapters/windows.ts`
- `../openclaw/src/gateway/server-methods/browser.ts`
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

## High

### 4. Window lifecycle commands are only partially routed through OpenClaw/Trope

Impact:

- OpenClaw and Trope map close (`app.windowClose`) only.
- `app.windowMove`/`Resize`/`Minimize`/`Maximize` remain unmapped in consumer routes.

Evidence:

- `protocol/schema.ts`
- `host/adapters/windows.ts`
- `../openclaw/src/gateway/server-methods/browser.ts`
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

### 5. App launch/quit command family is still undefined

Impact:

- `app.launch` / `app.quit` remain absent from Looksy identifiers.

Evidence:

- `protocol/generated/v1/identifiers.json`

### 6. Target-scoped browser semantics remain constrained

Impact:

- Mapped routes/actions still reject many `targetId`/selector/ref/frame/depth/labels variants.

Evidence:

- `../openclaw/src/gateway/server-methods/browser.ts`
- `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

### 7. SDK wrapper surface still lags protocol primitive surface

Evidence:

- `client/csharp/Looksy.Client/LooksyClient.cs`
- `client/rust/src/client.rs`

### 8. Cross-consumer parity assertions remain narrow on long-tail permutations

## Prioritized Backlog

## P0 (practical superset blockers)

- [ ] Add Trope Looksy mappings for browser pdf/console.
- [ ] Replace simulated Looksy Windows browser-state backend behavior with real backend execution.
- [ ] Route element command family through OpenClaw/Trope Looksy paths and harden UIA-first execution.

## P1 (integration quality + ergonomics)

- [ ] Add remaining OpenClaw/Trope mappings for `app.window*` beyond close.
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
