import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseCodexHistoryLine, type ParsedCodexTelemetryEvent } from './codex-telemetry.ts';
import type {
  ControlPlaneDirectoryRecord,
  ControlPlaneRepositoryRecord,
} from '../store/control-plane-store.ts';
import { startPerfSpan } from '../perf/perf-core.ts';

const HISTORY_POLL_JITTER_RATIO = 0.35;
const HISTORY_POLL_MAX_DELAY_MS = 60_000;
const LINE_FEED_BYTE = '\n'.charCodeAt(0);

function isClosedDatabaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes('database has closed') ||
    normalized.includes('database is closed') ||
    normalized.includes('cannot use a closed database')
  );
}

interface GitStatusSummary {
  branch: string | null;
  changedFiles: number;
  additions: number;
  deletions: number;
}

interface GitRepositorySnapshot {
  normalizedRemoteUrl: string | null;
  commitCount: number | null;
  lastCommitAt: string | null;
  shortCommitHash: string | null;
  inferredName: string | null;
  defaultBranch: string | null;
}

interface DirectoryGitStatusCacheEntry {
  readonly summary: GitStatusSummary;
  readonly repositorySnapshot: GitRepositorySnapshot;
  readonly repositoryId: string | null;
  readonly lastRefreshedAtMs: number;
  readonly lastRefreshDurationMs: number;
}

interface GitDirectorySnapshot {
  summary: GitStatusSummary;
  repository: GitRepositorySnapshot;
}

interface BackgroundSessionState {
  id: string;
  adapterState: Record<string, unknown>;
}

