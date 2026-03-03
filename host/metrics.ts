import type { ErrorCode, MetricsSnapshot } from "../protocol";

export interface HostMetricsRecorder {
  recordSuccess(commandType: string, latencyMs: number, platform: string): void;
  recordFailure(commandType: string, latencyMs: number, platform: string, errorCode: ErrorCode): void;
  snapshot?(): HostMetricsSnapshot;
}

export type HostMetricsSnapshot = MetricsSnapshot;

export class InMemoryMetricsRecorder implements HostMetricsRecorder {
  private successCount = 0;
  private failureCount = 0;
  private readonly successByCommand = new Map<string, number>();
  private readonly failureByCommand = new Map<string, number>();
  private readonly failureByCode = new Map<string, number>();
  private latencySampleCount = 0;
  private latencyTotalMs = 0;
  private latencyMinMs = Number.POSITIVE_INFINITY;
  private latencyMaxMs = 0;

  recordSuccess(commandType: string, latencyMs: number, _platform: string): void {
    this.successCount += 1;
    this.successByCommand.set(commandType, (this.successByCommand.get(commandType) ?? 0) + 1);
    this.recordLatency(latencyMs);
  }

  recordFailure(commandType: string, latencyMs: number, _platform: string, errorCode: ErrorCode): void {
    this.failureCount += 1;
    this.failureByCommand.set(commandType, (this.failureByCommand.get(commandType) ?? 0) + 1);
    this.failureByCode.set(errorCode, (this.failureByCode.get(errorCode) ?? 0) + 1);
    this.recordLatency(latencyMs);
  }

  snapshot(): HostMetricsSnapshot {
    const hasSamples = this.latencySampleCount > 0;
    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      successByCommand: Object.fromEntries(this.successByCommand.entries()),
      failureByCommand: Object.fromEntries(this.failureByCommand.entries()),
      failureByCode: Object.fromEntries(this.failureByCode.entries()),
      latencyMs: {
        sampleCount: this.latencySampleCount,
        minMs: hasSamples ? this.latencyMinMs : 0,
        maxMs: hasSamples ? this.latencyMaxMs : 0,
        avgMs: hasSamples ? this.latencyTotalMs / this.latencySampleCount : 0,
      },
    };
  }

  private recordLatency(latencyMs: number): void {
    const normalizedLatencyMs = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0;
    this.latencySampleCount += 1;
    this.latencyTotalMs += normalizedLatencyMs;
    this.latencyMinMs = Math.min(this.latencyMinMs, normalizedLatencyMs);
    this.latencyMaxMs = Math.max(this.latencyMaxMs, normalizedLatencyMs);
  }
}
