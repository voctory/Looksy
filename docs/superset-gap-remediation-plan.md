# Superset Gap Remediation Plan (Updated March 4, 2026)

This plan tracks what remains before Looksy can be treated as a practical superset for consumer browser/computer automation paths.

## Current Assessment (March 4, 2026)

Status: **not yet a superset**, but this wave moved key integration paths from design-only to partially routed production code.

## Directional Decision (March 2026)

- Phase 9-14 rollout work is now **OS-input-first**.
- Browser-driver/state-heavy actions remain intentionally deferred to legacy execution paths until backend/runtime parity is proven.
- Source-of-truth rollout scope: `docs/os-input-surface.md`.
- Source-of-truth capability parity matrix: `docs/peekaboo-parity-matrix-mar-2026.md`.

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

1. OpenClaw clipped screenshot command-type divergence.
- OpenClaw region/clip path emits `screen.capture.region`.
- Looksy protocol command list includes `screen.capture` (with optional `region`) and does not include `screen.capture.region`.
- Evidence: `../openclaw/src/gateway/server-methods/browser.ts`, `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`, `protocol/schema.ts`, `protocol/generated/v1/identifiers.json`.

2. Browser-state backend parity remains incomplete.
- Looksy protocol defines `browser.navigate`, `browser.snapshot`, `browser.pdf`, `browser.console`, `browser.trace.start`, `browser.trace.stop`.
- Windows adapter currently serves these from simulated in-memory state instead of real browser backend execution.
- Evidence: `protocol/schema.ts`, `host/adapters/windows.ts`.

3. Trope Windows runtime browser support remains partial for non-OS-input actions.
- Trope mapper includes `navigate`, `snapshot` family, and trace start/stop mappings.
- Windows agent `automation.browser` handler covers OS-input/screenshot subset and defaults unsupported actions to `unsupported_method`.
- Evidence: `../trope/packages/rust/trope-daemon/src/tools/mod.rs`, `../trope/apps/windows/WindowsAgent/Program.cs`.

4. Element family is defined but not practical parity.
- Looksy protocol includes `element.find`, `element.invoke`, `element.setValue`.
- Windows adapter element handling is currently simulated (static element list + in-memory state).
- OpenClaw/Trope Looksy browser mapping paths do not map these element commands.
- Evidence: `protocol/schema.ts`, `host/adapters/windows.ts`, `../openclaw/src/gateway/server-methods/browser.ts`, `../trope/packages/rust/trope-daemon/src/tools/mod.rs`.

5. Gesture primitives are absent from protocol and mappings.
- No `input.drag`/`input.swipe` command IDs in Looksy protocol.
- No drag/swipe Looksy mapping in OpenClaw `/act` translation or Trope Looksy mapper.
- Evidence: `protocol/generated/v1/identifiers.json`, `../openclaw/src/gateway/server-methods/browser.ts`, `../trope/packages/rust/trope-daemon/src/tools/mod.rs`.

### P1 blockers (needed to reduce integration friction)

6. Target-scoped browser semantics remain constrained.
- OpenClaw explicitly rejects `targetId` and ref/selector/frame/depth/labels modes on translated routes.
- Trope mapper returns `None` for target/ref/selector-heavy variants.
- Evidence: `../openclaw/src/gateway/server-methods/browser.ts`, `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`, `../trope/packages/rust/trope-daemon/src/tools/mod.rs`.

7. Missing command families: clipboard and broader window lifecycle/app controls.
- Clipboard copy/paste and lifecycle controls (move/resize/min/max/close/launch/quit) are not represented in current Looksy command identifiers.
- Evidence: `protocol/generated/v1/identifiers.json`.

8. SDK convenience wrappers lag protocol breadth.
- C# and Rust wrappers currently expose only a subset (health/capabilities/screenshot/windows list) despite generated constants carrying broader command IDs.
- Evidence:
  - `client/csharp/Looksy.Client/LooksyClient.cs`
  - `client/rust/src/client.rs`

9. Parity tests are still concentrated on limited routed paths; broader cross-consumer contract tests are pending.

## Validation + Rollout Toggle Reference

- Validation commands and rollout flag matrix are maintained in `docs/os-input-surface.md`.
- Consumer routing flag evidence:
  - OpenClaw: `../openclaw/src/gateway/server-methods/browser.ts`
  - Trope: `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

## Updated Execution Order

1. **P0**: align OpenClaw clipped screenshot command type with Looksy `screen.capture` protocol contract.
2. **P0**: replace simulated Windows browser-state handlers with real backend execution (`navigate`/`snapshot`/`pdf`/`console`/`trace`).
3. **P0**: deliver real Looksy element backend and wire OpenClaw/Trope mappings.
4. **P0**: add `input.drag` and `input.swipe` end-to-end (protocol + Windows backend + consumer mappings).
5. **P1**: close target-scoped browser semantic gaps and add missing clipboard/window lifecycle command families.
6. **P1**: expand C#/Rust wrappers and broaden cross-consumer parity/regression matrix coverage.
7. **P2**: complete phases 9-14 rollout gates (staging drill, canary, default-on, legacy removal) once P0/P1 are stable.
