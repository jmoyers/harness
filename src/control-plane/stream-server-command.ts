import { randomUUID } from 'node:crypto';
import type {
  StreamCommand,
  StreamObservedEvent,
  StreamSessionController,
  StreamSessionRuntimeStatus,
} from './stream-protocol.ts';
import type {
  ControlPlaneConversationRecord,
  ControlPlaneDirectoryRecord,
  ControlPlaneRepositoryRecord,
  ControlPlaneTaskRecord,
} from '../store/control-plane-store.ts';
import type { TerminalBufferTail, TerminalSnapshotFrame } from '../terminal/snapshot-oracle.ts';
import type { PtyExit } from '../pty/pty_host.ts';

const DEFAULT_TENANT_ID = 'tenant-local';
const DEFAULT_USER_ID = 'user-local';
const DEFAULT_WORKSPACE_ID = 'workspace-local';

interface StreamSubscriptionFilter {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  taskId?: string;
  directoryId?: string;
  conversationId?: string;
  includeOutput: boolean;
}

interface StreamObservedScope {
  tenantId: string;
  userId: string;
  workspaceId: string;
  directoryId: string | null;
  conversationId: string | null;
}

interface StreamJournalEntry {
  cursor: number;
  scope: StreamObservedScope;
  event: StreamObservedEvent;
}

interface SessionControllerState extends StreamSessionController {
  connectionId: string;
}

interface StartSessionRuntimeInput {
  readonly sessionId: string;
  readonly args: readonly string[];
  readonly initialCols: number;
  readonly initialRows: number;
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly worktreeId?: string;
  readonly terminalForegroundHex?: string;
  readonly terminalBackgroundHex?: string;
}

interface LiveSessionLike {
  attach(
    handlers: {
      onData: (event: { cursor: number; chunk: Buffer }) => void;
      onExit: (exit: PtyExit) => void;
    },
    sinceCursor?: number,
  ): string;
  detach(attachmentId: string): void;
  latestCursorValue(): number;
  write(data: string | Uint8Array): void;
  snapshot(): TerminalSnapshotFrame;
  bufferTail?(tailLines?: number): TerminalBufferTail;
}

interface SessionState {
  id: string;
  directoryId: string | null;
  tenantId: string;
  userId: string;
  workspaceId: string;
  worktreeId: string;
  session: LiveSessionLike | null;
  eventSubscriberConnectionIds: Set<string>;
  attachmentByConnectionId: Map<string, string>;
  status: StreamSessionRuntimeStatus;
  attentionReason: string | null;
  lastEventAt: string | null;
  lastExit: PtyExit | null;
  lastSnapshot: Record<string, unknown> | null;
  startedAt: string;
  exitedAt: string | null;
  lastObservedOutputCursor: number;
  controller: SessionControllerState | null;
}

interface ConnectionState {
  id: string;
  attachedSessionIds: Set<string>;
  eventSessionIds: Set<string>;
  streamSubscriptionIds: Set<string>;
}

interface DirectoryGitStatusCacheEntry {
  readonly summary: {
    branch: string | null;
    changedFiles: number;
    additions: number;
    deletions: number;
  };
  readonly repositorySnapshot: {
    normalizedRemoteUrl: string | null;
    commitCount: number | null;
    lastCommitAt: string | null;
    shortCommitHash: string | null;
    inferredName: string | null;
    defaultBranch: string | null;
  };
  readonly repositoryId: string | null;
  readonly lastRefreshedAtMs: number;
}

