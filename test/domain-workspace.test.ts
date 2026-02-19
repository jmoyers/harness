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
  assert.equal(workspace.commandMenu, null);
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

void test('workspace model pane transition methods own project/home state updates', () => {
  const workspace = new WorkspaceModel({
    activeDirectoryId: 'dir-a',
    leftNavSelection: {
      kind: 'conversation',
      sessionId: 'session-a',
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
  workspace.homePaneDragState = {
    kind: 'task',
    itemId: 'task-1',
    startedRowIndex: 1,
    latestRowIndex: 2,
    hasDragged: true,
  };
  workspace.taskPaneTaskEditClickState = {
    entityId: 'task-1',
    atMs: 1,
  };
  workspace.taskPaneRepositoryEditClickState = {
    entityId: 'repo-1',
    atMs: 2,
  };
  workspace.taskPaneScrollTop = 9;
  workspace.taskPaneNotice = 'notice';
  workspace.taskRepositoryDropdownOpen = true;
  workspace.projectPaneSnapshot = {
    directoryId: 'dir-a',
    path: '/repo/dir-a',
    lines: [],
    actionLineIndexByKind: {
      conversationNew: 0,
      projectClose: 1,
    },
  };
  workspace.projectPaneScrollTop = 5;

  workspace.enterProjectPane('dir-b', 'repo-b');
  assert.equal(workspace.activeDirectoryId, 'dir-b');
  assert.equal(workspace.mainPaneMode, 'project');
  assert.deepEqual(workspace.leftNavSelection, {
    kind: 'project',
    directoryId: 'dir-b',
  });
  assert.equal(workspace.activeRepositorySelectionId, 'repo-b');
  assert.equal(workspace.projectPaneScrollTop, 0);
  assert.equal(workspace.homePaneDragState, null);
  assert.equal(workspace.taskPaneTaskEditClickState, null);
  assert.equal(workspace.taskPaneRepositoryEditClickState, null);

  workspace.enterHomePane();
  assert.equal(workspace.mainPaneMode, 'home');
  assert.deepEqual(workspace.leftNavSelection, {
    kind: 'home',
  });
  assert.equal(workspace.projectPaneSnapshot, null);
  assert.equal(workspace.projectPaneScrollTop, 0);
  assert.equal(workspace.taskPaneScrollTop, 0);
  assert.equal(workspace.taskPaneNotice, null);
  assert.equal(workspace.taskRepositoryDropdownOpen, false);
  assert.equal(workspace.homePaneDragState, null);
  assert.equal(workspace.taskPaneTaskEditClickState, null);
  assert.equal(workspace.taskPaneRepositoryEditClickState, null);
});
