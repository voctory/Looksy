# Repository Guidelines

This file defines contributor and agent guardrails for Looksy.

## Collaboration & Git Safety

- Assume multiple humans/agents may work in parallel.
- Do not run destructive git operations unless explicitly requested: `git reset --hard`, `git clean -fd`, force checkouts/restores, or `git push --force`.
- Never discard unrelated local changes you did not create.
- Scope commits to the files relevant to your task.
- Prefer non-interactive git commands.

## Project Structure & Module Organization

- Keep a clear separation between:
  - `protocol/` for automation contract definitions.
  - `host/` for local automation runtime and platform adapters.
  - `client/` SDKs and integration surfaces.
  - `docs/` for architecture, operations, and release runbooks.
  - `tests/` for conformance + regression coverage.
- Keep platform-specific code isolated (`macos/`, `windows/`) behind stable interfaces.

## Build, Test, and Dev Commands

- Prefer explicit reproducible commands in docs and CI.
- Standardize on one canonical install/build/test path per language/toolchain.
- If dependencies are missing, install via the repo's lockfile-backed package manager, then rerun the exact failing command.
- Keep quick commands documented and up to date.

## Protocol-First Engineering

- Treat the protocol as source-of-truth.
- Use typed request/response payloads with explicit versioning.
- Every breaking wire change requires protocol version coordination and migration notes.
- Prefer additive changes over breaking changes.

## Security & Runtime Hardening

- Local automation surfaces must be local-only and authenticated.
- Enforce layered checks: OS endpoint permissions + session auth token + policy allow/deny.
- Return typed errors for policy denials and auth failures.
- Never log secrets, tokens, or sensitive user data.
- Keep capture and automation logs privacy-safe by default.

## Coding Style & Naming

- Prefer strict typing and small, composable modules.
- Avoid `any`/untyped payloads when a schema can be defined.
- Avoid prototype mutation and implicit behavior sharing; prefer explicit composition/inheritance.
- Add brief comments only where logic is non-obvious.
- Keep files reasonably small; split when readability improves.

## Testing Guidelines

- Add tests alongside behavior changes.
- Maintain platform conformance tests for protocol-level behavior.
- Add regression tests for previously observed failures.
- Validate both success and denial/error paths.
- Exercise multi-monitor/mixed-DPI and permission edge cases for desktop automation features.

## CI, Release, and Operations

- Keep release steps scripted and documented in `docs/`.
- Prefer self-hosted release runners when required by platform signing/distribution constraints.
- Use staged rollout and rollback playbooks.
- Track basic production metrics: success rates, latency, error codes, crash-free sessions.

## Documentation Rules

- Document architecture decisions and migration plans in `docs/`.
- Keep docs actionable (commands + acceptance criteria + rollback paths).
- Update docs when behavior or workflows change.

## Agent-Specific Practices

- Use `rg` for fast search.
- Use repo-relative paths in responses.
- Verify in code before making factual claims.
- When uncertain, state assumptions explicitly and choose reversible changes.
- Prefer incremental PRs over large cross-cutting rewrites.

## Source References

Imported source AGENTS snapshots are kept for provenance:
- `docs/reference/AGENTS.openclaw.md`
- `docs/reference/AGENTS.trope.md`
