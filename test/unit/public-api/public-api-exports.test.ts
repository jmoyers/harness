import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { buildCodexTelemetryConfigArgs } from '../../../src/control-plane/codex-telemetry.ts';
import { HarnessAgentRealtimeClient } from '../../../src/control-plane/agent-realtime-api.ts';
import type {
  AgentClaimSessionInput,
  AgentRealtimeConnectOptions,
  AgentRealtimeEventEnvelope,
  AgentRealtimeEventType,
  AgentRealtimeSubscriptionFilter,
  AgentReleaseSessionInput,
  AgentRepository,
  AgentRepositoryListQuery,
  AgentRepositoryUpdateInput,
  AgentRepositoryUpsertInput,
  AgentScopeQuery,
  AgentProject,
  AgentProjectListQuery,
  AgentProjectUpsertInput,
  AgentTask,
  AgentTaskClaimInput,
  AgentTaskCreateInput,
  AgentTaskListQuery,
  AgentTaskPullInput,
  AgentTaskReorderInput,
  AgentTaskStatus,
  AgentTaskUpdateInput,
  AgentProjectSettings,
  AgentProjectSettingsUpdateInput,
  AgentAutomationPolicy,
  AgentThread,
  AgentThreadCreateInput,
  AgentThreadListQuery,
  AgentThreadUpdateInput,
  AgentRealtimeSubscription,
  AgentSessionClaimResult,
  AgentSessionReleaseResult,
  AgentSessionSummary,
} from '../../../src/control-plane/agent-realtime-api.ts';
import type { ControlPlaneKeyEvent } from '../../../src/control-plane/codex-session-stream.ts';
import type {
  CodexStatusHint,
  CodexTelemetryConfigArgsInput,
} from '../../../src/control-plane/codex-telemetry.ts';
import type {
  StreamTelemetrySource,
  StreamTelemetryStatusHint,
} from '../../../src/control-plane/stream-protocol.ts';
import type {
  ControlPlaneProjectTaskFocusMode,
  ControlPlaneProjectThreadSpawnMode,
  ControlPlaneTaskScopeKind,
  ControlPlaneTaskRecord,
  ControlPlaneTelemetryRecord,
} from '../../../src/store/control-plane-store.ts';
import { statusModelFor } from '../../support/status-model.ts';

