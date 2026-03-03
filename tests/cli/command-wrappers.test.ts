import { createServer, type IncomingMessage } from "node:http";
import { type AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CLI_PATH = resolve(REPO_ROOT, "cli", "looksy.js");
const DEFAULT_SESSION_ID = "sess_test_default";

interface RecordedRequest {
  method?: string;
  url?: string;
  body: Record<string, unknown>;
}

interface CliExecutionResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface CommandRunResult {
  execution: CliExecutionResult;
  requests: RecordedRequest[];
}

type ServerCloser = () => Promise<void>;

const closers: ServerCloser[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) {
    await close();
  }
});

describe("cli command wrappers", () => {
  it("builds observability.getMetrics envelope and prints JSON output", async () => {
    const run = await runCommand(["metrics"]);
    expect(run.execution.code).toBe(0);
    expect(run.execution.stderr).toBe("");
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0].url).toBe("/v1/command");
    expect(run.requests[0].body.command).toEqual({ type: "observability.getMetrics" });
    expect(run.requests[0].body.sessionId).toBe(DEFAULT_SESSION_ID);

    const output = JSON.parse(run.execution.stdout.trim()) as { ok: boolean; result: { type: string } };
    expect(output.ok).toBe(true);
    expect(output.result.type).toBe("observability.metrics");
  });

  it("builds app.focusWindow envelope from positional window id", async () => {
    const run = await runCommand(["focus-window", "win-main", "--request-id", "req-focus", "--timeout-ms", "3210"]);
    expect(run.execution.code).toBe(0);
    expect(run.execution.stderr).toBe("");
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0].body.requestId).toBe("req-focus");
    expect(run.requests[0].body.timeoutMs).toBe(3210);
    expect(run.requests[0].body.command).toEqual({
      type: "app.focusWindow",
      windowId: "win-main",
    });
  });

  it("builds screen.capture envelope with protocol-supported screenshot fields only", async () => {
    const run = await runCommand(["screenshot", "--format", "png", "--request-id", "req-shot"]);
    expect(run.execution.code).toBe(0);
    expect(run.execution.stderr).toBe("");
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0].body.requestId).toBe("req-shot");
    expect(run.requests[0].body.command).toEqual({
      type: "screen.capture",
      format: "png",
    });
  });

  it("builds element.find envelope with selector and window scope", async () => {
    const run = await runCommand(["find-element", "button.save", "--window-id", "win-main"]);
    expect(run.execution.code).toBe(0);
    expect(run.execution.stderr).toBe("");
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0].body.command).toEqual({
      type: "element.find",
      selector: "button.save",
      windowId: "win-main",
    });
  });

  it("builds element.invoke and element.setValue envelopes from wrapper args", async () => {
    const invoke = await runCommand(["invoke-element", "win-btn-save", "press"]);
    expect(invoke.execution.code).toBe(0);
    expect(invoke.execution.stderr).toBe("");
    expect(invoke.requests).toHaveLength(1);
    expect(invoke.requests[0].body.command).toEqual({
      type: "element.invoke",
      elementId: "win-btn-save",
      action: "press",
    });

    const setValue = await runCommand(["set-element-value", "--element-id", "win-input-search", "--value", "hello world"]);
    expect(setValue.execution.code).toBe(0);
    expect(setValue.execution.stderr).toBe("");
    expect(setValue.requests).toHaveLength(1);
    expect(setValue.requests[0].body.command).toEqual({
      type: "element.setValue",
      elementId: "win-input-search",
      value: "hello world",
    });
  });

  it("returns JSON errors for invalid wrapper arguments in --json mode", async () => {
    const run = await runCommand(["invoke-element", "win-btn-save", "click"]);
    expect(run.execution.code).toBe(1);
    expect(run.requests).toHaveLength(0);

    const errorPayload = JSON.parse(run.execution.stderr.trim()) as {
      ok: boolean;
      error: { message: string };
    };
    expect(errorPayload.ok).toBe(false);
    expect(errorPayload.error.message).toContain("--action must be one of");
  });

  it("rejects unsupported screenshot flags with a CLI error", async () => {
    const run = await runCommand(["screenshot", "--include-cursor"]);
    expect(run.execution.code).toBe(1);
    expect(run.requests).toHaveLength(0);

    const errorPayload = JSON.parse(run.execution.stderr.trim()) as {
      ok: boolean;
      error: { message: string };
    };
    expect(errorPayload.ok).toBe(false);
    expect(errorPayload.error.message).toContain("Unknown option: --include-cursor");
  });
});

async function runCommand(commandArgs: string[]): Promise<CommandRunResult> {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/command") {
      response.statusCode = 404;
      response.end();
      return;
    }

    const requestBody = await readRequestBody(request);
    const parsedBody = requestBody ? (JSON.parse(requestBody) as Record<string, unknown>) : {};
    requests.push({
      method: request.method,
      url: request.url,
      body: parsedBody,
    });

    const command = parsedBody.command as Record<string, unknown> | undefined;
    const requestId = (parsedBody.requestId as string | undefined) ?? "req_test";
    const resultType = String(command?.type ?? "");
    const resultPayload = buildResultPayload(resultType, command);

    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        protocolVersion: "1.0.0",
        requestId,
        ok: true,
        result: resultPayload,
      }),
    );
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address() as AddressInfo;
  closers.push(
    () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      }),
  );

  const execution = await executeCli([
    "--host",
    `http://127.0.0.1:${address.port}`,
    "--session-id",
    DEFAULT_SESSION_ID,
    "--json",
    ...commandArgs,
  ]);

  return {
    execution,
    requests,
  };
}

function executeCli(args: string[]): Promise<CliExecutionResult> {
  return new Promise((resolveExecution, rejectExecution) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", rejectExecution);
    child.on("close", (code) => {
      resolveExecution({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function buildResultPayload(commandType: string, command: Record<string, unknown> | undefined): Record<string, unknown> {
  switch (commandType) {
    case "observability.getMetrics":
      return {
        type: "observability.metrics",
        snapshot: {
          successCount: 1,
          failureCount: 0,
          successByCommand: { "observability.getMetrics": 1 },
          failureByCommand: {},
          failureByCode: {},
          latencyMs: {
            sampleCount: 1,
            minMs: 4,
            maxMs: 4,
            avgMs: 4,
          },
        },
      };
    case "app.focusWindow":
      return {
        type: "app.windowFocused",
        windowId: String(command?.windowId ?? ""),
        focused: true,
      };
    case "element.find":
      return {
        type: "element.found",
        elementId: "element-1",
        confidence: 0.95,
      };
    case "element.invoke":
      return {
        type: "element.invoked",
        elementId: String(command?.elementId ?? ""),
        action: String(command?.action ?? ""),
        invoked: true,
      };
    case "element.setValue":
      return {
        type: "element.valueSet",
        elementId: String(command?.elementId ?? ""),
        valueSet: true,
      };
    default:
      return {
        type: "health.pong",
        status: "ok",
        adapter: "macos",
        now: new Date(0).toISOString(),
      };
  }
}
