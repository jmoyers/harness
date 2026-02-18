import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { RuntimeConversationTitleEditService } from '../src/services/runtime-conversation-title-edit.ts';

interface ConversationRecord {
  title: string;
}

function createWorkspace(): WorkspaceModel {
  return new WorkspaceModel({
    activeDirectoryId: 'directory-a',
    leftNavSelection: {
      kind: 'home',
    },
    latestTaskPaneView: {
      rows: [],
      taskIds: [],
      repositoryIds: [],
      actions: [],
      actionCells: [],
      top: 0,
      selectedRepositoryId: null,
    },
    taskDraftComposer: {
      text: '',
      cursor: 0,
    },
    repositoriesCollapsed: false,
    shortcutsCollapsed: false,
  });
}

void test('runtime conversation title edit service begin/schedule/debounced persist updates conversation and edit state', async () => {
  const workspace = createWorkspace();
  const conversations = new Map<string, ConversationRecord>([
    ['conversation-a', { title: 'Original title' }],
  ]);
  const queued: Array<{ label: string; task: () => Promise<void> }> = [];
  const updateCalls: Array<{ conversationId: string; title: string }> = [];
  let markDirtyCount = 0;
  let scheduledCallback: (() => void) | null = null;
  let debounceDelay = 0;
  let unrefCount = 0;
  let clearedTimerCount = 0;
  const timer = {
    unref: () => {
      unrefCount += 1;
    },
  } as unknown as NodeJS.Timeout;

  const service = new RuntimeConversationTitleEditService<ConversationRecord>({
    workspace,
    updateConversationTitle: async (input) => {
      updateCalls.push(input);
      return { title: `Persisted: ${input.title}` };
    },
    conversationById: (conversationId) => conversations.get(conversationId),
    markDirty: () => {
      markDirtyCount += 1;
    },
    queueControlPlaneOp: (task, label) => {
      queued.push({ task, label });
    },
    debounceMs: 250,
    setDebounceTimer: (callback, ms) => {
      scheduledCallback = callback;
      debounceDelay = ms;
      return timer;
    },
    clearDebounceTimer: () => {
      clearedTimerCount += 1;
    },
  });

  service.begin('conversation-a');
  assert.equal(workspace.conversationTitleEdit?.value, 'Original title');
  assert.equal(markDirtyCount, 1);

  if (workspace.conversationTitleEdit === null) {
    throw new Error('expected edit state');
  }
  workspace.conversationTitleEdit.value = 'Updated title';

  service.schedulePersist();
  service.schedulePersist();

  assert.equal(debounceDelay, 250);
  assert.equal(unrefCount, 2);
  assert.equal(clearedTimerCount, 1);
  if (scheduledCallback === null) {
    throw new Error('expected scheduled callback');
  }
  (scheduledCallback as () => void)();
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.label, 'title-edit-debounced:conversation-a');
  assert.equal(workspace.conversationTitleEdit?.persistInFlight, true);

  await queued[0]!.task();
  assert.deepEqual(updateCalls, [
    {
      conversationId: 'conversation-a',
      title: 'Updated title',
    },
  ]);
  assert.equal(conversations.get('conversation-a')?.title, 'Persisted: Updated title');
  assert.equal(workspace.conversationTitleEdit?.lastSavedValue, 'Persisted: Updated title');
  assert.equal(workspace.conversationTitleEdit?.persistInFlight, false);
});

