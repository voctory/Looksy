import { readFile } from "node:fs/promises";
import path from "node:path";

const FIXTURE_ROOT = path.resolve(process.cwd(), "fixtures/protocol/v1");

export interface FixtureCase {
  id: string;
  operation: "handshake" | "command" | "cancel";
  request: string;
  expected: string;
  preRequest?: string;
  context?: {
    cancelDelayMs?: number;
  };
  tags?: string[];
}

export interface ConformanceMatrix {
  schemaVersion: string;
  cases: FixtureCase[];
}

export async function loadFixture(relativePath: string): Promise<unknown> {
  const resolvedPath = path.join(FIXTURE_ROOT, relativePath);
  const raw = await readFile(resolvedPath, "utf8");
  return JSON.parse(raw);
}

export async function loadConformanceMatrix(): Promise<ConformanceMatrix> {
  return (await loadFixture("conformance-matrix.json")) as ConformanceMatrix;
}

export function applySessionPlaceholder(value: unknown, sessionId: string): unknown {
  if (value === "$session") {
    return sessionId;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => applySessionPlaceholder(entry, sessionId));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = applySessionPlaceholder(nested, sessionId);
    }
    return output;
  }

  return value;
}
