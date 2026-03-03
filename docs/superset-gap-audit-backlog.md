# Looksy Superset Gap Audit and Prioritized Backlog

Last updated: March 3, 2026

## Purpose

This document captures concrete gaps between current Looksy implementation and the practical requirements to be a superset replacement for existing desktop automation behavior, with a prioritized execution backlog.

Scope focus:
- Screenshot artifacts
- Browser actions
- Sessioning
- Telemetry
- Policy/auth
- Adapters

## Current Baseline Summary

- Protocol v1 with typed envelopes and command/result schemas is implemented.
- Host dispatcher supports auth, policy, timeout, cancel, and loopback-only HTTP.
- macOS and Windows adapters exist behind a stable interface.
- TypeScript SDK and CLI are operational.
- C# and Rust SDKs are present but currently skeleton-grade.
- Fixture-driven conformance/regression coverage exists but remains narrow.

## Gap Audit

## Critical

### 1. Cross-SDK wire compatibility is not converged on protocol v1

Impact:
- Non-TS consumers cannot reliably interoperate with host v1 envelopes.
- Multi-consumer rollout risk is high.

Evidence:
- `protocol/schema.ts`
- `client/csharp/Looksy.Client/Models.cs`
- `client/rust/src/models.rs`
- `client/rust/src/client.rs`

### 2. Screenshot artifact contract is metadata-only

Impact:
- `screen.capture` cannot be consumed as a real screenshot pipeline (no image retrieval path).
- Consumers cannot replace legacy screenshot behavior end-to-end.

Evidence:
- `protocol/schema.ts` (`screen.captured` has `artifactId` but no artifact fetch flow)
- `host/httpServer.ts` (no artifact endpoint)
- `host/adapters/macos.ts`
- `host/adapters/windows.ts`

## High

### 3. Browser automation surface is missing from protocol/runtime

Impact:
- Cannot replace browser-computer-use stacks that depend on tab/session/navigation/action semantics.

Evidence:
- `protocol/schema.ts` command union does not include browser command family.

### 4. Adapters are simulated, not production automation backends

Impact:
- Current behavior is deterministic mock output, not real OS automation.
- Superset parity cannot be validated.

Evidence:
- `host/adapters/macos.ts`
- `host/adapters/windows.ts`
- `docs/shared-automation-plan.md` immediate next steps already call for replacement.

## Medium

### 5. Session model lacks hardening and lifecycle controls

Impact:
- No built-in session expiry/revocation API.
- Command auth relies on session lookup without stronger session lifecycle controls.

Evidence:
- `host/core.ts`
- `host/types.ts`

### 6. Policy model is command-type allow/deny only

Impact:
- Missing argument-level and context-aware policy enforcement needed for safer desktop control.

Evidence:
- `host/policy.ts`

### 7. Telemetry is in-memory and coarse

Impact:
- No durable metrics pipeline, no p50/p95/p99, no standardized export path.

Evidence:
- `host/metrics.ts`

### 8. Conformance matrix does not cover full parity surface

Impact:
- Regression confidence is limited outside current small fixture set.

Evidence:
- `fixtures/protocol/v1/conformance-matrix.json`

## Prioritized Backlog

## P0 (Blockers for practical superset rollout)

### P0.1 Protocol parity across TS, C#, Rust, and host

Acceptance criteria:
- C#, Rust, and TS SDK request/response models match protocol v1 envelope fields exactly.
- Wrapper command names default to protocol v1 command IDs (no legacy-only aliases by default).
- Artifact/codegen check fails CI on drift across generated constants/models.

Checklist:
- [ ] Regenerate/replace C# models from protocol source-of-truth.
- [ ] Regenerate/replace Rust models from protocol source-of-truth.
- [ ] Add SDK regression tests that round-trip real v1 envelope fixtures.
- [ ] Add CI gate: protocol artifact drift check.

### P0.2 Screenshot artifact pipeline end-to-end

Acceptance criteria:
- `screen.capture` returns artifact metadata plus a resolvable retrieval mechanism.
- Host exposes artifact retrieval endpoint with auth/session checks.
- Artifacts have lifecycle policy (retention + cleanup).
- TS/CLI/C#/Rust can retrieve and decode screenshots from host.

