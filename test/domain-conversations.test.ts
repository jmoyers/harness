import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ConversationManager } from '../src/domain/conversations.ts';
import {
  createConversationState,
  type ConversationState,
} from '../src/mux/live-mux/conversation-state.ts';
import type { EventScope } from '../src/events/normalized-events.ts';
import { statusModelFor } from './support/status-model.ts';

const BASE_SCOPE: EventScope = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  workspaceId: 'workspace-a',
  worktreeId: 'worktree-a',
  conversationId: 'conversation-seed',
  turnId: 'turn-seed',
};

function createState(
  sessionId: string,
  directoryId: string | null,
  title = 'Title',
  agentType = 'codex',
  adapterState: Record<string, unknown> = {},
): ConversationState {
  return createConversationState(
    sessionId,
    directoryId,
    title,
    agentType,
    adapterState,
    `turn-${sessionId}`,
    BASE_SCOPE,
    80,
    24,
  );
}

void test('conversation manager map helpers and active-state operations are stable', () => {
  const manager = new ConversationManager();
  assert.equal(manager.size(), 0);
  assert.equal(manager.getActiveConversation(), null);
  assert.equal(manager.ensureActiveConversationId(), null);
  assert.deepEqual(manager.orderedIds(), []);
  assert.equal(manager.findConversationIdByDirectory('dir-a'), null);

  const state = createState('session-a', 'dir-a');
  manager.set(state);
  assert.equal(manager.get('session-a'), state);
  assert.equal(manager.has('session-a'), true);
  assert.equal(manager.size(), 1);
  assert.equal([...manager.values()].length, 1);
  assert.equal(manager.readonlyConversations().get('session-a'), state);
  assert.equal(manager.directoryIdOf('session-a'), 'dir-a');
  assert.equal(manager.directoryIdOf('missing'), null);
  assert.equal(manager.isLive('session-a'), true);
  assert.equal(manager.isLive('missing'), false);
  assert.equal(manager.findConversationIdByDirectory('dir-a'), 'session-a');
  assert.equal(manager.findConversationIdByDirectory('missing'), null);

  assert.equal(manager.setController('missing', null), null);
  assert.equal(manager.setLastEventAt('missing', '2026-02-18T00:00:00.000Z'), null);
  const controller = {
    controllerId: 'human-1',
    controllerType: 'human',
    controllerLabel: 'Human',
    claimedAt: '2026-02-18T00:00:00.000Z',
  } as const;
  assert.equal(manager.setController('session-a', controller), state);
  assert.equal(state.controller, controller);
  assert.equal(
    manager.setLastEventAt('session-a', '2026-02-18T00:01:00.000Z')?.lastEventAt,
    '2026-02-18T00:01:00.000Z',
  );

  manager.setActiveConversationId('session-a');
  assert.equal(manager.getActiveConversation(), state);
  assert.equal(manager.ensureActiveConversationId(), 'session-a');
  manager.remove('session-a');
  assert.equal(manager.get('session-a'), undefined);
  assert.equal(manager.has('session-a'), false);
  assert.equal(manager.getActiveConversation(), null);
  assert.equal(manager.isRemoved('session-a'), true);
  manager.clearRemoved('session-a');
  assert.equal(manager.isRemoved('session-a'), false);
});

