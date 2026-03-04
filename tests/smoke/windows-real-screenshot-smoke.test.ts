import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const RUN_REAL_SMOKE = process.env.LOOKSY_WINDOWS_REAL_SCREENSHOT_SMOKE === "1";
const SYNTHETIC_MARKER = Buffer.from("looksy-screenshot:windows:", "utf8");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

async function captureWindowsScreenshotPng(outputPath: string): Promise<void> {
  const powershellScript = `
$ErrorActionPreference = "Stop"
$outputPath = $args[0]
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ($bounds.Width -le 0 -or $bounds.Height -le 0) {
  throw "Virtual screen bounds are invalid."
}
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
  $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
`;

  await execFileAsync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      powershellScript,
      outputPath,
    ],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
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

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "looksy-win-shot-"));
    const screenshotPath = path.join(tempDir, "real-capture.png");

    try {
      await captureWindowsScreenshotPng(screenshotPath);
      const bytes = await readFile(screenshotPath);
      expect(bytes.length).toBeGreaterThan(0);
      expect(bytes.includes(SYNTHETIC_MARKER)).toBe(false);

      const dimensions = parsePngDimensions(bytes);
      expect(dimensions.width).toBeGreaterThan(0);
      expect(dimensions.height).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
