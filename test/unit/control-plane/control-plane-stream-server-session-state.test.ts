import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ControlPlaneStreamServer,
  startControlPlaneStreamServer,
  type StartControlPlaneSessionInput,
} from '../../../src/control-plane/stream-server.ts';
import { connectControlPlaneStreamClient } from '../../../src/control-plane/stream-client.ts';
import { type StreamServerEnvelope } from '../../../src/control-plane/stream-protocol.ts';
import type { CodexLiveEvent } from '../../../src/codex/live-session.ts';
import type { PtyExit } from '../../../src/pty/pty_host.ts';
import { SqliteControlPlaneStore } from '../../../src/store/control-plane-store.ts';
import { FakeLiveSession, collectEnvelopes } from '../../helpers/control-plane-stream-server-test-helpers.ts';

interface SessionStatusClient {
  sendCommand(command: never): Promise<Record<string, unknown>>;
}

async function waitForSessionStatus(
  client: SessionStatusClient,
  sessionId: string,
  expectedStatus: string,
  timeoutMs = 1_000,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await client.sendCommand(
        {
          type: 'session.status',
          sessionId,
        } as never,
      );
      if (status['status'] === expectedStatus) {
        return status;
      }
    } catch {
      // Ignore transient read errors while waiting for the expected lifecycle transition.
    }
    await delay(10);
  }
  throw new Error(
    `timed out waiting for session ${sessionId} to reach status ${expectedStatus}`,
  );
}

async function waitForSessionMissing(
  client: SessionStatusClient,
  sessionId: string,
  timeoutMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await client.sendCommand(
        {
          type: 'session.status',
          sessionId,
        } as never,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('session not found')) {
        return;
      }
    }
    await delay(10);
  }
  throw new Error(`timed out waiting for session ${sessionId} tombstone removal`);
}

