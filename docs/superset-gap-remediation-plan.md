# Superset Gap Remediation Plan (Updated March 4, 2026)

This plan tracks what remains before Looksy can be treated as a practical superset for consumer browser/computer automation paths.

## Current Assessment (March 4, 2026)

Status: **not yet a superset**, but this wave moved key integration paths from design-only to partially routed production code.

## Directional Decision (March 2026)

- Phase 9-14 rollout work is now **OS-input-first**.
- Browser-driver/state-heavy actions remain intentionally deferred to legacy execution paths until backend/runtime parity is proven.
- Source-of-truth rollout scope: `docs/os-input-surface.md`.

## Implemented in This Wave (Evidence-Based)

### 1. OpenClaw browser entrypoint now supports feature-flagged Looksy routing

Delivered behavior:
- `LOOKSY_INTEGRATION_ENABLED`, `LOOKSY_FORCE_LEGACY_EXECUTION`, `LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR`, `LOOKSY_OS_INPUT_ONLY` govern routing.
- Successful responses include route metadata: `looksy`, `legacy`, `legacy-fallback`.
- Unsupported/translation-limited operations are surfaced as typed errors or fallback to legacy (based on flag).

Evidence:
- `../openclaw/src/gateway/server-methods/browser.ts`
  - `resolveLooksyRoutingFlags`
  - `translateBrowserRequestToLooksy`
  - `invokeLooksyCommand`
  - `browserHandlers["browser.request"]`
- `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
  - integration-disabled -> legacy
  - force-legacy -> legacy
  - looksy failure + fallback enabled -> legacy-fallback
  - looksy failure + fallback disabled -> surfaced error

### 2. Trope Looksy browser mapping expanded across core browser actions

Delivered behavior:
- Looksy mapping now includes:
  - screenshot -> `screen.capture`
  - click -> `input.click`
  - hover -> `input.moveMouse`
  - navigate -> `browser.navigate`
  - snapshot/extract_visible_text/extract_interactables -> `browser.snapshot`
  - scroll -> `input.scroll`
  - start_recording/stop_recording -> `browser.trace.start`/`browser.trace.stop`
  - type_text -> `input.typeText`
  - press_key -> `input.pressKey`
- Unsupported or lossy actions still return `None` mapping and depend on fallback policy.

Evidence:
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`
  - `map_browser_action_to_looksy_v1_command`
  - `parse_press_key_repeat`
  - `execute_browser_command_with_routing`
- tests in same file (`map_browser_action_to_looksy_maps_supported_actions`, `map_browser_action_to_looksy_rejects_unsupported_actions`)

### 3. Protocol/runtime primitives were expanded and validated

Delivered primitives now present in protocol + host simulation:
- Input: `input.pressKey`, `input.scroll`
- Browser: `browser.navigate`, `browser.snapshot`, `browser.pdf`, `browser.console`, `browser.trace.start`, `browser.trace.stop`
- Element: `element.find`, `element.invoke`, `element.setValue`
- Host-managed: `control.cancel`, `observability.getMetrics`
- Screenshot retrieval metadata + artifact endpoint (`artifactUrl`, `/v1/artifacts/{id}?sessionId=...`)

Evidence:
- `protocol/schema.ts`
- `protocol/schema.test.ts`
- `host/__tests__/core.test.ts`
- `host/httpServer.ts`
- `protocol/generated/v1/identifiers.json`
- generated constants:
  - `client/csharp/Looksy.Client/Generated/ProtocolConstants.g.cs`
  - `client/rust/src/generated.rs`

## Remaining Blockers After This Wave

### P0 blockers (must close for practical superset claim)

1. Real backend gap remains partial (not closed end-to-end).
- Windows host now executes real OS-backed `screen.capture`, `input.*`, and `app.listWindows` / `app.focusWindow`.
- macOS adapter and browser/element families are still simulated and block practical superset parity.
- Evidence: `host/adapters/windows.ts`, `host/adapters/macos.ts`.

2. Browser-driver/state parity remains deferred by design for OS-input-first rollout.
- OpenClaw has translation branches for `/navigate`, `/snapshot`, `/pdf`, `/console`, `/trace/start`, `/trace/stop`, but these remain outside OS-input-first rollout scope and should stay on legacy execution where parity is not yet proven.
- Evidence: `../openclaw/src/gateway/server-methods/browser.ts` translation branches + routing tests.

3. Trope Windows runtime browser support remains partial.
- Windows agent now exposes `automation.browser` and executes a truthful subset (`screen.capture`, `input.moveMouse`, `input.click`, `input.typeText`, `input.pressKey`, `input.scroll`), but browser state/trace/pdf/console command families are still unsupported at runtime.
- Evidence: `../trope/packages/rust/trope-daemon/src/tools/mod.rs`, `../trope/apps/windows/WindowsAgent/Program.cs`, `../trope/docs/WINDOWS_AUTOMATION_LOOKSY_CAPABILITY_MATRIX_MAR_2026.md`.

### P1 blockers (needed to reduce integration friction)

4. SDK convenience wrappers lag protocol breadth.
- C# and Rust wrappers currently expose only a subset (health/capabilities/screenshot/windows list) despite generated constants carrying broader command IDs.
- Evidence:
  - `client/csharp/Looksy.Client/LooksyClient.cs`
  - `client/rust/src/client.rs`

5. Parity tests are still concentrated on limited routed paths; broader cross-consumer contract tests are pending.

## Validation + Rollout Toggle Reference

- Validation commands and rollout flag matrix are maintained in `docs/os-input-surface.md`.
- Consumer routing flag evidence:
  - OpenClaw: `../openclaw/src/gateway/server-methods/browser.ts`
  - Trope: `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

## Updated Execution Order

1. **P0**: replace remaining simulated adapter surfaces with real platform/browser backends (macOS + browser/element families).
2. **P0**: close OpenClaw + Trope translation/capability blockers for parity-critical browser routes.
3. **P1**: expand C#/Rust wrapper coverage to new protocol primitives.
4. **P1**: add cross-consumer parity/regression matrix for routed actions and error envelopes.
5. **P2**: complete phases 9-14 rollout gates (staging drill, canary, default-on, legacy removal) once P0/P1 are stable.
