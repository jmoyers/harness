import type { PtyExit } from '../pty/pty_host.ts';
import type { StreamSessionRuntimeStatus } from './stream-protocol.ts';

interface StreamSessionSummary {
  readonly sessionId: string;
  readonly directoryId: string | null;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly status: StreamSessionRuntimeStatus;
  readonly attentionReason: string | null;
  readonly latestCursor: number | null;
  readonly processId: number | null;
  readonly attachedClients: number;
  readonly eventSubscribers: number;
  readonly startedAt: string;
  readonly lastEventAt: string | null;
  readonly lastExit: PtyExit | null;
  readonly exitedAt: string | null;
  readonly live: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function readNullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readExit(value: unknown): PtyExit | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const record = asRecord(value);
  if (record === null) {
    return undefined;
  }
  const code = readNullableNumber(record['code']);
  const signal = readNullableString(record['signal']);
  if (code === undefined || signal === undefined) {
    return undefined;
  }
  if (signal !== null && !/^SIG[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(signal)) {
    return undefined;
  }
  return {
    code,
    signal: signal as NodeJS.Signals | null
  };
}

function isRuntimeStatus(value: string): value is StreamSessionRuntimeStatus {
  return (
    value === 'running' ||
    value === 'needs-input' ||
    value === 'completed' ||
    value === 'exited'
  );
}

export function parseSessionSummaryRecord(value: unknown): StreamSessionSummary | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const sessionId = readString(record['sessionId']);
  const directoryId = readNullableString(record['directoryId']);
  const tenantId = readString(record['tenantId']);
  const userId = readString(record['userId']);
  const workspaceId = readString(record['workspaceId']);
  const worktreeId = readString(record['worktreeId']);
  const status = readString(record['status']);
  if (
    sessionId === null ||
    directoryId === undefined ||
    tenantId === null ||
    userId === null ||
    workspaceId === null ||
    worktreeId === null ||
    status === null ||
    !isRuntimeStatus(status)
  ) {
    return null;
  }
  const attentionReason = readNullableString(record['attentionReason']);
  const latestCursor = readNullableNumber(record['latestCursor']);
  const processId = readNullableNumber(record['processId']);
  const attachedClients = readNumber(record['attachedClients']);
  const eventSubscribers = readNumber(record['eventSubscribers']);
  const startedAt = readString(record['startedAt']);
  const lastEventAt = readNullableString(record['lastEventAt']);
  const lastExit = readExit(record['lastExit']);
  const exitedAt = readNullableString(record['exitedAt']);
  const live = readBoolean(record['live']);
  if (attentionReason === undefined) {
    return null;
  }
  if (latestCursor === undefined) {
    return null;
  }
  if (processId === undefined) {
    return null;
  }
  if (attachedClients === null) {
    return null;
  }
  if (eventSubscribers === null) {
    return null;
  }
  if (startedAt === null) {
    return null;
  }
  if (lastEventAt === undefined) {
    return null;
  }
  if (lastExit === undefined) {
    return null;
  }
  if (exitedAt === undefined) {
    return null;
  }
  if (live === null) {
    return null;
  }
  return {
    sessionId,
    directoryId,
    tenantId,
    userId,
    workspaceId,
    worktreeId,
    status,
    attentionReason,
    latestCursor,
    processId,
    attachedClients,
    eventSubscribers,
    startedAt,
    lastEventAt,
    lastExit,
    exitedAt,
    live
  };
}

export function parseSessionSummaryList(value: unknown): readonly StreamSessionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parsed: StreamSessionSummary[] = [];
  for (const entry of value) {
    const summary = parseSessionSummaryRecord(entry);
    if (summary !== null) {
      parsed.push(summary);
    }
  }
  return parsed;
}
