import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTuiMainPaneInteractions } from '../src/clients/tui/main-pane-interactions.ts';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { createTaskComposerBuffer } from '../src/mux/task-composer.ts';

function emptyTaskPaneView() {
  return {
    rows: [],
    taskIds: [],
    repositoryIds: [],
    actions: [],
    actionCells: [],
    top: 0,
    selectedRepositoryId: null,
  };
}

function createWorkspace(): WorkspaceModel {
  return new WorkspaceModel({
    activeDirectoryId: 'dir-1',
    leftNavSelection: {
      kind: 'home',
    },
    latestTaskPaneView: emptyTaskPaneView(),
    taskDraftComposer: createTaskComposerBuffer(),
    repositoriesCollapsed: false,
  });
}

void test('main-pane preflight clears selection when task shortcut handles input', () => {
  const workspace = createWorkspace();
  workspace.selection = {
    anchor: { rowAbs: 0, col: 0 },
    focus: { rowAbs: 0, col: 3 },
    text: 'abc',
  };

  let released = 0;
  let markDirtyCalls = 0;

  const interactions = createTuiMainPaneInteractions({
    workspace,
    controllerId: 'controller-1',
    getLayout: () => ({
      cols: 100,
      rows: 40,
      paneRows: 39,
      statusRow: 40,
      leftCols: 30,
      rightCols: 69,
      separatorCol: 31,
      rightStartCol: 32,
    }),
    noteGitActivity: () => {},
    getInputRemainder: () => '',
    setInputRemainder: () => {},
    leftRailPointerInput: {
      handlePointerClick: () => false,
    },
    project: {
      projectPaneActionAtRow: () => null,
      refreshGitHubReview: () => {},
      toggleGitHubNode: () => false,
      openNewThreadPrompt: () => {},
      queueCloseDirectory: () => {},
    },
    task: {
      selectTaskById: () => {},
      selectRepositoryById: () => {},
      runTaskPaneAction: () => {},
      openTaskEditPrompt: () => {},
      reorderTaskByDrop: () => {},
      reorderRepositoryByDrop: () => {},
      handleShortcutInput: () => true,
    },
    repository: {
      openRepositoryPromptForEdit: () => {},
    },
    selection: {
      pinViewportForSelection: () => {},
      releaseViewportPinForSelection: () => {
        released += 1;
      },
    },
    runtime: {
      isShuttingDown: () => false,
      getActiveConversation: () => null,
      sendInputToSession: () => {},
      isControlledByLocalHuman: () => true,
      enableInputMode: () => {},
    },
    modal: {
      routeModalInput: () => false,
    },
    shortcuts: {
      handleRepositoryFoldInput: () => false,
      handleGlobalShortcutInput: () => false,
    },
    layout: {
      applyPaneDividerAtCol: () => {},
    },
    markDirty: () => {
      markDirtyCalls += 1;
    },
  });

  const sanitized = interactions.inputPreflight.nextInput(Buffer.from('x'));

  assert.equal(sanitized, null);
  assert.equal(workspace.selection, null);
  assert.equal(workspace.selectionDrag, null);
  assert.equal(released, 1);
  assert.equal(markDirtyCalls, 1);
});

