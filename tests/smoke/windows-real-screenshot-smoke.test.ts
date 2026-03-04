import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../../protocol";
import { WindowsAdapter } from "../../host/adapters/windows";
import { HostCore } from "../../host/core";

const RUN_REAL_SMOKE = process.env.LOOKSY_WINDOWS_REAL_SCREENSHOT_SMOKE === "1";
const SYNTHETIC_MARKER = Buffer.from("looksy-screenshot:windows:", "utf8");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const AUTH_TOKEN = "smoke-token";

function createHandshakeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: "hs-windows-real-smoke",
    authToken: AUTH_TOKEN,
    client: {
      name: "smoke",
      version: "1.0.0",
    },
    ...overrides,
  };
}

async function createSession(core: HostCore, requestId = "hs-windows-real-smoke") {
  const handshake = core.handshake(createHandshakeRequest({ requestId }));
  expect(handshake.ok).toBe(true);
  if (!handshake.ok) {
    throw new Error("Expected handshake success");
  }
  return handshake.session.sessionId;
}

function parsePngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24) {
    throw new Error("screenshot output was too small to contain PNG header data");
  }
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("screenshot output was not PNG");
  }
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("PNG header chunk (IHDR) was missing");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return { width, height };
}

describe("windows real screenshot smoke", () => {
  it("captures a real PNG screenshot on Windows when smoke mode is enabled", async () => {
    if (!RUN_REAL_SMOKE) {
      expect(true).toBe(true);
      return;
    }

    if (process.platform !== "win32") {
      expect(true).toBe(true);
      return;
    }

    const core = new HostCore({
      adapter: new WindowsAdapter(),
      authToken: AUTH_TOKEN,
    });
    const sessionId = await createSession(core);
    const response = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-windows-real-smoke",
      sessionId,
      command: {
        type: "screen.capture",
        format: "png",
      },
    });

    expect(response.ok).toBe(true);
    if (!response.ok || response.result.type !== "screen.captured") {
      return;
    }

    const artifact = core.readScreenshotArtifact({
      artifactId: response.result.artifactId,
      sessionId,
    });
    expect(artifact).not.toBeNull();
    const bytes = artifact?.bytes ?? Buffer.alloc(0);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.includes(SYNTHETIC_MARKER)).toBe(false);

    const dimensions = parsePngDimensions(bytes);
    expect(dimensions.width).toBeGreaterThan(0);
    expect(dimensions.height).toBeGreaterThan(0);
  });
});
