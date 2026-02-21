import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createCommandMenuState } from '../src/mux/live-mux/command-menu.ts';
import { handleCommandMenuInput } from '../src/mux/live-mux/modal-command-menu-handler.ts';
import {
  handleConversationTitleEditInput,
  handleNewThreadPromptInput,
} from '../src/mux/live-mux/modal-conversation-handlers.ts';
import {
  handleAddDirectoryPromptInput,
  handleApiKeyPromptInput,
  handleRepositoryPromptInput,
} from '../src/mux/live-mux/modal-prompt-handlers.ts';
import { handleTaskEditorPromptInput } from '../src/mux/live-mux/modal-task-editor-handler.ts';
import type { CommandMenuState } from '../src/mux/live-mux/command-menu.ts';
import { InputRouter } from '../packages/harness-ui/src/interaction/input.ts';
import type { InputRouterStrategies } from '../packages/harness-ui/src/interaction/input.ts';

type TaskEditorResult = ReturnType<typeof handleTaskEditorPromptInput>;

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

function createHarness(strategies: InputRouterStrategies): RouterHarness {
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
      shortcuts: {
        isModalDismissShortcut: () => false,
        isCommandMenuToggleShortcut: () => false,
        isArchiveConversationShortcut: () => false,
      },
      overlays: {
        dismissOnOutsideClick: () => false,
        buildCommandMenuModalOverlay: () => ({ top: 2 }),
        buildConversationTitleModalOverlay: () => ({ top: 2 }),
        buildNewThreadModalOverlay: () => ({ top: 2 }),
        resolveNewThreadPromptAgentByRow: () => 'codex',
      },
      actions: {
        stopConversationTitleEdit: () => {},
        queueControlPlaneOp: () => {},
        archiveConversation: async () => {},
        createAndActivateConversationInDirectory: async () => {},
        addDirectoryByPath: async () => {},
        normalizeGitHubRemoteUrl: () => 'https://github.com/acme/harness',
        upsertRepositoryByRemoteUrl: async () => {},
        repositoriesHas: () => true,
        submitTaskEditorPayload: (payload) => {
          calls.push(`submit:${payload.commandLabel}`);
        },
        resolveCommandMenuActions: () => [],
        executeCommandMenuAction: (actionId) => {
          calls.push(`command:${actionId}`);
        },
      },
      state: {
        markDirty: () => {
          markDirtyCount += 1;
        },
        conversations: new Map([['session-a', { title: 'Thread' }]]),
        scheduleConversationTitlePersist: () => {},
        getTaskEditorPrompt: () => taskPrompt,
        setTaskEditorPrompt: (next) => {
          taskPrompt = next;
        },
        getConversationTitleEdit: () => null,
        getCommandMenu: () => commandMenu,
        setCommandMenu: (next) => {
          commandMenu = next;
        },
        getNewThreadPrompt: () => null,
        setNewThreadPrompt: () => {},
        getAddDirectoryPrompt: () => null,
        setAddDirectoryPrompt: () => {},
        getRepositoryPrompt: () => null,
        setRepositoryPrompt: () => {},
      },
    },
    strategies,
  );
  return {
    router,
    calls,
    getMarkDirtyCount: () => markDirtyCount,
    getTaskPrompt: () => taskPrompt,
  };
}

