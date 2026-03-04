import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "../../protocol";
import { __windowsCaptureTestInternals, WindowsAdapter } from "../adapters/windows";
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
  it("uses DPI-aware virtual desktop bounds for default capture script", () => {
    const script = __windowsCaptureTestInternals.buildWindowsCapturePowerShellScript({
      format: "png",
      signal: new AbortController().signal,
    });
    expect(script).toContain("if (-not (\"LooksyDpiAwareness\" -as [type])) {");
    expect(script).toContain("[LooksyDpiAwareness]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))");
    expect(script).toContain("[LooksyDpiAwareness]::SetProcessDpiAwareness(2)");
    expect(script).toContain("[LooksyDpiAwareness]::SetProcessDPIAware()");
    expect(script).toContain("[System.Windows.Forms.SystemInformation]::VirtualScreen");
    expect(
      script.indexOf("[LooksyDpiAwareness]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))"),
    ).toBeLessThan(script.indexOf("[System.Windows.Forms.SystemInformation]::VirtualScreen"));
    expect(script.indexOf("[LooksyDpiAwareness]::SetProcessDPIAware()")).toBeLessThan(
      script.indexOf("$graphics.CopyFromScreen($rect.X, $rect.Y, 0, 0, $rect.Size)"),
    );
    expect(script).not.toContain("PrimaryScreen.Bounds");
  });

  it("keeps region override in capture script", () => {
    const script = __windowsCaptureTestInternals.buildWindowsCapturePowerShellScript({
      format: "png",
      region: {
        x: 20,
        y: 40,
        width: 300,
        height: 200,
        space: "screen-physical",
      },
      signal: new AbortController().signal,
    });
    expect(script).toContain("$rect = New-Object System.Drawing.Rectangle(20, 40, 300, 200)");
    expect(script).not.toContain("SystemInformation]::VirtualScreen");
  });

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

  it("preserves screen-physical capture regions without dip conversion", async () => {
    const captureBytes = Buffer.concat([PNG_SIGNATURE, Buffer.from([0x01])]);
    const captureScreen = vi.fn(async () => captureBytes);
    const screenDipToPhysicalPoint = vi.fn(
      async ({ point }: { point: { x: number; y: number; space: "screen-dip" } }) => ({
        x: point.x * 2,
        y: point.y * 2,
      }),
    );
    const core = new HostCore({
      adapter: new WindowsAdapter({
        captureScreen,
        screenDipToPhysicalPoint,
      }),
      authToken: AUTH_TOKEN,
    });
    const sessionId = await createSession(core, "hs-windows-capture-physical-region");
    const region = {
      x: 25,
      y: 35,
      width: 400,
      height: 240,
      space: "screen-physical" as const,
    };

    const response = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-windows-capture-physical-region",
      sessionId,
      command: {
        type: "screen.capture",
        region,
      },
    });
    expect(response.ok).toBe(true);
    if (!response.ok || response.result.type !== "screen.captured") {
      return;
    }

    expect(captureScreen).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "png",
        region,
      }),
    );
    expect(screenDipToPhysicalPoint).not.toHaveBeenCalled();
    expect(response.result.region).toEqual(region);
  });

  it("converts screen-dip capture region to screen-physical before capture", async () => {
    const captureBytes = Buffer.concat([PNG_SIGNATURE, Buffer.from([0x02])]);
    const captureScreen = vi.fn(async () => captureBytes);
    const screenDipToPhysicalPoint = vi.fn(
      async ({ point }: { point: { x: number; y: number; space: "screen-dip" } }) => ({
        x: point.x * 2 + 100,
        y: point.y * 3 + 50,
      }),
    );
    const core = new HostCore({
      adapter: new WindowsAdapter({
        captureScreen,
        screenDipToPhysicalPoint,
      }),
      authToken: AUTH_TOKEN,
    });
    const sessionId = await createSession(core, "hs-windows-capture-dip-region");

    const response = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-windows-capture-dip-region",
      sessionId,
      command: {
        type: "screen.capture",
        region: {
          x: 10,
          y: 20,
          width: 30,
          height: 40,
          space: "screen-dip",
        },
      },
    });
    expect(response.ok).toBe(true);
    if (!response.ok || response.result.type !== "screen.captured") {
      return;
    }

    expect(screenDipToPhysicalPoint).toHaveBeenCalledTimes(2);
    expect(screenDipToPhysicalPoint).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        point: {
          x: 10,
          y: 20,
          space: "screen-dip",
        },
      }),
    );
    expect(screenDipToPhysicalPoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        point: {
          x: 40,
          y: 60,
          space: "screen-dip",
        },
      }),
    );
    expect(captureScreen).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "png",
        region: {
          x: 120,
          y: 110,
          width: 60,
          height: 120,
          space: "screen-physical",
        },
      }),
    );
    expect(response.result.region).toEqual({
      x: 120,
      y: 110,
      width: 60,
      height: 120,
      space: "screen-physical",
    });
  });

  it("rejects window-client capture region space", async () => {
    const captureScreen = vi.fn(async () => Buffer.concat([PNG_SIGNATURE, Buffer.from([0x03])]));
    const screenDipToPhysicalPoint = vi.fn(
      async ({ point }: { point: { x: number; y: number; space: "screen-dip" } }) => ({
        x: point.x,
        y: point.y,
      }),
    );
    const core = new HostCore({
      adapter: new WindowsAdapter({
        captureScreen,
        screenDipToPhysicalPoint,
      }),
      authToken: AUTH_TOKEN,
    });
    const sessionId = await createSession(core, "hs-windows-capture-window-client-region");

    const response = await core.command({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-windows-capture-window-client-region",
      sessionId,
      command: {
        type: "screen.capture",
        region: {
          x: 1,
          y: 2,
          width: 30,
          height: 20,
          space: "window-client",
        },
      },
    });
    expect(response.ok).toBe(false);
    if (response.ok) {
      return;
    }
    expect(response.error.code).toBe("ADAPTER_FAILURE");
    expect(response.error.details).toEqual(
      expect.objectContaining({
        message: "WINDOWS_SCREEN_CAPTURE_WINDOW_CLIENT_UNSUPPORTED",
      }),
    );
    expect(captureScreen).not.toHaveBeenCalled();
    expect(screenDipToPhysicalPoint).not.toHaveBeenCalled();
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
