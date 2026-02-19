import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import {
  HarnessAgentRealtimeClient,
  type AgentRealtimeEventEnvelope,
  connectHarnessAgentRealtimeClient,
} from '../src/control-plane/agent-realtime-api.ts';
import type { ControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseClientEnvelope,
  type StreamClientEnvelope,
  type StreamCommand,
  type StreamServerEnvelope,
  type StreamSignal,
} from '../src/control-plane/stream-protocol.ts';
import { statusModelFor } from './support/status-model.ts';

interface MockHarnessServer {
  address: AddressInfo;
  stop: () => Promise<void>;
}

class MockRealtimeControlPlaneClient {
  readonly commands: StreamCommand[] = [];
  readonly inputCalls: Array<{ sessionId: string; chunk: Buffer }> = [];
  readonly resizeCalls: Array<{ sessionId: string; cols: number; rows: number }> = [];
  readonly signalCalls: Array<{ sessionId: string; signal: StreamSignal }> = [];
  closed = false;

  private readonly listeners = new Set<(envelope: StreamServerEnvelope) => void>();
  private readonly resultsByType = new Map<string, Record<string, unknown>[]>();
  private readonly errorsByType = new Map<string, Error[]>();

  onEnvelope(listener: (envelope: StreamServerEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(envelope: StreamServerEnvelope): void {
    for (const listener of this.listeners) {
      listener(envelope);
    }
  }

  queueResult(type: string, result: Record<string, unknown>): void {
    const queue = this.resultsByType.get(type);
    if (queue === undefined) {
      this.resultsByType.set(type, [result]);
      return;
    }
    queue.push(result);
  }

  queueError(type: string, error: Error): void {
    const queue = this.errorsByType.get(type);
    if (queue === undefined) {
      this.errorsByType.set(type, [error]);
      return;
    }
    queue.push(error);
  }

  sendCommand(command: StreamCommand): Promise<Record<string, unknown>> {
    this.commands.push(command);
    const errorQueue = this.errorsByType.get(command.type);
    if (errorQueue !== undefined && errorQueue.length > 0) {
      return Promise.reject(errorQueue.shift()!);
    }
    const resultQueue = this.resultsByType.get(command.type);
    if (resultQueue !== undefined && resultQueue.length > 0) {
      return Promise.resolve(resultQueue.shift()!);
    }
    return Promise.resolve({});
  }

  sendInput(sessionId: string, chunk: Buffer): void {
    this.inputCalls.push({
      sessionId,
      chunk,
    });
  }

  sendResize(sessionId: string, cols: number, rows: number): void {
    this.resizeCalls.push({
      sessionId,
      cols,
      rows,
    });
  }

  sendSignal(sessionId: string, signal: StreamSignal): void {
    this.signalCalls.push({
      sessionId,
      signal,
    });
  }

  close(): void {
    this.closed = true;
  }
}

function createRealtimeClientForTest(
  mockClient: MockRealtimeControlPlaneClient,
  onHandlerError?: (error: unknown, event: AgentRealtimeEventEnvelope) => void,
): {
  client: HarnessAgentRealtimeClient;
  envelopeListenerRemoved: () => boolean;
} {
  let envelopeListenerRemoved = false;
  const RealtimeClientCtor = HarnessAgentRealtimeClient as unknown as {
    new (
      client: ControlPlaneStreamClient,
      subscriptionId: string,
      removeEnvelopeListener: () => void,
      onHandlerError?: (error: unknown, event: AgentRealtimeEventEnvelope) => void,
    ): HarnessAgentRealtimeClient;
  };
  const client = new RealtimeClientCtor(
    mockClient as unknown as ControlPlaneStreamClient,
    'subscription-test',
    () => {
      envelopeListenerRemoved = true;
    },
    onHandlerError,
  );
  return {
    client,
    envelopeListenerRemoved: () => envelopeListenerRemoved,
  };
}

async function startMockHarnessServer(
  onMessage: (socket: Socket, envelope: StreamClientEnvelope) => void,
): Promise<MockHarnessServer> {
  const server = createServer((socket) => {
    let remainder = '';
    socket.on('data', (chunk: Buffer) => {
      const consumed = consumeJsonLines(`${remainder}${chunk.toString('utf8')}`);
      remainder = consumed.remainder;
      for (const message of consumed.messages) {
        const parsed = parseClientEnvelope(message);
        if (parsed === null) {
          continue;
        }
        onMessage(socket, parsed);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected tcp address');
  }

  return {
    address,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined && error !== null) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

void test('agent realtime client exposes typed CRUD wrappers for projects threads repositories tasks and subscriptions', async () => {
  const mockClient = new MockRealtimeControlPlaneClient();
  const realtime = createRealtimeClientForTest(mockClient);
  const timestamp = '2026-02-01T00:00:00.000Z';

  const projectRecord = {
    directoryId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    path: '/tmp/project',
    createdAt: timestamp,
    archivedAt: null,
  };
  const projectUpdatedRecord = {
    ...projectRecord,
    path: '/tmp/project-updated',
  };
  const projectArchivedRecord = {
    ...projectUpdatedRecord,
    archivedAt: timestamp,
  };
  const malformedProjectRecord = {
    directoryId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    createdAt: timestamp,
    archivedAt: null,
  };
  const threadRecord = {
    conversationId: 'conversation-1',
    directoryId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    title: 'Thread One',
    agentType: 'codex',
    createdAt: timestamp,
    archivedAt: null,
    runtimeStatus: 'running',
    runtimeStatusModel: statusModelFor('running', {
      observedAt: timestamp,
    }),
    runtimeLive: true,
    runtimeAttentionReason: null,
    runtimeProcessId: null,
    runtimeLastEventAt: timestamp,
    runtimeLastExit: {
      code: null,
      signal: 'SIGTERM',
    },
    adapterState: {},
  };
  const malformedThreadRecord = {
    ...threadRecord,
    archivedAt: 123,
    runtimeProcessId: 'invalid-number',
    runtimeLastExit: {
      code: 1,
      signal: 9,
    },
  };
  const regexMalformedThreadRecord = {
    ...threadRecord,
    runtimeLastExit: {
      code: 1,
      signal: 'BAD',
    },
  };
  const undefinedSignalThreadRecord = {
    conversationId: 'conversation-1',
    directoryId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    title: 'Thread bad signal',
    agentType: 'codex',
    createdAt: timestamp,
    archivedAt: null,
    runtimeStatus: 'running',
    runtimeStatusModel: statusModelFor('running', {
      observedAt: timestamp,
    }),
    runtimeLive: true,
    runtimeAttentionReason: null,
    runtimeLastEventAt: timestamp,
    runtimeLastExit: {},
    adapterState: {},
  };
  const nullSignalThreadRecord = {
    ...threadRecord,
    runtimeLastExit: {
      code: 'invalid-code',
      signal: null,
    },
  };
  const nonObjectExitThreadRecord = {
    ...threadRecord,
    runtimeLastExit: 'invalid-exit',
  };
  const invalidRuntimeLiveThreadRecord = {
    ...threadRecord,
    runtimeLive: 'invalid-runtime-live',
  };
  const missingExitThreadRecord = {
    conversationId: 'conversation-1',
    directoryId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    title: 'Thread bad status',
    agentType: 'codex',
    createdAt: timestamp,
    archivedAt: null,
    runtimeStatus: 'unknown',
    runtimeLive: true,
    runtimeAttentionReason: null,
    runtimeProcessId: null,
    runtimeLastEventAt: timestamp,
    adapterState: {},
  };
  const threadUpdatedRecord = {
    ...threadRecord,
    title: 'Thread One Updated',
  };
  const threadArchivedRecord = {
    ...threadUpdatedRecord,
    archivedAt: timestamp,
    runtimeLastExit: null,
  };
  const repositoryRecord = {
    repositoryId: 'repository-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    name: 'harness',
    remoteUrl: 'https://github.com/acme/harness.git',
    defaultBranch: 'main',
    metadata: {
      provider: 'github',
    },
    createdAt: timestamp,
    archivedAt: null,
  };
  const repositoryUpdatedRecord = {
    ...repositoryRecord,
    name: 'harness-updated',
  };
  const repositoryArchivedRecord = {
    ...repositoryUpdatedRecord,
    archivedAt: timestamp,
  };
  const projectSettingsRecord = {
    directoryId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    pinnedBranch: 'main',
    taskFocusMode: 'balanced',
    threadSpawnMode: 'new-thread',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const automationPolicyRecord = {
    policyId: 'policy-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    scope: 'project',
    scopeId: 'directory-1',
    automationEnabled: true,
    frozen: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const taskRecord = {
    taskId: 'task-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    repositoryId: 'repository-1',
    scopeKind: 'repository',
    projectId: null,
    title: 'implement api',
    body: 'details',
    status: 'ready',
    orderIndex: 0,
    claimedByControllerId: null,
    claimedByDirectoryId: null,
    branchName: null,
    baseBranch: null,
    claimedAt: null,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const taskClaimedRecord = {
    ...taskRecord,
    status: 'in-progress',
    claimedByControllerId: 'agent-1',
    claimedByDirectoryId: 'directory-1',
    branchName: 'task-branch',
    baseBranch: 'main',
    claimedAt: timestamp,
    updatedAt: timestamp,
  };
  const taskCompletedRecord = {
    ...taskClaimedRecord,
    status: 'completed',
    completedAt: timestamp,
  };

  mockClient.queueResult('stream.subscribe', {
    subscriptionId: 'subscription-extra',
    cursor: 44,
  });
  mockClient.queueResult('stream.subscribe', {
    subscriptionId: 'subscription-malformed',
    cursor: 45,
  });
  mockClient.queueResult('stream.unsubscribe', {
    unsubscribed: true,
  });
  mockClient.queueResult('stream.unsubscribe', {});

  mockClient.queueResult('directory.upsert', {
    directory: projectRecord,
  });
  mockClient.queueResult('directory.upsert', {
    directory: projectRecord,
  });
  mockClient.queueResult('directory.upsert', {
    directory: projectUpdatedRecord,
  });
  mockClient.queueResult('directory.upsert', {
    directory: [],
  });
  mockClient.queueResult('directory.upsert', {
    directory: malformedProjectRecord,
  });
  mockClient.queueResult('directory.list', {
    directories: [projectRecord],
  });
  mockClient.queueResult('directory.list', {
    directories: [projectRecord],
  });
  mockClient.queueResult('directory.list', {
    directories: [],
  });
  mockClient.queueResult('directory.list', {
    directories: {},
  });
  mockClient.queueResult('directory.git-status', {
    gitStatuses: [
      {
        directoryId: 'directory-1',
        summary: {
          branch: 'main',
          changedFiles: 1,
          additions: 2,
          deletions: 0,
        },
        repositorySnapshot: {
          normalizedRemoteUrl: 'https://github.com/acme/harness.git',
          commitCount: 10,
          lastCommitAt: timestamp,
          shortCommitHash: 'abc1234',
          inferredName: 'harness',
          defaultBranch: 'main',
        },
        repositoryId: 'repository-1',
        repository: repositoryRecord,
        observedAt: timestamp,
      },
    ],
  });
  mockClient.queueResult('directory.git-status', {
    gitStatuses: [{}],
  });
  mockClient.queueResult('directory.archive', {
    directory: projectArchivedRecord,
  });
  mockClient.queueResult('project.status', {
    availability: 'ready',
    reason: null,
    repositoryId: 'repository-1',
    settings: projectSettingsRecord,
    project: projectRecord,
    git: null,
    automation: {
      enabled: true,
      frozen: false,
      source: 'default',
    },
    liveThreadCount: 0,
  });
  mockClient.queueResult('project.settings-get', {
    settings: projectSettingsRecord,
  });
  mockClient.queueResult('project.settings-get', {
    settings: {
      ...projectSettingsRecord,
      taskFocusMode: 'unsupported',
    },
  });
  mockClient.queueResult('project.settings-update', {
    settings: {
      ...projectSettingsRecord,
      pinnedBranch: null,
      taskFocusMode: 'own-only',
      threadSpawnMode: 'reuse-thread',
    },
  });
  mockClient.queueResult('project.settings-update', {
    settings: {
      ...projectSettingsRecord,
      threadSpawnMode: 'unsupported',
    },
  });

  mockClient.queueResult('conversation.create', {
    conversation: threadRecord,
  });
  mockClient.queueResult('conversation.create', {
    conversation: malformedThreadRecord as unknown as Record<string, unknown>,
  });
  mockClient.queueResult('conversation.list', {
    conversations: [threadRecord],
  });
  mockClient.queueResult('conversation.list', {
    conversations: [threadRecord],
  });
  mockClient.queueResult('conversation.list', {
    conversations: [],
  });
  mockClient.queueResult('conversation.update', {
    conversation: threadUpdatedRecord,
  });
  mockClient.queueResult('conversation.update', {
    conversation: regexMalformedThreadRecord as unknown as Record<string, unknown>,
  });
  mockClient.queueResult('conversation.update', {
    conversation: undefinedSignalThreadRecord as unknown as Record<string, unknown>,
  });
  mockClient.queueResult('conversation.update', {
    conversation: nullSignalThreadRecord as unknown as Record<string, unknown>,
  });
  mockClient.queueResult('conversation.update', {
    conversation: nonObjectExitThreadRecord as unknown as Record<string, unknown>,
  });
  mockClient.queueResult('conversation.update', {
    conversation: invalidRuntimeLiveThreadRecord as unknown as Record<string, unknown>,
  });
  mockClient.queueResult('conversation.update', {
    conversation: missingExitThreadRecord as unknown as Record<string, unknown>,
  });
  mockClient.queueResult('conversation.archive', {
    conversation: threadArchivedRecord,
  });
  mockClient.queueResult('conversation.archive', {
    conversation: [],
  });
  mockClient.queueResult('conversation.delete', {
    deleted: true,
  });
  mockClient.queueResult('conversation.delete', {});
  mockClient.queueResult('session.status', {
    sessionId: 'conversation-1',
    directoryId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    worktreeId: 'worktree-local',
    status: 'running',
    attentionReason: null,
    statusModel: statusModelFor('running', {
      observedAt: timestamp,
    }),
    latestCursor: 7,
    processId: 51000,
    attachedClients: 1,
    eventSubscribers: 1,
    startedAt: timestamp,
    lastEventAt: timestamp,
    lastExit: null,
    exitedAt: null,
    live: true,
    launchCommand: null,
    controller: null,
    telemetry: null,
  });

  mockClient.queueResult('repository.upsert', {
    repository: repositoryRecord,
  });
  mockClient.queueResult('repository.upsert', {
    repository: repositoryRecord,
  });
  mockClient.queueResult('repository.upsert', {
    repository: [],
  });
  mockClient.queueResult('repository.get', {
    repository: repositoryRecord,
  });
  mockClient.queueResult('repository.list', {
    repositories: [repositoryRecord],
  });
  mockClient.queueResult('repository.list', {
    repositories: [{}],
  });
  mockClient.queueResult('repository.update', {
    repository: repositoryUpdatedRecord,
  });
  mockClient.queueResult('repository.archive', {
    repository: repositoryArchivedRecord,
  });

  mockClient.queueResult('task.create', {
    task: taskRecord,
  });
  mockClient.queueResult('task.create', {
    task: [],
  });
  mockClient.queueResult('task.get', {
    task: taskRecord,
  });
  mockClient.queueResult('task.list', {
    tasks: [taskRecord],
  });
  mockClient.queueResult('task.list', {
    tasks: [{}],
  });
  mockClient.queueResult('task.update', {
    task: taskClaimedRecord,
  });
  mockClient.queueResult('task.delete', {
    deleted: true,
  });
  mockClient.queueResult('task.delete', {});
  mockClient.queueResult('task.claim', {
    task: taskClaimedRecord,
  });
  mockClient.queueResult('task.pull', {
    task: taskClaimedRecord,
    directoryId: 'directory-1',
    availability: 'ready',
    reason: null,
    settings: projectSettingsRecord,
    repositoryId: 'repository-1',
  });
  mockClient.queueResult('task.pull', {
    task: null,
    directoryId: null,
    availability: 'blocked-untracked',
    reason: 'no eligible project available',
    settings: null,
    repositoryId: null,
  });
  mockClient.queueResult('task.pull', {
    task: [],
    directoryId: 'directory-1',
    availability: 'ready',
    reason: null,
    settings: projectSettingsRecord,
    repositoryId: 'repository-1',
  });
  mockClient.queueResult('task.pull', {
    task: null,
    directoryId: 7,
    availability: 'blocked-untracked',
    reason: null,
    settings: null,
    repositoryId: null,
  });
  mockClient.queueResult('task.complete', {
    task: taskCompletedRecord,
  });
  mockClient.queueResult('task.ready', {
    task: taskRecord,
  });
  mockClient.queueResult('task.queue', {
    task: taskRecord,
  });
  mockClient.queueResult('task.reorder', {
    tasks: [taskRecord],
  });
  mockClient.queueResult('automation.policy-get', {
    policy: automationPolicyRecord,
  });
  mockClient.queueResult('automation.policy-get', {
    policy: {
      ...automationPolicyRecord,
      scope: 'unsupported',
    },
  });
  mockClient.queueResult('automation.policy-set', {
    policy: {
      ...automationPolicyRecord,
      scope: 'repository',
      scopeId: 'repository-1',
      automationEnabled: false,
      frozen: true,
    },
  });
  mockClient.queueResult('automation.policy-set', {
    policy: {
      ...automationPolicyRecord,
      scope: 'repository',
      scopeId: 'repository-1',
      automationEnabled: 'invalid',
    },
  });

  const createdSub = await realtime.client.subscriptions.create({
    taskId: 'task-1',
  });
  assert.equal(createdSub.subscriptionId, 'subscription-extra');
  const removedSub = await createdSub.unsubscribe();
  assert.equal(removedSub.unsubscribed, true);
  const unknownViaWrapper = await realtime.client.subscriptions.remove(
    'subscription-unknown-wrapper',
  );
  assert.equal(unknownViaWrapper.unsubscribed, false);
  const unknownUnsubscribed = await realtime.client.unsubscribe('subscription-unknown');
  assert.equal(unknownUnsubscribed.unsubscribed, false);
  const malformedSub = await realtime.client.subscribe({
    repositoryId: 'repository-1',
  });
  await assert.rejects(
    realtime.client.unsubscribe(malformedSub.subscriptionId),
    /stream\.unsubscribe returned malformed response/,
  );

  const createdProject = await realtime.client.projects.create({
    projectId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    path: '/tmp/project',
  });
  assert.equal(createdProject.projectId, 'directory-1');
  const upsertedProject = await realtime.client.projects.upsert({
    path: '/tmp/project',
  });
  assert.equal(upsertedProject.path, '/tmp/project');
  const updatedProject = await realtime.client.projects.update('directory-1', {
    path: '/tmp/project-updated',
  });
  assert.equal(updatedProject.path, '/tmp/project-updated');
  const listedProjects = await realtime.client.projects.list({
    tenantId: 'tenant-local',
  });
  assert.equal(listedProjects.length, 1);
  const listedProjectGitStatus = await realtime.client.projects.listGitStatus({
    projectId: 'directory-1',
  });
  assert.equal(listedProjectGitStatus.length, 1);
  assert.equal(listedProjectGitStatus[0]?.repositoryId, 'repository-1');
  await assert.rejects(
    realtime.client.projects.listGitStatus(),
    /directory\.git-status returned malformed statuses/,
  );
  const fetchedProject = await realtime.client.projects.get('directory-1');
  assert.equal(fetchedProject.projectId, 'directory-1');
  await assert.rejects(realtime.client.projects.get('directory-missing'), /project not found/);
  const archivedProject = await realtime.client.projects.archive('directory-1');
  assert.equal(archivedProject.archivedAt, timestamp);
  const projectStatus = await realtime.client.projects.status('directory-1');
  assert.equal(projectStatus['availability'], 'ready');
  const projectSettings = await realtime.client.projects.settings.get('directory-1');
  assert.equal(projectSettings.pinnedBranch, 'main');
  await assert.rejects(
    realtime.client.projects.settings.get('directory-1'),
    /project\.settings-get returned malformed settings/,
  );
  const updatedProjectSettings = await realtime.client.projects.settings.update('directory-1', {
    pinnedBranch: null,
    taskFocusMode: 'own-only',
    threadSpawnMode: 'reuse-thread',
  });
  assert.equal(updatedProjectSettings.taskFocusMode, 'own-only');
  await assert.rejects(
    realtime.client.projects.settings.update('directory-1', {
      threadSpawnMode: 'reuse-thread',
    }),
    /project\.settings-update returned malformed settings/,
  );
  await assert.rejects(
    realtime.client.upsertProject({
      path: '/tmp/bad',
    }),
    /directory\.upsert returned malformed project/,
  );
  await assert.rejects(
    realtime.client.upsertProject({
      path: '/tmp/bad-2',
    }),
    /directory\.upsert returned malformed project/,
  );
  await assert.rejects(
    realtime.client.projects.list(),
    /directory\.list returned malformed projects/,
  );

  const createdThread = await realtime.client.threads.create({
    threadId: 'conversation-1',
    projectId: 'directory-1',
    title: 'Thread One',
    agentType: 'codex',
    adapterState: {},
  });
  assert.equal(createdThread.threadId, 'conversation-1');
  await assert.rejects(
    realtime.client.createThread({
      projectId: 'directory-1',
      title: 'bad',
      agentType: 'codex',
    }),
    /conversation\.create returned malformed thread/,
  );
  const listedThreads = await realtime.client.threads.list({
    projectId: 'directory-1',
  });
  assert.equal(listedThreads.length, 1);
  const fetchedThread = await realtime.client.threads.get('conversation-1');
  assert.equal(fetchedThread.threadId, 'conversation-1');
  await assert.rejects(realtime.client.threads.get('conversation-missing'), /thread not found/);
  const updatedThread = await realtime.client.threads.update('conversation-1', {
    title: 'Thread One Updated',
  });
  assert.equal(updatedThread.title, 'Thread One Updated');
  await assert.rejects(
    realtime.client.threads.update('conversation-1', {
      title: 'bad update',
    }),
    /conversation\.update returned malformed thread/,
  );
  await assert.rejects(
    realtime.client.threads.update('conversation-1', {
      title: 'bad update missing signal',
    }),
    /conversation\.update returned malformed thread/,
  );
  await assert.rejects(
    realtime.client.threads.update('conversation-1', {
      title: 'bad update null signal',
    }),
    /conversation\.update returned malformed thread/,
  );
  await assert.rejects(
    realtime.client.threads.update('conversation-1', {
      title: 'bad update non-object exit',
    }),
    /conversation\.update returned malformed thread/,
  );
  await assert.rejects(
    realtime.client.threads.update('conversation-1', {
      title: 'bad update invalid runtime live',
    }),
    /conversation\.update returned malformed thread/,
  );
  await assert.rejects(
    realtime.client.threads.update('conversation-1', {
      title: 'bad update missing exit',
    }),
    /conversation\.update returned malformed thread/,
  );
  const archivedThread = await realtime.client.threads.archive('conversation-1');
  assert.equal(archivedThread.archivedAt, timestamp);
  await assert.rejects(
    realtime.client.threads.archive('conversation-1'),
    /conversation\.archive returned malformed thread/,
  );
  const deletedThread = await realtime.client.threads.delete('conversation-1');
  assert.equal(deletedThread.deleted, true);
  await assert.rejects(realtime.client.threads.delete('conversation-1'), /malformed response/);
  const threadStatus = await realtime.client.threads.status('conversation-1');
  assert.equal(threadStatus.sessionId, 'conversation-1');

  const createdRepository = await realtime.client.repositories.create({
    repositoryId: 'repository-1',
    name: 'harness',
    remoteUrl: 'https://github.com/acme/harness.git',
    metadata: {
      provider: 'github',
    },
  });
  assert.equal(createdRepository.repositoryId, 'repository-1');
  const upsertedRepository = await realtime.client.repositories.upsert({
    name: 'harness',
    remoteUrl: 'https://github.com/acme/harness.git',
  });
  assert.equal(upsertedRepository.name, 'harness');
  await assert.rejects(
    realtime.client.repositories.upsert({
      name: 'bad',
      remoteUrl: 'https://github.com/acme/harness.git',
    }),
    /repository\.upsert returned malformed repository/,
  );
  const fetchedRepository = await realtime.client.repositories.get('repository-1');
  assert.equal(fetchedRepository.repositoryId, 'repository-1');
  const listedRepositories = await realtime.client.repositories.list();
  assert.equal(listedRepositories.length, 1);
  await assert.rejects(
    realtime.client.repositories.list(),
    /repository\.list returned malformed repositories/,
  );
  const updatedRepository = await realtime.client.repositories.update('repository-1', {
    name: 'harness-updated',
  });
  assert.equal(updatedRepository.name, 'harness-updated');
  const archivedRepository = await realtime.client.repositories.archive('repository-1');
  assert.equal(archivedRepository.archivedAt, timestamp);

  const createdTask = await realtime.client.tasks.create({
    taskId: 'task-1',
    repositoryId: 'repository-1',
    title: 'implement api',
    body: 'details',
  });
  assert.equal(createdTask.taskId, 'task-1');
  await assert.rejects(
    realtime.client.createTask({
      title: 'bad',
      body: 'bad body',
    }),
    /task\.create returned malformed task/,
  );
  const fetchedTask = await realtime.client.tasks.get('task-1');
  assert.equal(fetchedTask.taskId, 'task-1');
  const listedTasks = await realtime.client.tasks.list({
    repositoryId: 'repository-1',
  });
  assert.equal(listedTasks.length, 1);
  await assert.rejects(realtime.client.tasks.list(), /task\.list returned malformed tasks/);
  const updatedTask = await realtime.client.tasks.update('task-1', {
    title: 'updated',
  });
  assert.equal(updatedTask.status, 'in-progress');
  const deletedTask = await realtime.client.tasks.delete('task-1');
  assert.equal(deletedTask.deleted, true);
  await assert.rejects(realtime.client.tasks.delete('task-1'), /malformed response/);
  const claimedTask = await realtime.client.tasks.claim({
    taskId: 'task-1',
    controllerId: 'agent-1',
    projectId: 'directory-1',
    branchName: 'task-branch',
    baseBranch: 'main',
  });
  assert.equal(claimedTask.claimedByProjectId, 'directory-1');
  const pulledTask = await realtime.client.tasks.pull({
    controllerId: 'agent-1',
    projectId: 'directory-1',
    repositoryId: 'repository-1',
  });
  assert.equal(pulledTask.task?.taskId, 'task-1');
  assert.equal(pulledTask.settings?.threadSpawnMode, 'new-thread');
  const blockedPull = await realtime.client.tasks.pull({
    controllerId: 'agent-1',
    repositoryId: 'repository-1',
  });
  assert.equal(blockedPull.task, null);
  assert.equal(blockedPull.availability, 'blocked-untracked');
  await assert.rejects(
    realtime.client.tasks.pull({
      controllerId: 'agent-1',
      projectId: 'directory-1',
    }),
    /task\.pull returned malformed task/,
  );
  await assert.rejects(
    realtime.client.tasks.pull({
      controllerId: 'agent-1',
      repositoryId: 'repository-1',
    }),
    /task\.pull returned malformed response/,
  );
  const completedTask = await realtime.client.tasks.complete('task-1');
  assert.equal(completedTask.status, 'completed');
  const readyTask = await realtime.client.tasks.ready('task-1');
  assert.equal(readyTask.status, 'ready');
  const queuedTask = await realtime.client.tasks.queue('task-1');
  assert.equal(queuedTask.status, 'ready');
  const reorderedTasks = await realtime.client.tasks.reorder({
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    orderedTaskIds: ['task-1'],
  });
  assert.equal(reorderedTasks.length, 1);
  const fetchedPolicy = await realtime.client.automation.getPolicy({
    scope: 'project',
    scopeId: 'directory-1',
  });
  assert.equal(fetchedPolicy.scope, 'project');
  await assert.rejects(
    realtime.client.automation.getPolicy({
      scope: 'project',
      scopeId: 'directory-1',
    }),
    /automation\.policy-get returned malformed policy/,
  );
  const updatedPolicy = await realtime.client.automation.setPolicy({
    scope: 'repository',
    scopeId: 'repository-1',
    automationEnabled: false,
    frozen: true,
  });
  assert.equal(updatedPolicy.frozen, true);
  await assert.rejects(
    realtime.client.automation.setPolicy({
      scope: 'repository',
      scopeId: 'repository-1',
    }),
    /automation\.policy-set returned malformed policy/,
  );

  mockClient.queueError('stream.unsubscribe', new Error('unsubscribe failed'));
  await realtime.client.close();
});

void test('agent realtime client accepts draft task status and completed thread runtime status', async () => {
  const mockClient = new MockRealtimeControlPlaneClient();
  const realtime = createRealtimeClientForTest(mockClient);
  const timestamp = '2026-02-01T00:00:00.000Z';

  mockClient.queueResult('conversation.list', {
    conversations: [
      {
        conversationId: 'conversation-runtime-completed',
        directoryId: 'directory-1',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        title: 'Completed Thread',
        agentType: 'codex',
        createdAt: timestamp,
        archivedAt: null,
        runtimeStatus: 'completed',
        runtimeStatusModel: statusModelFor('completed', {
          observedAt: timestamp,
        }),
        runtimeLive: false,
        runtimeAttentionReason: null,
        runtimeProcessId: null,
        runtimeLastEventAt: timestamp,
        runtimeLastExit: {
          code: 0,
          signal: null,
        },
        adapterState: {},
      },
    ],
  });

  mockClient.queueResult('task.list', {
    tasks: [
      {
        taskId: 'task-draft',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        repositoryId: null,
        scopeKind: 'global',
        projectId: null,
        title: 'Draft task',
        body: '',
        status: 'draft',
        orderIndex: 1,
        claimedByControllerId: null,
        claimedByDirectoryId: null,
        branchName: null,
        baseBranch: null,
        claimedAt: null,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  });

  const threads = await realtime.client.threads.list();
  assert.equal(threads[0]?.runtimeStatus, 'completed');
  const tasks = await realtime.client.tasks.list();
  assert.equal(tasks[0]?.status, 'draft');

  await realtime.client.close();
});

void test('agent realtime connect forwards optional filters and ignores unrelated subscription events', async () => {
  const sockets = new Set<Socket>();
  const harness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind === 'auth') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'auth.ok',
        }),
      );
      return;
    }
    if (envelope.kind !== 'command') {
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId,
      }),
    );
    if (envelope.command.type === 'stream.subscribe') {
      sockets.add(socket);
      assert.equal(envelope.command.tenantId, 'tenant-local');
      assert.equal(envelope.command.userId, 'user-local');
      assert.equal(envelope.command.workspaceId, 'workspace-local');
      assert.equal(envelope.command.repositoryId, 'repository-local');
      assert.equal(envelope.command.taskId, 'task-local');
      assert.equal(envelope.command.directoryId, 'directory-local');
      assert.equal(envelope.command.conversationId, 'conversation-local');
      assert.equal(envelope.command.afterCursor, 22);
      assert.equal(envelope.command.includeOutput, true);
      socket.write(
        encodeStreamEnvelope({
          kind: 'pty.output',
          sessionId: 'ignored',
          cursor: 1,
          chunkBase64: Buffer.from('ignored', 'utf8').toString('base64'),
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'stream.event',
          subscriptionId: 'subscription-local',
          cursor: 44,
          event: {
            type: 'session-output',
            sessionId: 'conversation-local',
            outputCursor: 1,
            chunkBase64: Buffer.from('buffered', 'utf8').toString('base64'),
            ts: '2026-02-01T00:00:00.000Z',
            directoryId: null,
            conversationId: 'conversation-local',
          },
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'stream.event',
          subscriptionId: 'subscription-other',
          cursor: 45,
          event: {
            type: 'session-output',
            sessionId: 'conversation-other',
            outputCursor: 1,
            chunkBase64: Buffer.from('other', 'utf8').toString('base64'),
            ts: '2026-02-01T00:00:00.000Z',
            directoryId: null,
            conversationId: 'conversation-other',
          },
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            subscriptionId: 'subscription-local',
            cursor: 44,
          },
        }),
      );
      return;
    }
    if (envelope.command.type === 'stream.unsubscribe') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            unsubscribed: true,
          },
        }),
      );
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.completed',
        commandId: envelope.commandId,
        result: {},
      }),
    );
  });

  const client = await connectHarnessAgentRealtimeClient({
    host: harness.address.address,
    port: harness.address.port,
    authToken: 'token-local',
    connectRetryWindowMs: 1200,
    connectRetryDelayMs: 5,
    subscription: {
      tenantId: 'tenant-local',
      userId: 'user-local',
      workspaceId: 'workspace-local',
      repositoryId: 'repository-local',
      taskId: 'task-local',
      directoryId: 'directory-local',
      conversationId: 'conversation-local',
      includeOutput: true,
      afterCursor: 22,
    },
  });
  const observedTypes: string[] = [];
  const remove = client.on('*', (event) => {
    observedTypes.push(event.type);
  });

  try {
    for (const socket of sockets) {
      socket.write(
        encodeStreamEnvelope({
          kind: 'stream.event',
          subscriptionId: 'subscription-other',
          cursor: 46,
          event: {
            type: 'session-output',
            sessionId: 'conversation-other',
            outputCursor: 2,
            chunkBase64: Buffer.from('ignored-2', 'utf8').toString('base64'),
            ts: '2026-02-01T00:00:01.000Z',
            directoryId: null,
            conversationId: 'conversation-other',
          },
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'stream.event',
          subscriptionId: 'subscription-local',
          cursor: 47,
          event: {
            type: 'session-output',
            sessionId: 'conversation-local',
            outputCursor: 2,
            chunkBase64: Buffer.from('allowed', 'utf8').toString('base64'),
            ts: '2026-02-01T00:00:02.000Z',
            directoryId: null,
            conversationId: 'conversation-local',
          },
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(observedTypes, ['session.output']);
  } finally {
    remove();
    await client.close();
    for (const socket of sockets) {
      socket.destroy();
    }
    await harness.stop();
  }
});

void test('agent realtime connect drops post-connect events for unknown subscription ids', async () => {
  const sockets = new Set<Socket>();
  const harness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind !== 'command') {
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId,
      }),
    );
    if (envelope.command.type === 'stream.subscribe') {
      sockets.add(socket);
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            subscriptionId: 'subscription-main',
            cursor: 0,
          },
        }),
      );
      return;
    }
    if (envelope.command.type === 'stream.unsubscribe') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            unsubscribed: true,
          },
        }),
      );
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.completed',
        commandId: envelope.commandId,
        result: {},
      }),
    );
  });

  const client = await connectHarnessAgentRealtimeClient({
    host: harness.address.address,
    port: harness.address.port,
  });
  const observed: string[] = [];
  const remove = client.on('*', (event) => {
    observed.push(`${event.subscriptionId ?? 'none'}:${event.type}`);
  });

  try {
    const iterator = sockets.values().next();
    assert.equal(iterator.done, false);
    const eventSocket = iterator.value;
    eventSocket.write(
      encodeStreamEnvelope({
        kind: 'stream.event',
        subscriptionId: 'subscription-other',
        cursor: 1,
        event: {
          type: 'session-status',
          sessionId: 'session-other',
          status: 'running',
          attentionReason: null,
          statusModel: statusModelFor('running'),
          live: true,
          ts: '2026-02-02T00:00:00.000Z',
          directoryId: null,
          conversationId: null,
          telemetry: null,
          controller: null,
        },
      }),
    );
    eventSocket.write(
      encodeStreamEnvelope({
        kind: 'stream.event',
        subscriptionId: 'subscription-main',
        cursor: 2,
        event: {
          type: 'session-status',
          sessionId: 'session-main',
          status: 'running',
          attentionReason: null,
          statusModel: statusModelFor('running'),
          live: true,
          ts: '2026-02-02T00:00:01.000Z',
          directoryId: null,
          conversationId: null,
          telemetry: null,
          controller: null,
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(observed, ['subscription-main:session.status']);
  } finally {
    remove();
    await client.close();
    for (const socket of sockets) {
      socket.destroy();
    }
    await harness.stop();
  }
});

void test('agent realtime connect rejects malformed subscribe response and closes socket', async () => {
  const sockets = new Set<Socket>();
  let socketClosed = false;
  const harness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind !== 'command') {
      return;
    }
    sockets.add(socket);
    socket.once('close', () => {
      socketClosed = true;
    });
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId,
      }),
    );
    if (envelope.command.type === 'stream.subscribe') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            subscriptionId: '',
            cursor: 0,
          },
        }),
      );
    }
  });

  try {
    await assert.rejects(
      connectHarnessAgentRealtimeClient({
        host: harness.address.address,
        port: harness.address.port,
      }),
      /malformed subscription id/,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(socketClosed, true);
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await harness.stop();
  }
});

