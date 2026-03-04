import type { CommandResultPayload } from "../../protocol";
import type { AdapterCommandPayload, AdapterExecutionContext } from "../types";

const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";
const DEFAULT_CDP_TIMEOUT_MS = 10_000;
const MAX_CONSOLE_ENTRIES = 500;

type BrowserCommandType =
  | "browser.navigate"
  | "browser.snapshot"
  | "browser.pdf"
  | "browser.console"
  | "browser.trace.start"
  | "browser.trace.stop";
type BrowserResultType =
  | "browser.navigated"
  | "browser.snapshot"
  | "browser.pdf"
  | "browser.console"
  | "browser.traceStarted"
  | "browser.traceStopped";

export type WindowsBrowserBackendMode = "simulated" | "cdp";
export type WindowsBrowserCommandPayload = Extract<AdapterCommandPayload, { type: BrowserCommandType }>;
export type WindowsBrowserCommandResult = Extract<CommandResultPayload, { type: BrowserResultType }>;

type BrowserNavigateCommand = Extract<WindowsBrowserCommandPayload, { type: "browser.navigate" }>;
type BrowserSnapshotCommand = Extract<WindowsBrowserCommandPayload, { type: "browser.snapshot" }>;
type BrowserPdfCommand = Extract<WindowsBrowserCommandPayload, { type: "browser.pdf" }>;
type BrowserConsoleCommand = Extract<WindowsBrowserCommandPayload, { type: "browser.console" }>;
type BrowserTraceStartCommand = Extract<WindowsBrowserCommandPayload, { type: "browser.trace.start" }>;
type BrowserTraceStopCommand = Extract<WindowsBrowserCommandPayload, { type: "browser.trace.stop" }>;
type BrowserConsoleResult = Extract<WindowsBrowserCommandResult, { type: "browser.console" }>;
type BrowserConsoleEntry = BrowserConsoleResult["entries"][number];
type BrowserNavigationWaitUntil = NonNullable<BrowserNavigateCommand["waitUntil"]>;

type TraceState = {
  traceId: string;
  startedAtMs: number;
  eventCount: number;
};

type PendingCommand = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
  signal: AbortSignal;
  onAbort: () => void;
};

