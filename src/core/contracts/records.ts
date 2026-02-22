import {
  parseStreamSessionStatusModel,
  type StreamSessionController,
  type StreamSessionRuntimeStatus,
  type StreamSessionStatusModel,
} from '../../control-plane/stream-protocol.ts';

export interface ControlPlaneDirectoryRecord {
  readonly directoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly createdAt: string | null;
  readonly archivedAt: string | null;
}

export interface ControlPlaneConversationRecord {
  readonly conversationId: string;
  readonly directoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly agentType: string;
  readonly adapterState: Record<string, unknown>;
  readonly runtimeStatus: StreamSessionRuntimeStatus;
  readonly runtimeStatusModel: StreamSessionStatusModel | null;
  readonly runtimeLive: boolean;
}

export interface ControlPlaneRepositoryRecord {
  readonly repositoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly remoteUrl: string;
  readonly defaultBranch: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string | null;
  readonly archivedAt: string | null;
}

export interface ControlPlaneGitSummaryRecord {
  readonly branch: string;
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
}

export interface ControlPlaneGitRepositorySnapshotRecord {
  readonly normalizedRemoteUrl: string | null;
  readonly commitCount: number | null;
  readonly lastCommitAt: string | null;
  readonly shortCommitHash: string | null;
  readonly inferredName: string | null;
  readonly defaultBranch: string | null;
}

export interface ControlPlaneDirectoryGitStatusRecord {
  readonly directoryId: string;
  readonly summary: ControlPlaneGitSummaryRecord;
  readonly repositorySnapshot: ControlPlaneGitRepositorySnapshotRecord;
  readonly repositoryId: string | null;
  readonly repository: ControlPlaneRepositoryRecord | null;
  readonly observedAt: string;
}

export type TaskStatus = 'draft' | 'ready' | 'in-progress' | 'completed';
export type TaskScopeKind = 'global' | 'repository' | 'project';

export interface ControlPlaneTaskRecord {
  readonly taskId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly repositoryId: string | null;
  readonly scopeKind: TaskScopeKind;
  readonly projectId: string | null;
  readonly title: string;
  readonly body: string;
  readonly status: TaskStatus;
  readonly orderIndex: number;
  readonly claimedByControllerId: string | null;
  readonly claimedByDirectoryId: string | null;
  readonly branchName: string | null;
  readonly baseBranch: string | null;
  readonly claimedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asRequiredString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// Accept null/undefined as null; return undefined for invalid non-string non-null values.
function asOptionalString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
}

// Accept null/string only. Undefined and other types are invalid.
function asNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseDirectoryRecord(value: unknown): ControlPlaneDirectoryRecord | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const directoryId = asRequiredString(record['directoryId']);
  const tenantId = asRequiredString(record['tenantId']);
  const userId = asRequiredString(record['userId']);
  const workspaceId = asRequiredString(record['workspaceId']);
  const path = asRequiredString(record['path']);
  const createdAt = asOptionalString(record['createdAt']);
  const archivedAt = asOptionalString(record['archivedAt']);

  if (
    directoryId === null ||
    tenantId === null ||
    userId === null ||
    workspaceId === null ||
    path === null ||
    createdAt === undefined ||
    archivedAt === undefined
  ) {
    return null;
  }

  return {
    directoryId,
    tenantId,
    userId,
    workspaceId,
    path,
    createdAt,
    archivedAt,
  };
}

