# Shared Desktop Automation Plan (Looksy)

This plan defines how to build a shared automation stack that can be integrated by OpenClaw and additional consumer applications.

## 0. Implementation Status (Updated March 3, 2026)

The original migration plan and sequencing below remain intact. Current status snapshot:

- Phase 1 (scaffold + governance): **completed**
  - Repository structure now includes protocol, host, client, cli, fixtures, and tests.
- Phase 2 (protocol schema + bindings): **completed for v1 TypeScript**
  - Runtime-validated envelope + payload schemas are implemented under `protocol/`.
- Phase 3 (host-core dispatcher/policy/timeouts): **completed**
  - Auth, policy, timeout, cancel, and typed error envelopes are implemented under `host/core.ts`.
- Phase 4 (minimal macOS adapter): **completed**
  - Screenshot/input/app/element command families implemented behind adapter boundary.
- Phase 5 (minimal Windows adapter): **completed**
  - Matching command families implemented behind adapter boundary.
- Phase 6 (element operations): **completed in both adapters**
- Phase 7 (SDKs + auth/handshake e2e): **completed baseline**
  - TypeScript SDK implemented.
  - C# and Rust SDK skeletons implemented with handshake/command call paths.
- Phase 8 (conformance matrix): **completed baseline**
  - Fixture-driven matrix and regression-tag coverage are executed in test suite.
- Phases 9-14 (consumer integrations, dogfood, rollout, legacy removal): **pending**

Deliverables now present:
- Protocol v1 contract with typed request/response/error envelopes and coordinate-space metadata.
- Host runtime with loopback-only HTTP endpoints (`/v1/handshake`, `/v1/command`).
- Cross-platform adapter boundary with macOS and Windows implementations.
- CLI + SDK entry points for integration and diagnostics.
- Fixture-driven conformance and regression coverage.
- Architecture, quickstart, and release/rollback runbook docs.
- Integration feature-flag embedding guide (`docs/integration-feature-flag-guide.md`).
- Phases 9-14 execution tracker (`docs/phases-9-14-execution-tracker.md`).
- Superset gap remediation plan (`docs/superset-gap-remediation-plan.md`).
- Superset gap audit and prioritized backlog (`docs/superset-gap-audit-backlog.md`).
- Windows real browser backend implementation tracker (`docs/windows-real-browser-backend-implementation-tracker-mar-2026.md`).

## 1. Objective

Create a reusable desktop automation package that provides:
- A stable protocol for automation commands and results.
- Local host runtimes with platform adapters (macOS, Windows).
- Shared policy/security model.
- Client SDKs for integration.

The package should avoid app-specific business logic and remain focused on automation primitives.

## 2. Core Design

### 2.1 Repository Components

- `protocol/`: canonical command/result schema and versioning.
- `host-core/`: dispatcher, policy engine, validation, timeout/cancel handling.
- `host-macos/`: macOS adapter layer.
- `host-windows/`: Windows adapter layer.
- `client-ts/`, `client-csharp/`, `client-rust/`: integration SDKs.
- `cli/`: operator and debugging interface.
- `mcp/` (optional early): MCP-compatible tool surface.
- `conformance-tests/`: cross-platform protocol behavior suite.
- `fixtures/`: golden request/response fixtures.

### 2.2 Protocol v1

- Handshake: version/capability negotiation.
- Command envelope + typed payloads.
- Typed command result envelope.
- Typed error model.
- Coordinate-space annotations on any point/rect payload.
- Optional telemetry events for observability.

Recommended core command families:
- Screenshot and artifacts.
- Mouse and keyboard control.
- App/window listing and focus.
- UIA/AX-like element discovery + invocation/value setting.
- Health and capability introspection.

### 2.3 Security Model

Layered local security requirements:
- Local-only endpoint transport.
- OS-level endpoint permissions (UNIX socket mode / named-pipe ACL).
- Auth token validation during handshake.
- Policy allow/deny command filters.
- Request timeout and cancellation boundaries.
- Structured denied/error responses with reason codes.