Checklist:
- [ ] Define protocol artifact retrieval contract.
- [ ] Implement host artifact store + retrieval route.
- [ ] Implement adapter capture byte generation into artifact store.
- [ ] Add conformance fixtures for artifact retrieval success/failure/expiry.

### P0.3 Browser command family for parity with existing automation

Acceptance criteria:
- Protocol includes browser session/tab/action primitives required by integrations.
- Host dispatches browser commands with typed success/error envelopes.
- At least one adapter path supports real browser operations in staging.

Checklist:
- [ ] Define browser command/result schemas in `protocol/`.
- [ ] Add host dispatch and policy handling for browser family.
- [ ] Implement initial adapter/browser bridge integration.
- [ ] Add fixture-driven conformance for browser happy path + deny/error paths.

### P0.4 Replace simulated adapters with real macOS/Windows backends

Acceptance criteria:
- Both platform adapters execute real capture/input/window/element operations.
- Permission-denied and capability-missing branches return typed errors.
- Smoke reliability meets agreed thresholds in staged runs.

Checklist:
- [ ] Implement macOS backend wiring behind `HostAdapter`.
- [ ] Implement Windows backend wiring behind `HostAdapter`.
- [ ] Add platform integration tests for real operation paths.
- [ ] Remove mock-only assumptions from production startup path.

## P1 (Hardening for safe scale)

### P1.1 Session lifecycle and auth hardening

Acceptance criteria:
- Sessions support expiry and explicit revocation.
- Session metadata includes issuance/expiry data needed for auditability.
- Host provides lifecycle controls without breaking v1 compatibility.

Checklist:
- [ ] Add session expiry model and enforcement.
- [ ] Add session revocation endpoint/command.
- [ ] Add tests for expired/revoked/unknown session branches.

### P1.2 Policy v2: argument-aware enforcement

Acceptance criteria:
- Policy can deny based on command arguments/context, not only command type.
- Denials remain typed and include non-sensitive reasons.

Checklist:
- [ ] Extend `CommandPolicy` interface for contextual evaluation.
- [ ] Add policy rules for coordinates, selectors, and target scopes.
- [ ] Add coverage for success and denial branches.

### P1.3 Telemetry v2 and rollout observability

Acceptance criteria:
- Metrics include p50/p95/p99 latency, command/action dimensions, and error-code dimensions.
- Metrics can be exported/polled durably across process restarts.

Checklist:
- [ ] Extend metrics schema and host recorder.
- [ ] Add persistent/exportable metrics path.
- [ ] Add rollout dashboard contract fields and regression tests.

### P1.4 Expand conformance matrix to parity-critical surface

Acceptance criteria:
- Conformance covers browser family, artifact retrieval, policy v2 denials, and session lifecycle.

Checklist:
- [ ] Add fixture sets for each new command family and error path.
- [ ] Add mixed success/error parity assertions across adapters.

## P2 (Optimization and operational maturity)

### P2.1 Multi-monitor/mixed-DPI reliability suite

Acceptance criteria:
- Coordinate correctness and action targeting validated under mixed DPI and multi-monitor topologies.

Checklist:
- [ ] Add dedicated fixtures/tests for coordinate transforms and edge monitors.
- [ ] Add regression tags for mixed-DPI failures.

### P2.2 Artifact streaming and large-payload ergonomics

Acceptance criteria:
- Large screenshot/artifact flows support efficient transfer strategy without envelope bloat.

Checklist:
- [ ] Define streaming/chunking strategy.
- [ ] Add host/client support and compatibility tests.

### P2.3 Operational runbook completion for default-on rollout

Acceptance criteria:
- Runbook includes deployment, rollback, incident triage, and ownership for all new surfaces.

Checklist:
- [ ] Add explicit go/no-go gates tied to telemetry thresholds.
- [ ] Add incident templates for auth/policy/adapter/browser/artifact failures.
- [ ] Link this backlog from release and migration docs.

## Exit Criteria

Looksy is considered a practical superset replacement when:
- P0 backlog is fully complete and validated in staging.
- P1 backlog is complete for auth/policy/telemetry/session safety.
- Conformance matrix includes all parity-critical command families and error paths.
- Consumer integrations in phases 9-14 can run default-on with rollback verified.
