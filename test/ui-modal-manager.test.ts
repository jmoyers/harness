import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createCommandMenuState } from '../src/mux/live-mux/command-menu.ts';
import { createNewThreadPromptState } from '../src/mux/new-thread-prompt.ts';
import { ModalManager } from '../src/ui/modals/manager.ts';
import type { buildNewThreadModalOverlay } from '../src/mux/live-mux/modal-overlays.ts';
import type {
  ConversationTitleEditState,
  RepositoryPromptState,
  TaskEditorPromptState,
} from '../src/domain/workspace.ts';

const modalTheme = {} as Parameters<typeof buildNewThreadModalOverlay>[3];

void test('modal manager builds overlay priority order and dismisses pointer events', () => {
  const state: {
    newThread: ReturnType<typeof createNewThreadPromptState> | null;
    commandMenu: ReturnType<typeof createCommandMenuState> | null;
    addDirectory: { value: string; error: string | null } | null;
    taskEditor: TaskEditorPromptState | null;
    repository: RepositoryPromptState | null;
    titleEdit: ConversationTitleEditState | null;
  } = {
    newThread: createNewThreadPromptState('dir-a'),
    commandMenu: null,
    addDirectory: { value: '.', error: null },
    taskEditor: {
      mode: 'create',
      taskId: null,
      title: 'Task',
      description: 'Description',
      repositoryIds: ['repo-a'],
      repositoryIndex: 0,
      fieldIndex: 0,
      error: null,
    },
    repository: {
      mode: 'add',
      repositoryId: null,
      value: 'https://github.com/acme/harness',
      error: null,
    },
    titleEdit: {
      conversationId: 'session-a',
      value: 'Thread',
      lastSavedValue: 'Thread',
      error: null,
      persistInFlight: false,
      debounceTimer: null,
    },
  };
  const manager = new ModalManager({
    theme: modalTheme,
    resolveRepositoryName: () => 'Harness',
    getCommandMenu: () => state.commandMenu,
    resolveCommandMenuActions: () => [],
    getNewThreadPrompt: () => state.newThread,
    getAddDirectoryPrompt: () => state.addDirectory,
    getTaskEditorPrompt: () => state.taskEditor,
    getRepositoryPrompt: () => state.repository,
    getConversationTitleEdit: () => state.titleEdit,
  });

  const newThreadOverlay = manager.buildNewThreadOverlay(80, 24);
  assert.notEqual(newThreadOverlay, null);
  assert.deepEqual(manager.buildCurrentOverlay(80, 24), newThreadOverlay);

  state.commandMenu = createCommandMenuState();
  const commandMenuOverlay = manager.buildCommandMenuOverlay(80, 24);
  assert.notEqual(commandMenuOverlay, null);
  assert.deepEqual(manager.buildCurrentOverlay(80, 24), commandMenuOverlay);
  state.commandMenu = null;

  state.newThread = null;
  const addDirectoryOverlay = manager.buildAddDirectoryOverlay(80, 24);
  assert.notEqual(addDirectoryOverlay, null);
  assert.deepEqual(manager.buildCurrentOverlay(80, 24), addDirectoryOverlay);

  state.addDirectory = null;
  const taskEditorOverlay = manager.buildTaskEditorOverlay(80, 24);
  assert.notEqual(taskEditorOverlay, null);
  assert.deepEqual(manager.buildCurrentOverlay(80, 24), taskEditorOverlay);

  state.taskEditor = null;
  const repositoryOverlay = manager.buildRepositoryOverlay(80, 24);
  assert.notEqual(repositoryOverlay, null);
  assert.deepEqual(manager.buildCurrentOverlay(80, 24), repositoryOverlay);

  state.repository = null;
  const titleOverlay = manager.buildConversationTitleOverlay(80, 24);
  assert.notEqual(titleOverlay, null);
  const currentOverlay = manager.buildCurrentOverlay(80, 24);
  assert.deepEqual(currentOverlay, titleOverlay);
  assert.notEqual(currentOverlay, null);

  state.titleEdit = null;
  assert.equal(manager.buildCurrentOverlay(80, 24), null);

  let outsideDismissed = false;
  const outsideResult = manager.dismissOnOutsideClick({
    input: Buffer.from('\u001b[<0;1;1M', 'utf8'),
    inputRemainder: '',
    layoutCols: 80,
    viewportRows: 24,
    dismiss: () => {
      outsideDismissed = true;
    },
  });
  assert.equal(outsideResult.handled, true);
  assert.equal(outsideDismissed, false);

  state.newThread = createNewThreadPromptState('dir-b');
  const insideOverlay = manager.buildCurrentOverlay(80, 24);
  assert.notEqual(insideOverlay, null);
  if (insideOverlay === null) {
    assert.fail('expected active modal overlay');
  }
  let insideDismissed = false;
  const insideResult = manager.dismissOnOutsideClick({
    input: Buffer.from(
      `\u001b[<0;${String(insideOverlay.left + 1)};${String(insideOverlay.top + 1)}M`,
      'utf8',
    ),
    inputRemainder: '',
    layoutCols: 80,
    viewportRows: 24,
    dismiss: () => {
      insideDismissed = true;
    },
    onInsidePointerPress: () => true,
  });
  assert.equal(insideResult.handled, true);
  assert.equal(insideDismissed, false);

  const noEscapeResult = manager.dismissOnOutsideClick({
    input: Buffer.from('abc', 'utf8'),
    inputRemainder: 'carry',
    layoutCols: 80,
    viewportRows: 24,
    dismiss: () => {},
  });
  assert.equal(noEscapeResult.handled, false);
  assert.equal(noEscapeResult.inputRemainder, 'carry');
});