interface ExecuteCommandContext {
  readonly stateStore: {
    upsertDirectory(input: {
      directoryId: string;
      tenantId: string;
      userId: string;
      workspaceId: string;
      path: string;
    }): ControlPlaneDirectoryRecord;
    listDirectories(query: {
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      includeArchived?: boolean;
      limit?: number;
    }): ControlPlaneDirectoryRecord[];
    archiveDirectory(directoryId: string): ControlPlaneDirectoryRecord;
    createConversation(input: {
      conversationId: string;
      directoryId: string;
      title: string;
      agentType: string;
      adapterState?: Record<string, unknown>;
    }): ControlPlaneConversationRecord;
    listConversations(query: {
      directoryId?: string;
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      includeArchived?: boolean;
      limit?: number;
    }): ControlPlaneConversationRecord[];
    archiveConversation(conversationId: string): ControlPlaneConversationRecord;
    updateConversationTitle(
      conversationId: string,
      title: string,
    ): ControlPlaneConversationRecord | null;
    getConversation(conversationId: string): ControlPlaneConversationRecord | null;
    deleteConversation(conversationId: string): void;
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
    listRepositories(query: {
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      includeArchived?: boolean;
      limit?: number;
    }): ControlPlaneRepositoryRecord[];
    updateRepository(
      repositoryId: string,
      input: {
        name?: string;
        remoteUrl?: string;
        defaultBranch?: string;
        metadata?: Record<string, unknown>;
      },
    ): ControlPlaneRepositoryRecord | null;
    archiveRepository(repositoryId: string): ControlPlaneRepositoryRecord;
    createTask(input: {
      taskId: string;
      tenantId: string;
      userId: string;
      workspaceId: string;
      repositoryId?: string;
      title: string;
      description?: string;
      linear?: Record<string, unknown>;
    }): ControlPlaneTaskRecord;
    getTask(taskId: string): ControlPlaneTaskRecord | null;
    listTasks(query: {
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      repositoryId?: string;
      status?: 'draft' | 'ready' | 'in-progress' | 'completed';
      limit?: number;
    }): ControlPlaneTaskRecord[];
    updateTask(
      taskId: string,
      input: {
        title?: string;
        description?: string;
        repositoryId?: string | null;
        linear?: Record<string, unknown> | null;
      },
    ): ControlPlaneTaskRecord | null;
    deleteTask(taskId: string): void;
    claimTask(input: {
      taskId: string;
      controllerId: string;
      directoryId?: string;
      branchName?: string;
      baseBranch?: string;
    }): ControlPlaneTaskRecord;
    completeTask(taskId: string): ControlPlaneTaskRecord;
    readyTask(taskId: string): ControlPlaneTaskRecord;
    draftTask(taskId: string): ControlPlaneTaskRecord;
    reorderTasks(input: {
      tenantId: string;
      userId: string;
      workspaceId: string;
      orderedTaskIds: readonly string[];
    }): ControlPlaneTaskRecord[];
  };
  readonly gitStatusDirectoriesById: Map<string, ControlPlaneDirectoryRecord>;
  readonly gitStatusMonitor: {
    enabled: boolean;
  };
  readonly gitStatusByDirectoryId: Map<string, DirectoryGitStatusCacheEntry>;
  readonly streamSubscriptions: Map<
    string,
    {
      id: string;
      connectionId: string;
      filter: StreamSubscriptionFilter;
    }
  >;
  readonly connections: Map<string, ConnectionState>;
  readonly streamJournal: StreamJournalEntry[];
  readonly sessions: Map<string, SessionState>;
  readonly streamCursor: number;
  refreshGitStatusForDirectory(
    directory: ControlPlaneDirectoryRecord,
    options?: {
      readonly forcePublish?: boolean;
    },
  ): Promise<void>;
  directoryRecord(directory: ControlPlaneDirectoryRecord): Record<string, unknown>;
  conversationRecord(conversation: ControlPlaneConversationRecord): Record<string, unknown>;
  repositoryRecord(repository: ControlPlaneRepositoryRecord): Record<string, unknown>;
  taskRecord(task: ControlPlaneTaskRecord): Record<string, unknown>;
  publishObservedEvent(scope: StreamObservedScope, event: StreamObservedEvent): void;
  matchesObservedFilter(
    scope: StreamObservedScope,
    event: StreamObservedEvent,
    filter: StreamSubscriptionFilter,
  ): boolean;
  diagnosticSessionIdForObservedEvent(
    scope: StreamObservedScope,
    event: StreamObservedEvent,
  ): string | null;
  sendToConnection(
    connectionId: string,
    envelope: Record<string, unknown>,
    diagnosticSessionId?: string | null,
  ): void;
  sortSessionSummaries(
    sessions: readonly SessionState[],
    sort: 'attention-first' | 'started-desc' | 'started-asc',
  ): ReadonlyArray<Record<string, unknown>>;
  requireSession(sessionId: string): SessionState;
  requireLiveSession(sessionId: string): SessionState & { session: LiveSessionLike };
  sessionSummaryRecord(state: SessionState): Record<string, unknown>;
  snapshotRecordFromFrame(frame: TerminalSnapshotFrame): Record<string, unknown>;
  toPublicSessionController(
    controller: SessionControllerState | null,
  ): StreamSessionController | null;
  controllerDisplayName(controller: SessionControllerState): string;
  publishSessionControlObservedEvent(
    state: SessionState,
    action: 'claimed' | 'taken-over' | 'released',
    controller: StreamSessionController | null,
    previousController: StreamSessionController | null,
    reason: string | null,
  ): void;
  publishStatusObservedEvent(state: SessionState): void;
  assertConnectionCanMutateSession(connectionId: string, state: SessionState): void;
  setSessionStatus(
    state: SessionState,
    status: StreamSessionRuntimeStatus,
    attentionReason: string | null,
    ts: string,
  ): void;
  destroySession(sessionId: string, closeSession: boolean): void;
  startSessionRuntime(command: StartSessionRuntimeInput): void;
  detachConnectionFromSession(connectionId: string, sessionId: string): void;
  sessionScope(state: SessionState): StreamObservedScope;
}

function normalizeAdapterState(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return null;
  }
  return [...value];
}

function bufferTailFromVisibleLines(
  lines: readonly string[],
  totalRows: number,
  tailLines: number,
): TerminalBufferTail {
  const availableCount = lines.length;
  const rowCount = Math.min(availableCount, tailLines);
  const startRow = Math.max(0, totalRows - rowCount);
  return {
    totalRows,
    startRow,
    lines: lines.slice(Math.max(0, availableCount - rowCount)),
  };
}

function bufferTailFromFrame(frame: TerminalSnapshotFrame, tailLines: number): TerminalBufferTail {
  return bufferTailFromVisibleLines(frame.lines, frame.viewport.totalRows, tailLines);
}