void test('stream server archives directories and excludes archived rows from default list', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observed = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive',
      includeOutput: false,
      afterCursor: 0,
    });

    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-archive',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive',
      path: '/tmp/archive-me',
    });

    const archived = await client.sendCommand({
      type: 'directory.archive',
      directoryId: 'directory-archive',
    });
    const archivedDirectory = archived['directory'] as Record<string, unknown>;
    assert.equal(archivedDirectory['directoryId'], 'directory-archive');
    assert.equal(typeof archivedDirectory['archivedAt'], 'string');

    const defaultListed = await client.sendCommand({
      type: 'directory.list',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive',
    });
    assert.deepEqual(defaultListed['directories'], []);

    const listedWithArchived = await client.sendCommand({
      type: 'directory.list',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive',
      includeArchived: true,
    });
    const rows = listedWithArchived['directories'] as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.['directoryId'], 'directory-archive');
    assert.equal(typeof rows[0]?.['archivedAt'], 'string');

    await assert.rejects(
      client.sendCommand({
        type: 'conversation.create',
        conversationId: 'conversation-archived-directory',
        directoryId: 'directory-archive',
        title: 'should fail',
        agentType: 'codex',
      }),
      /directory not found/,
    );

    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' && envelope.event.type === 'directory-archived',
      ),
      true,
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server attention-first sorting falls back to recency when statuses tie', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-a',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await delay(2);
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-b',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });

    const listed = await client.sendCommand({
      type: 'session.list',
      sort: 'attention-first',
    });
    const entries = listed['sessions'] as Array<Record<string, unknown>>;
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.['sessionId'], 'conversation-b');
    assert.equal(entries[0]?.['status'], 'running');
    assert.equal(entries[1]?.['sessionId'], 'conversation-a');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server internal sort helper covers tie-break branches', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  try {
    interface InternalSessionState {
      id: string;
      directoryId: string | null;
      tenantId: string;
      userId: string;
      workspaceId: string;
      worktreeId: string;
      session: FakeLiveSession | null;
      eventSubscriberConnectionIds: Set<string>;
      attachmentByConnectionId: Map<string, string>;
      unsubscribe: (() => void) | null;
      status: 'running' | 'needs-input' | 'completed' | 'exited';
      attentionReason: string | null;
      lastEventAt: string | null;
      lastExit: PtyExit | null;
      lastSnapshot: Record<string, unknown> | null;
      startedAt: string;
      exitedAt: string | null;
      tombstoneTimer: NodeJS.Timeout | null;
      lastObservedOutputCursor: number;
      latestTelemetry: Record<string, unknown> | null;
      controller: Record<string, unknown> | null;
      diagnostics: Record<string, unknown>;
    }

    const internals = server as unknown as {
      sortSessionSummaries: (
        sessions: readonly InternalSessionState[],
        sort: 'attention-first' | 'started-desc' | 'started-asc',
      ) => ReadonlyArray<Record<string, unknown>>;
    };

    const base: Omit<InternalSessionState, 'id' | 'status' | 'startedAt' | 'lastEventAt'> = {
      directoryId: null,
      tenantId: 'tenant-local',
      userId: 'user-local',
      workspaceId: 'workspace-local',
      worktreeId: 'worktree-local',
      session: null,
      eventSubscriberConnectionIds: new Set<string>(),
      attachmentByConnectionId: new Map<string, string>(),
      unsubscribe: null,
      attentionReason: null,
      lastExit: null,
      lastSnapshot: null,
      exitedAt: null,
      tombstoneTimer: null,
      lastObservedOutputCursor: 0,
      latestTelemetry: null,
      controller: null,
      diagnostics: {
        telemetryIngestedTotal: 0,
        telemetryRetainedTotal: 0,
        telemetryDroppedTotal: 0,
        telemetryIngestRate: {
          buckets: [0, 0, 0, 0, 0, 0],
          currentBucketStartMs: 0,
        },
        telemetryEventsLast60s: 0,
        telemetryIngestQps1m: 0,
        fanoutEventsEnqueuedTotal: 0,
        fanoutBytesEnqueuedTotal: 0,
        fanoutBackpressureSignalsTotal: 0,
        fanoutBackpressureDisconnectsTotal: 0,
      },
    };

    const rows: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'session-c',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null,
      },
      {
        ...base,
        id: 'session-a',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null,
      },
      {
        ...base,
        id: 'session-b',
        status: 'exited',
        startedAt: '2026-01-02T00:00:00.000Z',
        lastEventAt: '2026-01-02T00:00:00.000Z',
      },
      {
        ...base,
        id: 'session-d',
        status: 'running',
        startedAt: '2026-01-03T00:00:00.000Z',
        lastEventAt: null,
      },
      {
        ...base,
        id: 'session-e',
        status: 'needs-input',
        startedAt: '2026-01-04T00:00:00.000Z',
        lastEventAt: '2026-01-04T00:00:00.000Z',
      },
    ];

    const startedAsc = internals.sortSessionSummaries(rows, 'started-asc');
    assert.deepEqual(
      startedAsc.map((entry) => entry['sessionId']),
      ['session-a', 'session-c', 'session-b', 'session-d', 'session-e'],
    );

    const startedDesc = internals.sortSessionSummaries(rows, 'started-desc');
    assert.deepEqual(
      startedDesc.map((entry) => entry['sessionId']),
      ['session-e', 'session-d', 'session-b', 'session-a', 'session-c'],
    );

    const attentionFirst = internals.sortSessionSummaries(rows, 'attention-first');
    assert.deepEqual(
      attentionFirst.map((entry) => entry['sessionId']),
      ['session-e', 'session-d', 'session-a', 'session-c', 'session-b'],
    );

    const byLastEventRows: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'session-last-a',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:10:00.000Z',
      },
      {
        ...base,
        id: 'session-last-b',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:09:00.000Z',
      },
    ];
    const byLastEvent = internals.sortSessionSummaries(byLastEventRows, 'attention-first');
    assert.deepEqual(
      byLastEvent.map((entry) => entry['sessionId']),
      ['session-last-a', 'session-last-b'],
    );

    const byStartedRows: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'session-start-a',
        status: 'completed',
        startedAt: '2026-01-01T00:10:00.000Z',
        lastEventAt: '2026-01-01T00:10:00.000Z',
      },
      {
        ...base,
        id: 'session-start-b',
        status: 'completed',
        startedAt: '2026-01-01T00:09:00.000Z',
        lastEventAt: '2026-01-01T00:10:00.000Z',
      },
    ];
    const byStarted = internals.sortSessionSummaries(byStartedRows, 'attention-first');
    assert.deepEqual(
      byStarted.map((entry) => entry['sessionId']),
      ['session-start-a', 'session-start-b'],
    );

    const nullVsNonNullA: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'null-last-event',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null,
      },
      {
        ...base,
        id: 'non-null-last-event',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:00:01.000Z',
      },
    ];
    const nullVsNonNullSortedA = internals.sortSessionSummaries(nullVsNonNullA, 'attention-first');
    assert.deepEqual(
      nullVsNonNullSortedA.map((entry) => entry['sessionId']),
      ['non-null-last-event', 'null-last-event'],
    );

    const nullVsNonNullB: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'non-null-last-event-2',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:00:01.000Z',
      },
      {
        ...base,
        id: 'null-last-event-2',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null,
      },
    ];
    const nullVsNonNullSortedB = internals.sortSessionSummaries(nullVsNonNullB, 'attention-first');
    assert.deepEqual(
      nullVsNonNullSortedB.map((entry) => entry['sessionId']),
      ['non-null-last-event-2', 'null-last-event-2'],
    );
  } finally {
    await server.close();
  }
});

