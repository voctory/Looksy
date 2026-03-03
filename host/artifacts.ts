export interface HostArtifactRecord {
  artifactId: string;
  mimeType: string;
  bytes: Buffer;
  capturedAt: string;
  createdAtMs: number;
}

export interface PutArtifactInput {
  artifactId: string;
  mimeType: string;
  bytes: Buffer;
  capturedAt: string;
}

export interface HostArtifactStore {
  put(input: PutArtifactInput): void;
  get(artifactId: string): HostArtifactRecord | null;
}

export interface InMemoryArtifactStoreOptions {
  maxEntries?: number;
  ttlMs?: number;
}

export class InMemoryArtifactStore implements HostArtifactStore {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly records = new Map<string, HostArtifactRecord>();

  constructor(options: InMemoryArtifactStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 256;
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  }

  put(input: PutArtifactInput): void {
    this.pruneExpired(Date.now());
    const now = Date.now();
    this.records.set(input.artifactId, {
      artifactId: input.artifactId,
      mimeType: input.mimeType,
      bytes: input.bytes,
      capturedAt: input.capturedAt,
      createdAtMs: now,
    });
    this.enforceMaxEntries();
  }

  get(artifactId: string): HostArtifactRecord | null {
    const now = Date.now();
    this.pruneExpired(now);
    return this.records.get(artifactId) ?? null;
  }

  private pruneExpired(now: number): void {
    for (const [artifactId, record] of this.records.entries()) {
      if (now - record.createdAtMs >= this.ttlMs) {
        this.records.delete(artifactId);
      }
    }
  }

  private enforceMaxEntries(): void {
    while (this.records.size > this.maxEntries) {
      const oldestKey = this.records.keys().next().value;
      if (typeof oldestKey !== "string") {
        break;
      }
      this.records.delete(oldestKey);
    }
  }
}
