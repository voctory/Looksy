# Superset Gap Remediation Plan (March 3, 2026)

This document tracks what is still missing for Looksy to be a practical superset of current desktop/browser automation behavior used by consumer integrations.

## Current Assessment

Status: **not yet a superset**.

Primary blocking gaps:

1. Screenshot artifact retrieval is missing.
2. Browser/domain action parity is incomplete versus current consumer behavior.
3. C# and Rust SDK wire envelopes are not fully aligned with host protocol v1 envelopes.
4. Runtime adapters are still simulated, not real OS automation backends.

## Baseline Surface We Must Cover

The baseline surface is the union of currently used behavior in consumer integrations:

- Desktop primitives: health, capture, input, app/window, element, cancel, metrics.
- Browser primitives: navigation, tab lifecycle, snapshots, richer action verbs, debug/trace/state surfaces, download/file-dialog hooks.

## Priority Backlog

### P0 (Must finish first)

- [ ] Add screenshot artifact retrieval endpoint and host-side artifact storage.
  - Acceptance:
    - `screen.capture` result includes retrieval metadata.
    - artifact bytes can be fetched by artifact ID from loopback endpoint.
    - tests cover success + not-found + auth/session denial path.

- [ ] Align C# SDK request/response models with protocol v1 envelopes.
  - Acceptance:
    - handshake and command use the same envelope shape as host validation.
    - health/capabilities/screenshot command names match protocol v1 IDs.

- [ ] Align Rust SDK request/response models with protocol v1 envelopes.
  - Acceptance:
    - handshake and command use the same envelope shape as host validation.
    - health/capabilities/screenshot command names match protocol v1 IDs.

- [ ] Remove screenshot payload drift between protocol and clients.
  - Acceptance:
    - TS SDK + CLI screenshot payload fields are accepted by protocol schema.
    - tests cover screenshot payload compatibility.

### P1 (Needed for practical parity)

- [ ] Expand protocol/browser command families to cover consumer-used browser actions.
- [ ] Expand integration routing in consumer repos to reduce forced legacy fallback scope.
- [ ] Add parity tests for routed actions and output-shape compatibility.

### P2 (Operational completion)

- [ ] Replace simulated adapters with real macOS and Windows automation backends.
- [ ] Complete phase 9-14 operations checklist (staging rollback drills, canary, dogfood, dashboards, default-on, legacy removal).

## Execution Notes

Update this section as work lands:

- 2026-03-03: audit completed across Looksy + both consumer repos; P0/P1/P2 backlog captured.
