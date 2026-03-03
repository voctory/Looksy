# Release and Rollback Runbook

## 1. Preconditions

- Protocol changes are versioned and migration notes are documented.
- `npm test` is green.
- `npm run typecheck` is green.
- Feature flags/rollback toggles are defined in each consumer integration.

## 2. Pre-Release Validation

1. Install from lockfile-backed path:
   - `npm ci`
2. Run quality gates:
   - `npm run typecheck`
   - `npm test`
3. Confirm security-critical paths:
   - invalid handshake token => `AUTH_FAILED`
   - policy deny => `POLICY_DENIED`
   - timeout => `TIMEOUT`
   - cancellation => `CANCELLED`
4. Confirm no secrets/tokens are logged.

## 3. Release Steps

1. Tag release candidate.
2. Publish artifacts by component (protocol/host/client) with changelog.
3. Roll out behind feature flags in consumer apps.
4. Monitor:
   - success/failure rate by command
   - p50/p95/p99 latency
   - top error codes
   - crash-free sessions
5. Promote to stable when metrics hold.

## 4. Rollback Triggers

Rollback immediately if one or more are true:

- Protocol compatibility breaks existing clients.
- Policy/auth behavior regresses.
- Timeout/cancel paths stall or leak in-flight work.
- Error rates or crashes exceed release thresholds.

## 5. Rollback Procedure

1. Flip integration feature flags off.
2. Revert to last known-good package versions.
3. Re-run smoke commands (`handshake`, `health.ping`, `screen.capture`).
4. Publish incident summary and owner.

## 6. Post-Rollback Actions

1. Add/adjust fixture cases that reproduce the failure.
2. Add regression tests before the next release.
3. Document root cause and updated acceptance criteria.