void test('modal manager uses injected dependencies when provided', () => {
  const calls: string[] = [];
  const overlay = {
    left: 0,
    top: 0,
    width: 10,
    height: 5,
    rows: [],
  } as NonNullable<ReturnType<typeof buildNewThreadModalOverlay>>;
  const manager = new ModalManager(
    {
      theme: modalTheme,
      resolveRepositoryName: () => 'Repo',
      getCommandMenu: () => createCommandMenuState(),
      resolveCommandMenuActions: () => [],
      getNewThreadPrompt: () => createNewThreadPromptState('dir-a'),
      getAddDirectoryPrompt: () => ({ value: '.', error: null }),
      getTaskEditorPrompt: () => ({
        mode: 'create',
        taskId: null,
        title: 'Task',
        description: '',
        repositoryIds: ['repo-a'],
        repositoryIndex: 0,
        fieldIndex: 0,
        error: null,
      }),
      getRepositoryPrompt: () => ({
        mode: 'add',
        repositoryId: null,
        value: 'https://github.com/acme/harness',
        error: null,
      }),
      getConversationTitleEdit: () => ({
        conversationId: 'session-a',
        value: 'Title',
        lastSavedValue: 'Title',
        error: null,
        persistInFlight: false,
        debounceTimer: null,
      }),
    },
    {
      buildNewThreadModalOverlay: () => {
        calls.push('new-thread');
        return overlay;
      },
      buildCommandMenuModalOverlay: () => {
        calls.push('command-menu');
        return overlay;
      },
      buildAddDirectoryModalOverlay: () => {
        calls.push('add-directory');
        return overlay;
      },
      buildTaskEditorModalOverlay: () => {
        calls.push('task-editor');
        return overlay;
      },
      buildRepositoryModalOverlay: () => {
        calls.push('repository');
        return overlay;
      },
      buildConversationTitleModalOverlay: () => {
        calls.push('title');
        return overlay;
      },
      dismissModalOnOutsideClick: (input) => {
        calls.push('dismiss');
        assert.equal(input.onInsidePointerPress !== undefined, true);
        return {
          handled: true,
          inputRemainder: 'next',
        };
      },
      isOverlayHit: () => {
        calls.push('overlay-hit');
        return true;
      },
    },
  );

  assert.equal(manager.buildCommandMenuOverlay(80, 24), overlay);
  assert.equal(manager.buildNewThreadOverlay(80, 24), overlay);
  assert.equal(manager.buildAddDirectoryOverlay(80, 24), overlay);
  assert.equal(manager.buildTaskEditorOverlay(80, 24), overlay);
  assert.equal(manager.buildRepositoryOverlay(80, 24), overlay);
  assert.equal(manager.buildConversationTitleOverlay(80, 24), overlay);
  assert.equal(manager.buildCurrentOverlay(80, 24), overlay);

  const dismissResult = manager.dismissOnOutsideClick({
    input: Buffer.from('\u001b[<0;1;1M', 'utf8'),
    inputRemainder: '',
    layoutCols: 80,
    viewportRows: 24,
    dismiss: () => {},
    onInsidePointerPress: () => true,
  });
  assert.equal(dismissResult.handled, true);
  assert.equal(dismissResult.inputRemainder, 'next');
  assert.equal(calls.includes('dismiss'), true);
});
