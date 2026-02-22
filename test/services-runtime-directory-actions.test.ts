import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createRuntimeDirectoryActions } from '../src/services/runtime-directory-actions.ts';

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

  const actions = createRuntimeDirectoryActions<DirectoryRecord, ConversationStateLike>({
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
    conversations: {
      records: () => conversations,
      orderedIds: () => [...conversations.keys()],
      directoryIdOf: (sessionId) => conversations.get(sessionId)?.directoryId ?? null,
      isLive: (sessionId) => conversations.get(sessionId)?.live === true,
      removeState: (sessionId) => {
        calls.push(`removeState:${sessionId}`);
        conversations.delete(sessionId);
      },
      unsubscribeEvents: async (sessionId) => {
        calls.push(`unsubscribe:${sessionId}`);
      },
      activeId: () => activeConversationId,
      setActiveId: (sessionId) => {
        activeConversationId = sessionId;
        calls.push(`setActive:${sessionId ?? 'null'}`);
      },
      activate: async (sessionId) => {
        calls.push(`activate:${sessionId}`);
      },
      findIdByDirectory: () => null,
    },
    directories: {
      createId: () => 'directory-unused',
      resolveWorkspacePath: (rawPath) => rawPath,
      setRecord: () => {},
      idOf: (directory) => directory.directoryId,
      setActiveId: () => {},
      activeId: () => null,
      resolveActiveId: () => 'directory-1',
      has: () => false,
      remove: () => {},
      removeGitState: () => {},
      projectPaneSnapshotDirectoryId: () => null,
      clearProjectPaneSnapshot: () => {},
      size: () => 0,
      firstId: () => null,
      syncGitStateWithDirectories: () => {},
      noteGitActivity: () => {},
      hydratePersistedConversations: async () => {},
    },
    ui: {
      enterProjectPane: (directoryId) => {
        calls.push(`enterProject:${directoryId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    },
    errors: {
      isSessionNotFoundError: () => false,
      isConversationNotFoundError: () => false,
    },
    invocationDirectory: '/unused',
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

  const actions = createRuntimeDirectoryActions<DirectoryRecord, ConversationStateLike>({
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
    conversations: {
      records: () => new Map(),
      orderedIds: () => [],
      directoryIdOf: () => null,
      isLive: () => false,
      removeState: () => {},
      unsubscribeEvents: async () => {},
      activeId: () => null,
      setActiveId: () => {},
      activate: async (sessionId) => {
        calls.push(`activate:${sessionId}`);
      },
      findIdByDirectory: (directoryId) =>
        directoryId === 'directory-new' ? 'session-existing' : null,
    },
    directories: {
      createId: () => 'directory-generated',
      resolveWorkspacePath: (rawPath) => `resolved:${rawPath}`,
      setRecord: (directory) => {
        calls.push(`setDirectory:${directory.directoryId}`);
      },
      idOf: (directory) => directory.directoryId,
      setActiveId: (directoryId) => {
        activeDirectoryId = directoryId;
        calls.push(`setActiveDirectory:${directoryId ?? 'null'}`);
      },
      activeId: () => activeDirectoryId,
      resolveActiveId: () => null,
      has: () => true,
      remove: () => {},
      removeGitState: () => {},
      projectPaneSnapshotDirectoryId: () => null,
      clearProjectPaneSnapshot: () => {},
      size: () => 1,
      firstId: () => 'directory-new',
      syncGitStateWithDirectories: () => {
        calls.push('syncGit');
      },
      noteGitActivity: (directoryId) => {
        calls.push(`noteGit:${directoryId}`);
      },
      hydratePersistedConversations: async (directoryId) => {
        calls.push(`hydrate:${directoryId}`);
      },
    },
    ui: {
      enterProjectPane: (directoryId) => {
        calls.push(`enterProject:${directoryId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    },
    errors: {
      isSessionNotFoundError: () => false,
      isConversationNotFoundError: () => false,
    },
    invocationDirectory: '/unused',
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

  const actions = createRuntimeDirectoryActions<DirectoryRecord, ConversationStateLike>({
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
    conversations: {
      records: () => new Map(),
      orderedIds: () => [],
      directoryIdOf: () => null,
      isLive: () => false,
      removeState: () => {},
      unsubscribeEvents: async () => {},
      activeId: () => null,
      setActiveId: () => {},
      activate: async () => {},
      findIdByDirectory: () => null,
    },
    directories: {
      createId: () => 'directory-generated',
      resolveWorkspacePath: (rawPath) => `resolved:${rawPath}`,
      setRecord: (directory) => {
        directories.set(directory.directoryId, directory);
        calls.push(`setDirectory:${directory.directoryId}`);
      },
      idOf: (directory) => directory.directoryId,
      setActiveId: (directoryId) => {
        activeDirectoryId = directoryId;
        calls.push(`setActiveDirectory:${directoryId ?? 'null'}`);
      },
      activeId: () => activeDirectoryId,
      resolveActiveId: () => activeDirectoryId,
      has: (directoryId) => directories.has(directoryId),
      remove: (directoryId) => {
        directories.delete(directoryId);
        calls.push(`deleteDirectory:${directoryId}`);
      },
      removeGitState: (directoryId) => {
        calls.push(`deleteGitState:${directoryId}`);
      },
      projectPaneSnapshotDirectoryId: () => 'directory-1',
      clearProjectPaneSnapshot: () => {
        calls.push('clearProjectPaneSnapshot');
      },
      size: () => directories.size,
      firstId: () => [...directories.keys()][0] ?? null,
      syncGitStateWithDirectories: () => {
        calls.push('syncGit');
      },
      noteGitActivity: (directoryId) => {
        calls.push(`noteGit:${directoryId}`);
      },
      hydratePersistedConversations: async (directoryId) => {
        calls.push(`hydrate:${directoryId}`);
      },
    },
    ui: {
      enterProjectPane: (directoryId) => {
        calls.push(`enterProject:${directoryId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    },
    errors: {
      isSessionNotFoundError: () => false,
      isConversationNotFoundError: () => false,
    },
    invocationDirectory: '/invocation',
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

  const actions = createRuntimeDirectoryActions<DirectoryRecord, ConversationStateLike>({
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
    conversations: {
      records: () => conversations,
      orderedIds: () => [...conversations.keys()],
      directoryIdOf: (sessionId) => conversations.get(sessionId)?.directoryId ?? null,
      isLive: (sessionId) => conversations.get(sessionId)?.live === true,
      removeState: (sessionId) => {
        conversations.delete(sessionId);
        calls.push(`removeState:${sessionId}`);
      },
      unsubscribeEvents: async (sessionId) => {
        calls.push(`unsubscribe:${sessionId}`);
      },
      activeId: () => activeConversationId,
      setActiveId: (sessionId) => {
        activeConversationId = sessionId;
        calls.push(`setActiveConversation:${sessionId ?? 'null'}`);
      },
      activate: async () => {},
      findIdByDirectory: () => null,
    },
    directories: {
      createId: () => 'directory-unused',
      resolveWorkspacePath: (rawPath) => rawPath,
      setRecord: () => {},
      idOf: (directory) => directory.directoryId,
      setActiveId: (directoryId) => {
        activeDirectoryId = directoryId;
        calls.push(`setActiveDirectory:${directoryId ?? 'null'}`);
      },
      activeId: () => activeDirectoryId,
      resolveActiveId: () => activeDirectoryId,
      has: (directoryId) => directories.has(directoryId),
      remove: (directoryId) => {
        directories.delete(directoryId);
        calls.push(`deleteDirectory:${directoryId}`);
      },
      removeGitState: (directoryId) => {
        calls.push(`deleteGitState:${directoryId}`);
      },
      projectPaneSnapshotDirectoryId: () => null,
      clearProjectPaneSnapshot: () => {},
      size: () => directories.size,
      firstId: () => [...directories.keys()][0] ?? null,
      syncGitStateWithDirectories: () => {},
      noteGitActivity: (directoryId) => {
        calls.push(`noteGit:${directoryId}`);
      },
      hydratePersistedConversations: async () => {},
    },
    ui: {
      enterProjectPane: (directoryId) => {
        calls.push(`enterProject:${directoryId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    },
    errors: {
      isSessionNotFoundError: () => false,
      isConversationNotFoundError: () => false,
    },
    invocationDirectory: '/unused',
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