void test('stream server exposes attention list and respond/interrupt wrappers', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-attention',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });

    const attention = await client.sendCommand({
      type: 'attention.list',
    });
    const attentionSessions = attention['sessions'] as Array<Record<string, unknown>>;
    assert.equal(attentionSessions.length, 0);

    const responded = await client.sendCommand({
      type: 'session.respond',
      sessionId: 'session-attention',
      text: 'approved',
    });
    assert.equal(responded['responded'], true);
    assert.equal(responded['sentBytes'], Buffer.byteLength('approved'));
    assert.equal(
      sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === 'approved'),
      true,
    );

    const interrupted = await client.sendCommand({
      type: 'session.interrupt',
      sessionId: 'session-attention',
    });
    assert.equal(interrupted['interrupted'], true);
    assert.equal(
      sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === '\u0003'),
      true,
    );
    const statusAfterInterrupt = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-attention',
    });
    assert.equal(statusAfterInterrupt['status'], 'completed');
    assert.equal(statusAfterInterrupt['live'], true);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server blocks non-controller mutations until takeover claim succeeds', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const ownerClient = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const otherClient = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await ownerClient.sendCommand({
      type: 'pty.start',
      sessionId: 'session-claimed',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await ownerClient.sendCommand({
      type: 'session.claim',
      sessionId: 'session-claimed',
      controllerId: 'agent-owner',
      controllerType: 'agent',
    });

    otherClient.sendInput('session-claimed', Buffer.from('blocked-input', 'utf8'));
    otherClient.sendResize('session-claimed', 120, 40);
    otherClient.sendSignal('session-claimed', 'interrupt');
    otherClient.sendSignal('session-claimed', 'terminate');
    await delay(10);
    assert.equal(
      sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === 'blocked-input'),
      false,
    );
    assert.equal(sessions[0]!.resizeCalls.length, 0);
    assert.equal(sessions[0]!.isClosed(), false);
    assert.equal(
      sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === '\u0003'),
      false,
    );

    await assert.rejects(
      otherClient.sendCommand({
        type: 'session.respond',
        sessionId: 'session-claimed',
        text: 'blocked-command',
      }),
      /session is claimed by agent:agent-owner/,
    );

    await assert.rejects(
      otherClient.sendCommand({
        type: 'session.release',
        sessionId: 'session-claimed',
      }),
      /session is claimed by agent:agent-owner/,
    );

    await otherClient.sendCommand({
      type: 'session.claim',
      sessionId: 'session-claimed',
      controllerId: 'human-owner',
      controllerType: 'human',
      controllerLabel: 'human owner',
      takeover: true,
    });
    otherClient.sendInput('session-claimed', Buffer.from('allowed-input', 'utf8'));
    await delay(10);
    assert.equal(
      sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === 'allowed-input'),
      true,
    );

    const releaseResult = await otherClient.sendCommand({
      type: 'session.release',
      sessionId: 'session-claimed',
      reason: 'manual done',
    });
    assert.equal(releaseResult['released'], true);

    const releaseAgainResult = await otherClient.sendCommand({
      type: 'session.release',
      sessionId: 'session-claimed',
    });
    assert.equal(releaseAgainResult['released'], false);
  } finally {
    ownerClient.close();
    otherClient.close();
    await server.close();
  }
});