export function parseConversationRecord(value: unknown): ControlPlaneConversationRecord | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const conversationId = asRequiredString(record['conversationId']);
  const directoryId = asRequiredString(record['directoryId']);
  const tenantId = asRequiredString(record['tenantId']);
  const userId = asRequiredString(record['userId']);
  const workspaceId = asRequiredString(record['workspaceId']);
  const title = asRequiredString(record['title']);
  const agentType = asRequiredString(record['agentType']);
  const adapterState = asObjectRecord(record['adapterState']);
  const runtimeStatus = record['runtimeStatus'];
  const runtimeStatusModel = parseStreamSessionStatusModel(record['runtimeStatusModel']);
  const runtimeLive = record['runtimeLive'];

  if (
    conversationId === null ||
    directoryId === null ||
    tenantId === null ||
    userId === null ||
    workspaceId === null ||
    title === null ||
    agentType === null ||
    adapterState === null ||
    runtimeStatusModel === undefined ||
    typeof runtimeLive !== 'boolean'
  ) {
    return null;
  }

  if (
    runtimeStatus !== 'running' &&
    runtimeStatus !== 'needs-input' &&
    runtimeStatus !== 'completed' &&
    runtimeStatus !== 'exited'
  ) {
    return null;
  }

  return {
    conversationId,
    directoryId,
    tenantId,
    userId,
    workspaceId,
    title,
    agentType,
    adapterState,
    runtimeStatus,
    runtimeStatusModel,
    runtimeLive,
  };
}

export function parseRepositoryRecord(value: unknown): ControlPlaneRepositoryRecord | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const repositoryId = asRequiredString(record['repositoryId']);
  const tenantId = asRequiredString(record['tenantId']);
  const userId = asRequiredString(record['userId']);
  const workspaceId = asRequiredString(record['workspaceId']);
  const name = asRequiredString(record['name']);
  const remoteUrl = asRequiredString(record['remoteUrl']);
  const defaultBranch = asRequiredString(record['defaultBranch']);
  const metadata = asObjectRecord(record['metadata']);
  const createdAt = asOptionalString(record['createdAt']);
  const archivedAt = asOptionalString(record['archivedAt']);

  if (
    repositoryId === null ||
    tenantId === null ||
    userId === null ||
    workspaceId === null ||
    name === null ||
    remoteUrl === null ||
    defaultBranch === null ||
    metadata === null ||
    createdAt === undefined ||
    archivedAt === undefined
  ) {
    return null;
  }

  return {
    repositoryId,
    tenantId,
    userId,
    workspaceId,
    name,
    remoteUrl,
    defaultBranch,
    metadata,
    createdAt,
    archivedAt,
  };
}

export function parseDirectoryGitStatusRecord(
  value: unknown,
): ControlPlaneDirectoryGitStatusRecord | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const directoryId = asRequiredString(record['directoryId']);
  const summaryRecord = asRecord(record['summary']);
  const repositorySnapshotRecord = asRecord(record['repositorySnapshot']);
  const repositoryId = asOptionalString(record['repositoryId']);
  const observedAt = asRequiredString(record['observedAt']);

  if (
    directoryId === null ||
    summaryRecord === null ||
    repositorySnapshotRecord === null ||
    repositoryId === undefined ||
    observedAt === null
  ) {
    return null;
  }

  const summaryBranch = asRequiredString(summaryRecord['branch']);
  const changedFiles = summaryRecord['changedFiles'];
  const additions = summaryRecord['additions'];
  const deletions = summaryRecord['deletions'];
  const normalizedRemoteUrl = asOptionalString(repositorySnapshotRecord['normalizedRemoteUrl']);
  const commitCountRaw = repositorySnapshotRecord['commitCount'];
  const lastCommitAt = asOptionalString(repositorySnapshotRecord['lastCommitAt']);
  const shortCommitHash = asOptionalString(repositorySnapshotRecord['shortCommitHash']);
  const inferredName = asOptionalString(repositorySnapshotRecord['inferredName']);
  const defaultBranch = asOptionalString(repositorySnapshotRecord['defaultBranch']);
  const repositoryRaw = record['repository'];
  const repository =
    repositoryRaw === null || repositoryRaw === undefined
      ? null
      : parseRepositoryRecord(repositoryRaw);

  if (
    summaryBranch === null ||
    typeof changedFiles !== 'number' ||
    !Number.isFinite(changedFiles) ||
    typeof additions !== 'number' ||
    !Number.isFinite(additions) ||
    typeof deletions !== 'number' ||
    !Number.isFinite(deletions) ||
    normalizedRemoteUrl === undefined ||
    lastCommitAt === undefined ||
    shortCommitHash === undefined ||
    inferredName === undefined ||
    defaultBranch === undefined ||
    (commitCountRaw !== null &&
      (typeof commitCountRaw !== 'number' || !Number.isFinite(commitCountRaw))) ||
    (repositoryRaw !== null && repositoryRaw !== undefined && repository === null)
  ) {
    return null;
  }

  return {
    directoryId,
    summary: {
      branch: summaryBranch,
      changedFiles,
      additions,
      deletions,
    },
    repositorySnapshot: {
      normalizedRemoteUrl,
      commitCount: commitCountRaw,
      lastCommitAt,
      shortCommitHash,
      inferredName,
      defaultBranch,
    },
    repositoryId,
    repository,
    observedAt,
  };
}

