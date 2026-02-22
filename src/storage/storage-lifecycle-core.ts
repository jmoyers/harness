import { createHash } from 'node:crypto';
import type { NormalizedEventEnvelope } from '../events/normalized-events.ts';

const DEFAULT_EVENT_RETENTION_MS = 72 * 60 * 60 * 1000;
const DEFAULT_TELEMETRY_RETENTION_MS = 72 * 60 * 60 * 1000;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 5000;
const DEFAULT_PRUNE_BATCH_SIZE = 2000;
const DEFAULT_COMPACT_FREELIST_PAGES = 256;
const DEFAULT_COPY_FORWARD_BATCH_SIZE = 5000;
const DEFAULT_COPY_FORWARD_FINALIZE_TAIL_ROWS = 1200;
const DEFAULT_TELEMETRY_PAYLOAD_MAX_BYTES = 16 * 1024;
const DEFAULT_TEXT_DELTA_PAYLOAD_MAX_BYTES = 32 * 1024;
const DEFAULT_TEXT_DELTA_COALESCE_WINDOW_MS = 1200;

export interface StorageLifecyclePolicy {
  readonly eventRetentionMs: number;
  readonly telemetryRetentionMs: number;
  readonly maintenanceIntervalMs: number;
  readonly pruneBatchSize: number;
  readonly compactFreelistPages: number;
  readonly copyForwardBatchSize: number;
  readonly copyForwardFinalizeTailRows: number;
  readonly telemetryPayloadMaxBytes: number;
  readonly textDeltaPayloadMaxBytes: number;
  readonly textDeltaCoalesceWindowMs: number;
}

interface StorageLifecycleCompactionStepResult {
  readonly state: 'idle' | 'copying' | 'finalized';
  readonly copiedRows: number;
}

export interface StorageLifecycleEventStore {
  pruneEventsOlderThan(cutoffTs: string, limit: number): number;
  checkpointWalTruncate(): void;
  compactFreelistPages(maxPages: number): void;
  runOnlineCopyForwardCompactionStep?(
    batchSize: number,
    finalizeTailRows: number,
  ): StorageLifecycleCompactionStepResult;
}

export interface StorageLifecycleTelemetryStore {
  pruneTelemetryOlderThan(cutoffIngestedAt: string, limit: number): number;
  checkpointWalTruncate(): void;
  compactFreelistPages(maxPages: number): void;
  runOnlineCopyForwardCompactionStep?(
    batchSize: number,
    finalizeTailRows: number,
  ): StorageLifecycleCompactionStepResult;
}

interface StorageLifecycleCoreOptions {
  readonly eventStore?: StorageLifecycleEventStore | null;
  readonly telemetryStore?: StorageLifecycleTelemetryStore | null;
  readonly policy?: Partial<StorageLifecyclePolicy>;
  readonly nowMs?: () => number;
  readonly writeStderr?: (text: string) => void;
}

