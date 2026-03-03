import http from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import { PROTOCOL_VERSION, createProtocolError, type CommandResultEnvelope, type HandshakeResultEnvelope } from "../protocol";
import type { HostCore } from "./core";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export interface LocalHttpHostServerOptions {
  core: HostCore;
  host?: string;
  port?: number;
  maxBodyBytes?: number;
}

export interface LocalHttpHostServerAddress {
  host: string;
  port: number;
}

export class LocalHttpHostServer {
  private readonly core: HostCore;
  private readonly host: string;
  private readonly port: number;
  private readonly maxBodyBytes: number;
  private server?: http.Server;

  constructor(options: LocalHttpHostServerOptions) {
    this.core = options.core;
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 0;
    this.maxBodyBytes = options.maxBodyBytes ?? 1_000_000;

    if (!LOOPBACK_HOSTS.has(this.host)) {
      throw new Error(`Host must be loopback-only. Received '${this.host}'`);
    }
  }

  async start(): Promise<LocalHttpHostServerAddress> {
    if (this.server?.listening) {
      const address = this.server.address() as AddressInfo;
      return { host: this.host, port: address.port };
    }

    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, this.host, () => {
        this.server?.off("error", reject);
        resolve();
      });
    });

    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to resolve server address");
    }

    return { host: this.host, port: address.port };
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (!request.url || request.method !== "POST") {
      this.writePlain(response, 404, "Not Found");
      return;
    }

    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== "/v1/handshake" && url.pathname !== "/v1/command") {
      this.writePlain(response, 404, "Not Found");
      return;
    }

    const body = await this.readJsonBody(request);
    if (body.kind === "error") {
      const envelope = {
        protocolVersion: PROTOCOL_VERSION,
        requestId: "unknown",
        ok: false as const,
        error: createProtocolError("VALIDATION_FAILED", body.message),
      };
      this.writeJson(response, 400, envelope);
      return;
    }

    if (url.pathname === "/v1/handshake") {
      const result = this.core.handshake(body.value);
      this.writeJson(response, getStatusCode(result), result);
      return;
    }

    const result = await this.core.command(body.value);
    this.writeJson(response, getStatusCode(result), result);
  }

  private async readJsonBody(request: http.IncomingMessage): Promise<{ kind: "ok"; value: unknown } | { kind: "error"; message: string }> {
    const chunks: Buffer[] = [];
    let size = 0;

    for await (const chunk of request) {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(bufferChunk);
      size += bufferChunk.byteLength;

      if (size > this.maxBodyBytes) {
        return { kind: "error", message: "Request body exceeds max size" };
      }
    }

    if (size === 0) {
      return { kind: "error", message: "Request body is empty" };
    }

    try {
      const text = Buffer.concat(chunks).toString("utf8");
      return { kind: "ok", value: JSON.parse(text) };
    } catch {
      return { kind: "error", message: "Request body must be valid JSON" };
    }
  }

  private writeJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
  }

  private writePlain(response: http.ServerResponse, statusCode: number, body: string): void {
    response.statusCode = statusCode;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end(body);
  }
}

function getStatusCode(envelope: HandshakeResultEnvelope | CommandResultEnvelope): number {
  if (envelope.ok) {
    return 200;
  }

  switch (envelope.error.code) {
    case "AUTH_FAILED":
      return 401;
    case "POLICY_DENIED":
      return 403;
    case "VALIDATION_FAILED":
    case "UNSUPPORTED_VERSION":
    case "UNKNOWN_COMMAND":
      return 400;
    case "TIMEOUT":
      return 408;
    case "CANCELLED":
      return 409;
    case "ADAPTER_FAILURE":
    case "INTERNAL":
      return 500;
    default:
      return 500;
  }
}
