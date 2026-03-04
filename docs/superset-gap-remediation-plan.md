# Superset Gap Remediation Plan (Updated March 4, 2026)

This plan tracks what remains before Looksy can be treated as a practical superset for consumer browser/computer automation paths.

## Current Assessment (March 4, 2026)

Status: **not yet a superset**.

Recent protocol and Windows backend expansion closed several previously-missing command families (`input.drag`, `input.swipe`, clipboard read/write, `app.window*`), but consumer routing parity and real browser backend parity are still incomplete.

Integration baselines checked for this refresh: OpenClaw `3c9067257`, Trope `5cb3808`.

## Directional Decision (March 2026)

- Phase 9-14 rollout work remains **OS-input-first**.
- Browser-driver/state-heavy actions remain deferred from default-on until backend/runtime parity is proven.
- Source-of-truth rollout scope: `docs/os-input-surface.md`.
- Source-of-truth capability matrix: `docs/peekaboo-parity-matrix-mar-2026.md`.

## Implemented State (Evidence-Based)

### 1. Protocol command surface expanded

Delivered command families now include:

- Input: `input.drag`, `input.swipe` (plus existing move/click/type/press/scroll)
- Clipboard: `clipboard.read`, `clipboard.write`
- Window lifecycle: `app.windowMove`, `app.windowResize`, `app.windowMinimize`, `app.windowMaximize`, `app.windowClose`

Evidence:

- `protocol/schema.ts`
- `protocol/generated/v1/identifiers.json`
- `protocol/schema.test.ts`

### 2. Windows backend expanded with real OS execution for new families

Delivered Windows adapter execution now includes:

- Real `input.drag` / `input.swipe`
- Real `clipboard.read` / `clipboard.write`
- Real `app.window*` lifecycle commands

Evidence:

- `host/adapters/windows.ts`
  - `dragViaPowerShell`, `swipeViaPowerShell`
  - `clipboardReadViaPowerShell`, `clipboardWriteViaPowerShell`
  - `windowMoveViaPowerShell`, `windowResizeViaPowerShell`, `windowMinimizeViaPowerShell`, `windowMaximizeViaPowerShell`, `windowCloseViaPowerShell`
- `host/__tests__/windows.automation.test.ts`

### 3. OpenClaw Looksy routing expanded, but still has parity gaps

Delivered/expanded routes include:

- `GET /tabs` -> `app.listWindows`
- `POST /tabs/focus` -> `app.focusWindow`
- `POST /tabs/open` -> `browser.navigate`
- `POST /tabs/action` with `action=list|select`
- `/screenshot` -> `screen.capture` (including clip/region path via `readLooksyCaptureRegion` with default `region.space`)
- `/act` now maps `act:scroll` -> `input.scroll`

Current OpenClaw gaps:

- `act:drag`, `act:swipe`, and clipboard kinds still return parity-gap unsupported errors.
- `/tabs/action` with `action=new|close` remains unsupported.

Evidence:

- `../openclaw/src/gateway/server-methods/browser.ts`
- `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`

### 4. Trope Looksy mapper expanded, but still partial

Delivered/expanded mappings include:

- `list_windows` -> `app.listWindows`
- `focus_window` / `activate_tab` -> `app.focusWindow`
- `drag` / `drag_and_drop` / `left_click_drag` -> `input.drag`
- `swipe` -> `input.swipe`
- `clipboard_read` / `clipboard_write` -> `clipboard.read` / `clipboard.write`
- `close_window` / `close_tab` and alias `window_close` -> `app.windowClose`
- existing mappings for screenshot/click/hover/type/press/scroll/navigate/snapshot/trace

Current Trope gaps:

- No Looksy mapper branch for `browser.pdf` / `browser.console`.
- Window lifecycle beyond close remains unmapped (`app.windowMove`/`Resize`/`Minimize`/`Maximize`).

Evidence:

- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`
  - `map_browser_action_to_looksy_v1_command`
  - routing tests (`map_browser_action_to_looksy_maps_supported_actions`, `map_browser_action_to_looksy_rejects_unsupported_actions`)

## Remaining Blockers

### P0 blockers (must close for practical superset claim)

1. OpenClaw parity-gap guards still block new command families.
- `act:drag`, `act:swipe`, and clipboard kinds are rejected even though Looksy protocol + Windows backend now support drag/swipe/clipboard commands.
- Evidence: `../openclaw/src/gateway/server-methods/browser.ts`, `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`, `protocol/schema.ts`, `host/adapters/windows.ts`.

2. Trope Looksy mapper still lacks browser pdf/console mappings.
- Evidence: `../trope/packages/rust/trope-daemon/src/tools/mod.rs`.

3. Browser-state backend parity remains incomplete.
- Looksy Windows adapter still serves `browser.navigate`/`snapshot`/`pdf`/`console`/`trace` from simulated in-memory state.
- Trope Windows runtime `automation.browser` still supports only an OS-input/screenshot subset.
- Evidence: `host/adapters/windows.ts`, `../trope/apps/windows/WindowsAgent/Program.cs`.

4. Element family parity is still incomplete.
- Windows adapter now has UIA-backed paths with fallback simulation, but OpenClaw/Trope Looksy routes do not map element commands.
- Evidence: `host/adapters/windows.ts`, `../openclaw/src/gateway/server-methods/browser.ts`, `../trope/packages/rust/trope-daemon/src/tools/mod.rs`.

### P1 blockers (needed to reduce integration friction)

5. Window lifecycle mappings are only partially exposed in OpenClaw/Trope Looksy integrations.
- OpenClaw does not route `app.window*`; Trope currently maps close only via `app.windowClose`.
- Evidence: `protocol/schema.ts`, `host/adapters/windows.ts`, `../openclaw/src/gateway/server-methods/browser.ts`, `../trope/packages/rust/trope-daemon/src/tools/mod.rs`.

6. App launch/quit command family is still missing.
- `app.launch`/`app.quit` are absent from Looksy command identifiers.
- Evidence: `protocol/generated/v1/identifiers.json`.

7. Target-scoped browser semantics remain constrained.
- `targetId`/selector/ref/frame/depth/labels variants are still explicitly rejected in mapped paths.
- Evidence: `../openclaw/src/gateway/server-methods/browser.ts`, `../trope/packages/rust/trope-daemon/src/tools/mod.rs`.

8. SDK convenience wrappers lag protocol breadth.
- Evidence: `client/csharp/Looksy.Client/LooksyClient.cs`, `client/rust/src/client.rs`.

9. Cross-consumer parity tests are still narrow for long-tail argument combinations.

## Validation + Rollout Toggle Reference

- Validation commands and rollout flag matrix: `docs/os-input-surface.md`.
- Routing flag evidence:
  - OpenClaw: `../openclaw/src/gateway/server-methods/browser.ts`
  - Trope: `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

## Updated Execution Order

1. **P0**: Wire OpenClaw `act:drag`/`act:swipe`/clipboard paths to new Looksy commands.
2. **P0**: Add Trope Looksy mappings for browser pdf/console.
3. **P0**: Replace simulated Windows browser-state handlers with real backend execution.
4. **P0**: Expose element commands in OpenClaw/Trope Looksy integration paths and harden UIA-first behavior.
5. **P1**: Add remaining consumer mappings for `app.window*` beyond Trope close and define `app.launch`/`app.quit` protocol strategy.
6. **P1**: Expand target-scoped semantics + regression matrix + SDK wrappers.
7. **P2**: Complete phases 9-14 rollout gates (staging drill, canary, default-on, legacy removal) once P0/P1 are stable.