interface StorageLifecycleMaintenanceResult {
  readonly ran: boolean;
  readonly eventsPruned: number;
  readonly telemetryPruned: number;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizePolicy(
  policy: Partial<StorageLifecyclePolicy> | undefined,
): StorageLifecyclePolicy {
  return {
    eventRetentionMs: normalizePositiveInt(policy?.eventRetentionMs, DEFAULT_EVENT_RETENTION_MS),
    telemetryRetentionMs: normalizePositiveInt(
      policy?.telemetryRetentionMs,
      DEFAULT_TELEMETRY_RETENTION_MS,
    ),
    maintenanceIntervalMs: normalizePositiveInt(
      policy?.maintenanceIntervalMs,
      DEFAULT_MAINTENANCE_INTERVAL_MS,
    ),
    pruneBatchSize: normalizePositiveInt(policy?.pruneBatchSize, DEFAULT_PRUNE_BATCH_SIZE),
    compactFreelistPages: normalizePositiveInt(
      policy?.compactFreelistPages,
      DEFAULT_COMPACT_FREELIST_PAGES,
    ),
    copyForwardBatchSize: normalizePositiveInt(
      policy?.copyForwardBatchSize,
      DEFAULT_COPY_FORWARD_BATCH_SIZE,
    ),
    copyForwardFinalizeTailRows: normalizePositiveInt(
      policy?.copyForwardFinalizeTailRows,
      DEFAULT_COPY_FORWARD_FINALIZE_TAIL_ROWS,
    ),
    telemetryPayloadMaxBytes: normalizePositiveInt(
      policy?.telemetryPayloadMaxBytes,
      DEFAULT_TELEMETRY_PAYLOAD_MAX_BYTES,
    ),
    textDeltaPayloadMaxBytes: normalizePositiveInt(
      policy?.textDeltaPayloadMaxBytes,
      DEFAULT_TEXT_DELTA_PAYLOAD_MAX_BYTES,
    ),
    textDeltaCoalesceWindowMs: normalizePositiveInt(
      policy?.textDeltaCoalesceWindowMs,
      DEFAULT_TEXT_DELTA_COALESCE_WINDOW_MS,
    ),
  };
}

function parseIsoMs(value: string): number | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

function asTextDeltaEvent(event: NormalizedEventEnvelope):
  | (NormalizedEventEnvelope & {
      readonly source: 'provider';
      readonly type: 'provider-text-delta';
      readonly payload: {
        readonly kind: 'text-delta';
        readonly threadId: string;
        readonly turnId: string;
        readonly delta: string;
      };
    })
  | null {
  if (event.source !== 'provider' || event.type !== 'provider-text-delta') {
    return null;
  }
  if (event.payload.kind !== 'text-delta') {
    return null;
  }
  if (
    typeof event.payload.threadId !== 'string' ||
    typeof event.payload.turnId !== 'string' ||
    typeof event.payload.delta !== 'string'
  ) {
    return null;
  }
  return event as NormalizedEventEnvelope & {
    readonly source: 'provider';
    readonly type: 'provider-text-delta';
    readonly payload: {
      readonly kind: 'text-delta';
      readonly threadId: string;
      readonly turnId: string;
      readonly delta: string;
    };
  };
}

function sameEventScope(left: NormalizedEventEnvelope, right: NormalizedEventEnvelope): boolean {
  return (
    left.scope.tenantId === right.scope.tenantId &&
    left.scope.userId === right.scope.userId &&
    left.scope.workspaceId === right.scope.workspaceId &&
    left.scope.worktreeId === right.scope.worktreeId &&
    left.scope.conversationId === right.scope.conversationId &&
    (left.scope.turnId ?? null) === (right.scope.turnId ?? null)
  );
}

export class StorageLifecycleCore {
  private readonly eventStore: StorageLifecycleEventStore | null;
  private readonly telemetryStore: StorageLifecycleTelemetryStore | null;
  private readonly policyValues: StorageLifecyclePolicy;
  private readonly nowMs: () => number;
  private readonly writeStderr: (text: string) => void;
  private nextMaintenanceAtMs = 0;

  constructor(options: StorageLifecycleCoreOptions = {}) {
    this.eventStore = options.eventStore ?? null;
    this.telemetryStore = options.telemetryStore ?? null;
    this.policyValues = normalizePolicy(options.policy);
    this.nowMs = options.nowMs ?? Date.now;
    this.writeStderr = options.writeStderr ?? ((text) => process.stderr.write(text));
  }

  policy(): StorageLifecyclePolicy {
    return this.policyValues;
  }

