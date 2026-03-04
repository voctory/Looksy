# Windows Real Browser Backend Implementation Tracker (March 2026)

Last updated: March 4, 2026
Scope owner: Looksy shared automation (`docs/` tracking only)
Status: In planning and execution

## Objective

Track delivery of a real Windows browser backend for Looksy so browser-state commands stop relying on simulated in-memory behavior and run against real browser protocols.

## Current Baseline (Simulated vs Real)

| Surface | Current state (March 2026) | Evidence |
| --- | --- | --- |
| `screen.capture` | Real Windows-backed implementation | `host/adapters/windows.ts` (`captureWindowsScreenViaPowerShell`) |
| OS input (`input.*`) | Real Windows-backed implementation | `host/adapters/windows.ts` (`moveMouseViaPowerShell`, `clickViaPowerShell`, `typeTextViaPowerShell`, `pressKeyViaPowerShell`, `scrollViaPowerShell`, `dragViaPowerShell`, `swipeViaPowerShell`) |
| Clipboard + window lifecycle (`clipboard.*`, `app.*`) | Real Windows-backed implementation | `host/adapters/windows.ts` (`clipboardReadViaPowerShell`, `clipboardWriteViaPowerShell`, `listWindowsViaPowerShell`, `focusWindowViaPowerShell`, `moveWindowViaPowerShell`, `resizeWindowViaPowerShell`, `minimizeWindowViaPowerShell`, `maximizeWindowViaPowerShell`, `closeWindowViaPowerShell`) |
| Element commands (`element.find`, `element.invoke`, `element.setValue`) | Hybrid: UIA attempt on Windows with deterministic simulation fallback | `host/adapters/windows.ts` (`findElementViaPowerShell`, fallback path in `findElement`) |
| Browser-state commands (`browser.navigate`, `browser.snapshot`, `browser.pdf`, `browser.console`, `browser.trace.*`) | Simulated in-memory behavior (no real browser protocol backend yet) | `host/adapters/windows.ts` (`browserUrl`, `browserTitle`, `browserConsole`, `activeTraceBySession`, `buildSnapshotHtml`, synthetic `looksy-browser-pdf:*`) |

## Decision (March 2026)

1. Implement Chromium/Edge real backend on Windows via CDP first.
2. Add WebDriver classic + WebDriver BiDi support after CDP baseline is stable for Chromium/Edge.
3. Implement Firefox via geckodriver with WebDriver + BiDi path.
4. Keep protocol command surface stable; backend changes remain adapter-internal and additive.

## Architecture Boundaries

| Layer | Responsibilities | Must not own |
| --- | --- | --- |
| OS orchestration layer (host runtime + Windows adapter shell/process control) | Process launch/attach, session lifecycle, local auth token checks, policy checks, timeout/cancel, window focus/desktop preflight | Browser-domain semantics translation (DOM/snapshot/PDF logic), UIA element heuristics beyond fallback role |
| Browser protocol layer (CDP/WebDriver/BiDi clients) | Tab/session management, navigation, snapshot/DOM extraction, PDF, console, trace, target/session routing | Direct OS input/focus repair loops and policy orchestration |
| UIA fallback layer | Last-resort element operations when browser protocol path cannot resolve a requested element action | Primary browser-state implementation for `browser.*` commands |

Boundary rule: `browser.*` command family should execute in browser protocol layer by default; UIA fallback is only for explicitly scoped element operations and break-glass recovery flows.

## Milestones

| Milestone | Target | Status | Acceptance criteria | Validation commands |
| --- | --- | --- | --- | --- |
| M0: Baseline lock and interface contract | Mar 2026 | `Not started` | Tracker approved, adapter interface for browser transport finalized, no protocol breaking changes | `npm run typecheck` |
| M1: CDP transport for Chromium/Edge | Mar 2026 | `Not started` | Can launch/attach Chromium/Edge, establish authenticated local session, enumerate targets, and close cleanly | `npm run typecheck`<br>`npm test -- host/__tests__/core.test.ts host/__tests__/policy.test.ts` |
| M2: Real `browser.*` execution via CDP | Apr 2026 | `Not started` | `browser.navigate/snapshot/pdf/console/trace.*` use live browser responses (no synthetic `looksy-browser-pdf:*` payloads) | `npm test -- host/__tests__/windows.automation.test.ts host/__tests__/windows.capture.test.ts`<br>`npm test -- host/__tests__/windows.browser-backend.test.ts` |
| M3: Chromium/Edge WebDriver + BiDi follow-on | Apr 2026 | `Not started` | WebDriver/BiDi path passes parity suite and can be selected without breaking CDP path | `npm run typecheck`<br>`npm test` |
| M4: Firefox via geckodriver WebDriver/BiDi | May 2026 | `Not started` | Firefox backend supports core `browser.*` commands with typed parity and denial paths | `npm test -- host/__tests__/windows.browser-backend.test.ts`<br>`npm test -- tests/smoke/windows-real-browser-backend-smoke.test.ts` |
| M5: Consumer rollout readiness | May 2026 | `Not started` | OpenClaw/Trope route parity validated; rollback toggles proven in drill | `npm run smoke:windows-os-input`<br>`npm run smoke:windows-screenshot`<br>`(cd ../openclaw && npm test -- src/gateway/server-methods/browser.looksy-routing.test.ts)`<br>`(cd ../trope && cargo test map_browser_action_to_looksy_maps_supported_actions)` |