void test('agent realtime sessions aliases and draft task helper issue expected control-plane commands', async () => {
  const mockClient = new MockRealtimeControlPlaneClient();
  const realtime = createRealtimeClientForTest(mockClient);
  const timestamp = '2026-02-02T00:00:00.000Z';

  mockClient.queueResult('task.draft', {
    task: {
      taskId: 'task-1',
      tenantId: 'tenant-local',
      userId: 'user-local',
      workspaceId: 'workspace-local',
      repositoryId: null,
      scopeKind: 'global',
      projectId: null,
      title: 'Draft task',
      body: '',
      status: 'draft',
      orderIndex: 1,
      claimedByControllerId: null,
      claimedByDirectoryId: null,
      branchName: null,
      baseBranch: null,
      claimedAt: null,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  });
  mockClient.queueResult('session.list', {
    sessions: [
      {
        sessionId: 'conversation-1',
        directoryId: null,
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        worktreeId: 'worktree-local',
        status: 'running',
        attentionReason: null,
        statusModel: statusModelFor('running', {
          observedAt: timestamp,
        }),
        latestCursor: 9,
        processId: 51000,
        attachedClients: 1,
        eventSubscribers: 0,
        startedAt: timestamp,
        lastEventAt: timestamp,
        lastExit: null,
        exitedAt: null,
        live: true,
        launchCommand: null,
        controller: null,
        telemetry: null,
      },
    ],
  });
  mockClient.queueResult('session.status', {
    sessionId: 'conversation-1',
    directoryId: null,
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    worktreeId: 'worktree-local',
    status: 'running',
    attentionReason: null,
    statusModel: statusModelFor('running', {
      observedAt: timestamp,
    }),
    latestCursor: 9,
    processId: 51000,
    attachedClients: 1,
    eventSubscribers: 0,
    startedAt: timestamp,
    lastEventAt: timestamp,
    lastExit: null,
    exitedAt: null,
    live: true,
    launchCommand: null,
    controller: null,
    telemetry: null,
  });
  mockClient.queueResult('session.claim', {
    sessionId: 'conversation-1',
    action: 'claimed',
    controller: {
      controllerId: 'human-1',
      controllerType: 'human',
      controllerLabel: 'human',
      claimedAt: timestamp,
    },
  });
  mockClient.queueResult('session.claim', {
    sessionId: 'conversation-1',
    action: 'taken-over',
    controller: {
      controllerId: 'human-1',
      controllerType: 'human',
      controllerLabel: 'human',
      claimedAt: timestamp,
    },
  });
  mockClient.queueResult('session.release', {
    sessionId: 'conversation-1',
    released: true,
  });
  mockClient.queueResult('session.respond', {
    responded: true,
    sentBytes: 3,
  });
  mockClient.queueResult('session.interrupt', {
    interrupted: true,
  });
  mockClient.queueResult('session.remove', {
    removed: true,
  });
  mockClient.queueResult('pty.start', {
    sessionId: 'conversation-1',
  });
  mockClient.queueResult('pty.attach', {
    latestCursor: 9,
  });
  mockClient.queueResult('pty.detach', {
    detached: true,
  });
  mockClient.queueResult('pty.subscribe-events', {
    subscribed: true,
  });
  mockClient.queueResult('pty.unsubscribe-events', {
    subscribed: false,
  });
  mockClient.queueResult('pty.close', {
    closed: true,
  });

  const drafted = await realtime.client.tasks.draft('task-1');
  assert.equal(drafted.status, 'draft');

  const listed = await realtime.client.sessions.list();
  assert.equal(listed.length, 1);
  const status = await realtime.client.sessions.status('conversation-1');
  assert.equal(status.sessionId, 'conversation-1');
  const claimed = await realtime.client.sessions.claim({
    sessionId: 'conversation-1',
    controllerId: 'human-1',
    controllerType: 'human',
    controllerLabel: 'human',
  });
  assert.equal(claimed.action, 'claimed');
  const takenOver = await realtime.client.sessions.takeover({
    sessionId: 'conversation-1',
    controllerId: 'human-1',
    controllerType: 'human',
    controllerLabel: 'human',
  });
  assert.equal(takenOver.action, 'taken-over');
  const released = await realtime.client.sessions.release({
    sessionId: 'conversation-1',
  });
  assert.equal(released.released, true);
  const responded = await realtime.client.sessions.respond('conversation-1', 'ack');
  assert.equal(responded.sentBytes, 3);
  const interrupted = await realtime.client.sessions.interrupt('conversation-1');
  assert.equal(interrupted.interrupted, true);
  const removed = await realtime.client.sessions.remove('conversation-1');
  assert.equal(removed.removed, true);
  const started = await realtime.client.sessions.start({
    sessionId: 'conversation-1',
    args: [],
    initialCols: 120,
    initialRows: 40,
  });
  assert.equal(started.sessionId, 'conversation-1');
  const attached = await realtime.client.sessions.attach('conversation-1', 0);
  assert.equal(attached.latestCursor, 9);
  const detached = await realtime.client.sessions.detach('conversation-1');
  assert.equal(detached.detached, true);
  const subscribed = await realtime.client.sessions.subscribeEvents('conversation-1');
  assert.equal(subscribed.subscribed, true);
  const unsubscribed = await realtime.client.sessions.unsubscribeEvents('conversation-1');
  assert.equal(unsubscribed.subscribed, false);
  const closed = await realtime.client.sessions.close('conversation-1');
  assert.equal(closed.closed, true);

  const sentTypes = mockClient.commands.map((command) => command.type);
  assert.equal(sentTypes.includes('task.draft'), true);
  assert.equal(sentTypes.includes('pty.subscribe-events'), true);
  assert.equal(sentTypes.includes('pty.unsubscribe-events'), true);

  await realtime.client.close();
});
