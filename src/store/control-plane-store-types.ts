import type { PtyExit } from '../pty/pty_host.ts';
import type {
  StreamSessionRuntimeStatus,
  StreamSessionStatusModel,
} from '../control-plane/stream-protocol.ts';
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
  readonly runtimeStatusModel: StreamSessionStatusModel | null;
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
export type ControlPlaneProjectTaskFocusMode = 'balanced' | 'own-only';
export type ControlPlaneProjectThreadSpawnMode = 'new-thread' | 'reuse-thread';
export type ControlPlaneAutomationPolicyScope = 'global' | 'repository' | 'project';
export type ControlPlaneGitHubPrState = 'open' | 'closed';
export type ControlPlaneGitHubCiRollup =
  | 'pending'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'neutral'
  | 'none';

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
  readonly body: string;
  readonly status: ControlPlaneTaskStatus;
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

export interface ControlPlaneGitHubPullRequestRecord {
  readonly prRecordId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly directoryId: string | null;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly authorLogin: string | null;
  readonly headBranch: string;
  readonly headSha: string;
  readonly baseBranch: string;
  readonly state: ControlPlaneGitHubPrState;
  readonly isDraft: boolean;
  readonly ciRollup: ControlPlaneGitHubCiRollup;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly observedAt: string;
}

export interface ControlPlaneGitHubPrJobRecord {
  readonly jobRecordId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly prRecordId: string;
  readonly provider: 'check-run' | 'status-context';
  readonly externalId: string;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly url: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly observedAt: string;
  readonly updatedAt: string;
}

export interface ControlPlaneGitHubSyncStateRecord {
  readonly stateId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly directoryId: string | null;
  readonly branchName: string;
  readonly lastSyncAt: string;
  readonly lastSuccessAt: string | null;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
}