void test('stream server reports agent tool availability and configured install commands', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    agentInstall: {
      codex: {
        command: 'brew install codex-cli',
      },
      critique: {
        command: null,
      },
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    const result = await client.sendCommand({
      type: 'agent.tools.status',
      agentTypes: ['codex', 'critique', 'unknown'],
    });
    const tools = result['tools'] as readonly Record<string, unknown>[];
    assert.equal(tools.length, 2);
    const codex = tools.find((tool) => tool['agentType'] === 'codex');
    const critique = tools.find((tool) => tool['agentType'] === 'critique');
    assert.notEqual(codex, undefined);
    assert.notEqual(critique, undefined);
    assert.equal(typeof codex?.['available'], 'boolean');
    assert.equal(typeof critique?.['available'], 'boolean');
    assert.equal(codex?.['installCommand'], 'brew install codex-cli');
    assert.equal(critique?.['installCommand'], null);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server assertConnectionCanMutateSession tolerates stale null-controller branch', async () => {
  const server = new ControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  try {
    const mutableServer = server as unknown as {
      connectionCanMutateSession: (connectionId: string, state: { controller: null }) => boolean;
      assertConnectionCanMutateSession: (connectionId: string, state: { controller: null }) => void;
    };
    const original = mutableServer.connectionCanMutateSession;
    mutableServer.connectionCanMutateSession = () => false;
    assert.doesNotThrow(() => {
      mutableServer.assertConnectionCanMutateSession('connection-local', {
        controller: null,
      });
    });
    mutableServer.connectionCanMutateSession = original;
  } finally {
    await server.close();
  }
});

void test('stream server keeps status running while typing until runtime events arrive', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-typing',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    assert.equal(sessions.length, 1);

    const initial = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-typing',
    });
    assert.equal(initial['status'], 'running');

    client.sendInput('session-typing', Buffer.from('typed', 'utf8'));
    await delay(10);
    const afterTyping = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-typing',
    });
    assert.equal(afterTyping['status'], 'running');

    client.sendInput('session-typing', Buffer.from('\r', 'utf8'));
    await delay(10);
    const afterSubmit = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-typing',
    });
    assert.equal(afterSubmit['status'], 'running');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server emits session-exit events for subscribed non-attached sessions', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observed = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-active',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-background',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    assert.equal(sessions.length, 2);

    await client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: 'session-active',
    });
    await client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: 'session-background',
    });

    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-active',
      sinceCursor: 0,
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-background',
      sinceCursor: 0,
    });
    await client.sendCommand({
      type: 'pty.detach',
      sessionId: 'session-background',
    });

    client.sendInput('session-background', Buffer.from('\r', 'utf8'));
    await delay(10);
    const runningStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-background',
    });
    assert.equal(runningStatus['status'], 'running');

    sessions[1]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(10);

    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'pty.event' &&
          envelope.sessionId === 'session-background' &&
          envelope.event.type === 'session-exit',
      ),
      true,
    );
    const completedStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-background',
    });
    assert.equal(completedStatus['status'], 'exited');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server surfaces listen failures', async () => {
  const startSession = (input: StartControlPlaneSessionInput): FakeLiveSession =>
    new FakeLiveSession(input);
  const first = new ControlPlaneStreamServer({
    host: '127.0.0.1',
    port: 0,
    startSession,
  });
  await first.start();
  const collisionPort = first.address().port;

  const second = new ControlPlaneStreamServer({
    host: '127.0.0.1',
    port: collisionPort,
    startSession,
  });

  await assert.rejects(second.start());
  await first.close();
});

void test('stream server enforces optional auth token on all operations', async () => {
  const server = await startControlPlaneStreamServer({
    authToken: 'secret-token',
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();

  const unauthenticatedClient = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await assert.rejects(
      unauthenticatedClient.sendCommand({
        type: 'session.list',
      }),
      /authentication required|closed/,
    );

    await assert.rejects(
      connectControlPlaneStreamClient({
        host: address.address,
        port: address.port,
        authToken: 'wrong-token',
      }),
      /invalid auth token|closed/,
    );

    const authenticatedClient = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
      authToken: 'secret-token',
    });
    try {
      const listed = await authenticatedClient.sendCommand({
        type: 'session.list',
      });
      assert.deepEqual(listed['sessions'], []);
    } finally {
      authenticatedClient.close();
    }
  } finally {
    unauthenticatedClient.close();
    await server.close();
  }
});

