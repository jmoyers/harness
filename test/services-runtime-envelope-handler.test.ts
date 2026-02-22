import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { StreamServerEnvelope } from '../src/control-plane/stream-protocol.ts';
import { RuntimeEnvelopeHandler } from '../src/services/runtime-envelope-handler.ts';

interface ConversationRecord {
  directoryId: string | null;
  agentType: string;
  adapterState: Record<string, unknown>;
  scope: unknown;
  lastEventAt: string;
}

function asEnvelope(value: unknown): StreamServerEnvelope {
  return value as StreamServerEnvelope;
}

void test('runtime envelope handler handles pty.output, records cursor regression, and updates active conversation', () => {
  const calls: string[] = [];
  const conversation: ConversationRecord = {
    directoryId: 'dir-1',
    agentType: 'codex',
    adapterState: {},
    scope: { tenantId: 'tenant' },
    lastEventAt: 'old-ts',
  };
  const events: Array<{ ts: string }> = [];
  const handler = new RuntimeEnvelopeHandler({
    perfNowNs: (() => {
      let tick = 0n;
      return () => {
        tick += 10_000_000n;
        return tick;
      };
    })(),
    isRemoved: () => false,
    ensureConversation: () => conversation,
    ingestOutputChunk: (input) => {
      calls.push(`ingest:${input.sessionId}:${input.cursor}:${input.chunk.length}`);
      return {
        conversation,
        cursorRegressed: true,
        previousCursor: 25,
      };
    },
    noteGitActivity: (directoryId) => {
      calls.push(`noteGit:${directoryId ?? 'null'}`);
    },
    recordOutputChunk: (input) => {
      calls.push(
        `recordOutputChunk:${input.sessionId}:${input.chunkLength}:${input.active ? '1' : '0'}`,
      );
    },
    startupOutputChunk: (sessionId, chunkLength) => {
      calls.push(`startupOutput:${sessionId}:${chunkLength}`);
    },
    startupPaintOutputChunk: (sessionId) => {
      calls.push(`startupPaintOutput:${sessionId}`);
    },
    recordPerfEvent: (name, attrs) => {
      calls.push(`perf:${name}:${attrs['sessionId']}`);
    },
    mapTerminalOutputToNormalizedEvent: (_chunk, _scope, _idFactory) => ({
      ts: 'new-ts',
    }),
    mapSessionEventToNormalizedEvent: () => null,
    observedAtFromSessionEvent: () => 'observed',
    mergeAdapterStateFromSessionEvent: () => null,
    enqueueEvent: (event) => {
      events.push(event);
      calls.push(`enqueue:${event.ts}`);
    },
    activeConversationId: () => 'session-1',
    markSessionExited: () => {
      calls.push('markExited');
    },
    deletePtySize: () => {
      calls.push('deletePtySize');
    },
    setExit: () => {
      calls.push('setExit');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    nowIso: () => '2026-02-18T00:00:00.000Z',
    recordOutputHandled: (durationMs) => {
      calls.push(`recordOutputHandled:${durationMs > 0 ? '1' : '0'}`);
    },
    conversationById: () => conversation,
    applyObservedEvent: () => {
      calls.push('applyObserved');
    },
    idFactory: () => 'event-id',
  });

  handler.handleEnvelope(
    asEnvelope({
      kind: 'pty.output',
      sessionId: 'session-1',
      cursor: 5,
      chunkBase64: Buffer.from('hello').toString('base64'),
    }),
  );

  assert.equal(conversation.lastEventAt, 'new-ts');
  assert.deepEqual(events, [{ ts: 'new-ts' }]);
  assert.deepEqual(calls, [
    'ingest:session-1:5:5',
    'noteGit:dir-1',
    'recordOutputChunk:session-1:5:1',
    'startupOutput:session-1:5',
    'startupPaintOutput:session-1',
    'perf:mux.output.cursor-regression:session-1',
    'enqueue:new-ts',
    'markDirty',
    'recordOutputHandled:1',
  ]);
});

void test('runtime envelope handler handles pty.event session-exit and pty.exit branches', () => {
  const calls: string[] = [];
  const conversation: ConversationRecord = {
    directoryId: 'dir-2',
    agentType: 'cursor',
    adapterState: {
      resumeSessionId: 'old',
    },
    scope: { tenantId: 'tenant' },
    lastEventAt: 'old-ts',
  };

  const handler = new RuntimeEnvelopeHandler({
    perfNowNs: () => 10n,
    isRemoved: () => false,
    ensureConversation: () => conversation,
    ingestOutputChunk: () => {
      throw new Error('not expected');
    },
    noteGitActivity: (directoryId) => {
      calls.push(`noteGit:${directoryId ?? 'null'}`);
    },
    recordOutputChunk: () => {},
    startupOutputChunk: () => {},
    startupPaintOutputChunk: () => {},
    recordPerfEvent: () => {},
    mapTerminalOutputToNormalizedEvent: () => ({ ts: 'unused' }),
    mapSessionEventToNormalizedEvent: () => ({
      ts: 'event-ts',
    }),
    observedAtFromSessionEvent: () => 'observed-ts',
    mergeAdapterStateFromSessionEvent: () => ({
      resumeSessionId: 'new',
    }),
    enqueueEvent: (event) => {
      calls.push(`enqueue:${event.ts}`);
    },
    activeConversationId: () => null,
    markSessionExited: (input) => {
      calls.push(`markExited:${input.sessionId}`);
    },
    deletePtySize: (sessionId) => {
      calls.push(`deletePtySize:${sessionId}`);
    },
    setExit: (exit) => {
      calls.push(`setExit:${exit.code ?? 'null'}:${exit.signal ?? 'null'}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    nowIso: () => '2026-02-18T00:00:00.000Z',
    recordOutputHandled: () => {},
    conversationById: () => conversation,
    applyObservedEvent: () => {},
    idFactory: () => 'event-id',
  });

  handler.handleEnvelope(
    asEnvelope({
      kind: 'pty.event',
      sessionId: 'session-2',
      event: {
        type: 'session-exit',
        exit: {
          code: 1,
          signal: null,
        },
      },
    }),
  );
  assert.deepEqual(conversation.adapterState, {
    resumeSessionId: 'new',
  });

  handler.handleEnvelope(
    asEnvelope({
      kind: 'pty.exit',
      sessionId: 'session-2',
      exit: {
        code: 0,
        signal: null,
      },
    }),
  );

  assert.deepEqual(calls, [
    'noteGit:dir-2',
    'enqueue:event-ts',
    'setExit:1:null',
    'markExited:session-2',
    'deletePtySize:session-2',
    'markDirty',
    'noteGit:dir-2',
    'setExit:0:null',
    'markExited:session-2',
    'deletePtySize:session-2',
    'markDirty',
  ]);
});

void test('runtime envelope handler forwards stream.event envelopes and removed-session short-circuit', () => {
  const calls: string[] = [];
  const conversation: ConversationRecord = {
    directoryId: 'dir-3',
    agentType: 'codex',
    adapterState: {},
    scope: {},
    lastEventAt: 'old',
  };
  let removed = true;

  const handler = new RuntimeEnvelopeHandler({
    perfNowNs: () => 0n,
    isRemoved: () => removed,
    ensureConversation: () => conversation,
    ingestOutputChunk: () => {
      calls.push('ingest');
      return {
        conversation,
        cursorRegressed: false,
        previousCursor: 0,
      };
    },
    noteGitActivity: () => {
      calls.push('noteGit');
    },
    recordOutputChunk: () => {
      calls.push('recordOutputChunk');
    },
    startupOutputChunk: () => {},
    startupPaintOutputChunk: () => {},
    recordPerfEvent: () => {},
    mapTerminalOutputToNormalizedEvent: () => ({ ts: 'ts' }),
    mapSessionEventToNormalizedEvent: () => null,
    observedAtFromSessionEvent: () => 'observed',
    mergeAdapterStateFromSessionEvent: () => null,
    enqueueEvent: () => {},
    activeConversationId: () => null,
    markSessionExited: () => {},
    deletePtySize: () => {},
    setExit: () => {},
    markDirty: () => {
      calls.push('markDirty');
    },
    nowIso: () => '2026-02-18T00:00:00.000Z',
    recordOutputHandled: () => {},
    conversationById: () => undefined,
    applyObservedEvent: (input) => {
      calls.push(`applyObserved:${input.subscriptionId}:${input.cursor}`);
    },
    idFactory: () => 'event-id',
  });

  handler.handleEnvelope(
    asEnvelope({
      kind: 'pty.output',
      sessionId: 'session-3',
      cursor: 1,
      chunkBase64: Buffer.from('x').toString('base64'),
    }),
  );
  removed = false;
  handler.handleEnvelope(
    asEnvelope({
      kind: 'stream.event',
      subscriptionId: 'sub-1',
      cursor: 9,
      event: {
        kind: 'repository-created',
        observedAt: '2026-02-18T00:00:00.000Z',
        repository: {
          repositoryId: 'repository-1',
          tenantId: 'tenant',
          userId: 'user',
          workspaceId: 'workspace',
          name: 'repo',
          remoteUrl: 'https://example.com/repo.git',
          defaultBranch: 'main',
          metadata: {},
          createdAt: '2026-02-18T00:00:00.000Z',
          archivedAt: null,
        },
      },
    }),
  );
  handler.handleEnvelope(
    asEnvelope({
      kind: 'stream.event',
      subscriptionId: 'sub-1',
      cursor: 9,
      event: {
        kind: 'repository-created',
        observedAt: '2026-02-18T00:00:00.000Z',
        repository: {
          repositoryId: 'repository-2',
          tenantId: 'tenant',
          userId: 'user',
          workspaceId: 'workspace',
          name: 'repo-2',
          remoteUrl: 'https://example.com/repo-2.git',
          defaultBranch: 'main',
          metadata: {},
          createdAt: '2026-02-18T00:00:00.000Z',
          archivedAt: null,
        },
      },
    }),
  );
  handler.handleEnvelope(
    asEnvelope({
      kind: 'stream.event',
      subscriptionId: 'sub-1',
      cursor: 10,
      event: {
        kind: 'repository-created',
        observedAt: '2026-02-18T00:00:01.000Z',
        repository: {
          repositoryId: 'repository-3',
          tenantId: 'tenant',
          userId: 'user',
          workspaceId: 'workspace',
          name: 'repo-3',
          remoteUrl: 'https://example.com/repo-3.git',
          defaultBranch: 'main',
          metadata: {},
          createdAt: '2026-02-18T00:00:01.000Z',
          archivedAt: null,
        },
      },
    }),
  );

  assert.deepEqual(calls, [
    'applyObserved:sub-1:9',
    'applyObserved:sub-1:9',
    'applyObserved:sub-1:10',
  ]);
});
