import { randomUUID } from 'node:crypto';
import type {
  StreamCommand,
  StreamObservedEvent,
  StreamSessionController,
  StreamSessionRuntimeStatus,
} from './stream-protocol.ts';
import type {
  ControlPlaneAutomationPolicyRecord,
  ControlPlaneAutomationPolicyScope,
  ControlPlaneConversationRecord,
  ControlPlaneDirectoryRecord,
  ControlPlaneGitHubCiRollup,
  ControlPlaneGitHubPrJobRecord,
  ControlPlaneGitHubPullRequestRecord,
  ControlPlaneGitHubSyncStateRecord,
  ControlPlaneProjectSettingsRecord,
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
    getDirectory(directoryId: string): ControlPlaneDirectoryRecord | null;
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
      projectId?: string;
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
      projectId?: string;
      scopeKind?: 'global' | 'repository' | 'project';
      status?: 'draft' | 'ready' | 'in-progress' | 'completed';
      limit?: number;
    }): ControlPlaneTaskRecord[];
    updateTask(
      taskId: string,
      input: {
        title?: string;
        description?: string;
        repositoryId?: string | null;
        projectId?: string | null;
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
    getProjectSettings(directoryId: string): ControlPlaneProjectSettingsRecord;
    updateProjectSettings(input: {
      directoryId: string;
      pinnedBranch?: string | null;
      taskFocusMode?: 'balanced' | 'own-only';
      threadSpawnMode?: 'new-thread' | 'reuse-thread';
    }): ControlPlaneProjectSettingsRecord;
    getAutomationPolicy(input: {
      tenantId: string;
      userId: string;
      workspaceId: string;
      scope: ControlPlaneAutomationPolicyScope;
      scopeId?: string | null;
    }): ControlPlaneAutomationPolicyRecord | null;
    updateAutomationPolicy(input: {
      tenantId: string;
      userId: string;
      workspaceId: string;
      scope: ControlPlaneAutomationPolicyScope;
      scopeId?: string | null;
      automationEnabled?: boolean;
      frozen?: boolean;
    }): ControlPlaneAutomationPolicyRecord;
    upsertGitHubPullRequest(input: {
      prRecordId: string;
      tenantId: string;
      userId: string;
      workspaceId: string;
      repositoryId: string;
      directoryId?: string | null;
      owner: string;
      repo: string;
      number: number;
      title: string;
      url: string;
      authorLogin?: string | null;
      headBranch: string;
      headSha: string;
      baseBranch: string;
      state: 'open' | 'closed';
      isDraft: boolean;
      ciRollup?: ControlPlaneGitHubCiRollup;
      closedAt?: string | null;
      observedAt: string;
    }): ControlPlaneGitHubPullRequestRecord;
    getGitHubPullRequest(prRecordId: string): ControlPlaneGitHubPullRequestRecord | null;
    listGitHubPullRequests(query?: {
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      repositoryId?: string;
      directoryId?: string;
      headBranch?: string;
      state?: 'open' | 'closed';
      limit?: number;
    }): ControlPlaneGitHubPullRequestRecord[];
    updateGitHubPullRequestCiRollup(
      prRecordId: string,
      ciRollup: ControlPlaneGitHubCiRollup,
      observedAt: string,
    ): ControlPlaneGitHubPullRequestRecord | null;
    replaceGitHubPrJobs(input: {
      tenantId: string;
      userId: string;
      workspaceId: string;
      repositoryId: string;
      prRecordId: string;
      observedAt: string;
      jobs: readonly {
        jobRecordId: string;
        provider: 'check-run' | 'status-context';
        externalId: string;
        name: string;
        status: string;
        conclusion?: string | null;
        url?: string | null;
        startedAt?: string | null;
        completedAt?: string | null;
      }[];
    }): ControlPlaneGitHubPrJobRecord[];
    listGitHubPrJobs(query?: {
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      repositoryId?: string;
      prRecordId?: string;
      limit?: number;
    }): ControlPlaneGitHubPrJobRecord[];
    upsertGitHubSyncState(input: {
      stateId: string;
      tenantId: string;
      userId: string;
      workspaceId: string;
      repositoryId: string;
      directoryId?: string | null;
      branchName: string;
      lastSyncAt: string;
      lastSuccessAt?: string | null;
      lastError?: string | null;
      lastErrorAt?: string | null;
    }): ControlPlaneGitHubSyncStateRecord;
    listGitHubSyncState(query?: {
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      repositoryId?: string;
      directoryId?: string;
      branchName?: string;
      limit?: number;
    }): ControlPlaneGitHubSyncStateRecord[];
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
  readonly github: {
    enabled: boolean;
    branchStrategy: 'pinned-then-current' | 'current-only' | 'pinned-only';
    viewerLogin: string | null;
  };
  readonly githubApi: {
    openPullRequestForBranch(input: { owner: string; repo: string; headBranch: string }): Promise<{
      number: number;
      title: string;
      url: string;
      authorLogin: string | null;
      headBranch: string;
      headSha: string;
      baseBranch: string;
      state: 'open' | 'closed';
      isDraft: boolean;
      updatedAt: string;
      createdAt: string;
      closedAt: string | null;
    } | null>;
    createPullRequest(input: {
      owner: string;
      repo: string;
      title: string;
      body: string;
      head: string;
      base: string;
      draft: boolean;
    }): Promise<{
      number: number;
      title: string;
      url: string;
      authorLogin: string | null;
      headBranch: string;
      headSha: string;
      baseBranch: string;
      state: 'open' | 'closed';
      isDraft: boolean;
      updatedAt: string;
      createdAt: string;
      closedAt: string | null;
    }>;
  };
  readonly streamCursor: number;
  refreshConversationTitle(conversationId: string): Promise<{
    conversation: ControlPlaneConversationRecord;
    status: 'updated' | 'unchanged' | 'skipped';
    reason: string | null;
  }>;
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
  resolveAgentToolStatus(agentTypes?: readonly string[]): ReadonlyArray<{
    agentType: string;
    launchCommand: string;
    available: boolean;
    installCommand: string | null;
  }>;
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

function parseGitHubOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/iu.exec(trimmed);
  if (httpsMatch !== null) {
    return {
      owner: httpsMatch[1] as string,
      repo: httpsMatch[2] as string,
    };
  }
  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/iu.exec(trimmed);
  if (sshMatch !== null) {
    return {
      owner: sshMatch[1] as string,
      repo: sshMatch[2] as string,
    };
  }
  return null;
}

function resolveTrackedBranch(input: {
  strategy: 'pinned-then-current' | 'current-only' | 'pinned-only';
  pinnedBranch: string | null;
  currentBranch: string | null;
}): {
  branchName: string | null;
  source: 'pinned' | 'current' | null;
} {
  if (input.strategy === 'pinned-only') {
    return {
      branchName: input.pinnedBranch,
      source: input.pinnedBranch === null ? null : 'pinned',
    };
  }
  if (input.strategy === 'current-only') {
    return {
      branchName: input.currentBranch,
      source: input.currentBranch === null ? null : 'current',
    };
  }
  if (input.pinnedBranch !== null) {
    return {
      branchName: input.pinnedBranch,
      source: 'pinned',
    };
  }
  return {
    branchName: input.currentBranch,
    source: input.currentBranch === null ? null : 'current',
  };
}

function ciRollupFromJobs(
  jobs: readonly {
    status: string;
    conclusion: string | null;
  }[],
): ControlPlaneGitHubCiRollup {
  if (jobs.length === 0) {
    return 'none';
  }
  let hasPending = false;
  let hasFailure = false;
  let hasCancelled = false;
  for (const job of jobs) {
    const status = job.status.toLowerCase();
    const conclusion = job.conclusion?.toLowerCase() ?? null;
    if (status !== 'completed') {
      hasPending = true;
      continue;
    }
    if (
      conclusion === 'failure' ||
      conclusion === 'timed_out' ||
      conclusion === 'action_required'
    ) {
      hasFailure = true;
      continue;
    }
    if (conclusion === 'cancelled') {
      hasCancelled = true;
    }
  }
  if (hasFailure) {
    return 'failure';
  }
  if (hasPending) {
    return 'pending';
  }
  if (hasCancelled) {
    return 'cancelled';
  }
  if (
    jobs.some((job) => {
      const conclusion = job.conclusion?.toLowerCase() ?? null;
      return conclusion === 'success';
    })
  ) {
    return 'success';
  }
  return 'neutral';
}

export const streamServerCommandTestInternals = {
  parseGitHubOwnerRepo,
  resolveTrackedBranch,
  ciRollupFromJobs,
};

export async function executeStreamServerCommand(
  ctx: ExecuteCommandContext,
  connection: ConnectionState,
  command: StreamCommand,
): Promise<Record<string, unknown>> {
  const liveThreadCountByDirectory = (directoryId: string): number =>
    [...ctx.sessions.values()].filter(
      (sessionState) => sessionState.directoryId === directoryId && sessionState.session !== null,
    ).length;

  const effectiveAutomationPolicy = (input: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    repositoryId: string | null;
    directoryId: string;
  }): {
    automationEnabled: boolean;
    frozen: boolean;
    source: 'default' | 'global' | 'repository' | 'project';
  } => {
    const globalPolicy = ctx.stateStore.getAutomationPolicy({
      tenantId: input.tenantId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      scope: 'global',
      scopeId: null,
    });
    const repositoryPolicy =
      input.repositoryId === null
        ? null
        : ctx.stateStore.getAutomationPolicy({
            tenantId: input.tenantId,
            userId: input.userId,
            workspaceId: input.workspaceId,
            scope: 'repository',
            scopeId: input.repositoryId,
          });
    const projectPolicy = ctx.stateStore.getAutomationPolicy({
      tenantId: input.tenantId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      scope: 'project',
      scopeId: input.directoryId,
    });
    if (projectPolicy !== null) {
      return {
        automationEnabled: projectPolicy.automationEnabled,
        frozen: projectPolicy.frozen,
        source: 'project',
      };
    }
    if (repositoryPolicy !== null) {
      return {
        automationEnabled: repositoryPolicy.automationEnabled,
        frozen: repositoryPolicy.frozen,
        source: 'repository',
      };
    }
    if (globalPolicy !== null) {
      return {
        automationEnabled: globalPolicy.automationEnabled,
        frozen: globalPolicy.frozen,
        source: 'global',
      };
    }
    return {
      automationEnabled: true,
      frozen: false,
      source: 'default',
    };
  };

  const evaluateProjectAvailability = (input: {
    directory: ControlPlaneDirectoryRecord;
    requiredRepositoryId: string | null;
  }): {
    availability:
      | 'ready'
      | 'blocked-disabled'
      | 'blocked-frozen'
      | 'blocked-untracked'
      | 'blocked-pinned-branch'
      | 'blocked-dirty'
      | 'blocked-occupied'
      | 'blocked-repository-mismatch';
    reason: string | null;
    settings: ControlPlaneProjectSettingsRecord;
    repositoryId: string | null;
    branch: string | null;
    changedFiles: number;
    liveThreadCount: number;
    automationEnabled: boolean;
    frozen: boolean;
    automationSource: 'default' | 'global' | 'repository' | 'project';
  } => {
    const settings = ctx.stateStore.getProjectSettings(input.directory.directoryId);
    const gitStatus = ctx.gitStatusByDirectoryId.get(input.directory.directoryId);
    const repositoryId = gitStatus?.repositoryId ?? null;
    const branch = gitStatus?.summary.branch ?? null;
    const changedFiles = gitStatus?.summary.changedFiles ?? 0;
    const liveThreadCount = liveThreadCountByDirectory(input.directory.directoryId);
    const automation = effectiveAutomationPolicy({
      tenantId: input.directory.tenantId,
      userId: input.directory.userId,
      workspaceId: input.directory.workspaceId,
      repositoryId,
      directoryId: input.directory.directoryId,
    });
    if (!automation.automationEnabled) {
      return {
        availability: 'blocked-disabled',
        reason: 'automation disabled',
        settings,
        repositoryId,
        branch,
        changedFiles,
        liveThreadCount,
        automationEnabled: automation.automationEnabled,
        frozen: automation.frozen,
        automationSource: automation.source,
      };
    }
    if (automation.frozen) {
      return {
        availability: 'blocked-frozen',
        reason: 'project/repository/global automation freeze',
        settings,
        repositoryId,
        branch,
        changedFiles,
        liveThreadCount,
        automationEnabled: automation.automationEnabled,
        frozen: automation.frozen,
        automationSource: automation.source,
      };
    }
    if (gitStatus === undefined || repositoryId === null || branch === null) {
      return {
        availability: 'blocked-untracked',
        reason: 'project has no tracked repository status',
        settings,
        repositoryId,
        branch,
        changedFiles,
        liveThreadCount,
        automationEnabled: automation.automationEnabled,
        frozen: automation.frozen,
        automationSource: automation.source,
      };
    }
    if (input.requiredRepositoryId !== null && repositoryId !== input.requiredRepositoryId) {
      return {
        availability: 'blocked-repository-mismatch',
        reason: 'project repository does not match requested repository',
        settings,
        repositoryId,
        branch,
        changedFiles,
        liveThreadCount,
        automationEnabled: automation.automationEnabled,
        frozen: automation.frozen,
        automationSource: automation.source,
      };
    }
    if (settings.pinnedBranch !== null && settings.pinnedBranch !== branch) {
      return {
        availability: 'blocked-pinned-branch',
        reason: `project pinned to ${settings.pinnedBranch} but current branch is ${branch}`,
        settings,
        repositoryId,
        branch,
        changedFiles,
        liveThreadCount,
        automationEnabled: automation.automationEnabled,
        frozen: automation.frozen,
        automationSource: automation.source,
      };
    }
    if (changedFiles > 0) {
      return {
        availability: 'blocked-dirty',
        reason: 'project has pending git changes',
        settings,
        repositoryId,
        branch,
        changedFiles,
        liveThreadCount,
        automationEnabled: automation.automationEnabled,
        frozen: automation.frozen,
        automationSource: automation.source,
      };
    }
    if (liveThreadCount > 0) {
      return {
        availability: 'blocked-occupied',
        reason: 'project has a live thread',
        settings,
        repositoryId,
        branch,
        changedFiles,
        liveThreadCount,
        automationEnabled: automation.automationEnabled,
        frozen: automation.frozen,
        automationSource: automation.source,
      };
    }
    return {
      availability: 'ready',
      reason: null,
      settings,
      repositoryId,
      branch,
      changedFiles,
      liveThreadCount,
      automationEnabled: automation.automationEnabled,
      frozen: automation.frozen,
      automationSource: automation.source,
    };
  };

  const resolveProjectGitHubContext = (
    directoryId: string,
  ): {
    directory: ControlPlaneDirectoryRecord;
    repository: ControlPlaneRepositoryRecord | null;
    ownerRepo: { owner: string; repo: string } | null;
    currentBranch: string | null;
    trackedBranch: string | null;
    trackedBranchSource: 'pinned' | 'current' | null;
    settings: ControlPlaneProjectSettingsRecord;
  } => {
    const directory = ctx.stateStore.getDirectory(directoryId);
    if (directory === null || directory.archivedAt !== null) {
      throw new Error(`directory not found: ${directoryId}`);
    }
    const settings = ctx.stateStore.getProjectSettings(directoryId);
    const gitStatus = ctx.gitStatusByDirectoryId.get(directoryId);
    const repository =
      gitStatus?.repositoryId === null || gitStatus?.repositoryId === undefined
        ? null
        : ctx.stateStore.getRepository(gitStatus.repositoryId);
    const activeRepository =
      repository === null || repository.archivedAt !== null ? null : repository;
    const ownerRepo =
      activeRepository === null ? null : parseGitHubOwnerRepo(activeRepository.remoteUrl);
    const currentBranch = gitStatus?.summary.branch ?? null;
    const tracked = resolveTrackedBranch({
      strategy: ctx.github.branchStrategy,
      pinnedBranch: settings.pinnedBranch,
      currentBranch,
    });
    return {
      directory,
      repository: activeRepository,
      ownerRepo,
      currentBranch,
      trackedBranch: tracked.branchName,
      trackedBranchSource: tracked.source,
      settings,
    };
  };

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

  if (command.type === 'project.settings-get') {
    const settings = ctx.stateStore.getProjectSettings(command.directoryId);
    return {
      settings,
    };
  }

  if (command.type === 'project.settings-update') {
    const settings = ctx.stateStore.updateProjectSettings({
      directoryId: command.directoryId,
      ...(command.pinnedBranch !== undefined ? { pinnedBranch: command.pinnedBranch } : {}),
      ...(command.taskFocusMode !== undefined ? { taskFocusMode: command.taskFocusMode } : {}),
      ...(command.threadSpawnMode !== undefined
        ? { threadSpawnMode: command.threadSpawnMode }
        : {}),
    });
    return {
      settings,
    };
  }

  if (command.type === 'automation.policy-get') {
    const tenantId = command.tenantId ?? DEFAULT_TENANT_ID;
    const userId = command.userId ?? DEFAULT_USER_ID;
    const workspaceId = command.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const policy = ctx.stateStore.getAutomationPolicy({
      tenantId,
      userId,
      workspaceId,
      scope: command.scope,
      scopeId: command.scope === 'global' ? null : (command.scopeId ?? null),
    }) ?? {
      policyId: `policy-default-${command.scope}`,
      tenantId,
      userId,
      workspaceId,
      scope: command.scope,
      scopeId: command.scope === 'global' ? null : (command.scopeId ?? null),
      automationEnabled: true,
      frozen: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    return {
      policy,
    };
  }

  if (command.type === 'automation.policy-set') {
    const policy = ctx.stateStore.updateAutomationPolicy({
      tenantId: command.tenantId ?? DEFAULT_TENANT_ID,
      userId: command.userId ?? DEFAULT_USER_ID,
      workspaceId: command.workspaceId ?? DEFAULT_WORKSPACE_ID,
      scope: command.scope,
      scopeId: command.scope === 'global' ? null : (command.scopeId ?? null),
      ...(command.automationEnabled !== undefined
        ? { automationEnabled: command.automationEnabled }
        : {}),
      ...(command.frozen !== undefined ? { frozen: command.frozen } : {}),
    });
    return {
      policy,
    };
  }

  if (command.type === 'github.project-pr') {
    const resolved = resolveProjectGitHubContext(command.directoryId);
    const pr =
      resolved.repository === null || resolved.trackedBranch === null
        ? null
        : (ctx.stateStore.listGitHubPullRequests({
            repositoryId: resolved.repository.repositoryId,
            headBranch: resolved.trackedBranch,
            state: 'open',
            limit: 1,
          })[0] ?? null);
    return {
      directoryId: resolved.directory.directoryId,
      repositoryId: resolved.repository?.repositoryId ?? null,
      branchName: resolved.trackedBranch,
      branchSource: resolved.trackedBranchSource,
      repository: resolved.repository === null ? null : ctx.repositoryRecord(resolved.repository),
      pr,
    };
  }

  if (command.type === 'github.pr-list') {
    const prs = ctx.stateStore.listGitHubPullRequests({
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      ...(command.userId === undefined ? {} : { userId: command.userId }),
      ...(command.workspaceId === undefined ? {} : { workspaceId: command.workspaceId }),
      ...(command.repositoryId === undefined ? {} : { repositoryId: command.repositoryId }),
      ...(command.directoryId === undefined ? {} : { directoryId: command.directoryId }),
      ...(command.headBranch === undefined ? {} : { headBranch: command.headBranch }),
      ...(command.state === undefined ? {} : { state: command.state }),
      ...(command.limit === undefined ? {} : { limit: command.limit }),
    });
    return {
      prs,
    };
  }

  if (command.type === 'github.pr-create') {
    if (!ctx.github.enabled) {
      throw new Error('github integration is disabled');
    }
    const resolved = resolveProjectGitHubContext(command.directoryId);
    if (resolved.repository === null || resolved.ownerRepo === null) {
      throw new Error('project has no tracked github repository');
    }
    const headBranch = command.headBranch ?? resolved.trackedBranch;
    if (headBranch === null) {
      throw new Error('project has no tracked branch for github pr');
    }
    const existing = ctx.stateStore.listGitHubPullRequests({
      repositoryId: resolved.repository.repositoryId,
      headBranch,
      state: 'open',
      limit: 1,
    })[0];
    if (existing !== undefined) {
      return {
        created: false,
        existing: true,
        pr: existing,
      };
    }
    const createdAt = new Date().toISOString();
    const title = command.title ?? `PR: ${headBranch}`;
    const body = command.body ?? '';
    const baseBranch = command.baseBranch ?? resolved.repository.defaultBranch;
    let remotePr: Awaited<ReturnType<ExecuteCommandContext['githubApi']['createPullRequest']>>;
    try {
      remotePr = await ctx.githubApi.createPullRequest({
        owner: resolved.ownerRepo.owner,
        repo: resolved.ownerRepo.repo,
        title,
        body,
        head: headBranch,
        base: baseBranch,
        draft: command.draft ?? false,
      });
    } catch {
      const fallback = await ctx.githubApi.openPullRequestForBranch({
        owner: resolved.ownerRepo.owner,
        repo: resolved.ownerRepo.repo,
        headBranch,
      });
      if (fallback === null) {
        throw new Error('github pr creation failed');
      }
      remotePr = fallback;
    }
    const stored = ctx.stateStore.upsertGitHubPullRequest({
      prRecordId: `github-pr-${randomUUID()}`,
      tenantId: resolved.directory.tenantId,
      userId: resolved.directory.userId,
      workspaceId: resolved.directory.workspaceId,
      repositoryId: resolved.repository.repositoryId,
      directoryId: resolved.directory.directoryId,
      owner: resolved.ownerRepo.owner,
      repo: resolved.ownerRepo.repo,
      number: remotePr.number,
      title: remotePr.title,
      url: remotePr.url,
      authorLogin: remotePr.authorLogin,
      headBranch: remotePr.headBranch,
      headSha: remotePr.headSha,
      baseBranch: remotePr.baseBranch,
      state: remotePr.state,
      isDraft: remotePr.isDraft,
      ciRollup: 'pending',
      closedAt: remotePr.closedAt,
      observedAt: remotePr.updatedAt || createdAt,
    });
    ctx.publishObservedEvent(
      {
        tenantId: stored.tenantId,
        userId: stored.userId,
        workspaceId: stored.workspaceId,
        directoryId: stored.directoryId,
        conversationId: null,
      },
      {
        type: 'github-pr-upserted',
        pr: asRecord(stored) ?? {},
      },
    );
    return {
      created: true,
      existing: false,
      pr: stored,
    };
  }

  if (command.type === 'github.pr-jobs-list') {
    const jobs = ctx.stateStore.listGitHubPrJobs({
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      ...(command.userId === undefined ? {} : { userId: command.userId }),
      ...(command.workspaceId === undefined ? {} : { workspaceId: command.workspaceId }),
      ...(command.repositoryId === undefined ? {} : { repositoryId: command.repositoryId }),
      ...(command.prRecordId === undefined ? {} : { prRecordId: command.prRecordId }),
      ...(command.limit === undefined ? {} : { limit: command.limit }),
    });
    return {
      jobs,
      ciRollup: ciRollupFromJobs(jobs),
    };
  }

  if (command.type === 'github.repo-my-prs-url') {
    const repository = ctx.stateStore.getRepository(command.repositoryId);
    if (repository === null || repository.archivedAt !== null) {
      throw new Error(`repository not found: ${command.repositoryId}`);
    }
    const ownerRepo = parseGitHubOwnerRepo(repository.remoteUrl);
    if (ownerRepo === null) {
      throw new Error('repository is not a github remote');
    }
    const authorQuery = ctx.github.viewerLogin === null ? '@me' : ctx.github.viewerLogin;
    const query = encodeURIComponent(`is:pr is:open author:${authorQuery}`);
    return {
      url: `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/pulls?q=${query}`,
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

  if (command.type === 'conversation.title.refresh') {
    const refreshed = await ctx.refreshConversationTitle(command.conversationId);
    return {
      conversation: ctx.conversationRecord(refreshed.conversation),
      status: refreshed.status,
      reason: refreshed.reason,
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
      projectId?: string;
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
    if (command.projectId !== undefined) {
      input.projectId = command.projectId;
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
      projectId?: string;
      scopeKind?: 'global' | 'repository' | 'project';
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
    if (command.projectId !== undefined) {
      query.projectId = command.projectId;
    }
    if (command.scopeKind !== undefined) {
      query.scopeKind = command.scopeKind;
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
      projectId?: string | null;
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
    if (command.projectId !== undefined) {
      update.projectId = command.projectId;
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

  if (command.type === 'project.status') {
    const directory = ctx.stateStore.getDirectory(command.directoryId);
    if (directory === null || directory.archivedAt !== null) {
      throw new Error(`directory not found: ${command.directoryId}`);
    }
    const availability = evaluateProjectAvailability({
      directory,
      requiredRepositoryId: null,
    });
    const gitStatus = ctx.gitStatusByDirectoryId.get(directory.directoryId);
    return {
      project: ctx.directoryRecord(directory),
      repositoryId: availability.repositoryId,
      git:
        gitStatus === undefined
          ? null
          : {
              branch: gitStatus.summary.branch,
              changedFiles: gitStatus.summary.changedFiles,
              additions: gitStatus.summary.additions,
              deletions: gitStatus.summary.deletions,
            },
      settings: availability.settings,
      automation: {
        enabled: availability.automationEnabled,
        frozen: availability.frozen,
        source: availability.automationSource,
      },
      liveThreadCount: availability.liveThreadCount,
      availability: availability.availability,
      reason: availability.reason,
    };
  }

  if (command.type === 'task.pull') {
    const tenantId = command.tenantId ?? DEFAULT_TENANT_ID;
    const userId = command.userId ?? DEFAULT_USER_ID;
    const workspaceId = command.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const controllerId = command.controllerId;

    const tryClaimTask = (
      task: ControlPlaneTaskRecord,
      directoryId: string,
      settings: ControlPlaneProjectSettingsRecord,
    ): ControlPlaneTaskRecord | null => {
      try {
        return ctx.stateStore.claimTask({
          taskId: task.taskId,
          controllerId,
          directoryId,
          ...(command.branchName !== undefined
            ? { branchName: command.branchName }
            : settings.pinnedBranch === null
              ? {}
              : { branchName: settings.pinnedBranch }),
          ...(command.baseBranch !== undefined
            ? { baseBranch: command.baseBranch }
            : settings.pinnedBranch === null
              ? {}
              : { baseBranch: settings.pinnedBranch }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('task already claimed:')) {
          return null;
        }
        throw error;
      }
    };

    const pullForDirectory = (
      directory: ControlPlaneDirectoryRecord,
      requiredRepositoryId: string | null,
    ):
      | {
          task: ControlPlaneTaskRecord;
          availability: ReturnType<typeof evaluateProjectAvailability>;
        }
      | {
          task: null;
          availability: ReturnType<typeof evaluateProjectAvailability>;
        } => {
      const availability = evaluateProjectAvailability({
        directory,
        requiredRepositoryId,
      });
      if (availability.availability !== 'ready') {
        return {
          task: null,
          availability,
        };
      }
      const readyProjectTasks = ctx.stateStore.listTasks({
        tenantId,
        userId,
        workspaceId,
        scopeKind: 'project',
        projectId: directory.directoryId,
        status: 'ready',
        limit: 10000,
      });
      for (const task of readyProjectTasks) {
        const claimed = tryClaimTask(task, directory.directoryId, availability.settings);
        if (claimed !== null) {
          return {
            task: claimed,
            availability,
          };
        }
      }

      if (availability.settings.taskFocusMode !== 'own-only') {
        const repositoryId = requiredRepositoryId ?? availability.repositoryId;
        if (repositoryId !== null) {
          const readyRepositoryTasks = ctx.stateStore.listTasks({
            tenantId,
            userId,
            workspaceId,
            scopeKind: 'repository',
            repositoryId,
            status: 'ready',
            limit: 10000,
          });
          for (const task of readyRepositoryTasks) {
            const claimed = tryClaimTask(task, directory.directoryId, availability.settings);
            if (claimed !== null) {
              return {
                task: claimed,
                availability,
              };
            }
          }
        }

        const readyGlobalTasks = ctx.stateStore.listTasks({
          tenantId,
          userId,
          workspaceId,
          scopeKind: 'global',
          status: 'ready',
          limit: 10000,
        });
        for (const task of readyGlobalTasks) {
          const claimed = tryClaimTask(task, directory.directoryId, availability.settings);
          if (claimed !== null) {
            return {
              task: claimed,
              availability,
            };
          }
        }
      }

      return {
        task: null,
        availability,
      };
    };

    const publishPulledTask = (task: ControlPlaneTaskRecord): void => {
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
    };

    if (command.directoryId !== undefined) {
      const directory = ctx.stateStore.getDirectory(command.directoryId);
      if (directory === null || directory.archivedAt !== null) {
        throw new Error(`directory not found: ${command.directoryId}`);
      }
      if (
        directory.tenantId !== tenantId ||
        directory.userId !== userId ||
        directory.workspaceId !== workspaceId
      ) {
        throw new Error('task pull scope mismatch');
      }
      const result = pullForDirectory(directory, command.repositoryId ?? null);
      if (result.task !== null) {
        publishPulledTask(result.task);
      }
      return {
        task: result.task === null ? null : ctx.taskRecord(result.task),
        directoryId: directory.directoryId,
        availability: result.availability.availability,
        reason:
          result.task === null ? (result.availability.reason ?? 'no ready task available') : null,
        settings: result.availability.settings,
        repositoryId: result.availability.repositoryId,
      };
    }

    if (command.repositoryId === undefined) {
      throw new Error('task pull requires directoryId or repositoryId');
    }

    const repositoryId = command.repositoryId;
    const directories = ctx.stateStore
      .listDirectories({
        tenantId,
        userId,
        workspaceId,
        includeArchived: false,
        limit: 10000,
      })
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.directoryId.localeCompare(right.directoryId),
      );

    let bestBlocked: {
      directoryId: string;
      availability: string;
      reason: string | null;
      settings: ControlPlaneProjectSettingsRecord;
      repositoryId: string | null;
    } | null = null;
    for (const directory of directories) {
      const pulled = pullForDirectory(directory, repositoryId);
      if (pulled.task !== null) {
        publishPulledTask(pulled.task);
        return {
          task: ctx.taskRecord(pulled.task),
          directoryId: directory.directoryId,
          availability: pulled.availability.availability,
          reason: null,
          settings: pulled.availability.settings,
          repositoryId: pulled.availability.repositoryId,
        };
      }
      if (bestBlocked === null) {
        bestBlocked = {
          directoryId: directory.directoryId,
          availability: pulled.availability.availability,
          reason: pulled.availability.reason,
          settings: pulled.availability.settings,
          repositoryId: pulled.availability.repositoryId,
        };
      }
    }
    return {
      task: null,
      directoryId: bestBlocked?.directoryId ?? null,
      availability: bestBlocked?.availability ?? 'blocked-untracked',
      reason: bestBlocked?.reason ?? 'no eligible project available',
      settings: bestBlocked?.settings ?? null,
      repositoryId: bestBlocked?.repositoryId ?? null,
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

  if (command.type === 'agent.tools.status') {
    return {
      tools: ctx.resolveAgentToolStatus(command.agentTypes),
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
