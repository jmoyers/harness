import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createCommandMenuState } from '../src/mux/live-mux/command-menu.ts';
import type { CommandMenuState } from '../src/mux/live-mux/command-menu.ts';
import { InputRouter } from '../src/ui/input.ts';
import type { handleTaskEditorPromptInput as handleTaskEditorPromptInputFrame } from '../src/mux/live-mux/modal-task-editor-handler.ts';

type TaskEditorResult = ReturnType<typeof handleTaskEditorPromptInputFrame>;

interface RouterHarness {
  readonly router: InputRouter;
  readonly calls: string[];
  readonly getMarkDirtyCount: () => number;
  readonly getTaskPrompt: () => {
    mode: 'create' | 'edit';
    taskId: string | null;
    title: string;
    body: string;
    repositoryIds: readonly string[];
    repositoryIndex: number;
    fieldIndex: 0 | 1 | 2;
    error: string | null;
  } | null;
}

function createHarness(dependencies: ConstructorParameters<typeof InputRouter>[1]): RouterHarness {
  let markDirtyCount = 0;
  let commandMenu: CommandMenuState | null = createCommandMenuState();
  let taskPrompt: RouterHarness['getTaskPrompt'] extends () => infer TValue ? TValue : never = {
    mode: 'create',
    taskId: null,
    title: 'Task',
    body: 'Desc',
    repositoryIds: ['repo-a'],
    repositoryIndex: 0,
    fieldIndex: 0,
    error: null,
  };
  const calls: string[] = [];
  const router = new InputRouter(
    {
      isModalDismissShortcut: () => false,
      isCommandMenuToggleShortcut: () => false,
      isArchiveConversationShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildCommandMenuModalOverlay: () => ({ top: 2 }),
      buildConversationTitleModalOverlay: () => ({ top: 2 }),
      buildNewThreadModalOverlay: () => ({ top: 2 }),
      resolveNewThreadPromptAgentByRow: () => 'codex',
      stopConversationTitleEdit: () => {},
      queueControlPlaneOp: () => {},
      archiveConversation: async () => {},
      createAndActivateConversationInDirectory: async () => {},
      addDirectoryByPath: async () => {},
      normalizeGitHubRemoteUrl: () => 'https://github.com/acme/harness',
      upsertRepositoryByRemoteUrl: async () => {},
      repositoriesHas: () => true,
      markDirty: () => {
        markDirtyCount += 1;
      },
      conversations: new Map([['session-a', { title: 'Thread' }]]),
      scheduleConversationTitlePersist: () => {},
      getTaskEditorPrompt: () => taskPrompt,
      setTaskEditorPrompt: (next) => {
        taskPrompt = next;
      },
      submitTaskEditorPayload: (payload) => {
        calls.push(`submit:${payload.commandLabel}`);
      },
      getConversationTitleEdit: () => null,
      getCommandMenu: () => commandMenu,
      setCommandMenu: (next) => {
        commandMenu = next;
      },
      resolveCommandMenuActions: () => [],
      executeCommandMenuAction: (actionId) => {
        calls.push(`command:${actionId}`);
      },
      getNewThreadPrompt: () => null,
      setNewThreadPrompt: () => {},
      getAddDirectoryPrompt: () => null,
      setAddDirectoryPrompt: () => {},
      getRepositoryPrompt: () => null,
      setRepositoryPrompt: () => {},
    },
    dependencies,
  );
  return {
    router,
    calls,
    getMarkDirtyCount: () => markDirtyCount,
    getTaskPrompt: () => taskPrompt,
  };
}

void test('input router task-editor branch updates prompt, dirty state, and submit callback', () => {
  const nextPrompt = {
    mode: 'edit' as const,
    taskId: 'task-1',
    title: 'Updated',
    body: 'Desc',
    repositoryIds: ['repo-a'],
    repositoryIndex: 0,
    fieldIndex: 1 as const,
    error: null,
  };
  const taskResult: TaskEditorResult = {
    handled: true,
    nextPrompt,
    markDirty: true,
    submitPayload: {
      mode: 'create',
      taskId: null,
      repositoryId: 'repo-a',
      title: 'Updated',
      body: 'Desc',
      commandLabel: 'tasks-create',
    },
  };
  const harness = createHarness({
    handleCommandMenuInput: () => false,
    handleTaskEditorPromptInput: () => taskResult,
    handleRepositoryPromptInput: () => false,
    handleNewThreadPromptInput: () => false,
    handleConversationTitleEditInput: () => false,
    handleAddDirectoryPromptInput: () => false,
  });

  const handled = harness.router.handleTaskEditorPromptInput(Buffer.from('x', 'utf8'));
  assert.equal(handled, true);
  assert.deepEqual(harness.getTaskPrompt(), nextPrompt);
  assert.equal(harness.getMarkDirtyCount(), 1);
  assert.deepEqual(harness.calls, ['submit:tasks-create']);
});