interface HistoryFileHandle {
  stat(): Promise<{ size: number }>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

interface BackgroundContext {
  historyNextAllowedPollAtMs: number;
  historyPollInFlight: boolean;
  historyIdleStreak: number;
  historyOffset: number;
  historyRemainder: string;
  readonly codexHistory: {
    enabled: boolean;
    filePath: string;
    pollMs: number;
  };
  openHistoryFile?: (path: string, flags: 'r') => Promise<HistoryFileHandle>;
  readonly sessions: Map<string, BackgroundSessionState>;
  readonly stateStore: {
    findConversationIdByCodexThreadId(threadId: string): string | null;
    upsertRepository(input: {
      repositoryId: string;
      tenantId: string;
      userId: string;
      workspaceId: string;
      name: string;
      remoteUrl: string;
      defaultBranch?: string;
      metadata?: Record<string, unknown>;
    }): ControlPlaneRepositoryRecord;
    getRepository(repositoryId: string): ControlPlaneRepositoryRecord | null;
  };
  ingestParsedTelemetryEvent(sessionId: string | null, event: ParsedCodexTelemetryEvent): void;
  resolveSessionIdByThreadId(threadId: string): string | null;
  pollHistoryFileUnsafe?: () => Promise<boolean>;
  gitStatusPollInFlight: boolean;
  readonly gitStatusDirectoriesById: Map<string, ControlPlaneDirectoryRecord>;
  readonly gitStatusByDirectoryId: Map<string, DirectoryGitStatusCacheEntry>;
  readonly gitStatusRefreshInFlightDirectoryIds: Set<string>;
  readonly gitStatusMonitor: {
    maxConcurrency: number;
    minDirectoryRefreshMs: number;
  };
  readonly readGitDirectorySnapshot: (cwd: string) => Promise<GitDirectorySnapshot>;
  repositoryRecord(repository: ControlPlaneRepositoryRecord): Record<string, unknown>;
  publishObservedEvent(
    scope: {
      tenantId: string;
      userId: string;
      workspaceId: string;
      directoryId: string | null;
      conversationId: string | null;
    },
    event: {
      type: 'directory-git-updated';
      directoryId: string;
      summary: GitStatusSummary;
      repositorySnapshot: GitRepositorySnapshot;
      repositoryId: string | null;
      repository: Record<string, unknown> | null;
      observedAt: string;
    },
  ): void;
}

function jitterDelayMs(baseMs: number): number {
  const clampedBaseMs = Math.max(25, Math.floor(baseMs));
  const jitterWindowMs = Math.max(1, Math.floor(clampedBaseMs * HISTORY_POLL_JITTER_RATIO));
  const jitterOffsetMs = Math.floor(Math.random() * (2 * jitterWindowMs + 1) - jitterWindowMs);
  return Math.max(25, clampedBaseMs + jitterOffsetMs);
}

function expandTildePath(pathValue: string): string {
  if (pathValue === '~') {
    return homedir();
  }
  if (pathValue.startsWith('~/')) {
    return resolve(homedir(), pathValue.slice(2));
  }
  return pathValue;
}

function gitSummaryEqual(left: GitStatusSummary, right: GitStatusSummary): boolean {
  return (
    left.branch === right.branch &&
    left.changedFiles === right.changedFiles &&
    left.additions === right.additions &&
    left.deletions === right.deletions
  );
}

function gitRepositorySnapshotEqual(
  left: GitRepositorySnapshot,
  right: GitRepositorySnapshot,
): boolean {
  return (
    left.normalizedRemoteUrl === right.normalizedRemoteUrl &&
    left.commitCount === right.commitCount &&
    left.lastCommitAt === right.lastCommitAt &&
    left.shortCommitHash === right.shortCommitHash &&
    left.inferredName === right.inferredName &&
    left.defaultBranch === right.defaultBranch
  );
}

async function runWithConcurrencyLimit<T>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  if (values.length === 0) {
    return;
  }
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(concurrency)));
  let index = 0;
  const runners: Promise<void>[] = [];
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    runners.push(
      (async () => {
        while (true) {
          const nextIndex = index;
          index += 1;
          if (nextIndex >= values.length) {
            return;
          }
          const value = values[nextIndex];
          if (value === undefined) {
            continue;
          }
          await worker(value);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

export async function pollHistoryFile(ctx: BackgroundContext): Promise<void> {
  const nowMs = Date.now();
  if (nowMs < ctx.historyNextAllowedPollAtMs) {
    return;
  }
  if (ctx.historyPollInFlight) {
    return;
  }
  ctx.historyPollInFlight = true;
  try {
    const consumedNewBytes =
      typeof ctx.pollHistoryFileUnsafe === 'function'
        ? await ctx.pollHistoryFileUnsafe()
        : await pollHistoryFileUnsafe(ctx);
    if (consumedNewBytes) {
      ctx.historyIdleStreak = 0;
      ctx.historyNextAllowedPollAtMs = Date.now() + jitterDelayMs(ctx.codexHistory.pollMs);
    } else {
      ctx.historyIdleStreak = Math.min(ctx.historyIdleStreak + 1, 4);
      const backoffMs = Math.min(
        HISTORY_POLL_MAX_DELAY_MS,
        ctx.codexHistory.pollMs * (1 << ctx.historyIdleStreak),
      );
      ctx.historyNextAllowedPollAtMs = Date.now() + jitterDelayMs(backoffMs);
    }
  } catch (error: unknown) {
    if (isClosedDatabaseError(error)) {
      throw error;
    }
    ctx.historyIdleStreak = Math.min(ctx.historyIdleStreak + 1, 4);
    const backoffMs = Math.min(
      HISTORY_POLL_MAX_DELAY_MS,
      ctx.codexHistory.pollMs * (1 << ctx.historyIdleStreak),
    );
    ctx.historyNextAllowedPollAtMs = Date.now() + jitterDelayMs(backoffMs);
  } finally {
    ctx.historyPollInFlight = false;
  }
}

export async function pollHistoryFileUnsafe(ctx: BackgroundContext): Promise<boolean> {
  if (!ctx.codexHistory.enabled) {
    return false;
  }
  const resolvedHistoryPath = expandTildePath(ctx.codexHistory.filePath);
  const openHistoryFile: NonNullable<BackgroundContext['openHistoryFile']> =
    ctx.openHistoryFile ?? (open as unknown as NonNullable<BackgroundContext['openHistoryFile']>);
  let handle: HistoryFileHandle;
  try {
    handle = await openHistoryFile(resolvedHistoryPath, 'r');
  } catch (error) {
    const errorWithCode = error as { code?: unknown };
    if (errorWithCode.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  let delta = '';
  let fileTruncated = false;
  try {
    const stats = await handle.stat();
    const fileSize = Number(stats.size);
    if (!Number.isFinite(fileSize)) {
      return false;
    }
    if (fileSize < ctx.historyOffset) {
      fileTruncated = true;
      ctx.historyOffset = 0;
      ctx.historyRemainder = '';
    }
    if (
      !fileTruncated &&
      ctx.historyOffset > 0 &&
      ctx.historyRemainder.length === 0 &&
      fileSize >= ctx.historyOffset
    ) {
      const probe = Buffer.allocUnsafe(1);
      const { bytesRead: probeBytesRead } = await handle.read(probe, 0, 1, ctx.historyOffset - 1);
      const historyBoundaryMatches = probeBytesRead === 1 && probe[0] === LINE_FEED_BYTE;
      if (!historyBoundaryMatches) {
        fileTruncated = true;
        ctx.historyOffset = 0;
        ctx.historyRemainder = '';
      }
    }
    const remainingBytes = fileSize - ctx.historyOffset;
    if (remainingBytes <= 0) {
      return fileTruncated;
    }
    const buffer = Buffer.allocUnsafe(remainingBytes);
    let bytesReadTotal = 0;
    while (bytesReadTotal < remainingBytes) {
      const { bytesRead } = await handle.read(
        buffer,
        bytesReadTotal,
        remainingBytes - bytesReadTotal,
        ctx.historyOffset + bytesReadTotal,
      );
      if (bytesRead <= 0) {
        break;
      }
      bytesReadTotal += bytesRead;
    }
    if (bytesReadTotal <= 0) {
      return fileTruncated;
    }
    ctx.historyOffset += bytesReadTotal;
    delta = buffer.toString('utf8', 0, bytesReadTotal);
  } finally {
    await handle.close();
  }

  const buffered = `${ctx.historyRemainder}${delta}`;
  const lines = buffered.split('\n');
  ctx.historyRemainder = lines.pop() as string;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const parsed = parseCodexHistoryLine(trimmed, new Date().toISOString());
    if (parsed === null) {
      continue;
    }
    const sessionId =
      parsed.providerThreadId === null
        ? null
        : ctx.resolveSessionIdByThreadId(parsed.providerThreadId);
    ctx.ingestParsedTelemetryEvent(sessionId, parsed);
  }
  return true;
}

export async function pollGitStatus(ctx: BackgroundContext): Promise<void> {
  if (ctx.gitStatusPollInFlight) {
    return;
  }
  ctx.gitStatusPollInFlight = true;
  try {
    const directories = [...ctx.gitStatusDirectoriesById.values()];
    if (directories.length === 0) {
      return;
    }
    const nowMs = Date.now();
    const dueDirectories = directories.filter((directory) => {
      const previous = ctx.gitStatusByDirectoryId.get(directory.directoryId);
      if (previous === undefined) {
        return true;
      }
      const minRefreshWindowMs = Math.max(
        ctx.gitStatusMonitor.minDirectoryRefreshMs,
        Math.min(10 * 60 * 1000, Math.max(1000, previous.lastRefreshDurationMs * 4)),
      );
      return nowMs - previous.lastRefreshedAtMs >= minRefreshWindowMs;
    });
    await runWithConcurrencyLimit(
      dueDirectories,
      ctx.gitStatusMonitor.maxConcurrency,
      async (directory) => await refreshGitStatusForDirectory(ctx, directory),
    );
  } finally {
    ctx.gitStatusPollInFlight = false;
  }
}

export async function refreshGitStatusForDirectory(
  ctx: BackgroundContext,
  directory: ControlPlaneDirectoryRecord,
  options: {
    readonly forcePublish?: boolean;
  } = {},
): Promise<void> {
  if (ctx.gitStatusRefreshInFlightDirectoryIds.has(directory.directoryId)) {
    return;
  }
  ctx.gitStatusRefreshInFlightDirectoryIds.add(directory.directoryId);
  const gitSpan = startPerfSpan('control-plane.background.git-status', {
    directoryId: directory.directoryId,
  });
  const startedAtMs = Date.now();
  const previous = ctx.gitStatusByDirectoryId.get(directory.directoryId) ?? null;
  try {
    const snapshot = await ctx.readGitDirectorySnapshot(directory.path);
    let repositorySnapshot: GitRepositorySnapshot = snapshot.repository;
    if (
      repositorySnapshot.commitCount === null &&
      previous !== null &&
      previous.repositorySnapshot.normalizedRemoteUrl === repositorySnapshot.normalizedRemoteUrl &&
      previous.repositorySnapshot.shortCommitHash === repositorySnapshot.shortCommitHash
    ) {
      repositorySnapshot = {
        ...repositorySnapshot,
        commitCount: previous.repositorySnapshot.commitCount,
      };
    }
    let repositoryId: string | null = null;
    let repositoryRecord: Record<string, unknown> | null = null;
    if (repositorySnapshot.normalizedRemoteUrl !== null) {
      if (
        previous !== null &&
        previous.repositoryId !== null &&
        previous.repositorySnapshot.normalizedRemoteUrl === repositorySnapshot.normalizedRemoteUrl
      ) {
        repositoryId = previous.repositoryId;
      } else {
        const upserted = ctx.stateStore.upsertRepository({
          repositoryId: `repository-${randomUUID()}`,
          tenantId: directory.tenantId,
          userId: directory.userId,
          workspaceId: directory.workspaceId,
          name: repositorySnapshot.inferredName ?? 'repository',
          remoteUrl: repositorySnapshot.normalizedRemoteUrl,
          defaultBranch: repositorySnapshot.defaultBranch ?? 'main',
          metadata: {
            source: 'control-plane-git-status',
          },
        });
        repositoryId = upserted.repositoryId;
        repositoryRecord = ctx.repositoryRecord(upserted);
      }
    }
    const next: DirectoryGitStatusCacheEntry = {
      summary: snapshot.summary,
      repositorySnapshot,
      repositoryId,
      lastRefreshedAtMs: Date.now(),
      lastRefreshDurationMs: Math.max(1, Date.now() - startedAtMs),
    };
    ctx.gitStatusByDirectoryId.set(directory.directoryId, next);
    const changed =
      previous === null ||
      !gitSummaryEqual(previous.summary, next.summary) ||
      !gitRepositorySnapshotEqual(previous.repositorySnapshot, next.repositorySnapshot) ||
      previous.repositoryId !== next.repositoryId;
    const shouldPublish = changed || options.forcePublish === true;
    if (shouldPublish) {
      if (repositoryRecord === null && repositoryId !== null) {
        const existingRepository = ctx.stateStore.getRepository(repositoryId);
        if (existingRepository !== null) {
          repositoryRecord = ctx.repositoryRecord(existingRepository);
        }
      }
      ctx.publishObservedEvent(
        {
          tenantId: directory.tenantId,
          userId: directory.userId,
          workspaceId: directory.workspaceId,
          directoryId: directory.directoryId,
          conversationId: null,
        },
        {
          type: 'directory-git-updated',
          directoryId: directory.directoryId,
          summary: {
            branch: snapshot.summary.branch,
            changedFiles: snapshot.summary.changedFiles,
            additions: snapshot.summary.additions,
            deletions: snapshot.summary.deletions,
          },
          repositorySnapshot: {
            normalizedRemoteUrl: repositorySnapshot.normalizedRemoteUrl,
            commitCount: repositorySnapshot.commitCount,
            lastCommitAt: repositorySnapshot.lastCommitAt,
            shortCommitHash: repositorySnapshot.shortCommitHash,
            inferredName: repositorySnapshot.inferredName,
            defaultBranch: repositorySnapshot.defaultBranch,
          },
          repositoryId,
          repository: repositoryRecord,
          observedAt: new Date().toISOString(),
        },
      );
    }
    gitSpan.end({
      directoryId: directory.directoryId,
      changed,
      published: shouldPublish ? 1 : 0,
      forcePublished: options.forcePublish ? 1 : 0,
      repositoryLinked: repositoryId === null ? 0 : 1,
    });
  } catch (error: unknown) {
    if (isClosedDatabaseError(error)) {
      throw error;
    }
    if (previous !== null) {
      ctx.gitStatusByDirectoryId.set(directory.directoryId, {
        ...previous,
        lastRefreshedAtMs: Date.now(),
        lastRefreshDurationMs: Math.max(1, Date.now() - startedAtMs),
      });
    }
    gitSpan.end({
      directoryId: directory.directoryId,
      changed: false,
      failed: true,
    });
  } finally {
    ctx.gitStatusRefreshInFlightDirectoryIds.delete(directory.directoryId);
  }
}