void test('runtime conversation title edit service stop/begin guard branches preserve behavior', async () => {
  const workspace = createWorkspace();
  const conversations = new Map<string, ConversationRecord>([
    ['conversation-a', { title: 'A' }],
    ['conversation-b', { title: 'B' }],
  ]);
  const queued: Array<{ label: string; task: () => Promise<void> }> = [];
  let markDirtyCount = 0;
  const service = new RuntimeConversationTitleEditService<ConversationRecord>({
    workspace,
    updateConversationTitle: async (input) => ({ title: `${input.title}!` }),
    conversationById: (conversationId) => conversations.get(conversationId),
    markDirty: () => {
      markDirtyCount += 1;
    },
    queueControlPlaneOp: (task, label) => {
      queued.push({ task, label });
    },
    debounceMs: 10,
  });

  service.stop(true);
  service.begin('missing-conversation');
  assert.equal(workspace.conversationTitleEdit === null, true);
  assert.equal(queued.length, 0);

  service.begin('conversation-a');
  service.begin('conversation-a');
  assert.equal(workspace.conversationTitleEdit?.conversationId ?? null, 'conversation-a');
  assert.equal(queued.length, 0);

  if (workspace.conversationTitleEdit === null) {
    throw new Error('expected edit state');
  }
  const nextEditState = workspace.conversationTitleEdit as NonNullable<
    WorkspaceModel['conversationTitleEdit']
  >;
  nextEditState.value = 'A2';
  service.begin('conversation-b');
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.label, 'title-edit-flush:conversation-a');
  assert.equal(workspace.conversationTitleEdit?.conversationId ?? null, 'conversation-b');

  await queued[0]!.task();
  assert.equal(conversations.get('conversation-a')?.title, 'A2!');
  assert.ok(markDirtyCount >= 3);
});

void test('runtime conversation title edit service handles persisted update failures and stale state guards', async () => {
  const workspace = createWorkspace();
  const conversations = new Map<string, ConversationRecord>([
    ['conversation-a', { title: 'A' }],
  ]);
  const queued: Array<{ label: string; task: () => Promise<void> }> = [];
  let markDirtyCount = 0;
  let scheduledCallback: (() => void) | null = null;
  const error = new Error('persist failed');
  const service = new RuntimeConversationTitleEditService<ConversationRecord>({
    workspace,
    updateConversationTitle: async () => {
      throw error;
    },
    conversationById: (conversationId) => conversations.get(conversationId),
    markDirty: () => {
      markDirtyCount += 1;
    },
    queueControlPlaneOp: (task, label) => {
      queued.push({ task, label });
    },
    debounceMs: 10,
    setDebounceTimer: (callback) => {
      scheduledCallback = callback;
      return { unref: () => {} } as unknown as NodeJS.Timeout;
    },
  });

  service.begin('conversation-a');
  if (workspace.conversationTitleEdit === null) {
    throw new Error('expected edit state');
  }
  workspace.conversationTitleEdit.value = 'A2';
  service.schedulePersist();
  if (scheduledCallback === null) {
    throw new Error('expected scheduled callback');
  }
  (scheduledCallback as () => void)();
  assert.equal(queued.length, 1);
  await assert.rejects(() => queued[0]!.task(), /persist failed/);
  assert.equal(workspace.conversationTitleEdit?.error, 'persist failed');
  assert.equal(workspace.conversationTitleEdit?.persistInFlight, false);

  workspace.conversationTitleEdit = null;
  service.begin('conversation-a');
  if (workspace.conversationTitleEdit === null) {
    throw new Error('expected edit state');
  }
  const staleGuardEditState = workspace.conversationTitleEdit as NonNullable<
    WorkspaceModel['conversationTitleEdit']
  >;
  staleGuardEditState.value = 'A3';
  service.schedulePersist();
  if (scheduledCallback === null) {
    throw new Error('expected scheduled callback');
  }
  (scheduledCallback as () => void)();
  assert.equal(queued.length, 2);
  workspace.conversationTitleEdit = null;
  await assert.rejects(() => queued[1]!.task(), /persist failed/);
  assert.ok(markDirtyCount >= 4);
});

void test('runtime conversation title edit service clearCurrentTimer handles empty and active timer states', () => {
  const workspace = createWorkspace();
  let clearCalls = 0;
  const service = new RuntimeConversationTitleEditService<ConversationRecord>({
    workspace,
    updateConversationTitle: async () => ({ title: 'unused' }),
    conversationById: () => ({ title: 'unused' }),
    markDirty: () => {},
    queueControlPlaneOp: () => {},
    debounceMs: 10,
    clearDebounceTimer: () => {
      clearCalls += 1;
    },
  });

  service.clearCurrentTimer();
  workspace.conversationTitleEdit = {
    conversationId: 'conversation-a',
    value: 'A',
    lastSavedValue: 'A',
    error: null,
    persistInFlight: false,
    debounceTimer: { unref: () => {} } as unknown as NodeJS.Timeout,
  };
  service.clearCurrentTimer();

  assert.equal(clearCalls, 1);
  assert.equal(workspace.conversationTitleEdit?.debounceTimer, null);
});