void test('conversation manager ensure lifecycle and start-in-flight semantics are stable', async () => {
  const manager = new ConversationManager();
  assert.throws(() => manager.ensure('session-a'), /ensure dependencies are not configured/);

  const createdInputs: Array<{
    sessionId: string;
    directoryId: string | null;
    title: string;
    agentType: string;
  }> = [];
  manager.configureEnsureDependencies({
    resolveDefaultDirectoryId: () => 'dir-default',
    normalizeAdapterState: (value) => ({
      normalized: true,
      ...(value ?? {}),
    }),
    createConversation: (input) => {
      createdInputs.push({
        sessionId: input.sessionId,
        directoryId: input.directoryId,
        title: input.title,
        agentType: input.agentType,
      });
      return createState(
        input.sessionId,
        input.directoryId,
        input.title,
        input.agentType,
        input.adapterState,
      );
    },
  });

  manager.remove('session-a');
  assert.equal(manager.isRemoved('session-a'), true);
  const created = manager.ensure('session-a');
  assert.equal(created.directoryId, 'dir-default');
  assert.equal(created.agentType, 'codex');
  assert.equal((created.adapterState['normalized'] as boolean) ?? false, true);
  assert.equal(manager.isRemoved('session-a'), false);
  assert.equal(createdInputs.length, 1);

  const updated = manager.ensure('session-a', {
    directoryId: null,
    title: 'Renamed',
    agentType: 'claude',
    adapterState: { session: 'abc' },
  });
  assert.equal(updated, created);
  assert.equal(updated.directoryId, null);
  assert.equal(updated.title, 'Renamed');
  assert.equal(updated.agentType, 'claude');
  assert.equal(updated.adapterState['normalized'], true);
  assert.equal(updated.adapterState['session'], 'abc');
  assert.equal(createdInputs.length, 1);

  manager.setActiveConversationId(null);
  assert.equal(manager.ensureActiveConversationId(), 'session-a');
  assert.equal(manager.requireActiveConversation().sessionId, 'session-a');
  manager.setActiveConversationId('missing');
  assert.throws(() => manager.requireActiveConversation(), /active thread missing: missing/);
  manager.setActiveConversationId(null);
  manager.remove('session-a');
  assert.throws(() => manager.requireActiveConversation(), /active thread is not set/);

  const session = manager.ensure('session-b', { directoryId: 'dir-b' });
  const inFlight = Promise.resolve(session);
  manager.setStartInFlight('session-b', inFlight);
  let factoryCalls = 0;
  const fromExistingInFlight = await manager.runWithStartInFlight('session-b', async () => {
    factoryCalls += 1;
    return createState('session-c', 'dir-c');
  });
  assert.equal(fromExistingInFlight, session);
  assert.equal(factoryCalls, 0);
  manager.clearStartInFlight('session-b');
  assert.equal(manager.getStartInFlight('session-b'), undefined);

  const createdFromFactory = await manager.runWithStartInFlight('session-b', async () => {
    factoryCalls += 1;
    return session;
  });
  assert.equal(createdFromFactory, session);
  assert.equal(factoryCalls, 1);
  assert.equal(manager.getStartInFlight('session-b'), undefined);

  await assert.rejects(
    () =>
      manager.runWithStartInFlight('session-fail', async () => {
        throw new Error('start failure');
      }),
    /start failure/,
  );
  assert.equal(manager.getStartInFlight('session-fail'), undefined);
});