## 3. Platform Strategy

### 3.1 macOS Adapter

Leverage existing macOS automation services and expose them behind the shared protocol.

### 3.2 Windows Adapter

Wrap existing Windows primitives (capture/input/UI Automation) behind the shared protocol.

### 3.3 Adapter Boundary Rules

- Keep platform-specific APIs inside adapter packages.
- Keep protocol/validation/policy in host-core.
- Keep app UX/session orchestration outside shared package.

## 4. Integration Strategy

### 4.1 OpenClaw Integration

- Add shared client SDK.
- Preserve current gateway/node external behavior.
- Swap macOS bridge internals to shared host adapter.
- Add compatibility layer and feature flag for rollback.

### 4.2 Secondary Consumer Integration

- Preserve each consumer app's existing transport/session behavior.
- Route existing automation actions through the shared dispatcher.
- Maintain compatibility mappings for legacy action names.
- Roll out behind a feature flag with a rapid fallback path.

## 5. Migration Phases (PR-by-PR)

1. Scaffold repo + CI + governance.
2. Add protocol schema + generated bindings.
3. Implement host-core dispatcher + policy + timeouts.
4. Add minimal macOS adapter (screenshot + input).
5. Add minimal Windows adapter (screenshot + input).
6. Add element operations for both adapters.
7. Add SDKs and handshake/auth e2e tests.
8. Add conformance test matrix.
9. Integrate OpenClaw behind flag.
10. Integrate second consumer behind flag.
11. Dogfood and compare telemetry/error envelopes.
12. Beta default-on in first app.
13. Beta default-on in second app.
14. Remove legacy duplicate execution paths.

## 6. Testing and Quality Gates

### 6.1 Conformance

- Shared fixtures run unchanged across macOS and Windows adapters.
- Validate schema fields, coordinate-space metadata, and error code parity.

### 6.2 Platform Reliability

- Multi-monitor and mixed-DPI mapping.
- Permission-denied and missing-capability paths.
- Foreground/focus instability handling.
- Long-run stability and memory/descriptor leak checks.

### 6.3 Security

- Unauthorized client rejection tests.
- Invalid/expired token rejection tests.
- Policy-denied command tests.
- No secret leakage in logs.

## 7. Observability and Operations

Track at minimum:
- Command success/failure rate by action and platform.
- Latency (p50/p95/p99).
- Top error codes and denial counts.
- Crash-free sessions.

Operational requirements:
- Staged rollouts.
- Documented rollback switches.
- Release runbook with signing/distribution steps.

## 8. Timeline (Reference)

With 2 senior engineers + 1 QA/automation engineer:
- Weeks 1-2: protocol + core + CI/fixtures.
- Weeks 3-5: platform adapters.
- Weeks 6-7: SDKs + conformance/security hardening.
- Weeks 8-9: first app integration + dogfood.
- Weeks 10-11: second app integration + dogfood.
- Week 12+: beta hardening and cleanup.

## 9. Immediate Next Steps (Execution-Focused)

1. Execute P1 parity backlog from `docs/superset-gap-audit-backlog.md` and `docs/superset-gap-remediation-plan.md` (browser command families, routing breadth, parity tests, session/policy hardening).
2. Add CI workflows that run `npm run typecheck` and `npm test` on every pull request.
3. Add protocol binding/codegen for C# and Rust so non-TS SDKs are generated from source-of-truth schemas.
4. Replace simulated adapter internals with real macOS and Windows automation backends behind the same interface.
5. Expand consumer integrations to reduce fallback scope and add route-level telemetry for unsupported semantics.
6. Add conformance coverage for mixed-DPI/multi-monitor coordinate mapping and permission-denied branches.
7. Continue phased integration milestones for phases 9-14 with telemetry-based go/no-go gates.
