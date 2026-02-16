import type { StreamSessionController } from '../../control-plane/stream-protocol.ts';
import type { ConversationRailSessionSummary } from '../conversation-rail.ts';

interface ControlPlaneDirectoryRecord {
  readonly directoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly createdAt: string | null;
  readonly archivedAt: string | null;
}

interface ControlPlaneConversationRecord {
  readonly conversationId: string;
  readonly directoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly agentType: string;
  readonly adapterState: Record<string, unknown>;
  readonly runtimeStatus: ConversationRailSessionSummary['status'];
  readonly runtimeLive: boolean;
}

interface ControlPlaneRepositoryRecord {
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

type TaskStatus = 'draft' | 'ready' | 'in-progress' | 'completed';

interface ControlPlaneTaskRecord {
  readonly taskId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly description: string;
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
    archivedAt
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
    runtimeLive
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
    archivedAt
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
  const title = asRequiredString(record['title']);
  const description = asRequiredString(record['description']);
  const status = parseTaskStatus(record['status']);
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
    title === null ||
    description === null ||
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
    title,
    description,
    status,
    orderIndex,
    claimedByControllerId,
    claimedByDirectoryId,
    branchName,
    baseBranch,
    claimedAt,
    completedAt,
    createdAt,
    updatedAt
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
    claimedAt
  };
}
