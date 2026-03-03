# Test Suites

The repository uses fixture-driven conformance tests plus focused regression coverage.

## Suites

- `tests/conformance/fixture-driven-conformance.test.ts`
  - Runs the same protocol fixture matrix against both built-in adapters (`macos`, `windows`).
- `tests/regression/error-path-regression.test.ts`
  - Verifies required regression tags exist for auth, policy, timeout, and cancel paths.
- `host/__tests__/*.test.ts`
  - Unit tests for host core and local HTTP server behavior.
- `protocol/schema.test.ts`
  - Unit tests for protocol runtime validation.

## Fixtures

Fixtures are stored in `fixtures/protocol/v1/`.

- `conformance-matrix.json` defines cases and expected envelopes.
- Envelope fixtures can use matcher tokens:
  - `$any:nonEmptyString`
  - `$oneOf`
  - `$includes`

## Run

```bash
npm test
```