void test('input router task-editor branch returns false when frame handler is not handled', () => {
  const harness = createHarness({
    handleCommandMenuInput: () => false,
    handleTaskEditorPromptInput: () => ({
      handled: false,
      markDirty: false,
    }),
    handleRepositoryPromptInput: () => false,
    handleNewThreadPromptInput: () => false,
    handleConversationTitleEditInput: () => false,
    handleAddDirectoryPromptInput: () => false,
  });

  const handled = harness.router.handleTaskEditorPromptInput(Buffer.from('x', 'utf8'));
  assert.equal(handled, false);
  assert.equal(harness.getMarkDirtyCount(), 0);
  assert.equal(harness.calls.length, 0);
});

void test('input router routeModalInput short-circuits in priority order', () => {
  type Winner = 'command' | 'task' | 'repo' | 'new' | 'title' | 'add' | 'none';
  const expectedCalls: Record<Winner, readonly string[]> = {
    command: ['command'],
    task: ['command', 'task'],
    repo: ['command', 'task', 'repo'],
    new: ['command', 'task', 'repo', 'new'],
    title: ['command', 'task', 'repo', 'new', 'title'],
    add: ['command', 'task', 'repo', 'new', 'title', 'add'],
    none: ['command', 'task', 'repo', 'new', 'title', 'add'],
  };
  const winners: readonly Winner[] = ['command', 'task', 'repo', 'new', 'title', 'add', 'none'];

  for (const winner of winners) {
    const calls: string[] = [];
    const harness = createHarness({
      handleCommandMenuInput: () => {
        calls.push('command');
        return winner === 'command';
      },
      handleTaskEditorPromptInput: () => {
        calls.push('task');
        return {
          handled: winner === 'task',
          markDirty: false,
        };
      },
      handleRepositoryPromptInput: () => {
        calls.push('repo');
        return winner === 'repo';
      },
      handleNewThreadPromptInput: () => {
        calls.push('new');
        return winner === 'new';
      },
      handleConversationTitleEditInput: () => {
        calls.push('title');
        return winner === 'title';
      },
      handleAddDirectoryPromptInput: () => {
        calls.push('add');
        return winner === 'add';
      },
    });

    const handled = harness.router.routeModalInput(Buffer.from('x', 'utf8'));
    assert.equal(handled, winner !== 'none');
    assert.deepEqual(calls, expectedCalls[winner]);
  }
});

void test('input router default frame dependencies are usable when prompt state is empty', () => {
  const router = new InputRouter({
    isModalDismissShortcut: () => false,
    isCommandMenuToggleShortcut: () => false,
    isArchiveConversationShortcut: () => false,
    dismissOnOutsideClick: () => false,
    buildCommandMenuModalOverlay: () => null,
    buildConversationTitleModalOverlay: () => null,
    buildNewThreadModalOverlay: () => null,
    resolveNewThreadPromptAgentByRow: () => null,
    stopConversationTitleEdit: () => {},
    queueControlPlaneOp: () => {},
    archiveConversation: async () => {},
    createAndActivateConversationInDirectory: async () => {},
    addDirectoryByPath: async () => {},
    normalizeGitHubRemoteUrl: () => null,
    upsertRepositoryByRemoteUrl: async () => {},
    repositoriesHas: () => false,
    markDirty: () => {},
    conversations: new Map(),
    scheduleConversationTitlePersist: () => {},
    getTaskEditorPrompt: () => null,
    setTaskEditorPrompt: () => {},
    submitTaskEditorPayload: () => {},
    getConversationTitleEdit: () => null,
    getCommandMenu: () => null,
    setCommandMenu: () => {},
    resolveCommandMenuActions: () => [],
    executeCommandMenuAction: () => {},
    getNewThreadPrompt: () => null,
    setNewThreadPrompt: () => {},
    getAddDirectoryPrompt: () => null,
    setAddDirectoryPrompt: () => {},
    getRepositoryPrompt: () => null,
    setRepositoryPrompt: () => {},
  });

  assert.equal(router.handleRepositoryPromptInput(Buffer.from('x', 'utf8')), false);
  assert.equal(router.handleNewThreadPromptInput(Buffer.from('x', 'utf8')), false);
  assert.equal(router.handleConversationTitleEditInput(Buffer.from('x', 'utf8')), false);
  assert.equal(router.handleAddDirectoryPromptInput(Buffer.from('x', 'utf8')), false);
  assert.equal(router.routeModalInput(Buffer.from('x', 'utf8')), false);
});