## Risks and Mitigations

| Risk | Impact | Mitigation | Validation signal |
| --- | --- | --- | --- |
| Session 0 isolation | Service/session context cannot access interactive desktop browser state reliably | Require interactive user-session execution for real browser backend; preflight and return typed denial when desktop is unavailable | Preflight logs + typed error frequency, no silent hang |
| UIPI / integrity-level boundaries | Automation against elevated windows may fail or partially execute | Detect integrity mismatch early, fail typed and explicit; document admin/elevation prerequisites for target apps | Integration test that exercises denial path and message quality |
| Remote debugging auth/exposure | Unauthenticated/overexposed debugging endpoint can enable unintended control | Bind debug endpoint to loopback only, use ephemeral session token, random ports, and honor enterprise policy restrictions | Security checklist pass; no non-loopback listener in canary telemetry |
| Enterprise policy restrictions | CDP/remote debugging may be disabled by policy and break flow | Preflight policy check, surface typed unsupported/denied response, auto-fallback to approved backend path | Policy-denied path coverage in tests and canary metrics |

## Rollout Gates

1. Gate A (dev/CI): Feature merged behind flag, tests green, no protocol break.
2. Gate B (internal canary): Enable Windows real browser backend for internal cohort with fallback enabled.
3. Gate C (expanded canary): Increase cohort, disable fallback for a subset, track success/error/p95 latency.
4. Gate D (default-on candidate): Browser backend enabled by default only after parity + rollback drill pass.

## Rollback Plan

1. Set `LOOKSY_FORCE_LEGACY_EXECUTION=true` for immediate hard rollback.
2. Keep or set `LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR=true` during incident triage.
3. If required, set `LOOKSY_OS_INPUT_ONLY=true` to constrain scope to known-safe command families.
4. If required, set `LOOKSY_INTEGRATION_ENABLED=false` to return fully to legacy execution path.
5. Capture failing request IDs and typed error envelopes before re-enabling canary.

## Checklist (Update In Place)

| Item | Owner | Status | Target date | Notes |
| --- | --- | --- | --- | --- |
| [ ] Approve architecture boundaries for OS orchestration vs browser protocol vs UIA fallback | Unassigned | `Not started` | 2026-03-15 |  |
| [ ] Land CDP session bootstrap for Chromium/Edge | Unassigned | `Not started` | 2026-03-22 |  |
| [ ] Move `browser.navigate` to real CDP path | Unassigned | `Not started` | 2026-03-29 |  |
| [ ] Move `browser.snapshot` to real CDP path | Unassigned | `Not started` | 2026-03-29 |  |
| [ ] Move `browser.pdf` to real CDP path | Unassigned | `Not started` | 2026-04-05 |  |
| [ ] Move `browser.console` and `browser.trace.*` to real CDP path | Unassigned | `Not started` | 2026-04-05 |  |
| [ ] Add Chromium/Edge WebDriver + BiDi follow-on path | Unassigned | `Not started` | 2026-04-19 |  |
| [ ] Add Firefox geckodriver WebDriver/BiDi backend | Unassigned | `Not started` | 2026-05-03 |  |
| [ ] Validate OpenClaw and Trope routing parity for browser families | Unassigned | `Not started` | 2026-05-10 |  |
| [ ] Complete rollout drill and rollback rehearsal | Unassigned | `Not started` | 2026-05-17 |  |

## Official Sources

- Chrome DevTools Protocol: https://chromedevtools.github.io/devtools-protocol/
- Microsoft Edge DevTools Protocol: https://learn.microsoft.com/en-us/microsoft-edge/test-and-automation/devtools-protocol
- W3C WebDriver: https://www.w3.org/TR/webdriver/
- W3C WebDriver Level 2: https://www.w3.org/TR/webdriver2/
- W3C WebDriver BiDi: https://w3c.github.io/webdriver-bidi/
- Firefox geckodriver docs: https://firefox-source-docs.mozilla.org/testing/geckodriver/
- Microsoft Edge policy (`RemoteDebuggingAllowed`): https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/remotedebuggingallowed
- Windows Session 0 isolation reference: https://learn.microsoft.com/en-us/windows/win32/services/service-changes-for-windows-vista#session-0-isolation
- Windows UI Automation security overview: https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview
- Win32 `ChangeWindowMessageFilterEx` (UIPI-related): https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-changewindowmessagefilterex
