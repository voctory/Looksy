#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.LOOKSY_HOST_URL ?? "http://127.0.0.1:4064";
const DEFAULT_PROTOCOL_VERSION = process.env.LOOKSY_PROTOCOL_VERSION ?? "1.0.0";
const DEFAULT_TIMEOUT_MS = parseInteger(process.env.LOOKSY_TIMEOUT_MS, 10_000);
const JSON_ERRORS_ENABLED = process.argv.includes("--json");

main().catch((error) => {
  handleError(error, JSON_ERRORS_ENABLED);
});

async function main() {
  const argv = process.argv.slice(2);
  const { argsWithoutJsonFlag, jsonRequested } = stripStandaloneJsonFlag(argv);
  const { options: globalOptions, remaining } = parseGlobalOptions(argsWithoutJsonFlag);
  globalOptions.json = globalOptions.json || jsonRequested;

  if (remaining.length === 0 || remaining[0] === "help" || remaining[0] === "--help" || remaining[0] === "-h") {
    printHelp();
    return;
  }

  const command = remaining[0];
  const args = remaining.slice(1);

  switch (command) {
    case "handshake": {
      const payload = parseHandshakeArgs(args, globalOptions);
      const response = await postJson(globalOptions, "/v1/handshake", payload);
      printResult("handshake", response, globalOptions.json);
      return;
    }
    case "health": {
      const envelope = parseEnvelopeArgs(args);
      const response = await sendCommand(globalOptions, "health.ping", {}, envelope);
      printResult("health", response, globalOptions.json);
      return;
    }
    case "capabilities": {
      const envelope = parseEnvelopeArgs(args);
      const response = await sendCommand(globalOptions, "health.getCapabilities", {}, envelope);
      printResult("capabilities", response, globalOptions.json);
      return;
    }
    case "screenshot": {
      const { payload, envelope } = parseScreenshotArgs(args);
      const response = await sendCommand(globalOptions, "screen.capture", payload, envelope);
      printResult("screenshot", response, globalOptions.json);
      return;
    }
    case "windows": {
      if (args[0] !== "list") {
        throw new Error("Use `looksy windows list`.");
      }

      const { payload, envelope } = parseWindowsListArgs(args.slice(1));
      const response = await sendCommand(globalOptions, "app.listWindows", payload, envelope);
      printResult("app.listWindows", response, globalOptions.json);
      return;
    }
    case "command": {
      const { type, payload, envelope } = parseGenericCommandArgs(args);
      const response = await sendCommand(globalOptions, type, payload, envelope);
      printResult(type, response, globalOptions.json);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseGlobalOptions(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    authToken: process.env.LOOKSY_AUTH_TOKEN,
    sessionId: process.env.LOOKSY_SESSION_ID,
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
  };

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      break;
    }

    switch (token) {
      case "--host":
      case "--base-url":
        options.baseUrl = readFlagValue(argv, index, token);
        index += 2;
        break;
      case "--token":
        options.authToken = readFlagValue(argv, index, token);
        index += 2;
        break;
      case "--session-id":
        options.sessionId = readFlagValue(argv, index, token);
        index += 2;
        break;
      case "--protocol-version":
        options.protocolVersion = readFlagValue(argv, index, token);
        index += 2;
        break;
      case "--timeout-ms":
        options.timeoutMs = parseInteger(readFlagValue(argv, index, token), options.timeoutMs);
        index += 2;
        break;
      case "--json":
        options.json = true;
        index += 1;
        break;
      default:
        return {
          options,
          remaining: argv.slice(index),
        };
    }
  }

  return {
    options,
    remaining: argv.slice(index),
  };
}

function stripStandaloneJsonFlag(argv) {
  const argsWithoutJsonFlag = [];
  let jsonRequested = false;

  for (const token of argv) {
    if (token === "--json") {
      jsonRequested = true;
      continue;
    }

    argsWithoutJsonFlag.push(token);
  }

  return {
    argsWithoutJsonFlag,
    jsonRequested,
  };
}

