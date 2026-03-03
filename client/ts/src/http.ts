export interface HttpPostOptions {
  baseUrl: string;
  path: string;
  body: unknown;
  authToken?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}

export class LooksyHttpError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: unknown;

  public constructor(message: string, statusCode: number, responseBody?: unknown) {
    super(message);
    this.name = "LooksyHttpError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export async function postJson<TResponse>(options: HttpPostOptions): Promise<TResponse> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("No fetch implementation available. Provide options.fetchImpl.");
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${options.timeoutMs}ms`));
  }, options.timeoutMs);

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      ...(options.defaultHeaders ?? {}),
    };

    if (options.authToken) {
      headers.authorization = `Bearer ${options.authToken}`;
    }

    const response = await fetchImpl(`${options.baseUrl}${options.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });

    const text = await response.text();
    const parsedBody = parseResponseBody(text);

    if (!response.ok) {
      throw new LooksyHttpError(
        `Host request failed with ${response.status} ${response.statusText}`,
        response.status,
        parsedBody,
      );
    }

    return parsedBody as TResponse;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function parseResponseBody(text: string): unknown {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
