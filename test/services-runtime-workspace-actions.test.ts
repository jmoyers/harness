import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { TaskPaneAction } from '../src/mux/harness-core-ui.ts';
import { RuntimeWorkspaceActions } from '../src/services/runtime-workspace-actions.ts';

void test('runtime workspace actions delegates conversation directory repository and control actions', async () => {
  const calls: string[] = [];
  const actions = new RuntimeWorkspaceActions({
    conversationActions: {
      activateConversation: async (sessionId) => {
        calls.push(`activateConversation:${sessionId}`);
      },
      createAndActivateConversationInDirectory: async (directoryId, agentType) => {
        calls.push(`createAndActivateConversationInDirectory:${directoryId}:${agentType}`);
      },
      openOrCreateCritiqueConversationInDirectory: async (directoryId) => {
        calls.push(`openOrCreateCritiqueConversationInDirectory:${directoryId}`);
      },
      takeoverConversation: async (sessionId) => {
        calls.push(`takeoverConversation:${sessionId}`);
      },
    },
    directoryActions: {
      archiveConversation: async (sessionId) => {
        calls.push(`archiveConversation:${sessionId}`);
      },
      addDirectoryByPath: async (rawPath) => {
        calls.push(`addDirectoryByPath:${rawPath}`);
      },
      closeDirectory: async (directoryId) => {
        calls.push(`closeDirectory:${directoryId}`);
      },
    },
    repositoryActions: {
      openRepositoryPromptForCreate: () => {
        calls.push('openRepositoryPromptForCreate');
      },
      openRepositoryPromptForEdit: (repositoryId) => {
        calls.push(`openRepositoryPromptForEdit:${repositoryId}`);
      },
      reorderRepositoryByDrop: (draggedRepositoryId, targetRepositoryId, orderedRepositoryIds) => {
        calls.push(
          `reorderRepositoryByDrop:${draggedRepositoryId}:${targetRepositoryId}:${orderedRepositoryIds.join(',')}`,
        );
      },
      upsertRepositoryByRemoteUrl: async (remoteUrl, existingRepositoryId) => {
        calls.push(`upsertRepositoryByRemoteUrl:${remoteUrl}:${existingRepositoryId ?? ''}`);
      },
      archiveRepositoryById: async (repositoryId) => {
        calls.push(`archiveRepositoryById:${repositoryId}`);
      },
    },
    controlActions: {
      interruptConversation: async (sessionId) => {
        calls.push(`interruptConversation:${sessionId}`);
      },
      toggleGatewayProfiler: async () => {
        calls.push('toggleGatewayProfiler');
      },
      toggleGatewayStatusTimeline: async () => {
        calls.push('toggleGatewayStatusTimeline');
      },
      toggleGatewayRenderTrace: async (conversationId) => {
        calls.push(`toggleGatewayRenderTrace:${conversationId ?? 'null'}`);
      },
      refreshAllConversationTitles: async () => {
        calls.push('refreshAllConversationTitles');
      },
    },
    taskPaneActions: {
      runTaskPaneAction: (action: TaskPaneAction) => {
        calls.push(`runTaskPaneAction:${action}`);
      },
      openTaskEditPrompt: (taskId) => {
        calls.push(`openTaskEditPrompt:${taskId}`);
      },
      reorderTaskByDrop: (draggedTaskId, targetTaskId) => {
        calls.push(`reorderTaskByDrop:${draggedTaskId}:${targetTaskId}`);
      },
    },
    taskPaneShortcuts: {
      handleInput: (input) => {
        calls.push(`handleTaskPaneShortcutInput:${input.toString('utf8')}`);
        return true;
      },
    },
    orderedActiveRepositoryIds: () => ['repository-1', 'repository-2'],
  });

  await actions.activateConversation('session-1');
  await actions.createAndActivateConversationInDirectory('directory-1', 'codex');
  await actions.openOrCreateCritiqueConversationInDirectory('directory-1');
  await actions.takeoverConversation('session-1');
  await actions.archiveConversation('session-2');
  await actions.addDirectoryByPath('/tmp/project');
  await actions.closeDirectory('directory-2');
  actions.openRepositoryPromptForCreate();
  actions.openRepositoryPromptForEdit('repository-1');
  actions.reorderRepositoryByDrop('repository-1', 'repository-2');
  await actions.upsertRepositoryByRemoteUrl('https://github.com/acme/repo', 'repository-1');
  await actions.upsertRepositoryByRemoteUrl('https://github.com/acme/repo-2');
  await actions.archiveRepositoryById('repository-2');
  await actions.interruptConversation('session-3');
  await actions.toggleGatewayProfiler();
  await actions.toggleGatewayStatusTimeline();
  await actions.toggleGatewayRenderTrace('session-3');
  await actions.refreshAllConversationTitles();
  actions.runTaskPaneAction('task.edit');
  actions.openTaskEditPrompt('task-4');
  actions.reorderTaskByDrop('task-4', 'task-5');
  const handledShortcut = actions.handleTaskPaneShortcutInput(Buffer.from('k', 'utf8'));

  assert.deepEqual(calls, [
    'activateConversation:session-1',
    'createAndActivateConversationInDirectory:directory-1:codex',
    'openOrCreateCritiqueConversationInDirectory:directory-1',
    'takeoverConversation:session-1',
    'archiveConversation:session-2',
    'addDirectoryByPath:/tmp/project',
    'closeDirectory:directory-2',
    'openRepositoryPromptForCreate',
    'openRepositoryPromptForEdit:repository-1',
    'reorderRepositoryByDrop:repository-1:repository-2:repository-1,repository-2',
    'upsertRepositoryByRemoteUrl:https://github.com/acme/repo:repository-1',
    'upsertRepositoryByRemoteUrl:https://github.com/acme/repo-2:',
    'archiveRepositoryById:repository-2',
    'interruptConversation:session-3',
    'toggleGatewayProfiler',
    'toggleGatewayStatusTimeline',
    'toggleGatewayRenderTrace:session-3',
    'refreshAllConversationTitles',
    'runTaskPaneAction:task.edit',
    'openTaskEditPrompt:task-4',
    'reorderTaskByDrop:task-4:task-5',
    'handleTaskPaneShortcutInput:k',
  ]);
  assert.equal(handledShortcut, true);
});
