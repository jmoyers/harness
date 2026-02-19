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
  type StreamObservedEvent,
  type StreamServerEnvelope,
  type StreamSignal,
} from '../src/control-plane/stream-protocol.ts';
import { statusModelFor } from './support/status-model.ts';
import {
  startControlPlaneStreamServer,
  type StartControlPlaneSessionInput,
} from '../src/control-plane/stream-server.ts';
import { TerminalSnapshotOracle } from '../src/terminal/snapshot-oracle.ts';
import type { CodexLiveEvent } from '../src/codex/live-session.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';

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

interface SessionDataEvent {
  cursor: number;
  chunk: Buffer;
}

interface SessionAttachHandlers {
  onData: (event: SessionDataEvent) => void;
  onExit: (exit: PtyExit) => void;
}

class AgentApiLiveSession {
  readonly writes: Buffer[] = [];
  private readonly snapshotOracle: TerminalSnapshotOracle;
  private readonly attachments = new Map<string, SessionAttachHandlers>();
  private readonly listeners = new Set<(event: CodexLiveEvent) => void>();
  private nextAttachmentId = 0;
  private latestCursor = 0;

  constructor(input: StartControlPlaneSessionInput) {
    this.snapshotOracle = new TerminalSnapshotOracle(input.initialCols, input.initialRows);
  }

  attach(handlers: SessionAttachHandlers): string {
    this.nextAttachmentId += 1;
    const attachmentId = `attachment-${String(this.nextAttachmentId)}`;
    this.attachments.set(attachmentId, handlers);
    return attachmentId;
  }

  detach(attachmentId: string): void {
    this.attachments.delete(attachmentId);
  }

  latestCursorValue(): number {
    return this.latestCursor;
  }

  processId(): number | null {
    return 72000;
  }

  write(data: string | Uint8Array): void {
    const chunk = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data);
    this.writes.push(chunk);
    this.latestCursor += 1;
    this.snapshotOracle.ingest(chunk);
    for (const handlers of this.attachments.values()) {
      handlers.onData({
        cursor: this.latestCursor,
        chunk,
      });
    }
  }

  resize(cols: number, rows: number): void {
    this.snapshotOracle.resize(cols, rows);
  }

  snapshot() {
    return this.snapshotOracle.snapshot();
  }

  close(): void {}

  onEvent(listener: (event: CodexLiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
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

void test('agent realtime client streams control events and wraps claim/release operations', async () => {
  const subscriptionId = 'subscription-agent-realtime';
  const broadcastSockets = new Set<Socket>();
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
      broadcastSockets.add(socket);
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            subscriptionId,
            cursor: 40,
          },
        }),
      );
      return;
    }

    if (envelope.command.type === 'session.claim') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'stream.event',
          subscriptionId,
          cursor: 41,
          event: {
            type: 'session-control',
            sessionId: envelope.command.sessionId,
            action: envelope.command.takeover === true ? 'taken-over' : 'claimed',
            controller: {
              controllerId: envelope.command.controllerId,
              controllerType: envelope.command.controllerType,
              controllerLabel: envelope.command.controllerLabel ?? null,
              claimedAt: '2026-02-01T00:00:00.000Z',
            },
            previousController:
              envelope.command.takeover === true
                ? {
                    controllerId: 'agent-prev',
                    controllerType: 'agent',
                    controllerLabel: 'agent-prev',
                    claimedAt: '2026-02-01T00:00:00.000Z',
                  }
                : null,
            reason: envelope.command.reason ?? null,
            ts: '2026-02-01T00:00:00.000Z',
            directoryId: null,
            conversationId: envelope.command.sessionId,
          },
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            sessionId: envelope.command.sessionId,
            action: envelope.command.takeover === true ? 'taken-over' : 'claimed',
            controller: {
              controllerId: envelope.command.controllerId,
              controllerType: envelope.command.controllerType,
              controllerLabel: envelope.command.controllerLabel ?? null,
              claimedAt: '2026-02-01T00:00:00.000Z',
            },
          },
        }),
      );
      return;
    }

    if (envelope.command.type === 'session.release') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'stream.event',
          subscriptionId,
          cursor: 42,
          event: {
            type: 'session-control',
            sessionId: envelope.command.sessionId,
            action: 'released',
            controller: null,
            previousController: {
              controllerId: 'agent-prev',
              controllerType: 'agent',
              controllerLabel: 'agent-prev',
              claimedAt: '2026-02-01T00:00:00.000Z',
            },
            reason: envelope.command.reason ?? null,
            ts: '2026-02-01T00:00:01.000Z',
            directoryId: null,
            conversationId: envelope.command.sessionId,
          },
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            sessionId: envelope.command.sessionId,
            released: true,
          },
        }),
      );
      return;
    }

    if (envelope.command.type === 'stream.unsubscribe') {
      broadcastSockets.delete(socket);
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

  const controlActions: string[] = [];
  const wildcardTypes: string[] = [];
  const removeControlListener = client.on('session.control', (event) => {
    controlActions.push(event.observed.action);
  });
  const removeWildcardListener = client.on('*', (event) => {
    wildcardTypes.push(event.type);
  });

  try {
    const claimed = await client.claimSession({
      sessionId: 'conversation-1',
      controllerId: 'agent-1',
      controllerType: 'agent',
      controllerLabel: 'agent one',
      reason: 'start work',
    });
    assert.equal(claimed.action, 'claimed');
    assert.equal(claimed.controller.controllerId, 'agent-1');

    const released = await client.releaseSession({
      sessionId: 'conversation-1',
      reason: 'done',
    });
    assert.equal(released.released, true);

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(controlActions, ['claimed', 'released']);
    assert.deepEqual(wildcardTypes, ['session.control', 'session.control']);
  } finally {
    removeControlListener();
    removeWildcardListener();
    await client.close();
    for (const socket of broadcastSockets) {
      socket.destroy();
    }
    await harness.stop();
  }
});

