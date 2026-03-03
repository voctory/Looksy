import type { AdapterCommandPayload } from "../types";

export interface SimulatedAdapterOptions {
  delayMsByCommand?: Partial<Record<AdapterCommandPayload["type"], number>>;
}

export interface SimulatedElement {
  elementId: string;
  selector: string;
  windowId: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    space: "window-client";
  };
}

export async function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("Operation aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("Operation aborted");
  }
}

export function mimeTypeForFormat(format: "png" | "jpeg" | undefined): string {
  if (format === "jpeg") {
    return "image/jpeg";
  }

  return "image/png";
}
