import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  addDirectoryByPath,
  archiveConversation,
  closeDirectory,
  createAndActivateConversationInDirectory,
  openNewThreadPrompt,
  openOrCreateCritiqueConversationInDirectory,
  takeoverConversation,
} from '../src/mux/live-mux/actions-conversation.ts';

void test('openNewThreadPrompt returns early when directory is missing', () => {
  const calls: string[] = [];
  openNewThreadPrompt({
    directoryId: 'missing-dir',
    directoriesHas: () => false,
    clearAddDirectoryPrompt: () => {
      calls.push('clearAddDirectoryPrompt');
    },
    clearRepositoryPrompt: () => {
      calls.push('clearRepositoryPrompt');
    },
    hasConversationTitleEdit: true,
    stopConversationTitleEdit: () => {
      calls.push('stopConversationTitleEdit');
    },
    clearConversationTitleEditClickState: () => {
      calls.push('clearConversationTitleEditClickState');
    },
    createNewThreadPromptState: () => ({ directoryId: 'missing-dir' }),
    setNewThreadPrompt: () => {
      calls.push('setNewThreadPrompt');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, []);
});

void test('openNewThreadPrompt clears prompts and sets modal state', () => {
  const calls: string[] = [];
  const prompts: Array<{ directoryId: string }> = [];
  openNewThreadPrompt({
    directoryId: 'dir-a',
    directoriesHas: (directoryId) => directoryId === 'dir-a',
    clearAddDirectoryPrompt: () => {
      calls.push('clearAddDirectoryPrompt');
    },
    clearRepositoryPrompt: () => {
      calls.push('clearRepositoryPrompt');
    },
    hasConversationTitleEdit: true,
    stopConversationTitleEdit: () => {
      calls.push('stopConversationTitleEdit');
    },
    clearConversationTitleEditClickState: () => {
      calls.push('clearConversationTitleEditClickState');
    },
    createNewThreadPromptState: (directoryId) => ({ directoryId }),
    setNewThreadPrompt: (prompt) => {
      prompts.push(prompt);
      calls.push('setNewThreadPrompt');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(prompts, [{ directoryId: 'dir-a' }]);
  assert.deepEqual(calls, [
    'clearAddDirectoryPrompt',
    'clearRepositoryPrompt',
    'stopConversationTitleEdit',
    'clearConversationTitleEditClickState',
    'setNewThreadPrompt',
    'markDirty',
  ]);

  calls.length = 0;
  openNewThreadPrompt({
    directoryId: 'dir-a',
    directoriesHas: () => true,
    clearAddDirectoryPrompt: () => {
      calls.push('clearAddDirectoryPrompt');
    },
    clearRepositoryPrompt: () => {
      calls.push('clearRepositoryPrompt');
    },
    hasConversationTitleEdit: false,
    stopConversationTitleEdit: () => {
      calls.push('stopConversationTitleEdit');
    },
    clearConversationTitleEditClickState: () => {
      calls.push('clearConversationTitleEditClickState');
    },
    createNewThreadPromptState: (directoryId) => ({ directoryId }),
    setNewThreadPrompt: () => {
      calls.push('setNewThreadPrompt');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.equal(calls.includes('stopConversationTitleEdit'), false);
});

void test('createAndActivateConversationInDirectory seeds and starts a conversation', async () => {
  const created: Array<{ sessionId: string; directoryId: string; agentType: string }> = [];
  const ensured: Array<{ sessionId: string; agentType: string }> = [];
  const started: string[] = [];
  const activated: string[] = [];

  await createAndActivateConversationInDirectory({
    directoryId: 'directory-1',
    agentType: 'critique',
    createConversationId: () => 'conversation-1',
    createConversationRecord: async (sessionId, directoryId, agentType) => {
      created.push({ sessionId, directoryId, agentType: String(agentType) });
    },
    ensureConversation: (sessionId, seed) => {
      ensured.push({ sessionId, agentType: seed.agentType });
      assert.equal(seed.directoryId, 'directory-1');
      assert.deepEqual(seed.adapterState, {});
    },
    noteGitActivity: (_directoryId) => {
      // covered by no-throw path
    },
    startConversation: async (sessionId) => {
      started.push(sessionId);
    },
    activateConversation: async (sessionId) => {
      activated.push(sessionId);
    },
  });

  assert.deepEqual(created, [
    { sessionId: 'conversation-1', directoryId: 'directory-1', agentType: 'critique' },
  ]);
  assert.deepEqual(ensured, [{ sessionId: 'conversation-1', agentType: 'critique' }]);
  assert.deepEqual(started, ['conversation-1']);
  assert.deepEqual(activated, ['conversation-1']);
});

void test('openOrCreateCritiqueConversationInDirectory activates existing critique session or creates one', async () => {
  const activated: string[] = [];
  const created: string[] = [];

  await openOrCreateCritiqueConversationInDirectory({
    directoryId: 'directory-1',
    orderedConversationIds: () => ['missing', 'session-a', 'session-b'],
    conversationById: (sessionId) => {
      if (sessionId === 'missing') {
        return null;
      }
      if (sessionId === 'session-a') {
        return {
          directoryId: 'directory-1',
          agentType: 'codex',
        };
      }
      if (sessionId === 'session-b') {
        return {
          directoryId: 'directory-1',
          agentType: 'Critique',
        };
      }
      return null;
    },
    activateConversation: async (sessionId) => {
      activated.push(sessionId);
    },
    createAndActivateCritiqueConversationInDirectory: async (directoryId) => {
      created.push(directoryId);
    },
  });

  assert.deepEqual(activated, ['session-b']);
  assert.equal(created.length, 0);

  await openOrCreateCritiqueConversationInDirectory({
    directoryId: 'directory-2',
    orderedConversationIds: () => ['session-c'],
    conversationById: () => ({
      directoryId: 'directory-2',
      agentType: 'terminal',
    }),
    activateConversation: async (sessionId) => {
      activated.push(sessionId);
    },
    createAndActivateCritiqueConversationInDirectory: async (directoryId) => {
      created.push(directoryId);
    },
  });

  assert.deepEqual(created, ['directory-2']);
});

void test('archiveConversation returns early when session id is absent', async () => {
  await archiveConversation({
    sessionId: 'missing',
    conversations: new Map(),
    closePtySession: async () => {
      throw new Error('unreachable');
    },
    removeSession: async () => {
      throw new Error('unreachable');
    },
    isSessionNotFoundError: () => false,
    archiveConversationRecord: async () => {
      throw new Error('unreachable');
    },
    isConversationNotFoundError: () => false,
    unsubscribeConversationEvents: async () => {
      throw new Error('unreachable');
    },
    removeConversationState: () => {
      throw new Error('unreachable');
    },
    activeConversationId: null,
    setActiveConversationId: () => {
      throw new Error('unreachable');
    },
    orderedConversationIds: () => [],
    conversationDirectoryId: () => null,
    resolveActiveDirectoryId: () => null,
    enterProjectPane: () => {
      throw new Error('unreachable');
    },
    activateConversation: async () => {
      throw new Error('unreachable');
    },
    markDirty: () => {
      throw new Error('unreachable');
    },
  });
});

void test('archiveConversation handles close/remove/archive best-effort and marks dirty for non-active session', async () => {
  const calls: string[] = [];
  await archiveConversation({
    sessionId: 'session-a',
    conversations: new Map([
      [
        'session-a',
        {
          directoryId: 'dir-a',
          live: true,
        },
      ],
    ]),
    closePtySession: async () => {
      calls.push('closePtySession');
      throw new Error('close failed');
    },
    removeSession: async () => {
      calls.push('removeSession');
      throw new Error('missing-session');
    },
    isSessionNotFoundError: (error) => String(error).includes('missing-session'),
    archiveConversationRecord: async () => {
      calls.push('archiveConversationRecord');
      throw new Error('missing-conversation');
    },
    isConversationNotFoundError: (error) => String(error).includes('missing-conversation'),
    unsubscribeConversationEvents: async () => {
      calls.push('unsubscribeConversationEvents');
    },
    removeConversationState: () => {
      calls.push('removeConversationState');
    },
    activeConversationId: 'different-session',
    setActiveConversationId: () => {
      calls.push('setActiveConversationId');
    },
    orderedConversationIds: () => ['session-b'],
    conversationDirectoryId: () => 'dir-b',
    resolveActiveDirectoryId: () => 'dir-fallback',
    enterProjectPane: () => {
      calls.push('enterProjectPane');
    },
    activateConversation: async () => {
      calls.push('activateConversation');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, [
    'closePtySession',
    'removeSession',
    'archiveConversationRecord',
    'unsubscribeConversationEvents',
    'removeConversationState',
    'markDirty',
  ]);
});

void test('archiveConversation rethrows unexpected control-plane failures', async () => {
  await assert.rejects(
    archiveConversation({
      sessionId: 'session-a',
      conversations: new Map([
        [
          'session-a',
          {
            directoryId: 'dir-a',
            live: false,
          },
        ],
      ]),
      closePtySession: async () => {
        throw new Error('unreachable');
      },
      removeSession: async () => {
        throw new Error('remove boom');
      },
      isSessionNotFoundError: () => false,
      archiveConversationRecord: async () => {
        throw new Error('unreachable');
      },
      isConversationNotFoundError: () => false,
      unsubscribeConversationEvents: async () => {
        throw new Error('unreachable');
      },
      removeConversationState: () => {},
      activeConversationId: null,
      setActiveConversationId: () => {},
      orderedConversationIds: () => [],
      conversationDirectoryId: () => null,
      resolveActiveDirectoryId: () => null,
      enterProjectPane: () => {},
      activateConversation: async () => {},
      markDirty: () => {},
    }),
    /remove boom/u,
  );

  await assert.rejects(
    archiveConversation({
      sessionId: 'session-a',
      conversations: new Map([
        [
          'session-a',
          {
            directoryId: 'dir-a',
            live: false,
          },
        ],
      ]),
      closePtySession: async () => {},
      removeSession: async () => {},
      isSessionNotFoundError: () => false,
      archiveConversationRecord: async () => {
        throw new Error('archive boom');
      },
      isConversationNotFoundError: () => false,
      unsubscribeConversationEvents: async () => {},
      removeConversationState: () => {},
      activeConversationId: null,
      setActiveConversationId: () => {},
      orderedConversationIds: () => [],
      conversationDirectoryId: () => null,
      resolveActiveDirectoryId: () => null,
      enterProjectPane: () => {},
      activateConversation: async () => {},
      markDirty: () => {},
    }),
    /archive boom/u,
  );
});

void test('archiveConversation retargets active selection to next conversation in same directory', async () => {
  const activated: string[] = [];
  const calls: string[] = [];
  await archiveConversation({
    sessionId: 'session-a',
    conversations: new Map([
      [
        'session-a',
        {
          directoryId: 'dir-a',
          live: false,
        },
      ],
    ]),
    closePtySession: async () => {},
    removeSession: async () => {},
    isSessionNotFoundError: () => false,
    archiveConversationRecord: async () => {},
    isConversationNotFoundError: () => false,
    unsubscribeConversationEvents: async () => {},
    removeConversationState: () => {},
    activeConversationId: 'session-a',
    setActiveConversationId: (sessionId) => {
      calls.push(`setActiveConversationId:${String(sessionId)}`);
    },
    orderedConversationIds: () => ['session-b', 'session-c'],
    conversationDirectoryId: (sessionId) => (sessionId === 'session-b' ? 'dir-a' : 'dir-c'),
    resolveActiveDirectoryId: () => 'dir-fallback',
    enterProjectPane: (directoryId) => {
      calls.push(`enterProjectPane:${directoryId}`);
    },
    activateConversation: async (sessionId) => {
      activated.push(sessionId);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, ['setActiveConversationId:null']);
  assert.deepEqual(activated, ['session-b']);
});

void test('archiveConversation falls back to project pane or dirty mark when no replacement conversation exists', async () => {
  const calls: string[] = [];
  await archiveConversation({
    sessionId: 'session-a',
    conversations: new Map([
      [
        'session-a',
        {
          directoryId: 'dir-a',
          live: false,
        },
      ],
    ]),
    closePtySession: async () => {},
    removeSession: async () => {},
    isSessionNotFoundError: () => false,
    archiveConversationRecord: async () => {},
    isConversationNotFoundError: () => false,
    unsubscribeConversationEvents: async () => {},
    removeConversationState: () => {},
    activeConversationId: 'session-a',
    setActiveConversationId: () => {
      calls.push('setActiveConversationId');
    },
    orderedConversationIds: () => [],
    conversationDirectoryId: () => null,
    resolveActiveDirectoryId: () => 'dir-fallback',
    enterProjectPane: (directoryId) => {
      calls.push(`enterProjectPane:${directoryId}`);
    },
    activateConversation: async () => {
      calls.push('activateConversation');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, [
    'setActiveConversationId',
    'enterProjectPane:dir-a',
    'markDirty',
  ]);

  calls.length = 0;
  await archiveConversation({
    sessionId: 'session-a',
    conversations: new Map([
      [
        'session-a',
        {
          directoryId: null,
          live: false,
        },
      ],
    ]),
    closePtySession: async () => {},
    removeSession: async () => {},
    isSessionNotFoundError: () => false,
    archiveConversationRecord: async () => {},
    isConversationNotFoundError: () => false,
    unsubscribeConversationEvents: async () => {},
    removeConversationState: () => {},
    activeConversationId: 'session-a',
    setActiveConversationId: () => {
      calls.push('setActiveConversationId');
    },
    orderedConversationIds: () => [],
    conversationDirectoryId: () => null,
    resolveActiveDirectoryId: () => null,
    enterProjectPane: () => {
      calls.push('enterProjectPane');
    },
    activateConversation: async () => {
      calls.push('activateConversation');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, ['setActiveConversationId', 'markDirty']);
});

void test('takeoverConversation covers missing session, claimed controller, and null controller flows', async () => {
  const calls: string[] = [];
  await takeoverConversation({
    sessionId: 'missing',
    conversationsHas: () => false,
    claimSession: async () => {
      calls.push('claimSession');
      return null;
    },
    applyController: () => {
      calls.push('applyController');
    },
    setLastEventNow: () => {
      calls.push('setLastEventNow');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.equal(calls.length, 0);

  await takeoverConversation({
    sessionId: 'session-a',
    conversationsHas: () => true,
    claimSession: async () => ({ owner: 'human' }),
    applyController: () => {
      calls.push('applyController');
    },
    setLastEventNow: () => {
      calls.push('setLastEventNow');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, ['applyController', 'setLastEventNow', 'markDirty']);

  calls.length = 0;
  await takeoverConversation({
    sessionId: 'session-a',
    conversationsHas: () => true,
    claimSession: async () => null,
    applyController: () => {
      calls.push('applyController');
    },
    setLastEventNow: () => {
      calls.push('setLastEventNow');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, ['setLastEventNow', 'markDirty']);
});

void test('addDirectoryByPath throws on malformed upsert and activates conversation when available', async () => {
  await assert.rejects(
    addDirectoryByPath({
      rawPath: '~/repo',
      resolveWorkspacePathForMux: (rawPath) => rawPath,
      upsertDirectory: async () => null,
      setDirectory: () => {},
      directoryIdOf: () => 'unused',
      setActiveDirectoryId: () => {},
      syncGitStateWithDirectories: () => {},
      noteGitActivity: () => {},
      hydratePersistedConversationsForDirectory: async () => {},
      findConversationIdByDirectory: () => null,
      activateConversation: async () => {},
      enterProjectPane: () => {},
      markDirty: () => {},
    }),
    /malformed directory record/u,
  );

  const calls: string[] = [];
  await addDirectoryByPath({
    rawPath: '~/repo',
    resolveWorkspacePathForMux: () => '/workspace/repo',
    upsertDirectory: async () => ({ directoryId: 'dir-a' }),
    setDirectory: () => {
      calls.push('setDirectory');
    },
    directoryIdOf: (directory) => directory.directoryId,
    setActiveDirectoryId: (directoryId) => {
      calls.push(`setActiveDirectoryId:${directoryId}`);
    },
    syncGitStateWithDirectories: () => {
      calls.push('syncGitStateWithDirectories');
    },
    noteGitActivity: (directoryId) => {
      calls.push(`noteGitActivity:${directoryId}`);
    },
    hydratePersistedConversationsForDirectory: async (directoryId) => {
      calls.push(`hydrate:${directoryId}`);
    },
    findConversationIdByDirectory: () => 'session-a',
    activateConversation: async (sessionId) => {
      calls.push(`activateConversation:${sessionId}`);
    },
    enterProjectPane: () => {
      calls.push('enterProjectPane');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, [
    'setDirectory',
    'setActiveDirectoryId:dir-a',
    'syncGitStateWithDirectories',
    'noteGitActivity:dir-a',
    'hydrate:dir-a',
    'activateConversation:session-a',
  ]);
});

void test('addDirectoryByPath enters project pane when no directory conversation exists', async () => {
  const calls: string[] = [];
  await addDirectoryByPath({
    rawPath: './repo',
    resolveWorkspacePathForMux: () => '/workspace/repo',
    upsertDirectory: async () => ({ directoryId: 'dir-a' }),
    setDirectory: () => {},
    directoryIdOf: (directory) => directory.directoryId,
    setActiveDirectoryId: () => {},
    syncGitStateWithDirectories: () => {},
    noteGitActivity: () => {},
    hydratePersistedConversationsForDirectory: async () => {},
    findConversationIdByDirectory: () => null,
    activateConversation: async () => {
      calls.push('activateConversation');
    },
    enterProjectPane: (directoryId) => {
      calls.push(`enterProjectPane:${directoryId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, ['enterProjectPane:dir-a', 'markDirty']);
});

void test('closeDirectory returns early when directory is absent', async () => {
  await closeDirectory({
    directoryId: 'missing',
    directoriesHas: () => false,
    orderedConversationIds: () => [],
    conversationDirectoryId: () => null,
    conversationLive: () => false,
    closePtySession: async () => {},
    archiveConversationRecord: async () => {},
    unsubscribeConversationEvents: async () => {},
    removeConversationState: () => {},
    activeConversationId: null,
    setActiveConversationId: () => {},
    archiveDirectory: async () => {},
    deleteDirectory: () => {},
    deleteDirectoryGitState: () => {},
    projectPaneSnapshotDirectoryId: null,
    clearProjectPaneSnapshot: () => {},
    directoriesSize: () => 0,
    addDirectoryByPath: async () => {},
    invocationDirectory: '/workspace',
    activeDirectoryId: null,
    setActiveDirectoryId: () => {},
    firstDirectoryId: () => null,
    noteGitActivity: () => {},
    resolveActiveDirectoryId: () => null,
    activateConversation: async () => {},
    enterProjectPane: () => {},
    markDirty: () => {},
  });
});

void test('closeDirectory archives directory sessions and re-seeds invocation directory when none remain', async () => {
  const calls: string[] = [];
  await closeDirectory({
    directoryId: 'dir-a',
    directoriesHas: (directoryId) => directoryId === 'dir-a',
    orderedConversationIds: () => ['session-a', 'session-other'],
    conversationDirectoryId: (sessionId) => (sessionId === 'session-a' ? 'dir-a' : 'dir-b'),
    conversationLive: () => true,
    closePtySession: async () => {
      calls.push('closePtySession');
      throw new Error('close failure');
    },
    archiveConversationRecord: async () => {
      calls.push('archiveConversationRecord');
    },
    unsubscribeConversationEvents: async () => {
      calls.push('unsubscribeConversationEvents');
    },
    removeConversationState: () => {
      calls.push('removeConversationState');
    },
    activeConversationId: 'session-a',
    setActiveConversationId: (sessionId) => {
      calls.push(`setActiveConversationId:${String(sessionId)}`);
    },
    archiveDirectory: async (directoryId) => {
      calls.push(`archiveDirectory:${directoryId}`);
    },
    deleteDirectory: (directoryId) => {
      calls.push(`deleteDirectory:${directoryId}`);
    },
    deleteDirectoryGitState: (directoryId) => {
      calls.push(`deleteDirectoryGitState:${directoryId}`);
    },
    projectPaneSnapshotDirectoryId: 'dir-a',
    clearProjectPaneSnapshot: () => {
      calls.push('clearProjectPaneSnapshot');
    },
    directoriesSize: () => 0,
    addDirectoryByPath: async (path) => {
      calls.push(`addDirectoryByPath:${path}`);
    },
    invocationDirectory: '/workspace',
    activeDirectoryId: 'dir-a',
    setActiveDirectoryId: () => {
      calls.push('setActiveDirectoryId');
    },
    firstDirectoryId: () => 'dir-b',
    noteGitActivity: () => {
      calls.push('noteGitActivity');
    },
    resolveActiveDirectoryId: () => 'dir-b',
    activateConversation: async () => {
      calls.push('activateConversation');
    },
    enterProjectPane: () => {
      calls.push('enterProjectPane');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, [
    'closePtySession',
    'archiveConversationRecord',
    'unsubscribeConversationEvents',
    'removeConversationState',
    'setActiveConversationId:null',
    'archiveDirectory:dir-a',
    'deleteDirectory:dir-a',
    'deleteDirectoryGitState:dir-a',
    'clearProjectPaneSnapshot',
    'addDirectoryByPath:/workspace',
  ]);
});

void test('closeDirectory activates fallback conversation when one exists', async () => {
  const calls: string[] = [];
  await closeDirectory({
    directoryId: 'dir-a',
    directoriesHas: () => true,
    orderedConversationIds: () => ['session-b'],
    conversationDirectoryId: () => 'dir-b',
    conversationLive: () => false,
    closePtySession: async () => {},
    archiveConversationRecord: async () => {},
    unsubscribeConversationEvents: async () => {},
    removeConversationState: () => {},
    activeConversationId: null,
    setActiveConversationId: (directoryId) => {
      calls.push(`setActiveConversationId:${String(directoryId)}`);
    },
    archiveDirectory: async () => {},
    deleteDirectory: () => {},
    deleteDirectoryGitState: () => {},
    projectPaneSnapshotDirectoryId: null,
    clearProjectPaneSnapshot: () => {},
    directoriesSize: () => 2,
    addDirectoryByPath: async () => {},
    invocationDirectory: '/workspace',
    activeDirectoryId: null,
    setActiveDirectoryId: (directoryId) => {
      calls.push(`setActiveDirectoryId:${String(directoryId)}`);
    },
    firstDirectoryId: () => 'dir-b',
    noteGitActivity: (directoryId) => {
      calls.push(`noteGitActivity:${directoryId}`);
    },
    resolveActiveDirectoryId: () => 'dir-b',
    activateConversation: async (sessionId) => {
      calls.push(`activateConversation:${sessionId}`);
    },
    enterProjectPane: (directoryId) => {
      calls.push(`enterProjectPane:${directoryId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, ['setActiveDirectoryId:dir-b', 'activateConversation:session-b']);
});

void test('closeDirectory falls back to project pane or dirty mark when no fallback conversation exists', async () => {
  const calls: string[] = [];
  await closeDirectory({
    directoryId: 'dir-a',
    directoriesHas: (directoryId) => directoryId === 'dir-a' || directoryId === 'dir-b',
    orderedConversationIds: () => [],
    conversationDirectoryId: () => null,
    conversationLive: () => false,
    closePtySession: async () => {},
    archiveConversationRecord: async () => {},
    unsubscribeConversationEvents: async () => {},
    removeConversationState: () => {},
    activeConversationId: null,
    setActiveConversationId: () => {},
    archiveDirectory: async () => {},
    deleteDirectory: () => {},
    deleteDirectoryGitState: () => {},
    projectPaneSnapshotDirectoryId: null,
    clearProjectPaneSnapshot: () => {},
    directoriesSize: () => 1,
    addDirectoryByPath: async () => {},
    invocationDirectory: '/workspace',
    activeDirectoryId: 'stale-dir',
    setActiveDirectoryId: (directoryId) => {
      calls.push(`setActiveDirectoryId:${String(directoryId)}`);
    },
    firstDirectoryId: () => 'dir-b',
    noteGitActivity: (directoryId) => {
      calls.push(`noteGitActivity:${directoryId}`);
    },
    resolveActiveDirectoryId: () => 'dir-b',
    activateConversation: async () => {
      calls.push('activateConversation');
    },
    enterProjectPane: (directoryId) => {
      calls.push(`enterProjectPane:${directoryId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, [
    'setActiveDirectoryId:dir-b',
    'noteGitActivity:stale-dir',
    'enterProjectPane:dir-b',
    'markDirty',
  ]);

  calls.length = 0;
  await closeDirectory({
    directoryId: 'dir-a',
    directoriesHas: () => true,
    orderedConversationIds: () => [],
    conversationDirectoryId: () => null,
    conversationLive: () => false,
    closePtySession: async () => {},
    archiveConversationRecord: async () => {},
    unsubscribeConversationEvents: async () => {},
    removeConversationState: () => {},
    activeConversationId: null,
    setActiveConversationId: () => {},
    archiveDirectory: async () => {},
    deleteDirectory: () => {},
    deleteDirectoryGitState: () => {},
    projectPaneSnapshotDirectoryId: null,
    clearProjectPaneSnapshot: () => {},
    directoriesSize: () => 1,
    addDirectoryByPath: async () => {},
    invocationDirectory: '/workspace',
    activeDirectoryId: 'dir-b',
    setActiveDirectoryId: () => {},
    firstDirectoryId: () => 'dir-b',
    noteGitActivity: () => {},
    resolveActiveDirectoryId: () => null,
    activateConversation: async () => {
      calls.push('activateConversation');
    },
    enterProjectPane: () => {
      calls.push('enterProjectPane');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  assert.deepEqual(calls, ['markDirty']);
});