void test('agent realtime client enforces claim ownership and supports takeover handoff', async () => {
  const startedSessions: AgentApiLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new AgentApiLiveSession(input);
      startedSessions.push(session);
      return session;
    },
  });

  const address = server.address();
  const agentClient = await connectHarnessAgentRealtimeClient({
    host: address.address,
    port: address.port,
  });
  const humanClient = await connectHarnessAgentRealtimeClient({
    host: address.address,
    port: address.port,
  });

  const controlEvents: Array<{ action: string; sessionId: string }> = [];
  const removeControlListener = agentClient.on('session.control', (event) => {
    controlEvents.push({
      action: event.observed.action,
      sessionId: event.observed.sessionId,
    });
  });

  try {
    await agentClient.startSession({
      sessionId: 'lock-session',
      args: [],
      env: {
        TERM: 'xterm-256color',
      },
      initialCols: 100,
      initialRows: 30,
    });

    await agentClient.claimSession({
      sessionId: 'lock-session',
      controllerId: 'agent-owner',
      controllerType: 'agent',
      controllerLabel: 'owner-agent',
    });

    await assert.rejects(
      humanClient.respond('lock-session', 'human input'),
      /session is claimed by owner-agent/,
    );

    const takeover = await humanClient.takeoverSession({
      sessionId: 'lock-session',
      controllerId: 'human-owner',
      controllerType: 'human',
      controllerLabel: 'human operator',
      reason: 'manual takeover',
    });
    assert.equal(takeover.action, 'taken-over');

    const responded = await humanClient.respond('lock-session', 'human input');
    assert.equal(responded.responded, true);

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      controlEvents.some((event) => event.action === 'taken-over'),
      true,
    );
    assert.equal(
      startedSessions[0]?.writes.some((chunk) => chunk.toString('utf8') === 'human input'),
      true,
    );
  } finally {
    removeControlListener();
    await humanClient.close();
    await agentClient.close();
    await server.close();
  }
});

void test('agent realtime client rejects malformed claim payloads', async () => {
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
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            subscriptionId: 'sub-1',
            cursor: 0,
          },
        }),
      );
      return;
    }
    if (envelope.command.type === 'session.claim') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            sessionId: envelope.command.sessionId,
            action: 'claimed',
            controller: {
              controllerId: 123,
            },
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
  });

  const client = await connectHarnessAgentRealtimeClient({
    host: harness.address.address,
    port: harness.address.port,
  });

  try {
    await assert.rejects(
      client.claimSession({
        sessionId: 'conversation-1',
        controllerId: 'agent-1',
        controllerType: 'agent',
      }),
      /malformed response/,
    );
  } finally {
    await client.close();
    await harness.stop();
  }
});

