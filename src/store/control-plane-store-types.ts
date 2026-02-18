import type { PtyExit } from '../pty/pty_host.ts';
import type { StreamSessionRuntimeStatus } from '../control-plane/stream-protocol.ts';
import type { CodexTelemetrySource } from '../control-plane/codex-telemetry.ts';

export interface ControlPlaneDirectoryRecord {
  readonly directoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly createdAt: string;
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
  readonly createdAt: string;
  readonly archivedAt: string | null;
  readonly runtimeStatus: StreamSessionRuntimeStatus;
  readonly runtimeLive: boolean;
  readonly runtimeAttentionReason: string | null;
  readonly runtimeProcessId: number | null;
  readonly runtimeLastEventAt: string | null;
  readonly runtimeLastExit: PtyExit | null;
  readonly adapterState: Record<string, unknown>;
}

export interface ControlPlaneTelemetryRecord {
  readonly telemetryId: number;
  readonly source: CodexTelemetrySource;
  readonly sessionId: string | null;
  readonly providerThreadId: string | null;
  readonly eventName: string | null;
  readonly severity: string | null;
  readonly summary: string | null;
  readonly observedAt: string;
  readonly ingestedAt: string;
  readonly payload: Record<string, unknown>;
  readonly fingerprint: string;
}

export interface ControlPlaneTelemetrySummary {
  readonly source: CodexTelemetrySource;
  readonly eventName: string | null;
  readonly severity: string | null;
  readonly summary: string | null;
  readonly observedAt: string;
}

export type ControlPlaneTaskStatus = 'draft' | 'ready' | 'in-progress' | 'completed';
export type ControlPlaneTaskScopeKind = 'global' | 'repository' | 'project';
export type ControlPlaneTaskLinearPriority = 0 | 1 | 2 | 3 | 4;
export type ControlPlaneProjectTaskFocusMode = 'balanced' | 'own-only';
export type ControlPlaneProjectThreadSpawnMode = 'new-thread' | 'reuse-thread';
export type ControlPlaneAutomationPolicyScope = 'global' | 'repository' | 'project';

export interface ControlPlaneTaskLinearRecord {
  readonly issueId: string | null;
  readonly identifier: string | null;
  readonly url: string | null;
  readonly teamId: string | null;
  readonly projectId: string | null;
  readonly projectMilestoneId: string | null;
  readonly cycleId: string | null;
  readonly stateId: string | null;
  readonly assigneeId: string | null;
  readonly priority: ControlPlaneTaskLinearPriority | null;
  readonly estimate: number | null;
  readonly dueDate: string | null;
  readonly labelIds: readonly string[];
}

export interface TaskLinearInput {
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
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface ControlPlaneTaskRecord {
  readonly taskId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly repositoryId: string | null;
  readonly scopeKind: ControlPlaneTaskScopeKind;
  readonly projectId: string | null;
  readonly title: string;
  readonly description: string;
  readonly status: ControlPlaneTaskStatus;
  readonly orderIndex: number;
  readonly claimedByControllerId: string | null;
  readonly claimedByDirectoryId: string | null;
  readonly branchName: string | null;
  readonly baseBranch: string | null;
  readonly claimedAt: string | null;
  readonly completedAt: string | null;
  readonly linear: ControlPlaneTaskLinearRecord;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ControlPlaneProjectSettingsRecord {
  readonly directoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly pinnedBranch: string | null;
  readonly taskFocusMode: ControlPlaneProjectTaskFocusMode;
  readonly threadSpawnMode: ControlPlaneProjectThreadSpawnMode;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ControlPlaneAutomationPolicyRecord {
  readonly policyId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly scope: ControlPlaneAutomationPolicyScope;
  readonly scopeId: string | null;
  readonly automationEnabled: boolean;
  readonly frozen: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
