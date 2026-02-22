import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceSyncedProjection } from '../src/services/workspace-observed-events.ts';

interface DirectoryRecord {
  readonly directoryId: string;
}

interface ConversationRecord {
  readonly conversationId: string;
  readonly directoryId: string;
}

void test('workspace synced projection applies directory and conversation upserts', () => {
  const calls: string[] = [];
  const directories = new Map<string, DirectoryRecord>();
  const conversations = new Map<string, ConversationRecord>();
  const service = new WorkspaceSyncedProjection<DirectoryRecord, ConversationRecord>({
    setDirectory: (directoryId, directory) => {
      directories.set(directoryId, directory);
      calls.push(`setDirectory:${directoryId}`);
    },
    deleteDirectory: (directoryId) => {
      const deleted = directories.delete(directoryId);
      calls.push(`deleteDirectory:${directoryId}:${String(deleted)}`);
      return deleted;
    },
    deleteDirectoryGitState: (directoryId) => {
      calls.push(`deleteGit:${directoryId}`);
    },
    syncGitStateWithDirectories: () => {
      calls.push('syncGit');
    },
    upsertConversationFromPersistedRecord: (record) => {
      conversations.set(record.conversationId, record);
      calls.push(`upsertConversation:${record.conversationId}:${record.directoryId}`);
    },
    removeConversation: (sessionId) => {
      const removed = conversations.delete(sessionId);
      calls.push(`removeConversation:${sessionId}:${String(removed)}`);
      return removed;
    },
  });

  const upserted = service.apply({
    changed: true,
    state: {
      directoriesById: {
        'directory-1': {
          directoryId: 'directory-1',
        },
      },
      conversationsById: {
        'conversation-1': {
          conversationId: 'conversation-1',
          directoryId: 'directory-2',
        },
      },
    },
    removedConversationIds: [],
    removedDirectoryIds: [],
    upsertedDirectoryIds: ['directory-1'],
    upsertedConversationIds: ['conversation-1'],
  });
  const unchanged = service.apply({
    changed: false,
    state: {
      directoriesById: {},
      conversationsById: {},
    },
    removedConversationIds: [],
    removedDirectoryIds: [],
    upsertedDirectoryIds: [],
    upsertedConversationIds: [],
  });

  assert.deepEqual(upserted, {
    changed: true,
    removedConversationIds: [],
    removedDirectoryIds: [],
  });
  assert.deepEqual(unchanged, {
    changed: false,
    removedConversationIds: [],
    removedDirectoryIds: [],
  });
  assert.equal(directories.has('directory-1'), true);
  assert.deepEqual(conversations.get('conversation-1'), {
    conversationId: 'conversation-1',
    directoryId: 'directory-2',
  });
  assert.deepEqual(calls, [
    'setDirectory:directory-1',
    'upsertConversation:conversation-1:directory-2',
    'syncGit',
  ]);
});

void test('workspace synced projection applies archive and delete flows', () => {
  const calls: string[] = [];
  const directories = new Map<string, DirectoryRecord>([
    ['directory-1', { directoryId: 'directory-1' }],
    ['directory-2', { directoryId: 'directory-2' }],
  ]);
  const conversations = new Map<string, ConversationRecord>([
    ['conversation-1', { conversationId: 'conversation-1', directoryId: 'directory-1' }],
    ['conversation-2', { conversationId: 'conversation-2', directoryId: 'directory-1' }],
    ['conversation-3', { conversationId: 'conversation-3', directoryId: 'directory-2' }],
  ]);
  const service = new WorkspaceSyncedProjection<DirectoryRecord, ConversationRecord>({
    setDirectory: () => {},
    deleteDirectory: (directoryId) => {
      const deleted = directories.delete(directoryId);
      calls.push(`deleteDirectory:${directoryId}:${String(deleted)}`);
      return deleted;
    },
    deleteDirectoryGitState: (directoryId) => {
      calls.push(`deleteGit:${directoryId}`);
    },
    syncGitStateWithDirectories: () => {
      calls.push('syncGit');
    },
    upsertConversationFromPersistedRecord: () => {},
    removeConversation: (sessionId) => {
      const removed = conversations.delete(sessionId);
      calls.push(`removeConversation:${sessionId}:${String(removed)}`);
      return removed;
    },
  });

  const archiveResult = service.apply({
    changed: true,
    state: {
      directoriesById: {},
      conversationsById: {},
    },
    removedConversationIds: ['conversation-1', 'conversation-2', 'conversation-missing'],
    removedDirectoryIds: ['directory-1'],
    upsertedDirectoryIds: [],
    upsertedConversationIds: [],
  });

  assert.deepEqual(archiveResult, {
    changed: true,
    removedConversationIds: ['conversation-1', 'conversation-2'],
    removedDirectoryIds: ['directory-1'],
  });

  const missingOnlyResult = service.apply({
    changed: true,
    state: {
      directoriesById: {},
      conversationsById: {},
    },
    removedConversationIds: ['conversation-missing'],
    removedDirectoryIds: ['directory-missing'],
    upsertedDirectoryIds: [],
    upsertedConversationIds: [],
  });
  assert.deepEqual(missingOnlyResult, {
    changed: false,
    removedConversationIds: [],
    removedDirectoryIds: [],
  });

  assert.deepEqual([...directories.keys()], ['directory-2']);
  assert.deepEqual([...conversations.keys()], ['conversation-3']);
  assert.deepEqual(calls, [
    'removeConversation:conversation-1:true',
    'removeConversation:conversation-2:true',
    'removeConversation:conversation-missing:false',
    'deleteDirectory:directory-1:true',
    'deleteGit:directory-1',
    'syncGit',
    'removeConversation:conversation-missing:false',
    'deleteDirectory:directory-missing:false',
    'deleteGit:directory-missing',
    'syncGit',
  ]);
});