function parseHandshakeArgs(args, globalOptions) {
  const parsed = parseKeyValueArgs(args, {
    "--protocol-version": "value",
    "--request-id": "value",
    "--client-name": "value",
    "--client-version": "value",
    "--capabilities": "value",
    "--auth-token": "value",
  });

  const capabilities = parsed.values["--capabilities"]
    ? parseCapabilities(parsed.values["--capabilities"])
    : undefined;

  const authToken = parsed.values["--auth-token"] ?? globalOptions.authToken;
  if (!authToken) {
    throw new Error("handshake requires auth token via --auth-token, --token, or LOOKSY_AUTH_TOKEN.");
  }

  return {
    protocolVersion: parsed.values["--protocol-version"] ?? globalOptions.protocolVersion,
    requestId: parsed.values["--request-id"] ?? createRequestId(),
    authToken,
    client: {
      name: parsed.values["--client-name"] ?? "looksy-cli",
      version: parsed.values["--client-version"] ?? "0.1.0",
    },
    requestedCapabilities: capabilities,
  };
}

function parseScreenshotArgs(args) {
  const parsed = parseKeyValueArgs(args, {
    "--format": "value",
    "--quality": "value",
    "--display-id": "value",
    "--include-cursor": "optional-boolean",
    "--request-id": "value",
    "--timeout-ms": "value",
    "--session-id": "value",
  });

  return {
    payload: compactObject({
      format: parsed.values["--format"],
      quality: parsed.values["--quality"] ? parseInteger(parsed.values["--quality"], undefined) : undefined,
      displayId: parsed.values["--display-id"],
      includeCursor: parsed.values["--include-cursor"],
    }),
    envelope: envelopeFromParsedValues(parsed.values),
  };
}

function parseWindowsListArgs(args) {
  const parsed = parseKeyValueArgs(args, {
    "--include-minimized": "optional-boolean",
    "--desktop-only": "optional-boolean",
    "--request-id": "value",
    "--timeout-ms": "value",
    "--session-id": "value",
  });

  return {
    payload: compactObject({
      includeMinimized: parsed.values["--include-minimized"],
      desktopOnly: parsed.values["--desktop-only"],
    }),
    envelope: envelopeFromParsedValues(parsed.values),
  };
}

function parseEnvelopeArgs(args) {
  const parsed = parseKeyValueArgs(args, {
    "--request-id": "value",
    "--timeout-ms": "value",
    "--session-id": "value",
  });

  return envelopeFromParsedValues(parsed.values);
}

function parseGenericCommandArgs(args) {
  if (args.length === 0 || args[0].startsWith("--")) {
    throw new Error("Usage: looksy command <type> [--payload <json>] [--request-id <id>] [--timeout-ms <ms>]");
  }

  const type = args[0];
  const parsed = parseKeyValueArgs(args.slice(1), {
    "--payload": "value",
    "--request-id": "value",
    "--timeout-ms": "value",
    "--session-id": "value",
  });

  const payload = parsed.values["--payload"] ? parseJson(parsed.values["--payload"], "--payload") : {};
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("--payload must be a JSON object.");
  }

  return {
    type,
    payload,
    envelope: envelopeFromParsedValues(parsed.values),
  };
}

function envelopeFromParsedValues(values) {
  return {
    requestId: values["--request-id"],
    timeoutMs: values["--timeout-ms"] ? parseInteger(values["--timeout-ms"], undefined) : undefined,
    sessionId: values["--session-id"],
  };
}

function parseKeyValueArgs(args, schema) {
  const values = {};
  let index = 0;

  while (index < args.length) {
    const token = args[index];
    const kind = schema[token];
    if (!kind) {
      throw new Error(`Unknown option: ${token}`);
    }

    if (kind === "optional-boolean") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        values[token] = true;
        index += 1;
        continue;
      }

      values[token] = parseBoolean(next, token);
      index += 2;
      continue;
    }

    values[token] = readFlagValue(args, index, token);
    index += 2;
  }

  return { values };
}