  prepareEventBatch(
    events: readonly NormalizedEventEnvelope[],
  ): readonly NormalizedEventEnvelope[] {
    if (events.length < 2) {
      return events;
    }
    const merged: NormalizedEventEnvelope[] = [];
    for (const event of events) {
      const previous = merged.length === 0 ? null : merged[merged.length - 1]!;
      if (previous === null) {
        merged.push(event);
        continue;
      }

      const left = asTextDeltaEvent(previous);
      const right = asTextDeltaEvent(event);
      if (left === null || right === null) {
        merged.push(event);
        continue;
      }
      if (!sameEventScope(left, right)) {
        merged.push(event);
        continue;
      }
      if (
        left.payload.threadId !== right.payload.threadId ||
        left.payload.turnId !== right.payload.turnId
      ) {
        merged.push(event);
        continue;
      }

      const leftMs = parseIsoMs(left.ts);
      const rightMs = parseIsoMs(right.ts);
      if (leftMs === null || rightMs === null) {
        merged.push(event);
        continue;
      }
      if (rightMs < leftMs || rightMs - leftMs > this.policyValues.textDeltaCoalesceWindowMs) {
        merged.push(event);
        continue;
      }

      const mergedDelta = `${left.payload.delta}${right.payload.delta}`;
      const mergedBytes = Buffer.byteLength(mergedDelta, 'utf8');
      if (mergedBytes > this.policyValues.textDeltaPayloadMaxBytes) {
        merged.push(event);
        continue;
      }

      const nextEvent: NormalizedEventEnvelope = {
        ...left,
        ts: right.ts,
        payload: {
          ...left.payload,
          delta: mergedDelta,
        },
      };
      merged[merged.length - 1] = nextEvent;
    }
    return merged;
  }

  prepareTelemetryPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const serialized = safeJsonStringify(payload);
    const serializedBytes = Buffer.byteLength(serialized, 'utf8');
    if (serializedBytes <= this.policyValues.telemetryPayloadMaxBytes) {
      return payload;
    }

    const metadata = {
      truncated: true,
      originalBytes: serializedBytes,
      maxBytes: this.policyValues.telemetryPayloadMaxBytes,
      sha256: createHash('sha256').update(serialized).digest('hex'),
    };

    let previewChars = Math.min(serialized.length, 4096);
    while (previewChars > 0) {
      const candidate: Record<string, unknown> = {
        storageLifecycle: metadata,
        previewJson: serialized.slice(0, previewChars),
      };
      const candidateBytes = Buffer.byteLength(safeJsonStringify(candidate), 'utf8');
      if (candidateBytes <= this.policyValues.telemetryPayloadMaxBytes) {
        return candidate;
      }
      previewChars = Math.floor(previewChars / 2);
    }

    return {
      storageLifecycle: metadata,
    };
  }

  runMaintenanceTick(): StorageLifecycleMaintenanceResult {
    const nowMs = this.nowMs();
    if (nowMs < this.nextMaintenanceAtMs) {
      return {
        ran: false,
        eventsPruned: 0,
        telemetryPruned: 0,
      };
    }
    this.nextMaintenanceAtMs = nowMs + this.policyValues.maintenanceIntervalMs;

    let eventsPruned = 0;
    let telemetryPruned = 0;

    if (this.eventStore !== null) {
      try {
        const cutoff = new Date(nowMs - this.policyValues.eventRetentionMs).toISOString();
        eventsPruned = this.eventStore.pruneEventsOlderThan(
          cutoff,
          this.policyValues.pruneBatchSize,
        );
        const compaction = this.eventStore.runOnlineCopyForwardCompactionStep?.(
          this.policyValues.copyForwardBatchSize,
          this.policyValues.copyForwardFinalizeTailRows,
        );
        if (eventsPruned > 0 || compaction?.state === 'finalized') {
          this.eventStore.checkpointWalTruncate();
          this.eventStore.compactFreelistPages(this.policyValues.compactFreelistPages);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.writeStderr(`[storage-lifecycle] event maintenance failed: ${message}\n`);
      }
    }

    if (this.telemetryStore !== null) {
      try {
        const cutoff = new Date(nowMs - this.policyValues.telemetryRetentionMs).toISOString();
        telemetryPruned = this.telemetryStore.pruneTelemetryOlderThan(
          cutoff,
          this.policyValues.pruneBatchSize,
        );
        const compaction = this.telemetryStore.runOnlineCopyForwardCompactionStep?.(
          this.policyValues.copyForwardBatchSize,
          this.policyValues.copyForwardFinalizeTailRows,
        );
        if (telemetryPruned > 0 || compaction?.state === 'finalized') {
          this.telemetryStore.checkpointWalTruncate();
          this.telemetryStore.compactFreelistPages(this.policyValues.compactFreelistPages);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.writeStderr(`[storage-lifecycle] telemetry maintenance failed: ${message}\n`);
      }
    }

    return {
      ran: true,
      eventsPruned,
      telemetryPruned,
    };
  }
}
