import { describe, expect, it } from "vitest";
import { CommandEnvelopeSchema, HandshakeRequestSchema, PROTOCOL_VERSION } from "./index";

describe("protocol schemas", () => {
  it("validates handshake payloads", () => {
    const payload = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: "hs-1",
      authToken: "token",
      client: {
        name: "tests",
        version: "1.0.0",
      },
    };

    const parsed = HandshakeRequestSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("requires coordinate-space annotations for point payloads", () => {
    const parsed = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cmd-1",
      sessionId: "session-1",
      command: {
        type: "input.moveMouse",
        point: {
          x: 10,
          y: 20,
        },
      },
    });

    expect(parsed.success).toBe(false);
  });
});
