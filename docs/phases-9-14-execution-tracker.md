# Phases 9-14 Execution Tracker

This tracker is the operational checklist for migration phases 9 through 14.

## Phase 9: Integrate OpenClaw Behind Flag

Acceptance criteria:
- OpenClaw routes automation through Looksy when integration flag is enabled.
- `LOOKSY_FORCE_LEGACY_EXECUTION` returns execution to the legacy path within one config refresh cycle.
- Success/error envelopes match protocol v1 shape.

Checklist:
- [ ] Integration flag shipped in OpenClaw.
- [ ] Rollback toggle verified in staging.
- [ ] Smoke suite covers handshake, `health.ping`, and `screen.capture`.
- [ ] Dashboards split metrics by execution path (`looksy` vs `legacy`).

## Phase 10: Integrate Second Consumer Behind Flag

Acceptance criteria:
- Second consumer can execute parity set of commands through Looksy.
- Legacy fallback toggle is validated in staging and production canary.
- No P0/P1 regressions introduced in auth/policy/timeout paths.

Checklist:
- [ ] Consumer-specific adapter wiring merged.
- [ ] Compatibility mappings configured for legacy action names (if required).
- [ ] Canary cohort configured.
- [ ] Rollback drill completed and documented.

## Phase 11: Dogfood and Compare Telemetry

Acceptance criteria:
- At least 7 consecutive dogfood days with stable error envelope parity.
- p95 latency delta between legacy and Looksy paths remains within agreed threshold.
- Top failure codes are understood with mitigation owners.

Checklist:
- [ ] Daily telemetry review in place.
- [ ] Error-code diff report automated.
- [ ] Weekly go/no-go review notes captured.
- [ ] Incident playbook tested by on-call.

## Phase 12: Beta Default-On in First App

Acceptance criteria:
- Default execution path in first app is Looksy.
- Rollback toggle remains functional and tested post-cutover.
- Support/on-call runbook updated for beta operations.

Checklist:
- [ ] Default flag state changed to on for first app.
- [ ] Guardrail alerts tuned for beta thresholds.
- [ ] On-call handoff completed.
- [ ] Post-cutover verification run completed.

## Phase 13: Beta Default-On in Second App

Acceptance criteria:
- Default execution path in second app is Looksy.
- Error budget remains within target for at least one full release cycle.
- Both apps share a consistent rollback mechanism.

Checklist:
- [ ] Default flag state changed to on for second app.
- [ ] Shared rollback play validated end-to-end.
- [ ] Cross-app telemetry dashboards aligned.
- [ ] Release notes include migration and rollback instructions.

## Phase 14: Remove Legacy Duplicate Execution Paths

Acceptance criteria:
- Legacy execution path is removed from active code paths.
- Compatibility flag usage is near-zero or eliminated for active clients.
- Regression and conformance suites are green after removal.

Checklist:
- [ ] Legacy execution code removed or hard-disabled.
- [ ] Dead flags removed from config and docs.
- [ ] Regression tests updated for post-legacy behavior.
- [ ] Final migration retrospective published.