function bufferTailFromSnapshotRecord(
  snapshot: Record<string, unknown>,
  tailLines: number,
): TerminalBufferTail {
  const lines = asStringArray(snapshot['lines']) ?? [];
  const viewport = asRecord(snapshot['viewport']);
  const totalRowsRaw = viewport?.['totalRows'];
  const totalRows =
    typeof totalRowsRaw === 'number' && Number.isInteger(totalRowsRaw) && totalRowsRaw >= 0
      ? totalRowsRaw
      : lines.length;
  return bufferTailFromVisibleLines(lines, totalRows, tailLines);
}

export function executeStreamServerCommand(
  ctx: ExecuteCommandContext,
  connection: ConnectionState,
  command: StreamCommand,
): Record<string, unknown> {
  if (command.type === 'directory.upsert') {
    const directory = ctx.stateStore.upsertDirectory({
      directoryId: command.directoryId ?? `directory-${randomUUID()}`,
      tenantId: command.tenantId ?? DEFAULT_TENANT_ID,
      userId: command.userId ?? DEFAULT_USER_ID,
      workspaceId: command.workspaceId ?? DEFAULT_WORKSPACE_ID,
      path: command.path,
    });
    const record = ctx.directoryRecord(directory);
    ctx.gitStatusDirectoriesById.set(directory.directoryId, directory);
    ctx.publishObservedEvent(
      {
        tenantId: directory.tenantId,
        userId: directory.userId,
        workspaceId: directory.workspaceId,
        directoryId: directory.directoryId,
        conversationId: null,
      },
      {
        type: 'directory-upserted',
        directory: record,
      },
    );
    if (ctx.gitStatusMonitor.enabled) {
      void ctx.refreshGitStatusForDirectory(directory, {
        forcePublish: true,
      });
    }
    return {
      directory: record,
    };
  }

  if (command.type === 'directory.list') {
    const query: {
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      includeArchived?: boolean;
      limit?: number;
    } = {};
    if (command.tenantId !== undefined) {
      query.tenantId = command.tenantId;
    }
    if (command.userId !== undefined) {
      query.userId = command.userId;
    }
    if (command.workspaceId !== undefined) {
      query.workspaceId = command.workspaceId;
    }
    if (command.includeArchived !== undefined) {
      query.includeArchived = command.includeArchived;
    }
    if (command.limit !== undefined) {
      query.limit = command.limit;
    }
    const directories = ctx.stateStore
      .listDirectories(query)
      .map((directory) => ctx.directoryRecord(directory));
    return {
      directories,
    };
  }

  if (command.type === 'directory.archive') {
    const archived = ctx.stateStore.archiveDirectory(command.directoryId);
    const record = ctx.directoryRecord(archived);
    ctx.publishObservedEvent(
      {
        tenantId: archived.tenantId,
        userId: archived.userId,
        workspaceId: archived.workspaceId,
        directoryId: archived.directoryId,
        conversationId: null,
      },
      {
        type: 'directory-archived',
        directoryId: archived.directoryId,
        ts: archived.archivedAt as string,
      },
    );
    ctx.gitStatusByDirectoryId.delete(archived.directoryId);
    ctx.gitStatusDirectoriesById.delete(archived.directoryId);
    return {
      directory: record,
    };
  }

  if (command.type === 'directory.git-status') {
    const query: {
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      includeArchived: boolean;
      limit: number;
    } = {
      includeArchived: false,
      limit: 1000,
    };
    if (command.tenantId !== undefined) {
      query.tenantId = command.tenantId;
    }
    if (command.userId !== undefined) {
      query.userId = command.userId;
    }
    if (command.workspaceId !== undefined) {
      query.workspaceId = command.workspaceId;
    }
    const listedDirectories = ctx.stateStore
      .listDirectories(query)
      .filter((directory) =>
        command.directoryId === undefined ? true : directory.directoryId === command.directoryId,
      );
    for (const directory of listedDirectories) {
      ctx.gitStatusDirectoriesById.set(directory.directoryId, directory);
    }
    const gitStatuses = listedDirectories.flatMap((directory) => {
      const cached = ctx.gitStatusByDirectoryId.get(directory.directoryId);
      if (cached === undefined) {
        return [];
      }
      const repositoryRecord =
        cached.repositoryId === null
          ? null
          : (() => {
              const repository = ctx.stateStore.getRepository(cached.repositoryId);
              if (repository === null || repository.archivedAt !== null) {
                return null;
              }
              return ctx.repositoryRecord(repository);
            })();
      return [
        {
          directoryId: directory.directoryId,
          summary: {
            branch: cached.summary.branch,
            changedFiles: cached.summary.changedFiles,
            additions: cached.summary.additions,
            deletions: cached.summary.deletions,
          },
          repositorySnapshot: {
            normalizedRemoteUrl: cached.repositorySnapshot.normalizedRemoteUrl,
            commitCount: cached.repositorySnapshot.commitCount,
            lastCommitAt: cached.repositorySnapshot.lastCommitAt,
            shortCommitHash: cached.repositorySnapshot.shortCommitHash,
            inferredName: cached.repositorySnapshot.inferredName,
            defaultBranch: cached.repositorySnapshot.defaultBranch,
          },
          repositoryId: cached.repositoryId,
          repository: repositoryRecord,
          observedAt: new Date(cached.lastRefreshedAtMs).toISOString(),
        },
      ];
    });
    return {
      gitStatuses,
    };
  }

  if (command.type === 'conversation.create') {
    const conversation = ctx.stateStore.createConversation({
      conversationId: command.conversationId ?? `conversation-${randomUUID()}`,
      directoryId: command.directoryId,
      title: command.title,
      agentType: command.agentType,
      adapterState: normalizeAdapterState(command.adapterState),
    });
    const record = ctx.conversationRecord(conversation);
    ctx.publishObservedEvent(
      {
        tenantId: conversation.tenantId,
        userId: conversation.userId,
        workspaceId: conversation.workspaceId,
        directoryId: conversation.directoryId,
        conversationId: conversation.conversationId,
      },
      {
        type: 'conversation-created',
        conversation: record,
      },
    );
    return {
      conversation: record,
    };
  }

  if (command.type === 'conversation.list') {
    const query: {
      directoryId?: string;
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      includeArchived?: boolean;
      limit?: number;
    } = {};
    if (command.directoryId !== undefined) {
      query.directoryId = command.directoryId;
    }
    if (command.tenantId !== undefined) {
      query.tenantId = command.tenantId;
    }
    if (command.userId !== undefined) {
      query.userId = command.userId;
    }
    if (command.workspaceId !== undefined) {
      query.workspaceId = command.workspaceId;
    }
    if (command.includeArchived !== undefined) {
      query.includeArchived = command.includeArchived;
    }
    if (command.limit !== undefined) {
      query.limit = command.limit;
    }
    const conversations = ctx.stateStore
      .listConversations(query)
      .map((conversation) => ctx.conversationRecord(conversation));
    return {
      conversations,
    };
  }

  if (command.type === 'conversation.archive') {
    const archived = ctx.stateStore.archiveConversation(command.conversationId);
    ctx.publishObservedEvent(
      {
        tenantId: archived.tenantId,
        userId: archived.userId,
        workspaceId: archived.workspaceId,
        directoryId: archived.directoryId,
        conversationId: archived.conversationId,
      },
      {
        type: 'conversation-archived',
        conversationId: archived.conversationId,
        ts: archived.archivedAt as string,
      },
    );
    return {
      conversation: ctx.conversationRecord(archived),
    };
  }

  if (command.type === 'conversation.update') {
    const updated = ctx.stateStore.updateConversationTitle(command.conversationId, command.title);
    if (updated === null) {
      throw new Error(`conversation not found: ${command.conversationId}`);
    }
    const record = ctx.conversationRecord(updated);
    ctx.publishObservedEvent(
      {
        tenantId: updated.tenantId,
        userId: updated.userId,
        workspaceId: updated.workspaceId,
        directoryId: updated.directoryId,
        conversationId: updated.conversationId,
      },
      {
        type: 'conversation-updated',
        conversation: record,
      },
    );
    return {
      conversation: record,
    };
  }

  if (command.type === 'conversation.delete') {
    const existing = ctx.stateStore.getConversation(command.conversationId);
    if (existing === null) {
      throw new Error(`conversation not found: ${command.conversationId}`);
    }
    ctx.destroySession(command.conversationId, true);
    ctx.stateStore.deleteConversation(command.conversationId);
    ctx.publishObservedEvent(
      {
        tenantId: existing.tenantId,
        userId: existing.userId,
        workspaceId: existing.workspaceId,
        directoryId: existing.directoryId,
        conversationId: existing.conversationId,
      },
      {
        type: 'conversation-deleted',
        conversationId: existing.conversationId,
        ts: new Date().toISOString(),
      },
    );
    return {
      deleted: true,
    };
  }

  if (command.type === 'repository.upsert') {
    const input: {
      repositoryId: string;
      tenantId: string;
      userId: string;
      workspaceId: string;
      name: string;
      remoteUrl: string;
      defaultBranch?: string;
      metadata?: Record<string, unknown>;
    } = {
      repositoryId: command.repositoryId ?? `repository-${randomUUID()}`,
      tenantId: command.tenantId ?? DEFAULT_TENANT_ID,
      userId: command.userId ?? DEFAULT_USER_ID,
      workspaceId: command.workspaceId ?? DEFAULT_WORKSPACE_ID,
      name: command.name,
      remoteUrl: command.remoteUrl,
    };
    if (command.defaultBranch !== undefined) {
      input.defaultBranch = command.defaultBranch;
    }
    if (command.metadata !== undefined) {
      input.metadata = command.metadata;
    }
    const repository = ctx.stateStore.upsertRepository(input);
    ctx.publishObservedEvent(
      {
        tenantId: repository.tenantId,
        userId: repository.userId,
        workspaceId: repository.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'repository-upserted',
        repository: ctx.repositoryRecord(repository),
      },
    );
    return {
      repository: ctx.repositoryRecord(repository),
    };
  }

  if (command.type === 'repository.get') {
    const repository = ctx.stateStore.getRepository(command.repositoryId);
    if (repository === null) {
      throw new Error(`repository not found: ${command.repositoryId}`);
    }
    return {
      repository: ctx.repositoryRecord(repository),
    };
  }

  if (command.type === 'repository.list') {
    const query: {
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      includeArchived?: boolean;
      limit?: number;
    } = {};
    if (command.tenantId !== undefined) {
      query.tenantId = command.tenantId;
    }
    if (command.userId !== undefined) {
      query.userId = command.userId;
    }
    if (command.workspaceId !== undefined) {
      query.workspaceId = command.workspaceId;
    }
    if (command.includeArchived !== undefined) {
      query.includeArchived = command.includeArchived;
    }
    if (command.limit !== undefined) {
      query.limit = command.limit;
    }
    const repositories = ctx.stateStore
      .listRepositories(query)
      .map((repository) => ctx.repositoryRecord(repository));
    return {
      repositories,
    };
  }

  if (command.type === 'repository.update') {
    const update: {
      name?: string;
      remoteUrl?: string;
      defaultBranch?: string;
      metadata?: Record<string, unknown>;
    } = {};
    if (command.name !== undefined) {
      update.name = command.name;
    }
    if (command.remoteUrl !== undefined) {
      update.remoteUrl = command.remoteUrl;
    }
    if (command.defaultBranch !== undefined) {
      update.defaultBranch = command.defaultBranch;
    }
    if (command.metadata !== undefined) {
      update.metadata = command.metadata;
    }
    const updated = ctx.stateStore.updateRepository(command.repositoryId, update);
    if (updated === null) {
      throw new Error(`repository not found: ${command.repositoryId}`);
    }
    ctx.publishObservedEvent(
      {
        tenantId: updated.tenantId,
        userId: updated.userId,
        workspaceId: updated.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'repository-updated',
        repository: ctx.repositoryRecord(updated),
      },
    );
    return {
      repository: ctx.repositoryRecord(updated),
    };
  }

  if (command.type === 'repository.archive') {
    const archived = ctx.stateStore.archiveRepository(command.repositoryId);
    ctx.publishObservedEvent(
      {
        tenantId: archived.tenantId,
        userId: archived.userId,
        workspaceId: archived.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'repository-archived',
        repositoryId: archived.repositoryId,
        ts: archived.archivedAt as string,
      },
    );
    return {
      repository: ctx.repositoryRecord(archived),
    };
  }

  if (command.type === 'task.create') {
    const input: {
      taskId: string;
      tenantId: string;
      userId: string;
      workspaceId: string;
      repositoryId?: string;
      title: string;
      description?: string;
      linear?: {
        issueId?: string | null;
        identifier?: string | null;
        url?: string | null;
        teamId?: string | null;
        projectId?: string | null;
        projectMilestoneId?: string | null;
        cycleId?: string | null;
        stateId?: string | null;
        assigneeId?: string | null;
        priority?: number | null;
        estimate?: number | null;
        dueDate?: string | null;
        labelIds?: readonly string[] | null;
      };
    } = {
      taskId: command.taskId ?? `task-${randomUUID()}`,
      tenantId: command.tenantId ?? DEFAULT_TENANT_ID,
      userId: command.userId ?? DEFAULT_USER_ID,
      workspaceId: command.workspaceId ?? DEFAULT_WORKSPACE_ID,
      title: command.title,
    };
    if (command.repositoryId !== undefined) {
      input.repositoryId = command.repositoryId;
    }
    if (command.description !== undefined) {
      input.description = command.description;
    }
    if (command.linear !== undefined) {
      input.linear = command.linear;
    }
    const task = ctx.stateStore.createTask(input);
    ctx.publishObservedEvent(
      {
        tenantId: task.tenantId,
        userId: task.userId,
        workspaceId: task.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'task-created',
        task: ctx.taskRecord(task),
      },
    );
    return {
      task: ctx.taskRecord(task),
    };
  }

  if (command.type === 'task.get') {
    const task = ctx.stateStore.getTask(command.taskId);
    if (task === null) {
      throw new Error(`task not found: ${command.taskId}`);
    }
    return {
      task: ctx.taskRecord(task),
    };
  }

  if (command.type === 'task.list') {
    const query: {
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      repositoryId?: string;
      status?: 'draft' | 'ready' | 'in-progress' | 'completed';
      limit?: number;
    } = {};
    if (command.tenantId !== undefined) {
      query.tenantId = command.tenantId;
    }
    if (command.userId !== undefined) {
      query.userId = command.userId;
    }
    if (command.workspaceId !== undefined) {
      query.workspaceId = command.workspaceId;
    }
    if (command.repositoryId !== undefined) {
      query.repositoryId = command.repositoryId;
    }
    if (command.status !== undefined) {
      query.status = command.status;
    }
    if (command.limit !== undefined) {
      query.limit = command.limit;
    }
    const tasks = ctx.stateStore.listTasks(query).map((task) => ctx.taskRecord(task));
    return {
      tasks,
    };
  }

  if (command.type === 'task.update') {
    const update: {
      title?: string;
      description?: string;
      repositoryId?: string | null;
      linear?: {
        issueId?: string | null;
        identifier?: string | null;
        url?: string | null;
        teamId?: string | null;
        projectId?: string | null;
        projectMilestoneId?: string | null;
        cycleId?: string | null;
        stateId?: string | null;
        assigneeId?: string | null;
        priority?: number | null;
        estimate?: number | null;
        dueDate?: string | null;
        labelIds?: readonly string[] | null;
      } | null;
    } = {};
    if (command.title !== undefined) {
      update.title = command.title;
    }
    if (command.description !== undefined) {
      update.description = command.description;
    }
    if (command.repositoryId !== undefined) {
      update.repositoryId = command.repositoryId;
    }
    if (command.linear !== undefined) {
      update.linear = command.linear;
    }
    const updated = ctx.stateStore.updateTask(command.taskId, update);
    if (updated === null) {
      throw new Error(`task not found: ${command.taskId}`);
    }
    ctx.publishObservedEvent(
      {
        tenantId: updated.tenantId,
        userId: updated.userId,
        workspaceId: updated.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'task-updated',
        task: ctx.taskRecord(updated),
      },
    );
    return {
      task: ctx.taskRecord(updated),
    };
  }

  if (command.type === 'task.delete') {
    const existing = ctx.stateStore.getTask(command.taskId);
    if (existing === null) {
      throw new Error(`task not found: ${command.taskId}`);
    }
    ctx.stateStore.deleteTask(command.taskId);
    ctx.publishObservedEvent(
      {
        tenantId: existing.tenantId,
        userId: existing.userId,
        workspaceId: existing.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'task-deleted',
        taskId: existing.taskId,
        ts: new Date().toISOString(),
      },
    );
    return {
      deleted: true,
    };
  }

  if (command.type === 'task.claim') {
    const input: {
      taskId: string;
      controllerId: string;
      directoryId?: string;
      branchName?: string;
      baseBranch?: string;
    } = {
      taskId: command.taskId,
      controllerId: command.controllerId,
    };
    if (command.directoryId !== undefined) {
      input.directoryId = command.directoryId;
    }
    if (command.branchName !== undefined) {
      input.branchName = command.branchName;
    }
    if (command.baseBranch !== undefined) {
      input.baseBranch = command.baseBranch;
    }
    const task = ctx.stateStore.claimTask(input);
    ctx.publishObservedEvent(
      {
        tenantId: task.tenantId,
        userId: task.userId,
        workspaceId: task.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'task-updated',
        task: ctx.taskRecord(task),
      },
    );
    return {
      task: ctx.taskRecord(task),
    };
  }

  if (command.type === 'task.complete') {
    const task = ctx.stateStore.completeTask(command.taskId);
    ctx.publishObservedEvent(
      {
        tenantId: task.tenantId,
        userId: task.userId,
        workspaceId: task.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'task-updated',
        task: ctx.taskRecord(task),
      },
    );
    return {
      task: ctx.taskRecord(task),
    };
  }

  if (command.type === 'task.queue') {
    const task = ctx.stateStore.readyTask(command.taskId);
    ctx.publishObservedEvent(
      {
        tenantId: task.tenantId,
        userId: task.userId,
        workspaceId: task.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'task-updated',
        task: ctx.taskRecord(task),
      },
    );
    return {
      task: ctx.taskRecord(task),
    };
  }

  if (command.type === 'task.ready') {
    const task = ctx.stateStore.readyTask(command.taskId);
    ctx.publishObservedEvent(
      {
        tenantId: task.tenantId,
        userId: task.userId,
        workspaceId: task.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'task-updated',
        task: ctx.taskRecord(task),
      },
    );
    return {
      task: ctx.taskRecord(task),
    };
  }

  if (command.type === 'task.draft') {
    const task = ctx.stateStore.draftTask(command.taskId);
    ctx.publishObservedEvent(
      {
        tenantId: task.tenantId,
        userId: task.userId,
        workspaceId: task.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'task-updated',
        task: ctx.taskRecord(task),
      },
    );
    return {
      task: ctx.taskRecord(task),
    };
  }

  if (command.type === 'task.reorder') {
    const tasks = ctx.stateStore
      .reorderTasks({
        tenantId: command.tenantId,
        userId: command.userId,
        workspaceId: command.workspaceId,
        orderedTaskIds: command.orderedTaskIds,
      })
      .map((task) => ctx.taskRecord(task));
    ctx.publishObservedEvent(
      {
        tenantId: command.tenantId,
        userId: command.userId,
        workspaceId: command.workspaceId,
        directoryId: null,
        conversationId: null,
      },
      {
        type: 'task-reordered',
        tasks,
        ts: new Date().toISOString(),
      },
    );
    return {
      tasks,
    };
  }

  if (command.type === 'stream.subscribe') {
    const subscriptionId = `subscription-${randomUUID()}`;
    const filter: StreamSubscriptionFilter = {
      includeOutput: command.includeOutput ?? false,
    };
    if (command.tenantId !== undefined) {
      filter.tenantId = command.tenantId;
    }
    if (command.userId !== undefined) {
      filter.userId = command.userId;
    }
    if (command.workspaceId !== undefined) {
      filter.workspaceId = command.workspaceId;
    }
    if (command.repositoryId !== undefined) {
      filter.repositoryId = command.repositoryId;
    }
    if (command.taskId !== undefined) {
      filter.taskId = command.taskId;
    }
    if (command.directoryId !== undefined) {
      filter.directoryId = command.directoryId;
    }
    if (command.conversationId !== undefined) {
      filter.conversationId = command.conversationId;
    }

    ctx.streamSubscriptions.set(subscriptionId, {
      id: subscriptionId,
      connectionId: connection.id,
      filter,
    });
    connection.streamSubscriptionIds.add(subscriptionId);

    const afterCursor = command.afterCursor ?? 0;
    for (const entry of ctx.streamJournal) {
      if (entry.cursor <= afterCursor) {
        continue;
      }
      if (!ctx.matchesObservedFilter(entry.scope, entry.event, filter)) {
        continue;
      }
      const diagnosticSessionId = ctx.diagnosticSessionIdForObservedEvent(entry.scope, entry.event);
      ctx.sendToConnection(
        connection.id,
        {
          kind: 'stream.event',
          subscriptionId,
          cursor: entry.cursor,
          event: entry.event,
        },
        diagnosticSessionId,
      );
    }

    return {
      subscriptionId,
      cursor: ctx.streamCursor,
    };
  }

  if (command.type === 'stream.unsubscribe') {
    const subscription = ctx.streamSubscriptions.get(command.subscriptionId);
    if (subscription !== undefined) {
      const subscriptionConnection = ctx.connections.get(subscription.connectionId);
      subscriptionConnection?.streamSubscriptionIds.delete(command.subscriptionId);
      ctx.streamSubscriptions.delete(command.subscriptionId);
    }
    return {
      unsubscribed: true,
    };
  }

  if (command.type === 'session.list') {
    const sort = command.sort ?? 'attention-first';
    const filtered = [...ctx.sessions.values()].filter((state) => {
      if (command.tenantId !== undefined && state.tenantId !== command.tenantId) {
        return false;
      }
      if (command.userId !== undefined && state.userId !== command.userId) {
        return false;
      }
      if (command.workspaceId !== undefined && state.workspaceId !== command.workspaceId) {
        return false;
      }
      if (command.worktreeId !== undefined && state.worktreeId !== command.worktreeId) {
        return false;
      }
      if (command.status !== undefined && state.status !== command.status) {
        return false;
      }
      if (command.live !== undefined && (state.session !== null) !== command.live) {
        return false;
      }
      return true;
    });
    const sessions = ctx.sortSessionSummaries(filtered, sort);
    const limited = command.limit === undefined ? sessions : sessions.slice(0, command.limit);
    return {
      sessions: limited,
    };
  }

  if (command.type === 'attention.list') {
    return {
      sessions: ctx.sortSessionSummaries(
        [...ctx.sessions.values()].filter((state) => state.status === 'needs-input'),
        'attention-first',
      ),
    };
  }

  if (command.type === 'session.status') {
    const state = ctx.requireSession(command.sessionId);
    return ctx.sessionSummaryRecord(state);
  }

  if (command.type === 'session.snapshot') {
    const state = ctx.requireSession(command.sessionId);
    if (state.session === null) {
      if (state.lastSnapshot === null) {
        throw new Error(`session snapshot unavailable: ${command.sessionId}`);
      }
      const result: Record<string, unknown> = {
        sessionId: command.sessionId,
        snapshot: state.lastSnapshot,
        stale: true,
      };
      if (command.tailLines !== undefined) {
        result['buffer'] = bufferTailFromSnapshotRecord(state.lastSnapshot, command.tailLines);
      }
      return result;
    }
    const frame = state.session.snapshot();
    const snapshot = ctx.snapshotRecordFromFrame(frame);
    state.lastSnapshot = snapshot;
    const result: Record<string, unknown> = {
      sessionId: command.sessionId,
      snapshot,
      stale: false,
    };
    if (command.tailLines !== undefined) {
      result['buffer'] =
        state.session.bufferTail?.(command.tailLines) ??
        bufferTailFromFrame(frame, command.tailLines);
    }
    return result;
  }

  if (command.type === 'session.claim') {
    const state = ctx.requireSession(command.sessionId);
    const claimedAt = new Date().toISOString();
    const previousController = state.controller;
    const nextController: SessionControllerState = {
      controllerId: command.controllerId,
      controllerType: command.controllerType,
      controllerLabel: command.controllerLabel ?? null,
      claimedAt,
      connectionId: connection.id,
    };
    if (previousController === null) {
      state.controller = nextController;
      ctx.publishSessionControlObservedEvent(
        state,
        'claimed',
        ctx.toPublicSessionController(nextController),
        null,
        command.reason ?? null,
      );
      ctx.publishStatusObservedEvent(state);
      return {
        sessionId: command.sessionId,
        action: 'claimed',
        controller: ctx.toPublicSessionController(nextController),
      };
    }
    if (previousController.connectionId !== connection.id && command.takeover !== true) {
      throw new Error(
        `session is already claimed by ${ctx.controllerDisplayName(previousController)}`,
      );
    }
    state.controller = nextController;
    const action = previousController.connectionId === connection.id ? 'claimed' : 'taken-over';
    ctx.publishSessionControlObservedEvent(
      state,
      action,
      ctx.toPublicSessionController(nextController),
      ctx.toPublicSessionController(previousController),
      command.reason ?? null,
    );
    ctx.publishStatusObservedEvent(state);
    return {
      sessionId: command.sessionId,
      action,
      controller: ctx.toPublicSessionController(nextController),
    };
  }

  if (command.type === 'session.release') {
    const state = ctx.requireSession(command.sessionId);
    if (state.controller === null) {
      return {
        sessionId: command.sessionId,
        released: false,
        controller: null,
      };
    }
    if (state.controller.connectionId !== connection.id) {
      throw new Error(`session is claimed by ${ctx.controllerDisplayName(state.controller)}`);
    }
    const previousController = state.controller;
    state.controller = null;
    ctx.publishSessionControlObservedEvent(
      state,
      'released',
      null,
      ctx.toPublicSessionController(previousController),
      command.reason ?? null,
    );
    ctx.publishStatusObservedEvent(state);
    return {
      sessionId: command.sessionId,
      released: true,
      controller: null,
    };
  }

  if (command.type === 'session.respond') {
    const state = ctx.requireLiveSession(command.sessionId);
    ctx.assertConnectionCanMutateSession(connection.id, state);
    state.session.write(command.text);
    ctx.setSessionStatus(state, 'running', null, new Date().toISOString());
    return {
      responded: true,
      sentBytes: Buffer.byteLength(command.text),
    };
  }

  if (command.type === 'session.interrupt') {
    const state = ctx.requireLiveSession(command.sessionId);
    ctx.assertConnectionCanMutateSession(connection.id, state);
    state.session.write('\u0003');
    ctx.setSessionStatus(state, 'completed', null, new Date().toISOString());
    return {
      interrupted: true,
    };
  }

  if (command.type === 'session.remove') {
    const state = ctx.requireSession(command.sessionId);
    ctx.assertConnectionCanMutateSession(connection.id, state);
    ctx.destroySession(command.sessionId, true);
    return {
      removed: true,
    };
  }

  if (command.type === 'pty.start') {
    const startInput: StartSessionRuntimeInput = {
      sessionId: command.sessionId,
      args: command.args,
      initialCols: command.initialCols,
      initialRows: command.initialRows,
      ...(command.env !== undefined ? { env: command.env } : {}),
      ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
      ...(command.tenantId !== undefined ? { tenantId: command.tenantId } : {}),
      ...(command.userId !== undefined ? { userId: command.userId } : {}),
      ...(command.workspaceId !== undefined ? { workspaceId: command.workspaceId } : {}),
      ...(command.worktreeId !== undefined ? { worktreeId: command.worktreeId } : {}),
      ...(command.terminalForegroundHex !== undefined
        ? { terminalForegroundHex: command.terminalForegroundHex }
        : {}),
      ...(command.terminalBackgroundHex !== undefined
        ? { terminalBackgroundHex: command.terminalBackgroundHex }
        : {}),
    };
    ctx.startSessionRuntime(startInput);

    return {
      sessionId: command.sessionId,
    };
  }

  if (command.type === 'pty.attach') {
    const state = ctx.requireLiveSession(command.sessionId);
    const previous = state.attachmentByConnectionId.get(connection.id);
    if (previous !== undefined) {
      state.session.detach(previous);
    }

    const attachmentId = state.session.attach(
      {
        onData: (event) => {
          ctx.sendToConnection(
            connection.id,
            {
              kind: 'pty.output',
              sessionId: command.sessionId,
              cursor: event.cursor,
              chunkBase64: Buffer.from(event.chunk).toString('base64'),
            },
            command.sessionId,
          );
          const sessionState = ctx.sessions.get(command.sessionId);
          if (sessionState !== undefined) {
            if (event.cursor <= sessionState.lastObservedOutputCursor) {
              return;
            }
            sessionState.lastObservedOutputCursor = event.cursor;
            ctx.publishObservedEvent(ctx.sessionScope(sessionState), {
              type: 'session-output',
              sessionId: command.sessionId,
              outputCursor: event.cursor,
              chunkBase64: Buffer.from(event.chunk).toString('base64'),
              ts: new Date().toISOString(),
              directoryId: sessionState.directoryId,
              conversationId: sessionState.id,
            });
          }
        },
        onExit: (exit) => {
          ctx.sendToConnection(
            connection.id,
            {
              kind: 'pty.exit',
              sessionId: command.sessionId,
              exit,
            },
            command.sessionId,
          );
        },
      },
      command.sinceCursor ?? 0,
    );

    state.attachmentByConnectionId.set(connection.id, attachmentId);
    connection.attachedSessionIds.add(command.sessionId);

    return {
      latestCursor: state.session.latestCursorValue(),
    };
  }

  if (command.type === 'pty.detach') {
    ctx.detachConnectionFromSession(connection.id, command.sessionId);
    connection.attachedSessionIds.delete(command.sessionId);
    return {
      detached: true,
    };
  }

  if (command.type === 'pty.subscribe-events') {
    const state = ctx.requireSession(command.sessionId);
    state.eventSubscriberConnectionIds.add(connection.id);
    connection.eventSessionIds.add(command.sessionId);
    return {
      subscribed: true,
    };
  }

  if (command.type === 'pty.unsubscribe-events') {
    const state = ctx.requireSession(command.sessionId);
    state.eventSubscriberConnectionIds.delete(connection.id);
    connection.eventSessionIds.delete(command.sessionId);
    return {
      subscribed: false,
    };
  }

  if (command.type === 'pty.close') {
    const state = ctx.requireLiveSession(command.sessionId);
    ctx.assertConnectionCanMutateSession(connection.id, state);
    ctx.destroySession(command.sessionId, true);
    return {
      closed: true,
    };
  }

  throw new Error(`unsupported command type: ${(command as { type: string }).type}`);
}
