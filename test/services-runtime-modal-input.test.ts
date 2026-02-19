import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { createCommandMenuState } from '../src/mux/live-mux/command-menu.ts';
import { createNewThreadPromptState } from '../src/mux/new-thread-prompt.ts';
import { RuntimeModalInput } from '../src/services/runtime-modal-input.ts';
import type { InputRouter } from '../src/ui/input.ts';

function createWorkspace(): WorkspaceModel {
  return new WorkspaceModel({
    activeDirectoryId: null,
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

void test('runtime modal input wires input router state accessors and delegates modal actions', async () => {
  const workspace = createWorkspace();
  const calls: string[] = [];
  type InputRouterOptions = ConstructorParameters<typeof InputRouter>[0];
  let capturedOptions: InputRouterOptions | null = null;
  const modalInput = new RuntimeModalInput(
    {
      workspace,
      conversations: new Map([['session-1', { title: 'Thread' }]]),
      workspaceActions: {
        archiveConversation: async (sessionId) => {
          calls.push(`archiveConversation:${sessionId}`);
        },
        createAndActivateConversationInDirectory: async (directoryId, agentType) => {
          calls.push(`createAndActivateConversationInDirectory:${directoryId}:${agentType}`);
        },
        addDirectoryByPath: async (rawPath) => {
          calls.push(`addDirectoryByPath:${rawPath}`);
        },
        upsertRepositoryByRemoteUrl: async (remoteUrl, existingRepositoryId) => {
          calls.push(`upsertRepositoryByRemoteUrl:${remoteUrl}:${existingRepositoryId ?? ''}`);
        },
      },
      taskEditorActions: {
        submitTaskEditorPayload: (payload) => {
          calls.push(`submitTaskEditorPayload:${payload.commandLabel}`);
        },
      },
      isModalDismissShortcut: () => false,
      isCommandMenuToggleShortcut: () => false,
      isArchiveConversationShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildCommandMenuModalOverlay: () => ({ top: 0 }),
      buildConversationTitleModalOverlay: () => ({ top: 1 }),
      buildNewThreadModalOverlay: () => ({ top: 2 }),
      resolveNewThreadPromptAgentByRow: () => 'codex',
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      queueControlPlaneOp: () => {
        calls.push('queueControlPlaneOp');
      },
      normalizeGitHubRemoteUrl: (remoteUrl) => remoteUrl,
      repositoriesHas: () => true,
      scheduleConversationTitlePersist: () => {
        calls.push('scheduleConversationTitlePersist');
      },
      resolveCommandMenuActions: () => [],
      executeCommandMenuAction: (actionId) => {
        calls.push(`executeCommandMenuAction:${actionId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    },
    {
      createInputRouter: (options) => {
        capturedOptions = options;
        return {
          routeModalInput: () => {
            calls.push('routeModalInput');
            return true;
          },
        };
      },
    },
  );

  assert.equal(modalInput.routeModalInput(Buffer.from('x', 'utf8')), true);
  assert.equal(capturedOptions !== null, true);
  const options = capturedOptions!;

  workspace.taskEditorPrompt = null;
  options.setCommandMenu(createCommandMenuState());
  assert.equal(options.getCommandMenu()?.query, '');
  options.setTaskEditorPrompt({
    mode: 'create',
    taskId: null,
    title: 'Task',
    description: 'Desc',
    repositoryIds: ['repo-1'],
    repositoryIndex: 0,
    fieldIndex: 0,
    error: null,
  });
  assert.equal(options.getTaskEditorPrompt()?.title, 'Task');

  options.setNewThreadPrompt(createNewThreadPromptState('directory-1'));
  assert.equal(options.getNewThreadPrompt()?.directoryId, 'directory-1');

  options.setAddDirectoryPrompt({
    value: '/tmp/workspace',
    error: null,
  });
  assert.equal(options.getAddDirectoryPrompt()?.value, '/tmp/workspace');

  options.setRepositoryPrompt({
    mode: 'add',
    repositoryId: null,
    value: 'https://github.com/acme/harness',
    error: null,
  });
  assert.equal(options.getRepositoryPrompt()?.mode, 'add');
  options.executeCommandMenuAction('command-id');
  assert.deepEqual(options.resolveCommandMenuActions(), []);
  workspace.conversationTitleEdit = {
    conversationId: 'session-1',
    value: 'Thread',
    lastSavedValue: 'Thread',
    error: null,
    persistInFlight: false,
    debounceTimer: null,
  };
  assert.equal(options.getConversationTitleEdit()?.conversationId, 'session-1');

  options.submitTaskEditorPayload({
    mode: 'create',
    taskId: null,
    repositoryId: 'repo-1',
    title: 'Task',
    description: 'Desc',
    commandLabel: 'tasks-create',
  });
  await options.archiveConversation('session-1');
  await options.createAndActivateConversationInDirectory('directory-1', 'codex');
  await options.addDirectoryByPath('/tmp/workspace');
  await options.upsertRepositoryByRemoteUrl('https://github.com/acme/harness', 'repository-1');
  options.scheduleConversationTitlePersist();
  options.markDirty();
  options.stopConversationTitleEdit(true);

  assert.deepEqual(calls, [
    'routeModalInput',
    'executeCommandMenuAction:command-id',
    'submitTaskEditorPayload:tasks-create',
    'archiveConversation:session-1',
    'createAndActivateConversationInDirectory:directory-1:codex',
    'addDirectoryByPath:/tmp/workspace',
    'upsertRepositoryByRemoteUrl:https://github.com/acme/harness:repository-1',
    'scheduleConversationTitlePersist',
    'markDirty',
    'stopConversationTitleEdit',
  ]);
});

void test('runtime modal input default router dependency path is usable', () => {
  const workspace = createWorkspace();
  const modalInput = new RuntimeModalInput({
    workspace,
    conversations: new Map(),
    workspaceActions: {
      archiveConversation: async () => {},
      createAndActivateConversationInDirectory: async () => {},
      addDirectoryByPath: async () => {},
      upsertRepositoryByRemoteUrl: async () => {},
    },
    taskEditorActions: {
      submitTaskEditorPayload: () => {},
    },
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
    normalizeGitHubRemoteUrl: () => null,
    repositoriesHas: () => false,
    scheduleConversationTitlePersist: () => {},
    resolveCommandMenuActions: () => [],
    executeCommandMenuAction: () => {},
    markDirty: () => {},
  });

  assert.equal(modalInput.routeModalInput(Buffer.from('x', 'utf8')), false);
});