type EventWaiter = {
  method: string;
  predicate?: (params: Record<string, unknown>) => boolean;
  resolve: (params: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
  signal: AbortSignal;
  onAbort: () => void;
};

type CdpTarget = {
  type?: unknown;
  webSocketDebuggerUrl?: unknown;
};

export interface WindowsBrowserBackend {
  execute(command: WindowsBrowserCommandPayload, context: AdapterExecutionContext): Promise<WindowsBrowserCommandResult>;
}

export interface WindowsBrowserCdpBackendOptions {
  endpoint?: string;
  timeoutMs?: number;
}

export function isWindowsBrowserCommand(command: AdapterCommandPayload): command is WindowsBrowserCommandPayload {
  switch (command.type) {
    case "browser.navigate":
    case "browser.snapshot":
    case "browser.pdf":
    case "browser.console":
    case "browser.trace.start":
    case "browser.trace.stop":
      return true;
    default:
      return false;
  }
}

export class CdpWindowsBrowserBackend implements WindowsBrowserBackend {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private socket: WebSocket | null = null;
  private connectionPromise: Promise<void> | null = null;
  private readonly pendingCommands = new Map<number, PendingCommand>();
  private readonly eventWaiters = new Set<EventWaiter>();
  private readonly consoleEntries: BrowserConsoleEntry[] = [];
  private readonly activeTraceBySession = new Map<string, TraceState>();
  private nextCommandId = 1;
  private currentUrl = "about:blank";
  private currentTitle = "Looksy";

  constructor(options: WindowsBrowserCdpBackendOptions = {}) {
    this.endpoint = options.endpoint?.trim() || DEFAULT_CDP_ENDPOINT;
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  }

  async execute(command: WindowsBrowserCommandPayload, context: AdapterExecutionContext): Promise<WindowsBrowserCommandResult> {
    switch (command.type) {
      case "browser.navigate":
        return this.executeNavigate(command, context);
      case "browser.snapshot":
        return this.executeSnapshot(command, context);
      case "browser.pdf":
        return this.executePdf(command, context);
      case "browser.console":
        return this.executeConsole(command, context);
      case "browser.trace.start":
        return this.executeTraceStart(command, context);
      case "browser.trace.stop":
        return this.executeTraceStop(command, context);
      default:
        return assertNever(command);
    }
  }

  private async executeNavigate(
    command: BrowserNavigateCommand,
    context: AdapterExecutionContext,
  ): Promise<Extract<WindowsBrowserCommandResult, { type: "browser.navigated" }>> {
    await this.ensureConnected(context.signal);

    const waitUntil = command.waitUntil ?? "load";
    if (waitUntil === "networkidle") {
      await this.sendCommand("Page.setLifecycleEventsEnabled", { enabled: true }, context.signal);
    }
    const waitForLifecycle = this.waitForNavigationEvent(waitUntil, context.signal);

    const navigateResult = await this.sendCommand("Page.navigate", { url: command.url }, context.signal);
    if (isRecord(navigateResult) && typeof navigateResult.errorText === "string" && navigateResult.errorText.length > 0) {
      throw new Error(`WINDOWS_BROWSER_CDP_NAVIGATE_FAILED: ${navigateResult.errorText}`);
    }

    await waitForLifecycle;

    const pageInfo = await this.readPageInfo(context.signal);
    const navigatedAt = new Date().toISOString();
    this.currentUrl = pageInfo.url;
    this.currentTitle = pageInfo.title;
    return {
      type: "browser.navigated",
      url: this.currentUrl,
      title: this.currentTitle,
      navigatedAt,
    };
  }

  private async executeSnapshot(
    command: BrowserSnapshotCommand,
    context: AdapterExecutionContext,
  ): Promise<Extract<WindowsBrowserCommandResult, { type: "browser.snapshot" }>> {
    await this.ensureConnected(context.signal);
    const capturedAt = new Date().toISOString();
    const pageInfo = await this.readPageInfo(context.signal);
    this.currentUrl = pageInfo.url;
    this.currentTitle = pageInfo.title;

    let html: string | undefined;
    if (command.includeHtml !== false) {
      const evaluated = await this.evaluateValue(
        "document.documentElement ? document.documentElement.outerHTML : ''",
        context.signal,
      );
      const htmlValue = typeof evaluated === "string" ? evaluated : "";
      html = command.maxLength === undefined ? htmlValue : htmlValue.slice(0, command.maxLength);
    }

    return {
      type: "browser.snapshot",
      url: this.currentUrl,
      title: this.currentTitle,
      capturedAt,
      ...(command.includeHtml === false ? {} : { html: html ?? "" }),
    };
  }

  private async executePdf(
    command: BrowserPdfCommand,
    context: AdapterExecutionContext,
  ): Promise<Extract<WindowsBrowserCommandResult, { type: "browser.pdf" }>> {
    await this.ensureConnected(context.signal);
    const result = await this.sendCommand(
      "Page.printToPDF",
      {
        landscape: command.landscape ?? false,
        ...(command.pageRanges ? { pageRanges: command.pageRanges } : {}),
      },
      context.signal,
    );
    const dataBase64 = isRecord(result) && typeof result.data === "string" ? result.data : undefined;
    if (!dataBase64 || dataBase64.length === 0) {
      throw new Error("WINDOWS_BROWSER_CDP_PDF_EMPTY");
    }

    return {
      type: "browser.pdf",
      mimeType: "application/pdf",
      dataBase64,
      generatedAt: new Date().toISOString(),
    };
  }

  private async executeConsole(
    command: BrowserConsoleCommand,
    context: AdapterExecutionContext,
  ): Promise<Extract<WindowsBrowserCommandResult, { type: "browser.console" }>> {
    await this.ensureConnected(context.signal);
    const limit = command.limit ?? 50;
    const filtered = command.level
      ? this.consoleEntries.filter((entry) => entry.level === command.level)
      : this.consoleEntries;
    return {
      type: "browser.console",
      entries: filtered.slice(-limit),
    };
  }

  private async executeTraceStart(
    command: BrowserTraceStartCommand,
    context: AdapterExecutionContext,
  ): Promise<Extract<WindowsBrowserCommandResult, { type: "browser.traceStarted" }>> {
    await this.ensureConnected(context.signal);

    const traceId = `windows-cdp-${context.sessionId}-${context.requestId}`;
    const startedAt = new Date().toISOString();
    this.activeTraceBySession.set(context.sessionId, {
      traceId,
      startedAtMs: Date.now(),
      eventCount: 0,
    });
    this.pushConsoleEntry({
      level: "info",
      text: `Trace started (${command.traceName ?? traceId})`,
      timestamp: startedAt,
    });

    return {
      type: "browser.traceStarted",
      traceId,
      startedAt,
    };
  }

  private async executeTraceStop(
    command: BrowserTraceStopCommand,
    context: AdapterExecutionContext,
  ): Promise<Extract<WindowsBrowserCommandResult, { type: "browser.traceStopped" }>> {
    await this.ensureConnected(context.signal);
    const stoppedAt = new Date().toISOString();
    const activeTrace = this.activeTraceBySession.get(context.sessionId);
    if (activeTrace) {
      this.activeTraceBySession.delete(context.sessionId);
    }

    const traceId = command.traceId ?? activeTrace?.traceId ?? `windows-cdp-${context.sessionId}-trace`;
    const durationMs = Math.max(0, activeTrace ? Date.now() - activeTrace.startedAtMs : 0);
    const eventCount = activeTrace?.eventCount ?? 0;
    this.pushConsoleEntry({
      level: "info",
      text: `Trace stopped (${traceId})`,
      timestamp: stoppedAt,
    });

    return {
      type: "browser.traceStopped",
      traceId,
      stoppedAt,
      durationMs,
      eventCount,
    };
  }

  private async ensureConnected(signal: AbortSignal): Promise<void> {
    const socket = this.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectionPromise) {
      await waitForPromiseWithAbort(this.connectionPromise, signal);
      return;
    }

    const connecting = this.connect(signal);
    this.connectionPromise = connecting.finally(() => {
      if (this.connectionPromise === connecting) {
        this.connectionPromise = null;
      }
    });
    await waitForPromiseWithAbort(connecting, signal);
  }

  private async connect(signal: AbortSignal): Promise<void> {
    const webSocketUrl = await this.resolveWebSocketUrl(signal);
    const socket = await this.openSocket(webSocketUrl, signal);
    this.attachSocket(socket);
    this.socket = socket;
    try {
      await this.sendCommandRaw("Runtime.enable", {}, signal);
      await this.sendCommandRaw("Log.enable", {}, signal);
      await this.sendCommandRaw("Page.enable", {}, signal);
    } catch (error) {
      this.disconnect(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private attachSocket(socket: WebSocket): void {
    socket.addEventListener("message", (event: MessageEvent) => {
      this.handleSocketMessage(event.data);
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.disconnect(new Error("WINDOWS_BROWSER_CDP_SOCKET_CLOSED"));
      }
    });
    socket.addEventListener("error", () => {
      if (this.socket === socket) {
        this.disconnect(new Error("WINDOWS_BROWSER_CDP_SOCKET_ERROR"));
      }
    });
  }

  private async resolveWebSocketUrl(signal: AbortSignal): Promise<string> {
    try {
      const created = await this.fetchJson("/json/new?about:blank", { method: "PUT" }, signal);
      const createUrl = extractTargetWebSocketUrl(created);
      if (createUrl) {
        return createUrl;
      }
    } catch {
      // Fallback to an existing page target when target creation is unavailable.
    }

    const listed = await this.fetchJson("/json/list", {}, signal);
    if (!Array.isArray(listed)) {
      throw new Error("WINDOWS_BROWSER_CDP_TARGET_LIST_INVALID");
    }

    for (const candidate of listed) {
      const webSocketUrl = extractTargetWebSocketUrl(candidate);
      const type = isRecord(candidate) ? candidate.type : undefined;
      if (typeof webSocketUrl === "string" && webSocketUrl.length > 0 && type === "page") {
        return webSocketUrl;
      }
    }

    throw new Error("WINDOWS_BROWSER_CDP_PAGE_TARGET_UNAVAILABLE");
  }

  private async openSocket(webSocketUrl: string, signal: AbortSignal): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(webSocketUrl);
      let settled = false;

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };

      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(socket);
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        try {
          socket.close();
        } catch {
          // ignore close failures during setup
        }
        reject(error);
      };

      const onOpen = () => {
        resolveOnce();
      };

      const onError = () => {
        rejectOnce(new Error("WINDOWS_BROWSER_CDP_SOCKET_CONNECT_FAILED"));
      };

      const onAbort = () => {
        rejectOnce(new Error("Operation aborted"));
      };

      signal.addEventListener("abort", onAbort, { once: true });
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
    });
  }

  private async fetchJson(pathname: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const requestController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      requestController.abort(new Error("timeout"));
    }, this.timeoutMs);
    const onAbort = () => {
      requestController.abort(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(new URL(pathname, this.endpoint), {
        ...init,
        signal: requestController.signal,
      });
      if (!response.ok) {
        throw new Error(`WINDOWS_BROWSER_CDP_HTTP_${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (signal.aborted) {
        throw new Error("Operation aborted");
      }
      if (requestController.signal.aborted) {
        throw new Error("WINDOWS_BROWSER_CDP_HTTP_TIMEOUT");
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timeoutHandle);
      signal.removeEventListener("abort", onAbort);
    }
  }

  private async sendCommand(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    await this.ensureConnected(signal);
    return this.sendCommandRaw(method, params, signal);
  }

  private async sendCommandRaw(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("WINDOWS_BROWSER_CDP_SOCKET_NOT_CONNECTED");
    }
    if (signal.aborted) {
      throw new Error("Operation aborted");
    }

    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextCommandId++;
      const onAbort = () => {
        this.rejectPendingCommand(id, new Error("Operation aborted"));
      };
      const timeoutHandle = setTimeout(() => {
        this.rejectPendingCommand(id, new Error(`WINDOWS_BROWSER_CDP_TIMEOUT: ${method}`));
      }, this.timeoutMs);

      this.pendingCommands.set(id, {
        method,
        resolve,
        reject,
        timeoutHandle,
        signal,
        onAbort,
      });

      signal.addEventListener("abort", onAbort, { once: true });

      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.rejectPendingCommand(
          id,
          error instanceof Error ? error : new Error(`WINDOWS_BROWSER_CDP_SEND_FAILED: ${String(error)}`),
        );
      }
    });
  }

  private handleSocketMessage(messageData: unknown): void {
    const messageText = decodeMessageData(messageData);
    if (!messageText) {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(messageText);
    } catch {
      return;
    }

    if (!isRecord(payload)) {
      return;
    }

    if (typeof payload.id === "number") {
      this.handleCommandResponse(payload.id, payload);
      return;
    }

    if (typeof payload.method === "string") {
      const params = isRecord(payload.params) ? payload.params : {};
      this.handleEvent(payload.method, params);
    }
  }

  private handleCommandResponse(id: number, payload: Record<string, unknown>): void {
    const pending = this.pendingCommands.get(id);
    if (!pending) {
      return;
    }
    this.pendingCommands.delete(id);
    clearTimeout(pending.timeoutHandle);
    pending.signal.removeEventListener("abort", pending.onAbort);

    if (isRecord(payload.error)) {
      const message =
        typeof payload.error.message === "string" && payload.error.message.length > 0
          ? payload.error.message
          : "Unknown CDP error";
      pending.reject(new Error(`WINDOWS_BROWSER_CDP_${pending.method}_FAILED: ${message}`));
      return;
    }

    pending.resolve(payload.result);
  }

  private handleEvent(method: string, params: Record<string, unknown>): void {
    for (const trace of this.activeTraceBySession.values()) {
      trace.eventCount += 1;
    }

    if (method === "Runtime.consoleAPICalled") {
      this.captureRuntimeConsole(params);
    } else if (method === "Log.entryAdded") {
      this.captureLogEntry(params);
    } else if (method === "Page.frameNavigated") {
      this.captureFrameNavigation(params);
    }

    for (const waiter of Array.from(this.eventWaiters)) {
      if (waiter.method !== method) {
        continue;
      }
      if (waiter.predicate && !waiter.predicate(params)) {
        continue;
      }

      this.eventWaiters.delete(waiter);
      clearTimeout(waiter.timeoutHandle);
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(params);
    }
  }

  private captureRuntimeConsole(params: Record<string, unknown>): void {
    const level = mapRuntimeConsoleLevel(params.type);
    const timestamp = toIsoTimestamp(params.timestamp);
    const args = Array.isArray(params.args) ? params.args : [];
    const text = args
      .map((arg) => toConsoleTextFromRemoteObject(arg))
      .filter((value) => value.length > 0)
      .join(" ")
      .trim();
    this.pushConsoleEntry({
      level,
      text: text || "console",
      timestamp,
    });
  }

  private captureLogEntry(params: Record<string, unknown>): void {
    if (!isRecord(params.entry)) {
      return;
    }
    const level = mapLogEntryLevel(params.entry.level);
    const text = typeof params.entry.text === "string" && params.entry.text.length > 0 ? params.entry.text : "log";
    const timestamp = toIsoTimestamp(params.entry.timestamp);
    this.pushConsoleEntry({
      level,
      text,
      timestamp,
    });
  }

  private captureFrameNavigation(params: Record<string, unknown>): void {
    const frame = isRecord(params.frame) ? params.frame : undefined;
    if (!frame || typeof frame.url !== "string" || frame.url.length === 0) {
      return;
    }
    if (typeof frame.parentId === "string" && frame.parentId.length > 0) {
      return;
    }
    this.currentUrl = frame.url;
    this.currentTitle = deriveBrowserTitle(frame.url);
  }

  private pushConsoleEntry(entry: BrowserConsoleEntry): void {
    this.consoleEntries.push(entry);
    if (this.consoleEntries.length > MAX_CONSOLE_ENTRIES) {
      this.consoleEntries.splice(0, this.consoleEntries.length - MAX_CONSOLE_ENTRIES);
    }
  }

  private waitForNavigationEvent(
    waitUntil: BrowserNavigationWaitUntil,
    signal: AbortSignal,
  ): Promise<void> {
    switch (waitUntil) {
      case "domcontentloaded":
        return this.waitForEvent("Page.domContentEventFired", undefined, signal).then(() => undefined);
      case "networkidle":
        return this.waitForEvent("Page.lifecycleEvent", (params) => params.name === "networkIdle", signal).then(
          () => undefined,
        );
      case "load":
      default:
        return this.waitForEvent("Page.loadEventFired", undefined, signal).then(() => undefined);
    }
  }

  private waitForEvent(
    method: string,
    predicate: ((params: Record<string, unknown>) => boolean) | undefined,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (signal.aborted) {
      return Promise.reject(new Error("Operation aborted"));
    }

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const onAbort = () => {
        this.rejectEventWaiter(waiter, new Error("Operation aborted"));
      };
      const waiter: EventWaiter = {
        method,
        predicate,
        resolve,
        reject,
        timeoutHandle: setTimeout(() => {
          this.rejectEventWaiter(waiter, new Error(`WINDOWS_BROWSER_CDP_EVENT_TIMEOUT: ${method}`));
        }, this.timeoutMs),
        signal,
        onAbort,
      };
      this.eventWaiters.add(waiter);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private rejectPendingCommand(id: number, error: Error): void {
    const pending = this.pendingCommands.get(id);
    if (!pending) {
      return;
    }
    this.pendingCommands.delete(id);
    clearTimeout(pending.timeoutHandle);
    pending.signal.removeEventListener("abort", pending.onAbort);
    pending.reject(error);
  }

  private rejectEventWaiter(waiter: EventWaiter, error: Error): void {
    if (!this.eventWaiters.has(waiter)) {
      return;
    }
    this.eventWaiters.delete(waiter);
    clearTimeout(waiter.timeoutHandle);
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.reject(error);
  }

  private disconnect(error: Error): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.close();
      } catch {
        // ignore shutdown errors
      }
    }

    for (const id of Array.from(this.pendingCommands.keys())) {
      this.rejectPendingCommand(id, error);
    }
    for (const waiter of Array.from(this.eventWaiters)) {
      this.rejectEventWaiter(waiter, error);
    }
  }

  private async evaluateValue(expression: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.sendCommand(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      signal,
    );

    if (!isRecord(response)) {
      return undefined;
    }
    if ("exceptionDetails" in response && response.exceptionDetails !== undefined) {
      throw new Error("WINDOWS_BROWSER_CDP_EVALUATE_FAILED");
    }
    if (!isRecord(response.result)) {
      return undefined;
    }
    if ("value" in response.result) {
      return response.result.value;
    }
    return typeof response.result.description === "string" ? response.result.description : undefined;
  }

  private async readPageInfo(signal: AbortSignal): Promise<{ url: string; title: string }> {
    const value = await this.evaluateValue(
      "({ url: String(window.location.href), title: String(document.title || window.location.hostname || window.location.href) })",
      signal,
    );

    if (isRecord(value)) {
      const url = typeof value.url === "string" && value.url.length > 0 ? value.url : this.currentUrl;
      const title =
        typeof value.title === "string" && value.title.length > 0 ? value.title : deriveBrowserTitle(url || this.currentUrl);
      return {
        url: url || this.currentUrl,
        title: title || this.currentTitle,
      };
    }

    return {
      url: this.currentUrl,
      title: this.currentTitle,
    };
  }
}

function decodeMessageData(messageData: unknown): string | null {
  if (typeof messageData === "string") {
    return messageData;
  }
  if (messageData instanceof ArrayBuffer) {
    return Buffer.from(messageData).toString("utf8");
  }
  if (ArrayBuffer.isView(messageData)) {
    return Buffer.from(messageData.buffer, messageData.byteOffset, messageData.byteLength).toString("utf8");
  }
  if (Buffer.isBuffer(messageData)) {
    return messageData.toString("utf8");
  }
  return null;
}

function toConsoleTextFromRemoteObject(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }
  if ("value" in value && value.value !== undefined) {
    return String(value.value);
  }
  if (typeof value.unserializableValue === "string") {
    return value.unserializableValue;
  }
  if (typeof value.description === "string") {
    return value.description;
  }
  if (typeof value.type === "string") {
    return value.type;
  }
  return "";
}

function mapRuntimeConsoleLevel(level: unknown): BrowserConsoleEntry["level"] {
  if (level === "warning") {
    return "warn";
  }
  if (level === "error" || level === "assert") {
    return "error";
  }
  if (level === "debug") {
    return "debug";
  }
  return "info";
}

function mapLogEntryLevel(level: unknown): BrowserConsoleEntry["level"] {
  if (level === "verbose") {
    return "debug";
  }
  if (level === "warning") {
    return "warn";
  }
  if (level === "error") {
    return "error";
  }
  return "info";
}

function toIsoTimestamp(timestamp: unknown): string {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    const ms = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1_000;
    try {
      return new Date(ms).toISOString();
    } catch {
      // fall through to current time
    }
  }
  return new Date().toISOString();
}

function extractTargetWebSocketUrl(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.webSocketDebuggerUrl === "string" && value.webSocketDebuggerUrl.length > 0) {
    return value.webSocketDebuggerUrl;
  }
  const target = value as CdpTarget;
  if (typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.length > 0) {
    return target.webSocketDebuggerUrl;
  }
  return undefined;
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) {
    return DEFAULT_CDP_TIMEOUT_MS;
  }
  const normalized = Math.round(timeoutMs);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return DEFAULT_CDP_TIMEOUT_MS;
  }
  return normalized;
}

function deriveBrowserTitle(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    return url;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function waitForPromiseWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw new Error("Operation aborted");
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error("Operation aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled browser command: ${JSON.stringify(value)}`);
}
