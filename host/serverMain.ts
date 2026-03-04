import { LocalHttpHostServer } from "./httpServer";
import { HostCore } from "./core";
import { MacOSAdapter } from "./adapters/macos";
import { WindowsAdapter } from "./adapters/windows";

const token = process.env.LOOKSY_AUTH_TOKEN ?? "token-fixture-valid";
const host = process.env.LOOKSY_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.LOOKSY_PORT ?? "4064", 10);
const platform = process.env.LOOKSY_PLATFORM === "windows" ? "windows" : "macos";
const windowsBrowserBackendMode = process.env.LOOKSY_WINDOWS_BROWSER_BACKEND === "cdp" ? "cdp" : "simulated";
const windowsCdpEndpoint = process.env.LOOKSY_WINDOWS_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const windowsCdpTimeoutMs = parseOptionalPositiveInt(process.env.LOOKSY_WINDOWS_CDP_TIMEOUT_MS);

const adapter =
  platform === "windows"
    ? new WindowsAdapter(
        windowsBrowserBackendMode === "cdp"
          ? {
              browserBackendMode: "cdp",
              browserCdp: {
                endpoint: windowsCdpEndpoint,
                ...(windowsCdpTimeoutMs !== undefined ? { timeoutMs: windowsCdpTimeoutMs } : {}),
              },
            }
          : {},
      )
    : new MacOSAdapter();
const core = new HostCore({ adapter, authToken: token });
const server = new LocalHttpHostServer({ core, host, port });

async function main(): Promise<void> {
  const address = await server.start();
  console.log(
    JSON.stringify({
      event: "looksy.host.started",
      host: address.host,
      port: address.port,
      platform,
    }),
  );
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "looksy.host.failed",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}