void test('conversation manager persistence, summaries, io updates, and attach/detach transitions are stable', async () => {
  const manager = new ConversationManager();
  manager.configureEnsureDependencies({
    resolveDefaultDirectoryId: () => 'dir-default',
    normalizeAdapterState: (value) => value ?? {},
    createConversation: (input) =>
      createState(
        input.sessionId,
        input.directoryId,
        input.title,
        input.agentType,
        input.adapterState,
      ),
  });

  const persisted = manager.upsertFromPersistedRecord({
    record: {
      conversationId: 'session-persisted',
      directoryId: 'dir-persisted',
      tenantId: 'tenant-persisted',
      userId: 'user-persisted',
      workspaceId: 'workspace-persisted',
      title: 'Persisted',
      agentType: 'codex',
      adapterState: { persisted: true },
      runtimeStatus: 'running',
      runtimeStatusModel: statusModelFor('running'),
      runtimeLive: false,
    },
    ensureConversation: (sessionId, seed) => manager.ensure(sessionId, seed),
  });
  assert.equal(persisted.scope.tenantId, 'tenant-persisted');
  assert.equal(persisted.status, 'running');
  assert.equal(persisted.live, false);

  const persistedLive = manager.upsertFromPersistedRecord({
    record: {
      conversationId: 'session-live',
      directoryId: 'dir-live',
      tenantId: 'tenant-live',
      userId: 'user-live',
      workspaceId: 'workspace-live',
      title: 'Live',
      agentType: 'claude',
      adapterState: { persisted: true },
      runtimeStatus: 'needs-input',
      runtimeStatusModel: statusModelFor('needs-input', {
        attentionReason: 'needs-input',
        detailText: 'needs-input',
      }),
      runtimeLive: true,
    },
    ensureConversation: (sessionId, seed) => manager.ensure(sessionId, seed),
  });
  assert.equal(persistedLive.status, 'needs-input');
  assert.equal(persistedLive.live, false);

  const fromSummary = manager.upsertFromSessionSummary({
    summary: {
      sessionId: 'session-live',
      tenantId: 'tenant-summary',
      userId: 'user-summary',
      workspaceId: 'workspace-summary',
      worktreeId: 'worktree-summary',
      directoryId: 'dir-summary',
      status: 'needs-input',
      attentionReason: 'needs-input',
      statusModel: statusModelFor('needs-input', {
        attentionReason: 'needs-input',
        observedAt: '2026-02-18T00:00:01.000Z',
        detailText: 'needs-input',
      }),
      latestCursor: 12,
      attachedClients: 1,
      eventSubscribers: 2,
      startedAt: '2026-02-18T00:00:00.000Z',
      lastEventAt: '2026-02-18T00:00:01.000Z',
      exitedAt: null,
      lastExit: null,
      processId: 42,
      live: true,
      launchCommand: 'codex',
      controller: null,
      telemetry: null,
    },
    ensureConversation: (sessionId, seed) => manager.ensure(sessionId, seed),
  });
  assert.equal(fromSummary.scope.workspaceId, 'workspace-summary');
  assert.equal(fromSummary.lastEventAt, '2026-02-18T00:00:01.000Z');

  assert.equal(
    manager.markSessionExited({
      sessionId: 'missing',
      exit: { code: 0, signal: null },
      exitedAt: '2026-02-18T00:00:02.000Z',
    }),
    null,
  );
  const exited = manager.markSessionExited({
    sessionId: 'session-live',
    exit: { code: 9, signal: 'SIGTERM' },
    exitedAt: '2026-02-18T00:00:02.000Z',
  });
  assert.equal(exited?.status, 'exited');
  assert.equal(exited?.live, false);
  assert.deepEqual(exited?.lastExit, { code: 9, signal: 'SIGTERM' });

  const ioConversation = manager.ensure('session-io', { directoryId: 'dir-io' });
  ioConversation.lastOutputCursor = 8;
  const regressed = manager.ingestOutputChunk({
    sessionId: 'session-io',
    cursor: 3,
    chunk: Buffer.from('abc', 'utf8'),
    ensureConversation: (sessionId, seed) => manager.ensure(sessionId, seed),
  });
  assert.equal(regressed.cursorRegressed, true);
  assert.equal(regressed.previousCursor, 8);
  assert.equal(regressed.conversation.lastOutputCursor, 3);

  const advanced = manager.ingestOutputChunk({
    sessionId: 'session-io',
    cursor: 9,
    chunk: Buffer.from('def', 'utf8'),
    ensureConversation: (sessionId, seed) => manager.ensure(sessionId, seed),
  });
  assert.equal(advanced.cursorRegressed, false);
  assert.equal(advanced.previousCursor, 3);

  assert.equal(manager.setAttached('missing', true), null);
  assert.equal(manager.setAttached('session-io', true)?.attached, true);
  assert.equal(manager.markSessionUnavailable('missing'), null);

  ioConversation.status = 'running';
  ioConversation.attentionReason = 'needs-input';
  manager.markSessionUnavailable('session-io');
  assert.equal(ioConversation.status, 'completed');
  assert.equal(ioConversation.attached, false);
  assert.equal(ioConversation.live, false);
  assert.equal(ioConversation.attentionReason, null);

  ioConversation.status = 'exited';
  ioConversation.attentionReason = 'retained';
  manager.markSessionUnavailable('session-io');
  assert.equal(ioConversation.status, 'exited');
  assert.equal(ioConversation.attentionReason, 'retained');

  ioConversation.controller = {
    controllerId: 'controller-1',
    controllerType: 'human',
    controllerLabel: 'Human',
    claimedAt: '2026-02-18T00:00:00.000Z',
  };
  assert.equal(
    manager.isControlledByLocalHuman({
      conversation: ioConversation,
      controllerId: 'controller-1',
    }),
    true,
  );
  assert.equal(
    manager.isControlledByLocalHuman({
      conversation: ioConversation,
      controllerId: 'controller-2',
    }),
    false,
  );
  ioConversation.controller = {
    controllerId: 'automation-1',
    controllerType: 'automation',
    controllerLabel: 'Automation',
    claimedAt: '2026-02-18T00:00:00.000Z',
  };
  assert.equal(
    manager.isControlledByLocalHuman({
      conversation: ioConversation,
      controllerId: 'automation-1',
    }),
    false,
  );

  assert.deepEqual(
    await manager.attachIfLive({
      sessionId: 'missing',
      attach: async () => {},
    }),
    {
      attached: false,
      conversation: null,
      sinceCursor: null,
    },
  );
  ioConversation.live = false;
  assert.equal(
    (
      await manager.attachIfLive({
        sessionId: 'session-io',
        attach: async () => {},
      })
    ).attached,
    false,
  );
  ioConversation.live = true;
  ioConversation.attached = true;
  assert.equal(
    (
      await manager.attachIfLive({
        sessionId: 'session-io',
        attach: async () => {},
      })
    ).attached,
    false,
  );

  ioConversation.attached = false;
  ioConversation.lastOutputCursor = -5;
  let attachedSinceCursor = Number.NaN;
  const attached = await manager.attachIfLive({
    sessionId: 'session-io',
    attach: async (sinceCursor) => {
      attachedSinceCursor = sinceCursor;
    },
  });
  assert.equal(attached.attached, true);
  assert.equal(attachedSinceCursor, 0);
  assert.equal(ioConversation.attached, true);

  assert.deepEqual(
    await manager.detachIfAttached({
      sessionId: 'missing',
      detach: async () => {},
    }),
    {
      detached: false,
      conversation: null,
    },
  );
  ioConversation.attached = false;
  assert.equal(
    (
      await manager.detachIfAttached({
        sessionId: 'session-io',
        detach: async () => {},
      })
    ).detached,
    false,
  );
  ioConversation.attached = true;
  let detachCalls = 0;
  const detached = await manager.detachIfAttached({
    sessionId: 'session-io',
    detach: async () => {
      detachCalls += 1;
    },
  });
  assert.equal(detached.detached, true);
  assert.equal(detachCalls, 1);
  assert.equal(ioConversation.attached, false);
});

