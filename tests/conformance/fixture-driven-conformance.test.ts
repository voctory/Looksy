import { beforeAll, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type CommandEnvelope, type HandshakeRequest } from "../../protocol";
import { HostCore } from "../../host/core";
import { MacOSAdapter } from "../../host/adapters/macos";
import { StaticCommandPolicy } from "../../host/policy";
import { WindowsAdapter } from "../../host/adapters/windows";
import { assertEnvelopeSubset, assertErrorEnvelopeParity } from "../helpers/envelope-assertions";
import { applySessionPlaceholder, loadConformanceMatrix, loadFixture, type FixtureCase } from "../helpers/fixture-loader";

const VALID_TOKEN = "token-fixture-valid";
const TEST_WINDOWS_CAPTURE_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
]);

const adapters = {
  macos: () => new MacOSAdapter(),
  windows: () => new WindowsAdapter(),
};

type PlatformName = keyof typeof adapters;

function createHostCore(platform: PlatformName, fixtureCase: FixtureCase): HostCore {
  const adapter =
    platform === "macos"
      ? new MacOSAdapter({
          delayMsByCommand:
            fixtureCase.tags?.includes("timeout") || fixtureCase.tags?.includes("cancel")
              ? { "screen.capture": 120 }
              : {},
        })
      : new WindowsAdapter({
          delayMsByCommand:
            fixtureCase.tags?.includes("timeout") || fixtureCase.tags?.includes("cancel")
              ? { "screen.capture": 120 }
              : {},
          captureScreen: async ({ format }) =>
            format === "jpeg"
              ? Buffer.from([0xff, 0xd8, 0xff, 0xd9])
              : Buffer.from(TEST_WINDOWS_CAPTURE_BYTES),
        });

  const policy = fixtureCase.tags?.includes("policy")
    ? new StaticCommandPolicy({ deny: ["screen.capture"] })
    : undefined;

  return new HostCore({
    adapter,
    authToken: VALID_TOKEN,
    policy,
    defaultTimeoutMs: 30,
  });
}

async function createSession(core: HostCore): Promise<string> {
  const request = (await loadFixture("handshake/client-hello.valid.json")) as HandshakeRequest;
  const response = core.handshake(request);
  expect(response.ok).toBe(true);
  if (!response.ok) {
    throw new Error("Expected handshake to succeed");
  }

  return response.session.sessionId;
}

async function executeCase(platform: PlatformName, fixtureCase: FixtureCase): Promise<unknown> {
  const core = createHostCore(platform, fixtureCase);

  if (fixtureCase.operation === "handshake") {
    const request = await loadFixture(fixtureCase.request);
    return core.handshake(request);
  }

  const sessionId = await createSession(core);
  const request = applySessionPlaceholder(await loadFixture(fixtureCase.request), sessionId) as CommandEnvelope;

  if (fixtureCase.operation === "cancel") {
    if (!fixtureCase.preRequest) {
      throw new Error(`Fixture case ${fixtureCase.id} is missing preRequest`);
    }

    const preRequest = applySessionPlaceholder(await loadFixture(fixtureCase.preRequest), sessionId) as CommandEnvelope;
    const inFlight = core.command(preRequest);

    if (fixtureCase.context?.cancelDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, fixtureCase.context?.cancelDelayMs));
    }

    const cancelResponse = await core.command(request);
    expect(cancelResponse.ok).toBe(true);
    if (cancelResponse.ok) {
      expect(cancelResponse.result.type).toBe("control.cancelled");
      if (cancelResponse.result.type === "control.cancelled") {
        expect(cancelResponse.result.cancelled).toBe(true);
      }
    }

    return inFlight;
  }

  return core.command(request);
}

describe("fixture-driven conformance matrix", () => {
  let matrix: Awaited<ReturnType<typeof loadConformanceMatrix>>;

  beforeAll(async () => {
    matrix = await loadConformanceMatrix();
  });

  it("runs every fixture case on macOS and Windows adapters", async () => {
    for (const fixtureCase of matrix.cases) {
      const resultsByPlatform = new Map<PlatformName, unknown>();
      const expectedEnvelope = await loadFixture(fixtureCase.expected);

      for (const platform of Object.keys(adapters) as PlatformName[]) {
        const actualEnvelope = await executeCase(platform, fixtureCase);
        assertEnvelopeSubset(actualEnvelope, expectedEnvelope, `${platform}:${fixtureCase.id}`);
        resultsByPlatform.set(platform, actualEnvelope);
      }

      if (fixtureCase.tags?.includes("error")) {
        assertErrorEnvelopeParity(
          resultsByPlatform.get("macos"),
          resultsByPlatform.get("windows"),
          fixtureCase.id,
        );
      }
    }
  });

  it("matrix schema version matches protocol version", () => {
    expect(matrix.schemaVersion).toBe(PROTOCOL_VERSION);
  });
});