function defaultStrategies(overrides: Partial<InputRouterStrategies> = {}): InputRouterStrategies {
  return {
    handleCommandMenuInput: () => false,
    handleTaskEditorPromptInput: () => ({
      handled: false,
      markDirty: false,
    }),
    handleApiKeyPromptInput: () => false,
    handleConversationTitleEditInput: () => false,
    handleNewThreadPromptInput: () => false,
    handleAddDirectoryPromptInput: () => false,
    handleRepositoryPromptInput: () => false,
    ...overrides,
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
  const harness = createHarness(
    defaultStrategies({
      handleCommandMenuInput: () => false,
      handleTaskEditorPromptInput: () => taskResult,
      handleRepositoryPromptInput: () => false,
      handleNewThreadPromptInput: () => false,
      handleConversationTitleEditInput: () => false,
      handleAddDirectoryPromptInput: () => false,
    }),
  );

  const handled = harness.router.handleTaskEditorPromptInput(Buffer.from('x', 'utf8'));
  assert.equal(handled, true);
  assert.deepEqual(harness.getTaskPrompt(), nextPrompt);
  assert.equal(harness.getMarkDirtyCount(), 1);
  assert.deepEqual(harness.calls, ['submit:tasks-create']);
});

void test('input router task-editor branch returns false when frame handler is not handled', () => {
  const harness = createHarness(
    defaultStrategies({
      handleCommandMenuInput: () => false,
      handleTaskEditorPromptInput: () => ({
        handled: false,
        markDirty: false,
      }),
      handleRepositoryPromptInput: () => false,
      handleNewThreadPromptInput: () => false,
      handleConversationTitleEditInput: () => false,
      handleAddDirectoryPromptInput: () => false,
    }),
  );

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
    const harness = createHarness(
      defaultStrategies({
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
      }),
    );

    const handled = harness.router.routeModalInput(Buffer.from('x', 'utf8'));
    assert.equal(handled, winner !== 'none');
    assert.deepEqual(calls, expectedCalls[winner]);
  }
});

void test('input router real strategy wiring is usable when prompt state is empty', () => {
  const router = new InputRouter(
    {
      shortcuts: {
        isModalDismissShortcut: () => false,
        isCommandMenuToggleShortcut: () => false,
        isArchiveConversationShortcut: () => false,
      },
      overlays: {
        dismissOnOutsideClick: () => false,
        buildCommandMenuModalOverlay: () => null,
        buildConversationTitleModalOverlay: () => null,
        buildNewThreadModalOverlay: () => null,
        resolveNewThreadPromptAgentByRow: () => null,
      },
      actions: {
        stopConversationTitleEdit: () => {},
        queueControlPlaneOp: () => {},
        archiveConversation: async () => {},
        createAndActivateConversationInDirectory: async () => {},
        addDirectoryByPath: async () => {},
        normalizeGitHubRemoteUrl: () => null,
        upsertRepositoryByRemoteUrl: async () => {},
        repositoriesHas: () => false,
        submitTaskEditorPayload: () => {},
        resolveCommandMenuActions: () => [],
        executeCommandMenuAction: () => {},
      },
      state: {
        markDirty: () => {},
        conversations: new Map(),
        scheduleConversationTitlePersist: () => {},
        getTaskEditorPrompt: () => null,
        setTaskEditorPrompt: () => {},
        getConversationTitleEdit: () => null,
        getCommandMenu: () => null,
        setCommandMenu: () => {},
        getNewThreadPrompt: () => null,
        setNewThreadPrompt: () => {},
        getAddDirectoryPrompt: () => null,
        setAddDirectoryPrompt: () => {},
        getRepositoryPrompt: () => null,
        setRepositoryPrompt: () => {},
      },
    },
    {
      handleCommandMenuInput,
      handleTaskEditorPromptInput,
      handleApiKeyPromptInput,
      handleConversationTitleEditInput,
      handleNewThreadPromptInput,
      handleAddDirectoryPromptInput,
      handleRepositoryPromptInput,
    },
  );

  assert.equal(router.handleRepositoryPromptInput(Buffer.from('x', 'utf8')), false);
  assert.equal(router.handleNewThreadPromptInput(Buffer.from('x', 'utf8')), false);
  assert.equal(router.handleConversationTitleEditInput(Buffer.from('x', 'utf8')), false);
  assert.equal(router.handleAddDirectoryPromptInput(Buffer.from('x', 'utf8')), false);
  assert.equal(router.routeModalInput(Buffer.from('x', 'utf8')), false);
});
