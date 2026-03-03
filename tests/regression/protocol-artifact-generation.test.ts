import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GENERATED_ARTIFACT_PATHS,
  PROTOCOL_JSON_ARTIFACT_PATH,
  RUST_CONSTANTS_PATH,
  getProtocolIdentifiersArtifact,
  syncProtocolArtifacts,
} from "../../scripts/generateProtocolArtifacts";

const tempDirs: string[] = [];

function createTempRoot(): string {
  const rootDir = mkdtempSync(path.join(tmpdir(), "looksy-protocol-artifacts-"));
  tempDirs.push(rootDir);
  return rootDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("protocol artifact generation", () => {
  it("generates deterministic outputs from protocol schemas", () => {
    const rootDir = createTempRoot();

    const firstRun = syncProtocolArtifacts(rootDir, "generate");
    expect([...firstRun.changed].sort()).toEqual([...GENERATED_ARTIFACT_PATHS].sort());

    const secondRun = syncProtocolArtifacts(rootDir, "generate");
    expect(secondRun.changed).toEqual([]);

    const jsonArtifact = JSON.parse(readFileSync(path.join(rootDir, PROTOCOL_JSON_ARTIFACT_PATH), "utf8"));
    expect(jsonArtifact).toEqual(getProtocolIdentifiersArtifact());
  });

  it("passes in check mode when artifacts are current", () => {
    const rootDir = createTempRoot();

    syncProtocolArtifacts(rootDir, "generate");
    const checkRun = syncProtocolArtifacts(rootDir, "check");

    expect(checkRun.changed).toEqual([]);
  });

  it("detects drift in check mode", () => {
    const rootDir = createTempRoot();

    syncProtocolArtifacts(rootDir, "generate");
    writeFileSync(path.join(rootDir, RUST_CONSTANTS_PATH), "// drift\n", "utf8");

    const checkRun = syncProtocolArtifacts(rootDir, "check");

    expect(checkRun.changed).toContain(RUST_CONSTANTS_PATH);
  });
});