void test('public api exports stay importable and structurally typed', () => {
  const subscription: AgentRealtimeSubscriptionFilter = {
    includeOutput: false,
  };
  const connectOptions: AgentRealtimeConnectOptions = {
    host: '127.0.0.1',
    port: 9000,
    subscription,
  };
  const claimInput: AgentClaimSessionInput = {
    sessionId: 'conversation-1',
    controllerId: 'agent-1',
    controllerType: 'agent',
  };
  const releaseInput: AgentReleaseSessionInput = {
    sessionId: 'conversation-1',
  };
  const claimResult: AgentSessionClaimResult = {
    sessionId: 'conversation-1',
    action: 'claimed',
    controller: {
      controllerId: 'agent-1',
      controllerType: 'agent',
      controllerLabel: null,
      claimedAt: new Date(0).toISOString(),
    },
  };
  const releaseResult: AgentSessionReleaseResult = {
    sessionId: 'conversation-1',
    released: true,
  };
  const eventType: AgentRealtimeEventType = 'session.status';
  const eventEnvelope: AgentRealtimeEventEnvelope<'session.status'> = {
    type: 'session.status',
    subscriptionId: 'subscription-1',
    cursor: 1,
    observed: {
      type: 'session-status',
      sessionId: 'conversation-1',
      status: 'running',
      attentionReason: null,
      statusModel: statusModelFor('running'),
      live: true,
      ts: new Date(0).toISOString(),
      directoryId: null,
      conversationId: 'conversation-1',
      telemetry: null,
      controller: null,
    },
  };
  const keyEvent: ControlPlaneKeyEvent = {
    type: 'session-status',
    sessionId: 'conversation-1',
    status: 'running',
    attentionReason: null,
    statusModel: statusModelFor('running'),
    live: true,
    ts: new Date(0).toISOString(),
    directoryId: null,
    conversationId: 'conversation-1',
    telemetry: null,
    controller: null,
    cursor: 1,
  };
  const telemetryRecord: ControlPlaneTelemetryRecord = {
    telemetryId: 1,
    source: 'otlp-log',
    sessionId: 'conversation-1',
    providerThreadId: null,
    eventName: 'codex.api_request',
    severity: 'INFO',
    summary: 'ok',
    observedAt: new Date(0).toISOString(),
    ingestedAt: new Date(0).toISOString(),
    payload: {},
    fingerprint: 'fingerprint-1',
  };
  const source: StreamTelemetrySource = 'otlp-log';
  const statusHint: StreamTelemetryStatusHint = 'running';
  const codexStatus: CodexStatusHint = 'running';
  const codexConfig: CodexTelemetryConfigArgsInput = {
    endpointBaseUrl: 'http://127.0.0.1:4318',
    token: 'token',
    logUserPrompt: true,
    captureLogs: true,
    captureMetrics: true,
    captureTraces: true,
    historyPersistence: 'save-all',
  };
  const codexArgs = buildCodexTelemetryConfigArgs(codexConfig);

  const summary = null as unknown as AgentSessionSummary;
  const scope: AgentScopeQuery = {
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
  };
  const projectUpsertInput: AgentProjectUpsertInput = {
    ...scope,
    projectId: 'directory-1',
    path: '/tmp/project',
  };
  const projectListQuery: AgentProjectListQuery = {
    ...scope,
    includeArchived: true,
    limit: 5,
  };
  const threadCreateInput: AgentThreadCreateInput = {
    threadId: 'conversation-1',
    projectId: 'directory-1',
    title: 'Thread',
    agentType: 'codex',
    adapterState: {},
  };
  const threadListQuery: AgentThreadListQuery = {
    ...scope,
    projectId: 'directory-1',
    includeArchived: true,
    limit: 5,
  };
  const threadUpdateInput: AgentThreadUpdateInput = {
    title: 'Updated',
  };
  const repositoryUpsertInput: AgentRepositoryUpsertInput = {
    ...scope,
    repositoryId: 'repository-1',
    name: 'harness',
    remoteUrl: 'https://github.com/acme/harness.git',
  };
  const repositoryListQuery: AgentRepositoryListQuery = {
    ...scope,
    includeArchived: true,
    limit: 5,
  };
  const repositoryUpdateInput: AgentRepositoryUpdateInput = {
    name: 'harness-updated',
  };
  const taskStatus: AgentTaskStatus = 'ready';
  const taskCreateInput: AgentTaskCreateInput = {
    ...scope,
    taskId: 'task-1',
    repositoryId: 'repository-1',
    title: 'Task',
    body: 'details',
  };
  const taskListQuery: AgentTaskListQuery = {
    ...scope,
    repositoryId: 'repository-1',
    status: 'ready',
    limit: 5,
  };
  const taskUpdateInput: AgentTaskUpdateInput = {
    title: 'updated',
  };
  const taskClaimInput: AgentTaskClaimInput = {
    taskId: 'task-1',
    controllerId: 'agent-1',
    projectId: 'directory-1',
    branchName: 'task-branch',
    baseBranch: 'main',
  };
  const taskPullInput: AgentTaskPullInput = {
    ...scope,
    controllerId: 'agent-1',
    projectId: 'directory-1',
    repositoryId: 'repository-1',
    branchName: 'task-branch',
    baseBranch: 'main',
  };
  const projectSettings: AgentProjectSettings = {
    directoryId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    pinnedBranch: 'main',
    taskFocusMode: 'balanced',
    threadSpawnMode: 'new-thread',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const projectSettingsUpdate: AgentProjectSettingsUpdateInput = {
    pinnedBranch: null,
    taskFocusMode: 'own-only',
    threadSpawnMode: 'reuse-thread',
  };
  const automationPolicy: AgentAutomationPolicy = {
    policyId: 'policy-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    scope: 'project',
    scopeId: 'directory-1',
    automationEnabled: true,
    frozen: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const project: AgentProject = {
    projectId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    path: '/tmp/project',
    createdAt: new Date(0).toISOString(),
    archivedAt: null,
  };
  const thread: AgentThread = {
    threadId: 'conversation-1',
    projectId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    title: 'Thread',
    agentType: 'codex',
    createdAt: new Date(0).toISOString(),
    archivedAt: null,
    runtimeStatus: 'running',
    runtimeStatusModel: statusModelFor('running'),
    runtimeLive: true,
    runtimeAttentionReason: null,
    runtimeProcessId: null,
    runtimeLastEventAt: null,
    runtimeLastExit: null,
    adapterState: {},
  };
  const repository: AgentRepository = {
    repositoryId: 'repository-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    name: 'harness',
    remoteUrl: 'https://github.com/acme/harness.git',
    defaultBranch: 'main',
    metadata: {},
    createdAt: new Date(0).toISOString(),
    archivedAt: null,
  };
  const task: AgentTask = {
    taskId: 'task-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    scopeKind: 'repository',
    repositoryId: 'repository-1',
    projectId: null,
    title: 'Task',
    body: 'details',
    status: 'ready',
    orderIndex: 0,
    claimedByControllerId: null,
    claimedByProjectId: null,
    branchName: null,
    baseBranch: null,
    claimedAt: null,
    completedAt: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const taskReorderInput: AgentTaskReorderInput = {
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    orderedTaskIds: ['task-1'],
  };
  const storeTaskStatus: ControlPlaneTaskRecord['status'] = 'ready';
  const storeTaskScopeKind: ControlPlaneTaskScopeKind = 'project';
  const storeTaskFocusMode: ControlPlaneProjectTaskFocusMode = 'own-only';
  const storeThreadSpawnMode: ControlPlaneProjectThreadSpawnMode = 'new-thread';
  const subscriptionHandle = null as unknown as AgentRealtimeSubscription;

  assert.equal(connectOptions.host, '127.0.0.1');
  assert.equal(claimInput.sessionId, 'conversation-1');
  assert.equal(releaseInput.sessionId, 'conversation-1');
  assert.equal(claimResult.action, 'claimed');
  assert.equal(releaseResult.released, true);
  assert.equal(eventType, 'session.status');
  assert.equal(eventEnvelope.type, 'session.status');
  assert.equal(keyEvent.type, 'session-status');
  assert.equal(telemetryRecord.telemetryId, 1);
  assert.equal(source, 'otlp-log');
  assert.equal(statusHint, 'running');
  assert.equal(codexStatus, 'running');
  assert.equal(codexArgs.length > 0, true);
  assert.equal(summary as unknown, null as unknown);
  assert.equal(scope.tenantId, 'tenant-local');
  assert.equal(projectUpsertInput.projectId, 'directory-1');
  assert.equal(projectListQuery.includeArchived, true);
  assert.equal(threadCreateInput.threadId, 'conversation-1');
  assert.equal(threadListQuery.projectId, 'directory-1');
  assert.equal(threadUpdateInput.title, 'Updated');
  assert.equal(repositoryUpsertInput.repositoryId, 'repository-1');
  assert.equal(repositoryListQuery.limit, 5);
  assert.equal(repositoryUpdateInput.name, 'harness-updated');
  assert.equal(taskStatus, 'ready');
  assert.equal(taskCreateInput.taskId, 'task-1');
  assert.equal(taskListQuery.repositoryId, 'repository-1');
  assert.equal(taskUpdateInput.title, 'updated');
  assert.equal(taskClaimInput.taskId, 'task-1');
  assert.equal(taskPullInput.controllerId, 'agent-1');
  assert.equal(projectSettings.threadSpawnMode, 'new-thread');
  assert.equal(projectSettingsUpdate.taskFocusMode, 'own-only');
  assert.equal(automationPolicy.scope, 'project');
  assert.equal(project.projectId, 'directory-1');
  assert.equal(thread.threadId, 'conversation-1');
  assert.equal(repository.repositoryId, 'repository-1');
  assert.equal(task.taskId, 'task-1');
  assert.equal(taskReorderInput.orderedTaskIds.length, 1);
  assert.equal(storeTaskStatus, 'ready');
  assert.equal(storeTaskScopeKind, 'project');
  assert.equal(storeTaskFocusMode, 'own-only');
  assert.equal(storeThreadSpawnMode, 'new-thread');
  assert.equal(subscriptionHandle as unknown, null as unknown);
  assert.equal(typeof HarnessAgentRealtimeClient.connect, 'function');
});