export function parseTaskStatus(value: unknown): TaskStatus | null {
  if (value === 'queued') {
    return 'ready';
  }
  if (value === 'draft' || value === 'ready' || value === 'in-progress' || value === 'completed') {
    return value;
  }
  return null;
}

function parseTaskScopeKind(
  value: unknown,
  repositoryId: string | null | undefined,
  projectId: string | null | undefined,
): TaskScopeKind | null {
  if (value === 'global' || value === 'repository' || value === 'project') {
    return value;
  }
  if (projectId !== null) {
    return 'project';
  }
  if (repositoryId !== null) {
    return 'repository';
  }
  if (value === null || value === undefined) return 'global';
  return null;
}

export function parseTaskRecord(value: unknown): ControlPlaneTaskRecord | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const taskId = asRequiredString(record['taskId']);
  const tenantId = asRequiredString(record['tenantId']);
  const userId = asRequiredString(record['userId']);
  const workspaceId = asRequiredString(record['workspaceId']);
  const repositoryId = asOptionalString(record['repositoryId']);
  const projectId = asOptionalString(record['projectId']);
  const title = asRequiredString(record['title']);
  const body = asRequiredString(record['body'] ?? record['description']);
  const status = parseTaskStatus(record['status']);
  const scopeKind = parseTaskScopeKind(record['scopeKind'], repositoryId, projectId);
  const orderIndex = record['orderIndex'];
  const claimedByControllerId = asOptionalString(record['claimedByControllerId']);
  const claimedByDirectoryId = asOptionalString(record['claimedByDirectoryId']);
  const branchName = asOptionalString(record['branchName']);
  const baseBranch = asOptionalString(record['baseBranch']);
  const claimedAt = asOptionalString(record['claimedAt']);
  const completedAt = asOptionalString(record['completedAt']);
  const createdAt = asRequiredString(record['createdAt']);
  const updatedAt = asRequiredString(record['updatedAt']);

  if (
    taskId === null ||
    tenantId === null ||
    userId === null ||
    workspaceId === null ||
    repositoryId === undefined ||
    projectId === undefined ||
    scopeKind === null ||
    title === null ||
    body === null ||
    status === null ||
    typeof orderIndex !== 'number' ||
    claimedByControllerId === undefined ||
    claimedByDirectoryId === undefined ||
    branchName === undefined ||
    baseBranch === undefined ||
    claimedAt === undefined ||
    completedAt === undefined ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }

  return {
    taskId,
    tenantId,
    userId,
    workspaceId,
    repositoryId,
    scopeKind,
    projectId,
    title,
    body,
    status,
    orderIndex,
    claimedByControllerId,
    claimedByDirectoryId,
    branchName,
    baseBranch,
    claimedAt,
    completedAt,
    createdAt,
    updatedAt,
  };
}

export function parseSessionControllerRecord(value: unknown): StreamSessionController | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const controllerId = asRequiredString(record['controllerId']);
  const controllerType = record['controllerType'];
  const controllerLabel = asNullableString(record['controllerLabel']);
  const claimedAt = asRequiredString(record['claimedAt']);

  if (
    controllerId === null ||
    (controllerType !== 'human' && controllerType !== 'agent' && controllerType !== 'automation') ||
    controllerLabel === undefined ||
    claimedAt === null
  ) {
    return null;
  }

  return {
    controllerId,
    controllerType,
    controllerLabel,
    claimedAt,
  };
}
