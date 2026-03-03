import { describe, expect, it } from "vitest";
import { LooksyClient } from "../../client/ts/src/client.js";

describe("LooksyClient screenshot payload", () => {
  it("sends only protocol-supported screenshot fields", async () => {
    const sentBodies: unknown[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? "{}")));

      return new Response(
        JSON.stringify({
          protocolVersion: "1.0.0",
          requestId: "req_test",
          ok: true,
          result: {
            type: "screen.captured",
            artifactId: "artifact-1",
            mimeType: "image/png",
            capturedAt: new Date(0).toISOString(),
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    };

    const client = new LooksyClient({
      authToken: "token-fixture-valid",
      fetchImpl,
    });
    client.setSessionId("sess_123");

    const rawPayload = {
      format: "png",
      // Ensure runtime payload is filtered even if callers cast/forward extras.
      quality: 90,
      displayId: "display-1",
      includeCursor: true,
    };

    await client.screenshot(rawPayload as unknown as Parameters<LooksyClient["screenshot"]>[0]);

    const firstBody = sentBodies[0] as {
      command: Record<string, unknown>;
    };

    expect(firstBody.command).toEqual({
      type: "screen.capture",
      format: "png",
    });
    expect(firstBody.command).not.toHaveProperty("quality");
    expect(firstBody.command).not.toHaveProperty("displayId");
    expect(firstBody.command).not.toHaveProperty("includeCursor");
  });
});