void test('agent realtime client covers dispatch mapping command wrappers and malformed response guards', async () => {
  const mockClient = new MockRealtimeControlPlaneClient();
  const handlerErrors: string[] = [];
  const realtime = createRealtimeClientForTest(mockClient, (error) => {
    if (error instanceof Error) {
      handlerErrors.push(error.message);
    }
  });

  const wildcardTypes: string[] = [];
  const wildcardSubscriptionIds: Array<string | undefined> = [];
  const statusEventSessionIds: string[] = [];
  const removeWildcard = realtime.client.on('*', (event) => {
    wildcardTypes.push(event.type);
    wildcardSubscriptionIds.push(event.subscriptionId);
  });
  const removeStatusA = realtime.client.on('session.status', (event) => {
    statusEventSessionIds.push(event.observed.sessionId);
  });
  const removeStatusB = realtime.client.on('session.status', () => {
    return Promise.reject(new Error('listener boom'));
  });

  const dispatch = (
    realtime.client as unknown as {
      dispatch: (subscriptionId: string, cursor: number, observed: StreamObservedEvent) => void;
    }
  ).dispatch.bind(realtime.client) as (
    subscriptionId: string,
    cursor: number,
    observed: StreamObservedEvent,
  ) => void;

  const directoryPayload = {
    directoryId: 'directory-1',
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    path: '/tmp/project',
    archivedAt: null,
    updatedAt: '2026-02-01T00:00:00.000Z',
  };
  const conversationPayload = {
    conversationId: 'conversation-1',
    directoryId: 'directory-1',
    title: 'task',
    agentType: 'codex',
    archivedAt: null,
    updatedAt: '2026-02-01T00:00:00.000Z',
    adapterState: null,
  };
  const repositoryPayload = {
    repositoryId: 'repository-1',
    name: 'harness',
    remoteUrl: 'https://github.com/acme/harness.git',
  };
  const taskPayload = {
    taskId: 'task-1',
    repositoryId: 'repository-1',
    status: 'ready',
  };
  const timestamp = '2026-02-01T00:00:00.000Z';
  const mappedEvents: StreamObservedEvent[] = [
    {
      type: 'directory-upserted',
      directory: directoryPayload,
    },
    {
      type: 'directory-archived',
      directoryId: 'directory-1',
      ts: timestamp,
    },
    {
      type: 'directory-git-updated',
      directoryId: 'directory-1',
      summary: {
        branch: 'main',
        changedFiles: 2,
        additions: 5,
        deletions: 1,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: 'https://github.com/example/harness',
        commitCount: 10,
        lastCommitAt: timestamp,
        shortCommitHash: 'abc1234',
        inferredName: 'harness',
        defaultBranch: 'main',
      },
      repositoryId: 'repository-1',
      repository: {
        repositoryId: 'repository-1',
        name: 'harness',
      },
      observedAt: timestamp,
    },
    {
      type: 'conversation-created',
      conversation: conversationPayload,
    },
    {
      type: 'conversation-updated',
      conversation: conversationPayload,
    },
    {
      type: 'conversation-archived',
      conversationId: 'conversation-1',
      ts: timestamp,
    },
    {
      type: 'conversation-deleted',
      conversationId: 'conversation-1',
      ts: timestamp,
    },
    {
      type: 'repository-upserted',
      repository: repositoryPayload,
    },
    {
      type: 'repository-updated',
      repository: repositoryPayload,
    },
    {
      type: 'repository-archived',
      repositoryId: 'repository-1',
      ts: timestamp,
    },
    {
      type: 'task-created',
      task: taskPayload,
    },
    {
      type: 'task-updated',
      task: taskPayload,
    },
    {
      type: 'task-deleted',
      taskId: 'task-1',
      ts: timestamp,
    },
    {
      type: 'task-reordered',
      tasks: [taskPayload],
      ts: timestamp,
    },
    {
      type: 'github-pr-upserted',
      pr: {
        prRecordId: 'github-pr-1',
        repositoryId: 'repository-1',
      },
    },
    {
      type: 'github-pr-closed',
      prRecordId: 'github-pr-1',
      repositoryId: 'repository-1',
      ts: timestamp,
    },
    {
      type: 'github-pr-jobs-updated',
      prRecordId: 'github-pr-1',
      repositoryId: 'repository-1',
      ciRollup: 'pending',
      jobs: [],
      ts: timestamp,
    },
    {
      type: 'session-status',
      sessionId: 'conversation-1',
      status: 'running',
      attentionReason: null,
      statusModel: statusModelFor('running'),
      live: true,
      telemetry: null,
      controller: null,
      ts: timestamp,
      directoryId: null,
      conversationId: 'conversation-1',
    },
    {
      type: 'session-event',
      sessionId: 'conversation-1',
      event: {
        type: 'session-exit',
        exit: {
          code: 0,
          signal: null,
        },
      },
      ts: timestamp,
      directoryId: null,
      conversationId: 'conversation-1',
    },
    {
      type: 'session-key-event',
      sessionId: 'conversation-1',
      keyEvent: {
        source: 'otlp-log',
        eventName: 'codex.api_request',
        severity: 'INFO',
        summary: 'request complete',
        statusHint: 'running',
        observedAt: timestamp,
      },
      ts: timestamp,
      directoryId: null,
      conversationId: 'conversation-1',
    },
    {
      type: 'session-control',
      sessionId: 'conversation-1',
      action: 'claimed',
      controller: {
        controllerId: 'agent-1',
        controllerType: 'agent',
        controllerLabel: null,
        claimedAt: timestamp,
      },
      previousController: null,
      reason: null,
      ts: timestamp,
      directoryId: null,
      conversationId: 'conversation-1',
    },
    {
      type: 'session-output',
      sessionId: 'conversation-1',
      outputCursor: 1,
      chunkBase64: Buffer.from('data', 'utf8').toString('base64'),
      ts: timestamp,
      directoryId: null,
      conversationId: 'conversation-1',
    },
  ];

  for (const event of mappedEvents) {
    dispatch('subscription-test', 1, event);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(wildcardTypes, [
    'directory.upserted',
    'directory.archived',
    'directory.git-updated',
    'conversation.created',
    'conversation.updated',
    'conversation.archived',
    'conversation.deleted',
    'repository.upserted',
    'repository.updated',
    'repository.archived',
    'task.created',
    'task.updated',
    'task.deleted',
    'task.reordered',
    'github.pr-upserted',
    'github.pr-closed',
    'github.pr-jobs-updated',
    'session.status',
    'session.event',
    'session.telemetry',
    'session.control',
    'session.output',
  ]);
  assert.deepEqual(statusEventSessionIds, ['conversation-1']);
  assert.equal(
    wildcardSubscriptionIds.every((subscriptionId) => subscriptionId === 'subscription-test'),
    true,
  );
  assert.deepEqual(handlerErrors, ['listener boom']);

  removeStatusA();
  removeStatusB();
  removeWildcard();

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
      },
      {
        sessionId: 123,
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
  mockClient.queueResult('session.status', {
    sessionId: 99,
  });
  mockClient.queueResult('session.claim', {
    sessionId: 'conversation-1',
    action: 'claimed',
    controller: {
      controllerId: 'agent-1',
      controllerType: 'agent',
      controllerLabel: null,
      claimedAt: timestamp,
    },
  });
  mockClient.queueResult('session.claim', {
    sessionId: 'conversation-1',
    action: 'taken-over',
    controller: {
      controllerId: 'human-1',
      controllerType: 'human',
      controllerLabel: 'operator',
      claimedAt: timestamp,
    },
  });
  mockClient.queueResult('session.claim', {
    sessionId: 'conversation-1',
    action: 'claimed',
    controller: {
      controllerId: 'auto-1',
      controllerType: 'automation',
      controllerLabel: null,
      claimedAt: timestamp,
    },
  });
  mockClient.queueResult('session.claim', {
    sessionId: 'conversation-1',
    action: 'claimed',
    controller: 'bad-controller',
  });
  mockClient.queueResult('session.release', {
    sessionId: 'conversation-1',
    released: true,
  });
  mockClient.queueResult('session.release', {
    sessionId: 'conversation-1',
    released: 'nope',
  } as unknown as Record<string, unknown>);
  mockClient.queueResult('session.respond', {
    responded: true,
    sentBytes: 11,
  });
  mockClient.queueResult('session.respond', {
    responded: true,
  });
  mockClient.queueResult('session.interrupt', {
    interrupted: true,
  });
  mockClient.queueResult('session.interrupt', {});
  mockClient.queueResult('session.remove', {
    removed: true,
  });
  mockClient.queueResult('session.remove', {});
  mockClient.queueResult('pty.start', {
    sessionId: 'conversation-1',
  });
  mockClient.queueResult('pty.start', {});
  mockClient.queueResult('pty.attach', {
    latestCursor: 9,
  });
  mockClient.queueResult('pty.attach', {});
  mockClient.queueResult('pty.detach', {
    detached: true,
  });
  mockClient.queueResult('pty.detach', {});
  mockClient.queueResult('pty.close', {
    closed: true,
  });
  mockClient.queueResult('pty.close', {});
  mockClient.queueResult('session.snapshot', {
    passthrough: true,
  });
  mockClient.queueError('stream.unsubscribe', new Error('unsubscribe failed'));

  const passthroughResult = await realtime.client.sendCommand({
    type: 'session.snapshot',
    sessionId: 'conversation-1',
  });
  assert.equal(passthroughResult['passthrough'], true);

  const sessions = await realtime.client.listSessions({
    status: 'running',
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.sessionId, 'conversation-1');

  const sessionStatus = await realtime.client.sessionStatus('conversation-1');
  assert.equal(sessionStatus.sessionId, 'conversation-1');
  await assert.rejects(realtime.client.sessionStatus('conversation-1'), /malformed summary/);

  const claimed = await realtime.client.claimSession({
    sessionId: 'conversation-1',
    controllerId: 'agent-1',
    controllerType: 'agent',
  });
  assert.equal(claimed.controller.controllerId, 'agent-1');
  const takeover = await realtime.client.takeoverSession({
    sessionId: 'conversation-1',
    controllerId: 'human-1',
    controllerType: 'human',
    controllerLabel: 'operator',
    reason: 'manual',
  });
  assert.equal(takeover.action, 'taken-over');
  const automationClaim = await realtime.client.claimSession({
    sessionId: 'conversation-1',
    controllerId: 'auto-1',
    controllerType: 'automation',
  });
  assert.equal(automationClaim.controller.controllerType, 'automation');
  await assert.rejects(
    realtime.client.claimSession({
      sessionId: 'conversation-1',
      controllerId: 'agent-1',
      controllerType: 'agent',
    }),
    /malformed response/,
  );

  const released = await realtime.client.releaseSession({
    sessionId: 'conversation-1',
  });
  assert.equal(released.released, true);
  await assert.rejects(
    realtime.client.releaseSession({
      sessionId: 'conversation-1',
      reason: 'done',
    }),
    /malformed response/,
  );

  const responded = await realtime.client.respond('conversation-1', 'hello world');
  assert.equal(responded.sentBytes, 11);
  await assert.rejects(
    realtime.client.respond('conversation-1', 'hello world'),
    /malformed response/,
  );

  const interrupted = await realtime.client.interrupt('conversation-1');
  assert.equal(interrupted.interrupted, true);
  await assert.rejects(realtime.client.interrupt('conversation-1'), /malformed response/);

  const removed = await realtime.client.removeSession('conversation-1');
  assert.equal(removed.removed, true);
  await assert.rejects(realtime.client.removeSession('conversation-1'), /malformed response/);

  const started = await realtime.client.startSession({
    sessionId: 'conversation-1',
    args: [],
    initialCols: 80,
    initialRows: 24,
  });
  assert.equal(started.sessionId, 'conversation-1');
  await assert.rejects(
    realtime.client.startSession({
      sessionId: 'conversation-1',
      args: [],
      initialCols: 80,
      initialRows: 24,
    }),
    /malformed response/,
  );

  const attached = await realtime.client.attachSession('conversation-1');
  assert.equal(attached.latestCursor, 9);
  await assert.rejects(realtime.client.attachSession('conversation-1'), /malformed response/);

  const detached = await realtime.client.detachSession('conversation-1');
  assert.equal(detached.detached, true);
  await assert.rejects(realtime.client.detachSession('conversation-1'), /malformed response/);

  const closed = await realtime.client.closeSession('conversation-1');
  assert.equal(closed.closed, true);
  await assert.rejects(realtime.client.closeSession('conversation-1'), /malformed response/);

  realtime.client.sendInput('conversation-1', 'abc');
  realtime.client.sendInput('conversation-1', Buffer.from('xyz', 'utf8'));
  realtime.client.sendResize('conversation-1', 100, 30);
  realtime.client.sendSignal('conversation-1', 'interrupt');
  assert.equal(mockClient.inputCalls.length, 2);
  assert.equal(mockClient.inputCalls[0]?.chunk.toString('utf8'), 'abc');
  assert.equal(mockClient.inputCalls[1]?.chunk.toString('utf8'), 'xyz');
  assert.equal(mockClient.resizeCalls.length, 1);
  assert.equal(mockClient.signalCalls.length, 1);

  await realtime.client.close();
  await realtime.client.close();
  assert.equal(realtime.envelopeListenerRemoved(), true);
  assert.equal(mockClient.closed, true);
  const unsubscribeCommands = mockClient.commands.filter(
    (command) => command.type === 'stream.unsubscribe',
  );
  assert.equal(unsubscribeCommands.length, 1);
});
