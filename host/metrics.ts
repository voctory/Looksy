import type { ErrorCode } from "../protocol";

export interface HostMetricsRecorder {
  recordSuccess(commandType: string, latencyMs: number, platform: string): void;
  recordFailure(commandType: string, latencyMs: number, platform: string, errorCode: ErrorCode): void;
}

export interface HostMetricsSnapshot {
  successCount: number;
  failureCount: number;
  successByCommand: Record<string, number>;
  failureByCommand: Record<string, number>;
  failureByCode: Record<string, number>;
}

export class InMemoryMetricsRecorder implements HostMetricsRecorder {
  private successCount = 0;
  private failureCount = 0;
  private readonly successByCommand = new Map<string, number>();
  private readonly failureByCommand = new Map<string, number>();
  private readonly failureByCode = new Map<string, number>();

  recordSuccess(commandType: string): void {
    this.successCount += 1;
    this.successByCommand.set(commandType, (this.successByCommand.get(commandType) ?? 0) + 1);
  }

  recordFailure(commandType: string, _latencyMs: number, _platform: string, errorCode: ErrorCode): void {
    this.failureCount += 1;
    this.failureByCommand.set(commandType, (this.failureByCommand.get(commandType) ?? 0) + 1);
    this.failureByCode.set(errorCode, (this.failureByCode.get(errorCode) ?? 0) + 1);
  }

  snapshot(): HostMetricsSnapshot {
    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      successByCommand: Object.fromEntries(this.successByCommand.entries()),
      failureByCommand: Object.fromEntries(this.failureByCommand.entries()),
      failureByCode: Object.fromEntries(this.failureByCode.entries()),
    };
  }
}
