import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import type { PaneSelection, PaneSelectionDrag } from '../src/mux/live-mux/selection.ts';
import {
  prepareRuntimeRenderState,
  type RuntimeRenderStateOptions,
} from '../src/services/runtime-render-state.ts';

interface ConversationRecord {
  readonly id: string;
}

interface FrameRecord {
  readonly id: string;
}

const baseSelection: PaneSelection = {
  anchor: { rowAbs: 1, col: 1 },
  focus: { rowAbs: 2, col: 2 },
  text: 'selected',
};

const dragSelection: PaneSelectionDrag = {
  anchor: { rowAbs: 5, col: 3 },
  focus: { rowAbs: 6, col: 4 },
  hasDragged: true,
};

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
  });
}

void test('runtime render state returns null when no pane is active and no active conversation id exists', () => {
  const workspace = createWorkspace();
  workspace.mainPaneMode = 'conversation';

  const options: RuntimeRenderStateOptions<ConversationRecord, FrameRecord> = {
    workspace,
    directories: {
      hasDirectory: () => true,
    },
    conversations: {
      activeConversationId: null,
      getActiveConversation: () => ({ id: 'unused' }),
    },
    snapshotFrame: () => ({ id: 'frame-1' }),
    selectionVisibleRows: () => [0],
  };

  assert.equal(prepareRuntimeRenderState(options, baseSelection, null), null);
});

void test('runtime render state returns null when active conversation id exists but conversation is missing', () => {
  const workspace = createWorkspace();
  workspace.mainPaneMode = 'conversation';

  const options: RuntimeRenderStateOptions<ConversationRecord, FrameRecord> = {
    workspace,
    directories: {
      hasDirectory: () => true,
    },
    conversations: {
      activeConversationId: 'session-1',
      getActiveConversation: () => null,
    },
    snapshotFrame: () => ({ id: 'frame-1' }),
    selectionVisibleRows: () => [0],
  };

  assert.equal(prepareRuntimeRenderState(options, baseSelection, null), null);
});

void test('runtime render state builds dragged selection payload when drag is active', () => {
  const workspace = createWorkspace();
  workspace.mainPaneMode = 'conversation';
  const calls: PaneSelection[] = [];

  const options: RuntimeRenderStateOptions<ConversationRecord, FrameRecord> = {
    workspace,
    directories: {
      hasDirectory: () => true,
    },
    conversations: {
      activeConversationId: 'session-1',
      getActiveConversation: () => ({ id: 'session-1' }),
    },
    snapshotFrame: () => ({ id: 'frame-1' }),
    selectionVisibleRows: (_frame, selection) => {
      if (selection !== null) {
        calls.push(selection);
      }
      return [3, 4];
    },
  };

  const state = prepareRuntimeRenderState(options, baseSelection, dragSelection);
  if (state === null) {
    throw new Error('expected render state');
  }
  assert.equal(state.projectPaneActive, false);
  assert.equal(state.homePaneActive, false);
  assert.deepEqual(state.activeConversation, { id: 'session-1' });
  assert.deepEqual(state.rightFrame, { id: 'frame-1' });
  assert.deepEqual(state.renderSelection, {
    anchor: { rowAbs: 5, col: 3 },
    focus: { rowAbs: 6, col: 4 },
    text: '',
  });
  assert.deepEqual(state.selectionRows, [3, 4]);
  assert.deepEqual(calls, [
    {
      anchor: { rowAbs: 5, col: 3 },
      focus: { rowAbs: 6, col: 4 },
      text: '',
    },
  ]);
});

void test('runtime render state uses existing selection when no drag is active', () => {
  const workspace = createWorkspace();
  workspace.mainPaneMode = 'conversation';
  const calls: PaneSelection[] = [];

  const options: RuntimeRenderStateOptions<ConversationRecord, FrameRecord> = {
    workspace,
    directories: {
      hasDirectory: () => true,
    },
    conversations: {
      activeConversationId: 'session-1',
      getActiveConversation: () => ({ id: 'session-1' }),
    },
    snapshotFrame: () => ({ id: 'frame-1' }),
    selectionVisibleRows: (_frame, selection) => {
      if (selection !== null) {
        calls.push(selection);
      }
      return [1];
    },
  };

  const state = prepareRuntimeRenderState(options, baseSelection, null);
  if (state === null) {
    throw new Error('expected render state');
  }
  assert.deepEqual(state.renderSelection, baseSelection);
  assert.deepEqual(state.selectionRows, [1]);
  assert.deepEqual(calls, [baseSelection]);
});

void test('runtime render state allows project-pane rendering without active conversation', () => {
  const workspace = createWorkspace();
  workspace.mainPaneMode = 'project';
  workspace.activeDirectoryId = 'dir-1';

  const options: RuntimeRenderStateOptions<ConversationRecord, FrameRecord> = {
    workspace,
    directories: {
      hasDirectory: () => true,
    },
    conversations: {
      activeConversationId: null,
      getActiveConversation: () => null,
    },
    snapshotFrame: () => ({ id: 'frame-1' }),
    selectionVisibleRows: () => [9],
  };

  const state = prepareRuntimeRenderState(options, baseSelection, null);
  if (state === null) {
    throw new Error('expected render state');
  }
  assert.equal(state.projectPaneActive, true);
  assert.equal(state.homePaneActive, false);
  assert.equal(state.activeConversation, null);
  assert.equal(state.rightFrame, null);
  assert.equal(state.renderSelection, null);
  assert.deepEqual(state.selectionRows, []);
});
