# OS-Input-First Execution Scope (Source of Truth)

Last updated: March 4, 2026

This is the source-of-truth scope for current rollout work (phases 9-14 readiness): integrations are **OS-input-first** and must keep browser-driver/state-heavy actions on legacy execution unless explicitly validated.

## Directional Decision (March 2026)

- Route only stable OS-input primitives through Looksy by default.
- Keep browser-driver/state actions (navigation/snapshot/pdf/console/trace and rich target-scoped semantics) on legacy execution during this rollout wave.
- Use feature flags to allow safe canarying and immediate rollback without redeploy.
- Windows is the priority rollout platform for this scope.
- For actions inside this scope, target architecture is Looksy-exclusive execution (do not rely on Trope native browser capture/backend as the primary path).
- TODO: document per-consumer criteria/date for making `LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR=false` the default in Windows cohorts.

Evidence:
- `protocol/schema.ts`
- `host/__tests__/core.test.ts`
- `../openclaw/src/gateway/server-methods/browser.ts`
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

## Supported Actions Now

### Protocol + host envelope primitives

- `screen.capture` (desktop-style capture)
- `input.moveMouse`
- `input.click`
- `input.typeText`
- `input.pressKey`
- `input.scroll`
- `app.listWindows`
- `app.focusWindow`

### Consumer mapping surface currently intended for rollout

- OpenClaw `/act` subsets:
  - `click` (point-based, no selector/ref target semantics)
  - `hover` (point-based)
  - `type` (direct text)
  - `press` (key/chord + optional modifiers)
- OpenClaw `/screenshot` desktop capture subset (no `targetId`/`ref`/`element`/`fullPage`)
- OpenClaw `/tabs` and `/tabs/focus` desktop window surfaces
- Trope browser action subset:
  - `screenshot`, `click`, `hover`, `type_text`, `press_key`, `scroll`

Evidence:
- `../openclaw/src/gateway/server-methods/browser.looksy-routing.test.ts`
- `../trope/packages/rust/trope-daemon/src/tools/mod.rs`

## Deferred Actions (Not In OS-Input-First Rollout Scope)

- Browser-driver/state families:
  - `browser.navigate`
  - `browser.snapshot`
  - `browser.pdf`
  - `browser.console`
  - `browser.trace.start`
  - `browser.trace.stop`
- Target-scoped/browser-state semantics (`targetId`, `ref`, `selector`, `element`) beyond currently translated point/text/key subsets.
- Rich browser lifecycle/state parity work needed for practical superset claim.

## Rollout Toggles

| Flag | Purpose | Typical OS-input-first value |
| --- | --- | --- |
| `LOOKSY_INTEGRATION_ENABLED` | Enables Looksy routing path. | `true` in canary, `false` by default in broad rollout until ready |
| `LOOKSY_FORCE_LEGACY_EXECUTION` | Emergency hard rollback. | `false` |
| `LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR` | Auto-fallback when Looksy route fails. | `true` during early canary |
| `LOOKSY_OS_INPUT_ONLY` | Restricts routing to OS-input-safe subset. | `true` |

Code references:
- OpenClaw: `../openclaw/src/gateway/server-methods/browser.ts` (`resolveLooksyRoutingFlags`, `browserHandlers["browser.request"]`)
- Trope: `../trope/packages/rust/trope-daemon/src/tools/mod.rs` (`looksy_routing_flags_from_reader`, `execute_browser_command_with_routing`)

## Validation Commands

```bash
# Looksy protocol/host baseline
npm run typecheck
npm test -- protocol/schema.test.ts host/__tests__/core.test.ts

# OpenClaw routing + fallback metadata matrix
pnpm vitest run src/gateway/server-methods/browser.looksy-routing.test.ts

# Trope mapper + routing matrix
cargo test -p trope-daemon map_browser_action_to_looksy_
cargo test -p trope-daemon execute_browser_command_with_routing_

# Local Windows real-capture smoke (non-Windows hosts skip deterministically)
npm run smoke:windows-screenshot
```

## Rollout Baseline Matrix

```bash
# Legacy baseline
LOOKSY_INTEGRATION_ENABLED=false

# Canary: Looksy enabled, OS-input-first, with safety fallback
LOOKSY_INTEGRATION_ENABLED=true
LOOKSY_OS_INPUT_ONLY=true
LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR=true

# Strict failure surfacing for verification environments
LOOKSY_INTEGRATION_ENABLED=true
LOOKSY_OS_INPUT_ONLY=true
LOOKSY_FALLBACK_TO_LEGACY_ON_ERROR=false

# Emergency rollback
LOOKSY_FORCE_LEGACY_EXECUTION=true
```