void test('stream server retains exited tombstones briefly then auto-removes by ttl', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    sessionExitTombstoneTtlMs: 15,
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-ttl',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });

    sessions[0]!.emitExit({
      code: 0,
      signal: null,
    });
    const exited = await waitForSessionStatus(client, 'session-ttl', 'exited');
    assert.equal(exited['status'], 'exited');
    assert.equal(exited['live'], false);
    await assert.rejects(
      client.sendCommand({
        type: 'session.interrupt',
        sessionId: 'session-ttl',
      }),
      /session is not live/,
    );

    await waitForSessionMissing(client, 'session-ttl');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server allows restarting a session id from exited tombstone', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    sessionExitTombstoneTtlMs: 1000,
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-restart',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(5);
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-restart',
      args: [],
      initialCols: 90,
      initialRows: 30,
    });
    assert.equal(sessions.length, 2);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server can remove exited tombstones before ttl callback', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    sessionExitTombstoneTtlMs: 20,
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-remove-tombstone',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(5);
    await client.sendCommand({
      type: 'session.remove',
      sessionId: 'session-remove-tombstone',
    });
    await delay(40);
    await assert.rejects(
      client.sendCommand({
        type: 'session.status',
        sessionId: 'session-remove-tombstone',
      }),
      /session not found/,
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server ttl zero removes exited session immediately', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    sessionExitTombstoneTtlMs: 0,
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-zero-ttl',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(5);
    await assert.rejects(
      client.sendCommand({
        type: 'session.status',
        sessionId: 'session-zero-ttl',
      }),
      /session not found/,
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server covers detach/cleanup and missing-session stream operations', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();

  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observed = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-x',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: 'session-x',
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x',
      sinceCursor: 0,
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x',
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x',
      sinceCursor: 0,
    });
    await client.sendCommand({
      type: 'pty.detach',
      sessionId: 'session-x',
    });
    await client.sendCommand({
      type: 'pty.detach',
      sessionId: 'session-x',
    });

    client.sendInput('missing-session', Buffer.from('ignored', 'utf8'));
    client.sendResize('missing-session', 10, 5);
    client.sendSignal('missing-session', 'interrupt');
    await delay(10);

    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x',
      sinceCursor: 0,
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(10);
    assert.equal(
      observed.some(
        (envelope) => envelope.kind === 'pty.exit' && envelope.sessionId === 'session-x',
      ),
      true,
    );

    sessions[0]!.emitEvent({
      type: 'session-exit',
      exit: {
        code: 0,
        signal: null,
      },
    });

    const cleanupClient = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
    });
    await cleanupClient.sendCommand({
      type: 'pty.start',
      sessionId: 'session-y',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await cleanupClient.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: 'session-y',
    });
    await cleanupClient.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-y',
      sinceCursor: 0,
    });
    cleanupClient.close();
    await delay(10);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server command failure serializes thrown errors', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: () => {
      throw new Error('start-session-failed');
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await assert.rejects(
      client.sendCommand({
        type: 'pty.start',
        sessionId: 'session-fail',
        args: [],
        initialCols: 80,
        initialRows: 24,
      }),
      /Error: start-session-failed/,
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server bounds per-connection output buffering under backpressure', async () => {
  const server = await startControlPlaneStreamServer({
    maxConnectionBufferedBytes: 256,
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-buffer',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-buffer',
      sinceCursor: 2,
    });

    const internals = server as unknown as {
      connections: Map<string, { socket: Socket }>;
    };
    const [connectionState] = [...internals.connections.values()];
    assert.notEqual(connectionState, undefined);
    connectionState!.socket.write = (() => false) as unknown as Socket['write'];
    connectionState!.socket.emit('drain');

    for (let idx = 0; idx < 20; idx += 1) {
      client.sendInput(
        'session-buffer',
        Buffer.from(`payload-${String(idx).padStart(2, '0')}`, 'utf8'),
      );
    }

    await delay(20);
    assert.equal(internals.connections.size, 0);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server internal guard branches remain safe for missing ids', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    sessionExitTombstoneTtlMs: 5,
  });
  try {
    interface InternalSessionState {
      id: string;
      directoryId: string | null;
      tenantId: string;
      userId: string;
      workspaceId: string;
      worktreeId: string;
      session: FakeLiveSession | null;
      eventSubscriberConnectionIds: Set<string>;
      attachmentByConnectionId: Map<string, string>;
      unsubscribe: (() => void) | null;
      status: 'running' | 'needs-input' | 'completed' | 'exited';
      attentionReason: string | null;
      lastEventAt: string | null;
      lastExit: PtyExit | null;
      lastSnapshot: Record<string, unknown> | null;
      startedAt: string;
      exitedAt: string | null;
      tombstoneTimer: NodeJS.Timeout | null;
      lastObservedOutputCursor: number;
      latestTelemetry: Record<string, unknown> | null;
      controller: Record<string, unknown> | null;
      diagnostics: Record<string, unknown>;
    }

    const internals = server as unknown as {
      connections: Map<
        string,
        {
          id: string;
          socket: Socket;
          remainder: string;
          authenticated: boolean;
          attachedSessionIds: Set<string>;
          eventSessionIds: Set<string>;
          streamSubscriptionIds: Set<string>;
          queuedPayloads: Array<{
            payload: string;
            bytes: number;
            diagnosticSessionId: string | null;
          }>;
          queuedPayloadBytes: number;
          writeBlocked: boolean;
        }
      >;
      sessions: Map<string, InternalSessionState>;
      streamSubscriptions: Map<string, { id: string }>;
      handleSessionEvent: (sessionId: string, event: CodexLiveEvent) => void;
      detachConnectionFromSession: (connectionId: string, sessionId: string) => void;
      deactivateSession: (sessionId: string, closeSession: boolean) => void;
      scheduleTombstoneRemoval: (sessionId: string) => void;
      destroySession: (sessionId: string, closeSession: boolean) => void;
      cleanupConnection: (connectionId: string) => void;
      sendToConnection: (connectionId: string, envelope: StreamServerEnvelope) => void;
      flushConnectionWrites: (connectionId: string) => void;
    };

    let destroyed = false;
    const fakeSocket = {
      writableLength: Number.MAX_SAFE_INTEGER,
      write: () => true,
      destroy: () => {
        destroyed = true;
      },
    } as unknown as Socket;
    internals.connections.set('fake-connection', {
      id: 'fake-connection',
      socket: fakeSocket,
      remainder: '',
      authenticated: true,
      attachedSessionIds: new Set<string>(),
      eventSessionIds: new Set<string>(),
      streamSubscriptionIds: new Set<string>(),
      queuedPayloads: [],
      queuedPayloadBytes: 0,
      writeBlocked: false,
    });

    internals.handleSessionEvent('missing-session', {
      type: 'session-exit',
      exit: {
        code: 0,
        signal: null,
      },
    });
    internals.destroySession('missing-session', true);
    internals.sendToConnection('missing-connection', {
      kind: 'auth.ok',
    });

    const fakeConnection = internals.connections.get('fake-connection')!;
    fakeConnection.queuedPayloads.push({
      payload: 'payload',
      bytes: 7,
      diagnosticSessionId: null,
    });
    fakeConnection.queuedPayloadBytes = 7;
    internals.flushConnectionWrites('fake-connection');
    assert.equal(destroyed, true);

    internals.sessions.set('fake-session', {
      id: 'fake-session',
      directoryId: null,
      tenantId: 'tenant-local',
      userId: 'user-local',
      workspaceId: 'workspace-local',
      worktreeId: 'worktree-local',
      session: null,
      eventSubscriberConnectionIds: new Set<string>(),
      attachmentByConnectionId: new Map<string, string>([['fake-connection', 'attachment-x']]),
      unsubscribe: null,
      status: 'exited',
      attentionReason: null,
      lastEventAt: null,
      lastExit: null,
      lastSnapshot: null,
      startedAt: new Date(0).toISOString(),
      exitedAt: new Date(0).toISOString(),
      tombstoneTimer: null,
      lastObservedOutputCursor: 0,
      latestTelemetry: null,
      controller: null,
      diagnostics: {
        telemetryIngestedTotal: 0,
        telemetryRetainedTotal: 0,
        telemetryDroppedTotal: 0,
        telemetryIngestRate: {
          buckets: [0, 0, 0, 0, 0, 0],
          currentBucketStartMs: 0,
        },
        telemetryEventsLast60s: 0,
        telemetryIngestQps1m: 0,
        fanoutEventsEnqueuedTotal: 0,
        fanoutBytesEnqueuedTotal: 0,
        fanoutBackpressureSignalsTotal: 0,
        fanoutBackpressureDisconnectsTotal: 0,
      },
    } as unknown as typeof internals.sessions extends Map<string, infer T> ? T : never);
    internals.detachConnectionFromSession('fake-connection', 'fake-session');

    const cleanupSocket = {
      writableLength: 0,
      write: () => true,
      destroy: () => undefined,
    } as unknown as Socket;
    internals.connections.set('cleanup-connection', {
      id: 'cleanup-connection',
      socket: cleanupSocket,
      remainder: '',
      authenticated: true,
      attachedSessionIds: new Set<string>(),
      eventSessionIds: new Set<string>(),
      streamSubscriptionIds: new Set<string>(['subscription-cleanup']),
      queuedPayloads: [],
      queuedPayloadBytes: 0,
      writeBlocked: false,
    });
    internals.streamSubscriptions.set('subscription-cleanup', {
      id: 'subscription-cleanup',
    } as unknown as { id: string });
    internals.sessions.set('controlled-session', {
      id: 'controlled-session',
      directoryId: null,
      tenantId: 'tenant-local',
      userId: 'user-local',
      workspaceId: 'workspace-local',
      worktreeId: 'worktree-local',
      session: null,
      eventSubscriberConnectionIds: new Set<string>(),
      attachmentByConnectionId: new Map<string, string>(),
      unsubscribe: null,
      status: 'running',
      attentionReason: null,
      lastEventAt: new Date(0).toISOString(),
      lastExit: null,
      lastSnapshot: null,
      startedAt: new Date(0).toISOString(),
      exitedAt: null,
      tombstoneTimer: null,
      lastObservedOutputCursor: 0,
      latestTelemetry: null,
      controller: {
        connectionId: 'cleanup-connection',
        controllerId: 'agent-cleanup',
        controllerType: 'agent',
        controllerLabel: 'Cleanup Agent',
        claimedAt: new Date(0).toISOString(),
      },
      diagnostics: {
        telemetryIngestedTotal: 0,
        telemetryRetainedTotal: 0,
        telemetryDroppedTotal: 0,
        telemetryIngestRate: {
          buckets: [0, 0, 0, 0, 0, 0],
          currentBucketStartMs: 0,
        },
        telemetryEventsLast60s: 0,
        telemetryIngestQps1m: 0,
        fanoutEventsEnqueuedTotal: 0,
        fanoutBytesEnqueuedTotal: 0,
        fanoutBackpressureSignalsTotal: 0,
        fanoutBackpressureDisconnectsTotal: 0,
      },
    } as unknown as typeof internals.sessions extends Map<string, infer T> ? T : never);
    internals.cleanupConnection('cleanup-connection');
    assert.equal(internals.streamSubscriptions.has('subscription-cleanup'), false);
    const controlledAfterCleanup = internals.sessions.get('controlled-session') as
      | {
          controller: Record<string, unknown> | null;
        }
      | undefined;
    assert.notEqual(controlledAfterCleanup, undefined);
    assert.equal(controlledAfterCleanup?.controller, null);

    internals.deactivateSession('missing-session', true);
    internals.deactivateSession('fake-session', true);
    internals.scheduleTombstoneRemoval('missing-session');

    const fakeTimer = setTimeout(() => undefined, 1000);
    const fakeSessionState = internals.sessions.get('fake-session');
    assert.notEqual(fakeSessionState, undefined);
    fakeSessionState!.status = 'exited';
    fakeSessionState!.tombstoneTimer = fakeTimer;
    internals.scheduleTombstoneRemoval('fake-session');

    internals.sessions.set('timer-guard-session', {
      id: 'timer-guard-session',
      directoryId: null,
      tenantId: 'tenant-local',
      userId: 'user-local',
      workspaceId: 'workspace-local',
      worktreeId: 'worktree-local',
      session: null,
      eventSubscriberConnectionIds: new Set<string>(),
      attachmentByConnectionId: new Map<string, string>(),
      unsubscribe: null,
      status: 'exited',
      attentionReason: null,
      lastEventAt: null,
      lastExit: null,
      lastSnapshot: null,
      startedAt: new Date(0).toISOString(),
      exitedAt: new Date(0).toISOString(),
      tombstoneTimer: null,
      lastObservedOutputCursor: 0,
      latestTelemetry: null,
      controller: null,
      diagnostics: {
        telemetryIngestedTotal: 0,
        telemetryRetainedTotal: 0,
        telemetryDroppedTotal: 0,
        telemetryIngestRate: {
          buckets: [0, 0, 0, 0, 0, 0],
          currentBucketStartMs: 0,
        },
        telemetryEventsLast60s: 0,
        telemetryIngestQps1m: 0,
        fanoutEventsEnqueuedTotal: 0,
        fanoutBytesEnqueuedTotal: 0,
        fanoutBackpressureSignalsTotal: 0,
        fanoutBackpressureDisconnectsTotal: 0,
      },
    });
    internals.scheduleTombstoneRemoval('timer-guard-session');
    const timerGuardState = internals.sessions.get('timer-guard-session');
    assert.notEqual(timerGuardState, undefined);
    timerGuardState!.status = 'running';
    await delay(20);
    assert.equal(internals.sessions.has('timer-guard-session'), true);
    internals.destroySession('timer-guard-session', false);
  } finally {
    await server.close();
  }
});

