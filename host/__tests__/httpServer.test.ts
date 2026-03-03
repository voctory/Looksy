import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../../protocol";
import { MacOSAdapter } from "../adapters/macos";
import { HostCore } from "../core";
import { LocalHttpHostServer } from "../httpServer";

const AUTH_TOKEN = "http-token";

describe("LocalHttpHostServer", () => {
  const servers: LocalHttpHostServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    servers.length = 0;
  });

  it("binds only to loopback hosts", () => {
    const core = new HostCore({ adapter: new MacOSAdapter(), authToken: AUTH_TOKEN });
    expect(() => {
      new LocalHttpHostServer({
        core,
        host: "0.0.0.0",
      });
    }).toThrow(/loopback-only/);
  });

  it("serves handshake and command endpoints", async () => {
    const core = new HostCore({
      adapter: new MacOSAdapter(),
      authToken: AUTH_TOKEN,
      sessionIdFactory: () => "session-http",
      now: () => new Date("2026-03-03T00:00:00.000Z"),
    });

    const server = new LocalHttpHostServer({
      core,
      host: "127.0.0.1",
      port: 0,
    });
    servers.push(server);

    const address = await server.start();
    const baseUrl = `http://${address.host}:${address.port}`;

    const handshakeResponse = await fetch(`${baseUrl}/v1/handshake`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        requestId: "hs-http",
        authToken: AUTH_TOKEN,
        client: {
          name: "tests",
          version: "1.0.0",
        },
      }),
    });

    expect(handshakeResponse.status).toBe(200);
    const handshakePayload = (await handshakeResponse.json()) as {
      ok: boolean;
      session?: { sessionId: string };
    };
    expect(handshakePayload.ok).toBe(true);

    const commandResponse = await fetch(`${baseUrl}/v1/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        requestId: "cmd-http",
        sessionId: handshakePayload.session?.sessionId,
        command: {
          type: "input.moveMouse",
          point: {
            x: 12,
            y: 24,
            space: "screen-dip",
          },
        },
      }),
    });

    expect(commandResponse.status).toBe(200);
    const commandPayload = (await commandResponse.json()) as {
      ok: boolean;
      result?: { type: string };
    };
    expect(commandPayload.ok).toBe(true);
    expect(commandPayload.result?.type).toBe("input.mouseMoved");
  });

  it("returns 401 for unauthorized handshake", async () => {
    const core = new HostCore({ adapter: new MacOSAdapter(), authToken: AUTH_TOKEN });
    const server = new LocalHttpHostServer({ core, host: "127.0.0.1", port: 0 });
    servers.push(server);

    const address = await server.start();
    const response = await fetch(`http://${address.host}:${address.port}/v1/handshake`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        requestId: "hs-invalid",
        authToken: "wrong-token",
        client: {
          name: "tests",
          version: "1.0.0",
        },
      }),
    });

    expect(response.status).toBe(401);
    const payload = (await response.json()) as { ok: boolean; error?: { code: string } };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("AUTH_FAILED");
  });
});
