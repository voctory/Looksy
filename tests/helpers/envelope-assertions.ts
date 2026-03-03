import assert from "node:assert/strict";

const ANY_PREFIX = "$any:";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertAnyMatcher(actual: unknown, matcher: string, atPath: string): void {
  const matcherType = matcher.slice(ANY_PREFIX.length);

  if (matcherType === "string") {
    assert.equal(typeof actual, "string", `${atPath} expected string`);
    return;
  }

  if (matcherType === "number") {
    assert.equal(typeof actual, "number", `${atPath} expected number`);
    return;
  }

  if (matcherType === "boolean") {
    assert.equal(typeof actual, "boolean", `${atPath} expected boolean`);
    return;
  }

  if (matcherType === "nonEmptyString") {
    assert.equal(typeof actual, "string", `${atPath} expected string`);
    const stringValue = actual as string;
    assert.ok(stringValue.trim().length > 0, `${atPath} expected non-empty string`);
    return;
  }

  if (matcherType === "defined") {
    assert.notEqual(actual, undefined, `${atPath} expected defined value`);
    return;
  }

  throw new Error(`${atPath} uses unsupported matcher ${matcher}`);
}

function matchesSubset(actual: unknown, expected: unknown, atPath: string): void {
  if (typeof expected === "string" && expected.startsWith(ANY_PREFIX)) {
    assertAnyMatcher(actual, expected, atPath);
    return;
  }

  if (isPlainObject(expected) && "$oneOf" in expected) {
    const variants = expected.$oneOf;
    assert.ok(Array.isArray(variants), `${atPath}.$oneOf must be an array`);

    let matched = false;
    for (const variant of variants) {
      try {
        matchesSubset(actual, variant, atPath);
        matched = true;
        break;
      } catch {
        // Try next variant.
      }
    }

    assert.ok(matched, `${atPath} does not match any $oneOf variants`);
    return;
  }

  if (isPlainObject(expected) && "$includes" in expected) {
    const requiredItems = expected.$includes;
    assert.ok(Array.isArray(actual), `${atPath} expected array for $includes matcher`);
    assert.ok(Array.isArray(requiredItems), `${atPath}.$includes must be an array`);
    const actualArray = actual as unknown[];

    for (const required of requiredItems) {
      assert.ok(
        actualArray.some((candidate) => {
          try {
            matchesSubset(candidate, required, `${atPath}[]`);
            return true;
          } catch {
            return false;
          }
        }),
        `${atPath} missing required item from $includes`,
      );
    }

    return;
  }

  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${atPath} expected array`);
    const actualArray = actual as unknown[];
    assert.ok(
      actualArray.length >= expected.length,
      `${atPath} expected at least ${expected.length} entries but got ${actualArray.length}`,
    );

    for (let index = 0; index < expected.length; index += 1) {
      matchesSubset(actualArray[index], expected[index], `${atPath}[${index}]`);
    }

    return;
  }

  if (isPlainObject(expected)) {
    assert.ok(isPlainObject(actual), `${atPath} expected object`);

    for (const [key, value] of Object.entries(expected)) {
      matchesSubset(actual[key], value, `${atPath}.${key}`);
    }

    return;
  }

  assert.deepEqual(actual, expected, `${atPath} mismatch`);
}

export function assertEnvelopeSubset(actual: unknown, expected: unknown, label = "envelope"): void {
  matchesSubset(actual, expected, label);
}

export function assertErrorEnvelopeParity(
  leftEnvelope: unknown,
  rightEnvelope: unknown,
  contextLabel: string,
): void {
  const normalize = (envelope: unknown) => {
    const typedEnvelope = envelope as {
      ok?: boolean;
      error?: { code?: string; retriable?: boolean; details?: Record<string, unknown> };
    };

    const details =
      typedEnvelope.error?.details && typeof typedEnvelope.error.details === "object"
        ? typedEnvelope.error.details
        : undefined;

    return {
      ok: typedEnvelope.ok ?? false,
      code: typedEnvelope.error?.code,
      retriable: typedEnvelope.error?.retriable,
      detailsKeys: details ? Object.keys(details).sort() : [],
    };
  };

  assert.deepEqual(normalize(leftEnvelope), normalize(rightEnvelope), `${contextLabel} error envelope parity mismatch`);
}