void test('conversation manager persisted upsert does not regress live state after session-summary hydration', () => {
  const manager = new ConversationManager();
  manager.configureEnsureDependencies({
    resolveDefaultDirectoryId: () => 'dir-default',
    normalizeAdapterState: (value) => value ?? {},
    createConversation: (input) =>
      createState(
        input.sessionId,
        input.directoryId,
        input.title,
        input.agentType,
        input.adapterState,
      ),
  });

  manager.upsertFromSessionSummary({
    summary: {
      sessionId: 'session-race',
      tenantId: 'tenant-live',
      userId: 'user-live',
      workspaceId: 'workspace-live',
      worktreeId: 'worktree-live',
      directoryId: 'dir-live',
      status: 'running',
      attentionReason: null,
      statusModel: statusModelFor('running'),
      latestCursor: 1,
      attachedClients: 0,
      eventSubscribers: 1,
      startedAt: '2026-02-19T00:00:00.000Z',
      lastEventAt: '2026-02-19T00:00:01.000Z',
      exitedAt: null,
      lastExit: null,
      processId: 101,
      live: true,
      launchCommand: 'codex',
      controller: null,
      telemetry: null,
    },
    ensureConversation: (sessionId, seed) => manager.ensure(sessionId, seed),
  });

  const persisted = manager.upsertFromPersistedRecord({
    record: {
      conversationId: 'session-race',
      directoryId: 'dir-live',
      tenantId: 'tenant-live',
      userId: 'user-live',
      workspaceId: 'workspace-live',
      title: 'Live Session',
      agentType: 'codex',
      adapterState: { persisted: true },
      runtimeStatus: 'completed',
      runtimeStatusModel: statusModelFor('completed'),
      runtimeLive: false,
    },
    ensureConversation: (sessionId, seed) => manager.ensure(sessionId, seed),
  });

  assert.equal(persisted.live, true);
  assert.equal(persisted.status, 'running');
});
