import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';

void test('workspace model initializes defaults and preserves constructor state', () => {
  const workspace = new WorkspaceModel({
    activeDirectoryId: 'dir-a',
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
    repositoriesCollapsed: true,
    shortcutsCollapsed: false,
  });

  assert.equal(workspace.activeDirectoryId, 'dir-a');
  assert.deepEqual(workspace.leftNavSelection, { kind: 'home' });
  assert.equal(workspace.mainPaneMode, 'conversation');
  assert.equal(workspace.activeRepositorySelectionId, null);
  assert.equal(workspace.repositoryToggleChordPrefixAtMs, null);
  assert.equal(workspace.projectPaneSnapshot, null);
  assert.equal(workspace.projectPaneScrollTop, 0);
  assert.equal(workspace.taskPaneScrollTop, 0);
  assert.equal(workspace.taskPaneSelectedTaskId, null);
  assert.equal(workspace.taskPaneSelectedRepositoryId, null);
  assert.equal(workspace.taskRepositoryDropdownOpen, false);
  assert.deepEqual(workspace.taskEditorTarget, { kind: 'draft' });
  assert.equal(workspace.taskPaneSelectionFocus, 'task');
  assert.equal(workspace.taskPaneNotice, null);
  assert.equal(workspace.taskPaneTaskEditClickState, null);
  assert.equal(workspace.taskPaneRepositoryEditClickState, null);
  assert.equal(workspace.homePaneDragState, null);
  assert.equal(workspace.selection, null);
  assert.equal(workspace.selectionDrag, null);
  assert.equal(workspace.selectionPinnedFollowOutput, null);
  assert.equal(workspace.repositoryPrompt, null);
  assert.equal(workspace.newThreadPrompt, null);
  assert.equal(workspace.addDirectoryPrompt, null);
  assert.equal(workspace.taskEditorPrompt, null);
  assert.equal(workspace.conversationTitleEdit, null);
  assert.equal(workspace.conversationTitleEditClickState, null);
  assert.equal(workspace.paneDividerDragActive, false);
  assert.deepEqual(workspace.previousSelectionRows, []);
  assert.deepEqual(workspace.latestRailViewRows, []);
  assert.equal(workspace.repositoriesCollapsed, true);
  assert.equal(workspace.shortcutsCollapsed, false);
});

void test('workspace model left-nav transition methods own state updates', () => {
  const workspace = new WorkspaceModel({
    activeDirectoryId: 'dir-a',
    leftNavSelection: {
      kind: 'project',
      directoryId: 'dir-a',
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

  workspace.selectLeftNavHome();
  assert.deepEqual(workspace.leftNavSelection, { kind: 'home' });

  workspace.selectLeftNavRepository('repo-a');
  assert.deepEqual(workspace.leftNavSelection, {
    kind: 'repository',
    repositoryId: 'repo-a',
  });
  assert.equal(workspace.activeRepositorySelectionId, 'repo-a');

  workspace.selectLeftNavProject('dir-b', 'repo-b');
  assert.deepEqual(workspace.leftNavSelection, {
    kind: 'project',
    directoryId: 'dir-b',
  });
  assert.equal(workspace.activeRepositorySelectionId, 'repo-b');

  workspace.selectLeftNavConversation('session-a');
  assert.deepEqual(workspace.leftNavSelection, {
    kind: 'conversation',
    sessionId: 'session-a',
  });
});
