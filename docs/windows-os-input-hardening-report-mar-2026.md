# Windows OS-Input Hardening Report (March 4, 2026)

Last updated: March 4, 2026

## Scope

This report documents the Windows-priority hardening wave for Looksy host automation, including:

- Real Windows input and window-control backend behavior.
- Coordinate-space normalization and DPI handling.
- Runtime validation across direct host and consumer gateway routing.
- Remaining parity gaps relative to Peekaboo-style automation breadth.

This report is intentionally operational and evidence-based. It is the detailed companion to:

- `docs/os-input-surface.md`
- `docs/superset-gap-remediation-plan.md`
- `docs/superset-gap-audit-backlog.md`

## Delivered Outcomes

## 1) Real Windows host behavior for OS-input/window commands

The Windows adapter now executes real Windows-backed behavior for:

- `input.moveMouse`
- `input.click`
- `input.typeText`
- `input.pressKey`
- `input.scroll`
- `app.listWindows`
- `app.focusWindow`
- `screen.capture` (already real from prior wave; retained)

Primary implementation:

- `host/adapters/windows.ts`

## 2) Input path hardened to `SendInput`

Windows input execution migrated from older helper patterns to `SendInput`-based scripts for click, type, press, and scroll.

Implementation evidence:

- `buildWindowsSendInputHelperLines(...)`
- `buildWindowsClickPowerShellScript(...)`
- `buildWindowsTypeTextPowerShellScript(...)`
- `buildWindowsPressKeySendInputPlan(...)`
- `buildWindowsScrollSendInputPlan(...)`

All in:

- `host/adapters/windows.ts`

## 3) Coordinate-space hardening

Global input commands now normalize point space consistently:

- Accept `screen-physical` directly.
- Accept `screen-dip` and convert to physical.
- Reject `window-client` for global input commands when no window-relative anchor is provided.

Implementation evidence:

- `normalizeGlobalInputPoint(...)`
- `convertScreenDipToPhysicalPoint(...)`

In:

- `host/adapters/windows.ts`

## 4) Monitor-aware DPI conversion

`screen-dip -> screen-physical` conversion was upgraded from a simple passthrough/system-scale approach to monitor-aware resolution with fallback chain:

1. `MonitorFromPoint` + `GetDpiForMonitor`
2. `GetDpiForSystem`
3. `GetDeviceCaps(LOGPIXELSX)`

Implementation evidence:

- `buildWindowsScreenDipScalePowerShellScript(...)`
- `convertScreenDipToPhysicalPoint(...)`

In:

- `host/adapters/windows.ts`

## 5) Focus-window reliability hardening

Focus logic now includes restore/retry behavior and foreground verification steps to reduce flaky focus transitions:

- restore minimized window
- bring window to top
- set foreground
- verify foreground with retry loop

Implementation evidence:

- `buildWindowsFocusWindowPowerShellScript(...)`
- focus payload/status parsing in `windows.ts`

In:

- `host/adapters/windows.ts`

## 6) Smoke and test coverage expansion

Added/expanded validation paths:

- Unit/integration tests:
  - `host/__tests__/windows.automation.test.ts`
  - `host/__tests__/windows.capture.test.ts`
- New real Windows smoke test for OS-input/window surfaces:
  - `tests/smoke/windows-real-os-input-smoke.test.ts`
  - runner: `scripts/runWindowsRealOsInputSmoke.cjs`
  - package script: `smoke:windows-os-input`
- Existing real screenshot smoke retained:
  - `tests/smoke/windows-real-screenshot-smoke.test.ts`
  - package script: `smoke:windows-screenshot`

## Commit Log (This Hardening Wave)

- `be109ff` feat(windows): power real input and window commands via PowerShell
- `f1451e4` fix(windows): stabilize listWindows JSON serialization
- `9a9d94f` test(windows): cover input hardening spaces and denial paths
- `d255b59` hardening: switch Windows input to SendInput and add DIP conversion
- `a83c259` harden Windows input script assertions and DPI fallback constants
- `07e49da` fix(windows): preserve signed wheel delta for SendInput scroll
- `52b2203` add Windows OS-input smoke validation path
- `2196608` harden Windows focus flow and monitor-aware DIP conversion

## Validation Runbook

## Local verification commands

```bash
# Core Windows automation coverage
npm test -- host/__tests__/windows.automation.test.ts host/__tests__/windows.capture.test.ts
npm run typecheck

# Real Windows smokes (safe; no typing/click in OS-input smoke)
npm run smoke:windows-os-input
npm run smoke:windows-screenshot
```

## Host launch (Windows terminal)

```powershell
cd C:\Users\victo\Looksy
$env:LOOKSY_PLATFORM="windows"
$env:LOOKSY_AUTH_TOKEN="token-fixture-valid"
npm run host:start
```

## Direct protocol checks (representative)

- Handshake success (`/v1/handshake`)
- `app.listWindows` returns real windows
- `app.focusWindow` returns `app.windowFocused`
- `input.moveMouse` / `input.click` / `input.pressKey` / `input.scroll` return success envelopes
- `screen.capture` returns real PNG artifact bytes

## Gateway-route checks (representative)

From the consumer gateway side, verify:

- `browser.request` `GET /tabs`
- `browser.request` `POST /tabs/focus`
- `browser.request` `POST /act` with `hover`, `click`, `press`
- `browser screenshot` command still emits full-frame capture

## Operational Notes

- Keep `LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR=true` for early canary cohorts.
- Keep `LOOKSY_OS_INPUT_ONLY=true` for this rollout phase.
- Use `LOOKSY_FORCE_LEGACY_EXECUTION=true` as emergency rollback.

## Known Gaps vs Peekaboo-Style Breadth

Canonical source of truth for gap status is now:

- `docs/peekaboo-parity-matrix-mar-2026.md`

Current P0 blockers from that matrix:

1. Clipped screenshot command-type divergence in OpenClaw mapping (`screen.capture.region`) versus Looksy protocol command list (`screen.capture` only).
2. Browser-state command families (`browser.navigate`, `browser.snapshot`, `browser.pdf`, `browser.console`, `browser.trace.*`) remain simulated in Looksy Windows adapter.
3. Trope Windows runtime `automation.browser` still executes an OS-input/screenshot subset and returns `unsupported_method` for non-covered browser actions.
4. Looksy element command family is protocol-defined but still simulated in Windows adapter and not mapped in OpenClaw/Trope Looksy paths.
5. Gesture primitives (`drag`, `swipe`) are absent from protocol + Windows backend + current consumer mappings.

Related planning docs:

- `docs/superset-gap-remediation-plan.md`
- `docs/superset-gap-audit-backlog.md`

## Recommended Next Sequence

1. P0: Resolve OpenClaw clipped screenshot command mismatch to align with Looksy `screen.capture` command contract.
2. P0: Replace simulated Windows browser-state handlers with real backend execution semantics.
3. P0: Implement real UIA-backed Looksy element operations (`element.find`, `element.invoke`, `element.setValue`) and wire consumer mappings.
4. P0: Add `input.drag` and `input.swipe` protocol + backend + consumer mappings.
5. P1: Add clipboard and broader window lifecycle command families, then expand cross-consumer parity regression coverage.
