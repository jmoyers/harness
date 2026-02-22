import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { StreamObservedEvent } from '../../../src/control-plane/stream-protocol.ts';
import { WorkspaceObservedEvents } from '../../../src/services/workspace-observed-events.ts';

interface DirectoryRecord {
  readonly directoryId: string;
}

interface ConversationRecord {
  readonly conversationId: string;
  readonly directoryId: string;
}

void test('workspace observed events applies directory and conversation upserts', () => {
  const calls: string[] = [];
  const directories = new Map<string, DirectoryRecord>();
  const conversations = new Map<string, ConversationRecord>();
  const service = new WorkspaceObservedEvents<DirectoryRecord, ConversationRecord>({
    parseDirectoryRecord: (value) => {
      if (typeof value === 'object' && value !== null && 'directoryId' in value) {
        const directoryId = Reflect.get(value, 'directoryId');
        if (typeof directoryId === 'string') {
          return {
            directoryId,
          };
        }
      }
      return null;
    },
    parseConversationRecord: (value) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'conversationId' in value &&
        'directoryId' in value
      ) {
        const conversationId = Reflect.get(value, 'conversationId');
        const directoryId = Reflect.get(value, 'directoryId');
        if (typeof conversationId === 'string' && typeof directoryId === 'string') {
          return {
            conversationId,
            directoryId,
          };
        }
      }
      return null;
    },
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
    orderedConversationIds: () => [...conversations.keys()],
    conversationDirectoryId: (sessionId) => conversations.get(sessionId)?.directoryId ?? null,
  });

  const upsertedDirectory = service.apply({
    type: 'directory-upserted',
    directory: {
      directoryId: 'directory-1',
    },
  } as StreamObservedEvent);
  const ignoredMalformedDirectory = service.apply({
    type: 'directory-upserted',
    directory: {
      invalid: true,
    },
  } as StreamObservedEvent);
  const createdConversation = service.apply({
    type: 'conversation-created',
    conversation: {
      conversationId: 'conversation-1',
      directoryId: 'directory-1',
    },
  } as StreamObservedEvent);
  const updatedConversation = service.apply({
    type: 'conversation-updated',
    conversation: {
      conversationId: 'conversation-1',
      directoryId: 'directory-2',
    },
  } as StreamObservedEvent);
  const ignoredMalformedConversation = service.apply({
    type: 'conversation-updated',
    conversation: {
      invalid: true,
    },
  } as StreamObservedEvent);
  const ignoredUnrelated = service.apply({
    type: 'session-status',
  } as StreamObservedEvent);

  assert.deepEqual(upsertedDirectory, {
    changed: true,
    removedConversationIds: [],
    removedDirectoryIds: [],
  });
  assert.deepEqual(ignoredMalformedDirectory, {
    changed: false,
    removedConversationIds: [],
    removedDirectoryIds: [],
  });
  assert.deepEqual(createdConversation, {
    changed: true,
    removedConversationIds: [],
    removedDirectoryIds: [],
  });
  assert.deepEqual(updatedConversation, {
    changed: true,
    removedConversationIds: [],
    removedDirectoryIds: [],
  });
  assert.deepEqual(ignoredMalformedConversation, {
    changed: false,
    removedConversationIds: [],
    removedDirectoryIds: [],
  });
  assert.deepEqual(ignoredUnrelated, {
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
    'syncGit',
    'upsertConversation:conversation-1:directory-1',
    'upsertConversation:conversation-1:directory-2',
  ]);
});

void test('workspace observed events applies archive and delete flows', () => {
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
  const service = new WorkspaceObservedEvents<DirectoryRecord, ConversationRecord>({
    parseDirectoryRecord: () => null,
    parseConversationRecord: () => null,
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
    orderedConversationIds: () => [...conversations.keys()],
    conversationDirectoryId: (sessionId) => conversations.get(sessionId)?.directoryId ?? null,
  });

  const archivedDirectory = service.apply({
    type: 'directory-archived',
    directoryId: 'directory-1',
    ts: '2026-02-18T00:00:00.000Z',
  } as StreamObservedEvent);
  const archivedConversation = service.apply({
    type: 'conversation-archived',
    conversationId: 'conversation-3',
    ts: '2026-02-18T00:00:01.000Z',
  } as StreamObservedEvent);
  const deletedConversation = service.apply({
    type: 'conversation-deleted',
    conversationId: 'conversation-missing',
    ts: '2026-02-18T00:00:02.000Z',
  } as StreamObservedEvent);

  assert.deepEqual(archivedDirectory, {
    changed: true,
    removedConversationIds: ['conversation-1', 'conversation-2'],
    removedDirectoryIds: ['directory-1'],
  });
  assert.deepEqual(archivedConversation, {
    changed: true,
    removedConversationIds: ['conversation-3'],
    removedDirectoryIds: [],
  });
  assert.deepEqual(deletedConversation, {
    changed: false,
    removedConversationIds: [],
    removedDirectoryIds: [],
  });
  assert.deepEqual([...directories.keys()], ['directory-2']);
  assert.deepEqual([...conversations.keys()], []);
  assert.deepEqual(calls, [
    'removeConversation:conversation-1:true',
    'removeConversation:conversation-2:true',
    'deleteDirectory:directory-1:true',
    'deleteGit:directory-1',
    'syncGit',
    'removeConversation:conversation-3:true',
    'removeConversation:conversation-missing:false',
  ]);
});