void test('stream server supports injected state store and observed filter/journal guards', async () => {
  const injectedStore = new SqliteControlPlaneStore(':memory:');
  const server = new ControlPlaneStreamServer({
    maxStreamJournalEntries: 1,
    stateStore: injectedStore,
    startSession: (input) => new FakeLiveSession(input),
  });
  try {
    const internals = server as unknown as {
      streamJournal: Array<{ cursor: number }>;
      matchesObservedFilter: (
        scope: {
          tenantId: string;
          userId: string;
          workspaceId: string;
          directoryId: string | null;
          conversationId: string;
        },
        event: Record<string, unknown>,
        filter: {
          includeOutput: boolean;
          tenantId?: string;
          userId?: string;
          workspaceId?: string;
          repositoryId?: string;
          taskId?: string;
          directoryId?: string;
          conversationId?: string;
        },
      ) => boolean;
      publishObservedEvent: (
        scope: {
          tenantId: string;
          userId: string;
          workspaceId: string;
          directoryId: string | null;
          conversationId: string;
        },
        event: Record<string, unknown>,
      ) => void;
    };

    const baseScope = {
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
      directoryId: 'directory-a',
      conversationId: 'conversation-a',
    };
    const statusEvent = {
      type: 'session-status',
      sessionId: 'conversation-a',
      status: 'running',
      attentionReason: null,
      live: true,
      ts: new Date(0).toISOString(),
      directoryId: 'directory-a',
      conversationId: 'conversation-a',
    };
    const outputEvent = {
      type: 'session-output',
      sessionId: 'conversation-a',
      outputCursor: 1,
      chunkBase64: Buffer.from('x').toString('base64'),
      ts: new Date(0).toISOString(),
      directoryId: 'directory-a',
      conversationId: 'conversation-a',
    };
    const reorderedEvent = {
      type: 'task-reordered',
      tasks: [
        {
          taskId: 'task-a',
          repositoryId: 'repository-a',
        },
      ],
    };

    assert.equal(
      internals.matchesObservedFilter(baseScope, outputEvent, { includeOutput: false }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        tenantId: 'tenant-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        userId: 'user-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        workspaceId: 'workspace-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        directoryId: 'directory-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        conversationId: 'conversation-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, reorderedEvent, {
        includeOutput: true,
        repositoryId: 'repository-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, reorderedEvent, {
        includeOutput: true,
        taskId: 'task-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        tenantId: 'tenant-a',
        userId: 'user-a',
        workspaceId: 'workspace-a',
        directoryId: 'directory-a',
        conversationId: 'conversation-a',
      }),
      true,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, reorderedEvent, {
        includeOutput: true,
        repositoryId: 'repository-missing',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, reorderedEvent, {
        includeOutput: true,
        taskId: 'task-missing',
      }),
      false,
    );

    internals.publishObservedEvent(baseScope, statusEvent);
    internals.publishObservedEvent(baseScope, statusEvent);
    assert.equal(internals.streamJournal.length, 1);
    assert.equal(internals.streamJournal[0]?.cursor, 2);
  } finally {
    await server.close();
  }

  injectedStore.upsertDirectory({
    directoryId: 'after-close-directory',
    tenantId: 'tenant-after',
    userId: 'user-after',
    workspaceId: 'workspace-after',
    path: '/tmp/after-close',
  });
  injectedStore.close();
});
