import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeDirectoryActions } from '../../../../src/services/runtime-directory-actions.ts';

interface DirectoryRecord {
  readonly directoryId: string;
  readonly path: string;
}

interface ConversationStateLike {
  readonly directoryId: string | null;
  readonly live: boolean;
}

void test('runtime directory actions archive conversation routes lifecycle + project fallback', async () => {
  const calls: string[] = [];
  const conversations = new Map<string, ConversationStateLike>([
    ['session-1', { directoryId: 'directory-1', live: true }],
  ]);
  let activeConversationId: string | null = 'session-1';

  const actions = new RuntimeDirectoryActions<DirectoryRecord, ConversationStateLike>({
    controlPlaneService: {
      closePtySession: async (sessionId) => {
        calls.push(`closePty:${sessionId}`);
      },
      removeSession: async (sessionId) => {
        calls.push(`removeSession:${sessionId}`);
      },
      archiveConversation: async (sessionId) => {
        calls.push(`archiveConversation:${sessionId}`);
      },
      upsertDirectory: async () => null,
      archiveDirectory: async () => {},
    },
    conversations: () => conversations,
    orderedConversationIds: () => [...conversations.keys()],
    conversationDirectoryId: (sessionId) => conversations.get(sessionId)?.directoryId ?? null,
    conversationLive: (sessionId) => conversations.get(sessionId)?.live === true,
    removeConversationState: (sessionId) => {
      calls.push(`removeState:${sessionId}`);
      conversations.delete(sessionId);
    },
    unsubscribeConversationEvents: async (sessionId) => {
      calls.push(`unsubscribe:${sessionId}`);
    },
    activeConversationId: () => activeConversationId,
    setActiveConversationId: (sessionId) => {
      activeConversationId = sessionId;
      calls.push(`setActive:${sessionId ?? 'null'}`);
    },
    activateConversation: async (sessionId) => {
      calls.push(`activate:${sessionId}`);
    },
    resolveActiveDirectoryId: () => 'directory-1',
    enterProjectPane: (directoryId) => {
      calls.push(`enterProject:${directoryId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    isSessionNotFoundError: () => false,
    isConversationNotFoundError: () => false,
    createDirectoryId: () => 'directory-unused',
    resolveWorkspacePathForMux: (rawPath) => rawPath,
    setDirectory: () => {},
    directoryIdOf: (directory) => directory.directoryId,
    setActiveDirectoryId: () => {},
    syncGitStateWithDirectories: () => {},
    noteGitActivity: () => {},
    hydratePersistedConversationsForDirectory: async () => {},
    findConversationIdByDirectory: () => null,
    directoriesHas: () => false,
    deleteDirectory: () => {},
    deleteDirectoryGitState: () => {},
    projectPaneSnapshotDirectoryId: () => null,
    clearProjectPaneSnapshot: () => {},
    directoriesSize: () => 0,
    invocationDirectory: '/unused',
    activeDirectoryId: () => null,
    firstDirectoryId: () => null,
  });

  await actions.archiveConversation('session-1');

  assert.equal(activeConversationId, null);
  assert.deepEqual(calls, [
    'closePty:session-1',
    'removeSession:session-1',
    'archiveConversation:session-1',
    'unsubscribe:session-1',
    'removeState:session-1',
    'setActive:null',
    'enterProject:directory-1',
    'markDirty',
  ]);
});

void test('runtime directory actions add directory hydrates and activates existing conversation', async () => {
  const calls: string[] = [];
  let activeDirectoryId: string | null = null;

  const actions = new RuntimeDirectoryActions<DirectoryRecord, ConversationStateLike>({
    controlPlaneService: {
      closePtySession: async () => {},
      removeSession: async () => {},
      archiveConversation: async () => {},
      upsertDirectory: async ({ path }) => {
        calls.push(`upsert:${path}`);
        return {
          directoryId: 'directory-new',
          path,
        };
      },
      archiveDirectory: async () => {},
    },
    conversations: () => new Map(),
    orderedConversationIds: () => [],
    conversationDirectoryId: () => null,
    conversationLive: () => false,
    removeConversationState: () => {},
    unsubscribeConversationEvents: async () => {},
    activeConversationId: () => null,
    setActiveConversationId: () => {},
    activateConversation: async (sessionId) => {
      calls.push(`activate:${sessionId}`);
    },
    resolveActiveDirectoryId: () => null,
    enterProjectPane: (directoryId) => {
      calls.push(`enterProject:${directoryId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    isSessionNotFoundError: () => false,
    isConversationNotFoundError: () => false,
    createDirectoryId: () => 'directory-generated',
    resolveWorkspacePathForMux: (rawPath) => `resolved:${rawPath}`,
    setDirectory: (directory) => {
      calls.push(`setDirectory:${directory.directoryId}`);
    },
    directoryIdOf: (directory) => directory.directoryId,
    setActiveDirectoryId: (directoryId) => {
      activeDirectoryId = directoryId;
      calls.push(`setActiveDirectory:${directoryId ?? 'null'}`);
    },
    syncGitStateWithDirectories: () => {
      calls.push('syncGit');
    },
    noteGitActivity: (directoryId) => {
      calls.push(`noteGit:${directoryId}`);
    },
    hydratePersistedConversationsForDirectory: async (directoryId) => {
      calls.push(`hydrate:${directoryId}`);
    },
    findConversationIdByDirectory: (directoryId) =>
      directoryId === 'directory-new' ? 'session-existing' : null,
    directoriesHas: () => true,
    deleteDirectory: () => {},
    deleteDirectoryGitState: () => {},
    projectPaneSnapshotDirectoryId: () => null,
    clearProjectPaneSnapshot: () => {},
    directoriesSize: () => 1,
    invocationDirectory: '/unused',
    activeDirectoryId: () => activeDirectoryId,
    firstDirectoryId: () => 'directory-new',
  });

  await actions.addDirectoryByPath('./repo');

  assert.equal(activeDirectoryId, 'directory-new');
  assert.deepEqual(calls, [
    'upsert:resolved:./repo',
    'setDirectory:directory-new',
    'setActiveDirectory:directory-new',
    'syncGit',
    'noteGit:directory-new',
    'hydrate:directory-new',
    'activate:session-existing',
  ]);
});

void test('runtime directory actions close directory seeds invocation directory when none remain', async () => {
  const calls: string[] = [];
  const directories = new Map<string, DirectoryRecord>([
    ['directory-1', { directoryId: 'directory-1', path: '/repo/one' }],
  ]);
  let activeDirectoryId: string | null = 'directory-1';

  const actions = new RuntimeDirectoryActions<DirectoryRecord, ConversationStateLike>({
    controlPlaneService: {
      closePtySession: async () => {},
      removeSession: async () => {},
      archiveConversation: async () => {},
      upsertDirectory: async ({ path }) => {
        calls.push(`upsert:${path}`);
        return {
          directoryId: 'directory-2',
          path,
        };
      },
      archiveDirectory: async (directoryId) => {
        calls.push(`archiveDirectory:${directoryId}`);
      },
    },
    conversations: () => new Map(),
    orderedConversationIds: () => [],
    conversationDirectoryId: () => null,
    conversationLive: () => false,
    removeConversationState: () => {},
    unsubscribeConversationEvents: async () => {},
    activeConversationId: () => null,
    setActiveConversationId: () => {},
    activateConversation: async () => {},
    resolveActiveDirectoryId: () => activeDirectoryId,
    enterProjectPane: (directoryId) => {
      calls.push(`enterProject:${directoryId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    isSessionNotFoundError: () => false,
    isConversationNotFoundError: () => false,
    createDirectoryId: () => 'directory-generated',
    resolveWorkspacePathForMux: (rawPath) => `resolved:${rawPath}`,
    setDirectory: (directory) => {
      directories.set(directory.directoryId, directory);
      calls.push(`setDirectory:${directory.directoryId}`);
    },
    directoryIdOf: (directory) => directory.directoryId,
    setActiveDirectoryId: (directoryId) => {
      activeDirectoryId = directoryId;
      calls.push(`setActiveDirectory:${directoryId ?? 'null'}`);
    },
    syncGitStateWithDirectories: () => {
      calls.push('syncGit');
    },
    noteGitActivity: (directoryId) => {
      calls.push(`noteGit:${directoryId}`);
    },
    hydratePersistedConversationsForDirectory: async (directoryId) => {
      calls.push(`hydrate:${directoryId}`);
    },
    findConversationIdByDirectory: () => null,
    directoriesHas: (directoryId) => directories.has(directoryId),
    deleteDirectory: (directoryId) => {
      directories.delete(directoryId);
      calls.push(`deleteDirectory:${directoryId}`);
    },
    deleteDirectoryGitState: (directoryId) => {
      calls.push(`deleteGitState:${directoryId}`);
    },
    projectPaneSnapshotDirectoryId: () => 'directory-1',
    clearProjectPaneSnapshot: () => {
      calls.push('clearProjectPaneSnapshot');
    },
    directoriesSize: () => directories.size,
    invocationDirectory: '/invocation',
    activeDirectoryId: () => activeDirectoryId,
    firstDirectoryId: () => [...directories.keys()][0] ?? null,
  });

  await actions.closeDirectory('directory-1');

  assert.equal(activeDirectoryId, 'directory-2');
  assert.deepEqual(calls, [
    'archiveDirectory:directory-1',
    'deleteDirectory:directory-1',
    'deleteGitState:directory-1',
    'clearProjectPaneSnapshot',
    'upsert:resolved:/invocation',
    'setDirectory:directory-2',
    'setActiveDirectory:directory-2',
    'syncGit',
    'noteGit:directory-2',
    'hydrate:directory-2',
    'enterProject:directory-2',
    'markDirty',
  ]);
});

void test('runtime directory actions close directory archives live conversations before fallback', async () => {
  const calls: string[] = [];
  const directories = new Map<string, DirectoryRecord>([
    ['directory-1', { directoryId: 'directory-1', path: '/repo/one' }],
    ['directory-2', { directoryId: 'directory-2', path: '/repo/two' }],
  ]);
  const conversations = new Map<string, ConversationStateLike>([
    ['session-1', { directoryId: 'directory-1', live: true }],
  ]);
  let activeDirectoryId: string | null = 'directory-1';
  let activeConversationId: string | null = 'session-1';

  const actions = new RuntimeDirectoryActions<DirectoryRecord, ConversationStateLike>({
    controlPlaneService: {
      closePtySession: async (sessionId) => {
        calls.push(`closePty:${sessionId}`);
      },
      removeSession: async () => {},
      archiveConversation: async (sessionId) => {
        calls.push(`archiveConversation:${sessionId}`);
      },
      upsertDirectory: async () => null,
      archiveDirectory: async (directoryId) => {
        calls.push(`archiveDirectory:${directoryId}`);
      },
    },
    conversations: () => conversations,
    orderedConversationIds: () => [...conversations.keys()],
    conversationDirectoryId: (sessionId) => conversations.get(sessionId)?.directoryId ?? null,
    conversationLive: (sessionId) => conversations.get(sessionId)?.live === true,
    removeConversationState: (sessionId) => {
      conversations.delete(sessionId);
      calls.push(`removeState:${sessionId}`);
    },
    unsubscribeConversationEvents: async (sessionId) => {
      calls.push(`unsubscribe:${sessionId}`);
    },
    activeConversationId: () => activeConversationId,
    setActiveConversationId: (sessionId) => {
      activeConversationId = sessionId;
      calls.push(`setActiveConversation:${sessionId ?? 'null'}`);
    },
    activateConversation: async () => {},
    resolveActiveDirectoryId: () => activeDirectoryId,
    enterProjectPane: (directoryId) => {
      calls.push(`enterProject:${directoryId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    isSessionNotFoundError: () => false,
    isConversationNotFoundError: () => false,
    createDirectoryId: () => 'directory-unused',
    resolveWorkspacePathForMux: (rawPath) => rawPath,
    setDirectory: () => {},
    directoryIdOf: (directory) => directory.directoryId,
    setActiveDirectoryId: (directoryId) => {
      activeDirectoryId = directoryId;
      calls.push(`setActiveDirectory:${directoryId ?? 'null'}`);
    },
    syncGitStateWithDirectories: () => {},
    noteGitActivity: (directoryId) => {
      calls.push(`noteGit:${directoryId}`);
    },
    hydratePersistedConversationsForDirectory: async () => {},
    findConversationIdByDirectory: () => null,
    directoriesHas: (directoryId) => directories.has(directoryId),
    deleteDirectory: (directoryId) => {
      directories.delete(directoryId);
      calls.push(`deleteDirectory:${directoryId}`);
    },
    deleteDirectoryGitState: (directoryId) => {
      calls.push(`deleteGitState:${directoryId}`);
    },
    projectPaneSnapshotDirectoryId: () => null,
    clearProjectPaneSnapshot: () => {},
    directoriesSize: () => directories.size,
    invocationDirectory: '/unused',
    activeDirectoryId: () => activeDirectoryId,
    firstDirectoryId: () => [...directories.keys()][0] ?? null,
  });

  await actions.closeDirectory('directory-1');

  assert.equal(activeConversationId, null);
  assert.equal(activeDirectoryId, 'directory-2');
  assert.deepEqual(calls, [
    'closePty:session-1',
    'archiveConversation:session-1',
    'unsubscribe:session-1',
    'removeState:session-1',
    'setActiveConversation:null',
    'archiveDirectory:directory-1',
    'deleteDirectory:directory-1',
    'deleteGitState:directory-1',
    'setActiveDirectory:directory-2',
    'noteGit:directory-1',
    'enterProject:directory-2',
    'markDirty',
  ]);
});