async function sendCommand(globalOptions, type, payload, envelopeOptions) {
  const sessionId = envelopeOptions.sessionId ?? globalOptions.sessionId;
  if (!sessionId) {
    throw new Error("command requires session id via --session-id or LOOKSY_SESSION_ID.");
  }

  return postJson(globalOptions, "/v1/command", {
    protocolVersion: globalOptions.protocolVersion,
    requestId: envelopeOptions.requestId ?? createRequestId(),
    sessionId,
    timeoutMs: envelopeOptions.timeoutMs,
    command: {
      type,
      ...payload,
    },
  });
}

async function postJson(globalOptions, path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${globalOptions.timeoutMs}ms`));
  }, globalOptions.timeoutMs);

  try {
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
    };

    if (globalOptions.authToken) {
      headers.authorization = `Bearer ${globalOptions.authToken}`;
    }

    const response = await fetch(`${stripTrailingSlash(globalOptions.baseUrl)}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(compactObject(body)),
      signal: controller.signal,
    });

    const text = await response.text();
    const parsed = text ? tryParseJson(text) : undefined;

    if (!response.ok) {
      const error = new Error(`Host request failed: ${response.status} ${response.statusText}`);
      error.status = response.status;
      error.response = parsed;
      throw error;
    }

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

function compactObject(value) {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return Object.fromEntries(entries);
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (value == null || value.startsWith("--")) {
    throw new Error(`Missing value for ${flagName}`);
  }
  return value;
}

function parseCapabilities(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("[")) {
    const parsed = parseJson(trimmed, "--capabilities");
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new Error("--capabilities JSON must be an array of strings.");
    }
    return parsed;
  }

  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseJson(value, flagName) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${flagName} must be valid JSON: ${error.message}`);
  }
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseBoolean(value, flagName) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${flagName} boolean values must be true or false.`);
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Expected an integer but received: ${value}`);
  }
  return parsed;
}

function stripTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function printResult(commandName, result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result && typeof result === "object" && "ok" in result) {
    const status = result.ok === false ? "error" : "ok";
    process.stdout.write(`[${status}] ${commandName}\n`);

    if (result.result !== undefined) {
      process.stdout.write(`${JSON.stringify(result.result, null, 2)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }

    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function handleError(error, json) {
  if (json) {
    const payload = {
      ok: false,
      error: {
        message: error.message,
        status: error.status,
        response: error.response,
      },
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exit(1);
    return;
  }

  process.stderr.write(`Error: ${error.message}\n`);
  if (error.response !== undefined) {
    process.stderr.write(`${JSON.stringify(error.response, null, 2)}\n`);
  }
  process.exit(1);
}

function printHelp() {
  const help = `
Looksy CLI

Usage:
  looksy [global options] handshake [options]
  looksy [global options] health [options]
  looksy [global options] capabilities [options]
  looksy [global options] screenshot [options]
  looksy [global options] windows list [options]
  looksy [global options] command <type> [options]

Global options:
  --host, --base-url <url>     Host base URL (default: ${DEFAULT_BASE_URL})
  --token <token>              Bearer token (default: LOOKSY_AUTH_TOKEN env var)
  --session-id <id>            Session ID for command calls (default: LOOKSY_SESSION_ID env var)
  --protocol-version <value>   Protocol version (default: ${DEFAULT_PROTOCOL_VERSION})
  --timeout-ms <ms>            HTTP timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})
  --json                       Emit compact machine-readable JSON output

handshake options:
  --protocol-version <value>   Override protocol version for this request
  --request-id <id>            Request ID (default: generated UUID)
  --client-name <name>         Client name (default: looksy-cli)
  --client-version <version>   Client version (default: 0.1.0)
  --capabilities <csv|json>    Requested capabilities list
  --auth-token <token>         Auth token for handshake body

command envelope options (supported by health/capabilities/screenshot/windows list/command):
  --session-id <id>            Override global session ID for this command
  --request-id <id>            Override request ID (default: generated UUID)
  --timeout-ms <ms>            Host command timeout

screenshot options:
  --format <png|jpeg>
  --quality <0-100>
  --display-id <id>
  --include-cursor [true|false]

windows list options:
  --include-minimized [true|false]
  --desktop-only [true|false]

generic command options:
  --payload <json-object>      Additional fields merged into command payload
`;

  process.stdout.write(help.trimStart());
  process.stdout.write("\n");
}
