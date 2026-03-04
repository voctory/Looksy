import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "../../protocol";
import { WindowsAdapter } from "../adapters/windows";
import { HostCore } from "../core";

const AUTH_TOKEN = "test-token";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function createHandshakeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: "hs-windows-capture",
    authToken: AUTH_TOKEN,
    client: {
      name: "tests",
      version: "1.0.0",
    },
    ...overrides,
  };
}

async function createSession(core: HostCore, requestId = "hs-windows-capture") {
  const handshake = core.handshake(createHandshakeRequest({ requestId }));
  expect(handshake.ok).toBe(true);
  if (!handshake.ok) {
    throw new Error("Expected handshake success");
  }
  return handshake.session.sessionId;
}

describe("WindowsAdapter screen.capture", () => {
  it("stores PNG signature bytes when captureScreen override is used", async () => {
    const captureBytes = Buffer.concat([PNG_SIGNATURE, Buffer.from([0x00, 0x01, 0x02])]);
    const captureScreen = vi.fn(async () => captureBytes);
    const core = new HostCore({
      adapter: new WindowsAdapter({ captureScreen }),
      authToken: AUTH_TOKEN,
    });

    const sessionId = await createSession(core);
    const response = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-windows-capture-mocked",
      sessionId,
      command: {
        type: "screen.capture",
      },
    });
    expect(response.ok).toBe(true);
    if (!response.ok || response.result.type !== "screen.captured") {
      return;
    }

    expect(captureScreen).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "png",
      }),
    );
    const stored = core.readScreenshotArtifact({
      artifactId: response.result.artifactId,
      sessionId,
    });
    expect(stored).not.toBeNull();
    expect(stored?.mimeType).toBe("image/png");
    expect(stored?.bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
  });

  it.runIf(process.platform !== "win32")(
    "returns ADAPTER_FAILURE on non-Windows hosts when no capture provider is configured",
    async () => {
      const core = new HostCore({
        adapter: new WindowsAdapter(),
        authToken: AUTH_TOKEN,
      });
      const sessionId = await createSession(core, "hs-windows-non-win32");
      const response = await core.command({
        protocolVersion: PROTOCOL_VERSION,
        requestId: "cmd-windows-capture-non-win32",
        sessionId,
        command: {
          type: "screen.capture",
        },
      });
      expect(response.ok).toBe(false);
      if (response.ok) {
        return;
      }
      expect(response.error.code).toBe("ADAPTER_FAILURE");
      expect(response.error.details).toEqual(
        expect.objectContaining({
          message: "WINDOWS_SCREEN_CAPTURE_UNSUPPORTED_ON_NON_WINDOWS",
        }),
      );
    },
  );
});