void test('main-pane preflight handles copy shortcut for home selection', () => {
  const workspace = createWorkspace();
  workspace.mainPaneMode = 'home';
  workspace.selection = {
    anchor: { rowAbs: 0, col: 0 },
    focus: { rowAbs: 0, col: 4 },
    text: 'copy-me',
  };

  let copiedText: string | null = null;
  let markDirtyCalls = 0;

  const interactions = createTuiMainPaneInteractions({
    workspace,
    controllerId: 'controller-1',
    getLayout: () => ({
      cols: 100,
      rows: 40,
      paneRows: 39,
      statusRow: 40,
      leftCols: 30,
      rightCols: 69,
      separatorCol: 31,
      rightStartCol: 32,
    }),
    noteGitActivity: () => {},
    getInputRemainder: () => '',
    setInputRemainder: () => {},
    leftRailPointerInput: {
      handlePointerClick: () => false,
    },
    project: {
      projectPaneActionAtRow: () => null,
      refreshGitHubReview: () => {},
      toggleGitHubNode: () => false,
      openNewThreadPrompt: () => {},
      queueCloseDirectory: () => {},
    },
    task: {
      selectTaskById: () => {},
      selectRepositoryById: () => {},
      runTaskPaneAction: () => {},
      openTaskEditPrompt: () => {},
      reorderTaskByDrop: () => {},
      reorderRepositoryByDrop: () => {},
      handleShortcutInput: () => false,
    },
    repository: {
      openRepositoryPromptForEdit: () => {},
    },
    selection: {
      pinViewportForSelection: () => {},
      releaseViewportPinForSelection: () => {},
    },
    runtime: {
      isShuttingDown: () => false,
      getActiveConversation: () => null,
      sendInputToSession: () => {},
      isControlledByLocalHuman: () => true,
      enableInputMode: () => {},
    },
    modal: {
      routeModalInput: () => false,
    },
    shortcuts: {
      handleRepositoryFoldInput: () => false,
      handleGlobalShortcutInput: () => false,
    },
    layout: {
      applyPaneDividerAtCol: () => {},
    },
    markDirty: () => {
      markDirtyCalls += 1;
    },
    writeTextToClipboard: (text) => {
      copiedText = text;
      return true;
    },
  });

  const sanitized = interactions.inputPreflight.nextInput(Buffer.from([0x03]));

  assert.equal(sanitized, null);
  assert.equal(copiedText, 'copy-me');
  assert.equal(markDirtyCalls, 1);
});

void test('main-pane interactions forward sanitized text input to active conversation session', () => {
  const workspace = createWorkspace();
  let inputRemainder = '';
  const sent: Array<{ sessionId: string; text: string }> = [];

  const interactions = createTuiMainPaneInteractions({
    workspace,
    controllerId: 'controller-1',
    getLayout: () => ({
      cols: 100,
      rows: 40,
      paneRows: 39,
      statusRow: 40,
      leftCols: 30,
      rightCols: 69,
      separatorCol: 31,
      rightStartCol: 32,
    }),
    noteGitActivity: () => {},
    getInputRemainder: () => inputRemainder,
    setInputRemainder: (next) => {
      inputRemainder = next;
    },
    leftRailPointerInput: {
      handlePointerClick: () => false,
    },
    project: {
      projectPaneActionAtRow: () => null,
      refreshGitHubReview: () => {},
      toggleGitHubNode: () => false,
      openNewThreadPrompt: () => {},
      queueCloseDirectory: () => {},
    },
    task: {
      selectTaskById: () => {},
      selectRepositoryById: () => {},
      runTaskPaneAction: () => {},
      openTaskEditPrompt: () => {},
      reorderTaskByDrop: () => {},
      reorderRepositoryByDrop: () => {},
      handleShortcutInput: () => false,
    },
    repository: {
      openRepositoryPromptForEdit: () => {},
    },
    selection: {
      pinViewportForSelection: () => {},
      releaseViewportPinForSelection: () => {},
    },
    runtime: {
      isShuttingDown: () => false,
      getActiveConversation: () => ({
        sessionId: 'session-1',
        directoryId: 'dir-1',
        controller: null,
        oracle: {
          snapshotWithoutHash: () => ({
            rows: 1,
            cols: 1,
            activeScreen: 'primary',
            modes: {
              bracketedPaste: false,
              decMouseX10: false,
              decMouseButtonEvent: false,
              decMouseAnyEvent: false,
              decFocusTracking: false,
              decMouseSgrEncoding: false,
            },
            cursor: {
              row: 0,
              col: 0,
              visible: false,
              style: {
                shape: 'block',
                blinking: false,
              },
            },
            viewport: {
              top: 0,
              totalRows: 1,
              followOutput: true,
            },
            lines: [],
            richLines: [],
          }),
          isMouseTrackingEnabled: () => false,
          scrollViewport: () => {},
          selectionText: () => '',
        },
      }),
      sendInputToSession: (sessionId, input) => {
        sent.push({
          sessionId,
          text: input.toString('utf8'),
        });
      },
      isControlledByLocalHuman: () => true,
      enableInputMode: () => {},
    },
    modal: {
      routeModalInput: () => false,
    },
    shortcuts: {
      handleRepositoryFoldInput: () => false,
      handleGlobalShortcutInput: () => false,
    },
    layout: {
      applyPaneDividerAtCol: () => {},
    },
    markDirty: () => {},
  });

  interactions.handleInput(Buffer.from('hello'));

  assert.equal(inputRemainder, '');
  assert.deepEqual(sent, [
    {
      sessionId: 'session-1',
      text: 'hello',
    },
  ]);
});
