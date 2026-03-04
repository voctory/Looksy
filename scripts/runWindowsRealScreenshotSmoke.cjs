const path = require("node:path");
const { spawnSync } = require("node:child_process");

const vitestEntrypoint = path.resolve(__dirname, "..", "node_modules", "vitest", "vitest.mjs");
const smokeTestPath = path.resolve(__dirname, "..", "tests", "smoke", "windows-real-screenshot-smoke.test.ts");

const result = spawnSync(process.execPath, [vitestEntrypoint, "run", smokeTestPath], {
  stdio: "inherit",
  env: {
    ...process.env,
    LOOKSY_WINDOWS_REAL_SCREENSHOT_SMOKE: "1",
  },
});

if (result.error) {
  console.error("[looksy] failed to run Windows screenshot smoke test:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
