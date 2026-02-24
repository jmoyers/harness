import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTuiMainPaneInteractions } from '../src/clients/tui/main-pane-interactions.ts';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { computeDualPaneLayout } from '../src/mux/dual-pane-core.ts';
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

function mouseTokenWithFinal(code: number, col: number, row: number, final: 'M' | 'm') {
  return {
    kind: 'mouse' as const,
    event: {
      sequence: `\u001b[<${code};${col};${row}${final}`,
      code,
      col,
      row,
      final,
    },
  };
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

void test('main-pane preflight handles copy shortcut for nim selection via active frame extraction', () => {
  const workspace = createWorkspace();
  workspace.enterNimPane();
  workspace.selection = {
    anchor: { rowAbs: 0, col: 0 },
    focus: { rowAbs: 0, col: 2 },
    text: '',
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
      getActiveConversation: () => ({
        sessionId: 'nim-session-1',
        directoryId: 'dir-1',
        controller: null,
        oracle: {
          snapshotWithoutHash: () => ({
            rows: 1,
            cols: 3,
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
            lines: ['nim'],
            richLines: [
              {
                wrapped: false,
                text: 'nim',
                cells: [
                  {
                    glyph: 'n',
                    width: 1,
                    continued: false,
                    style: {
                      fg: { kind: 'default' },
                      bg: { kind: 'default' },
                      bold: false,
                      dim: false,
                      italic: false,
                      underline: false,
                      inverse: false,
                    },
                  },
                  {
                    glyph: 'i',
                    width: 1,
                    continued: false,
                    style: {
                      fg: { kind: 'default' },
                      bg: { kind: 'default' },
                      bold: false,
                      dim: false,
                      italic: false,
                      underline: false,
                      inverse: false,
                    },
                  },
                  {
                    glyph: 'm',
                    width: 1,
                    continued: false,
                    style: {
                      fg: { kind: 'default' },
                      bg: { kind: 'default' },
                      bold: false,
                      dim: false,
                      italic: false,
                      underline: false,
                      inverse: false,
                    },
                  },
                ],
              },
            ],
          }),
          isMouseTrackingEnabled: () => false,
          scrollViewport: () => {},
          selectionText: () => '',
        },
      }),
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
  assert.equal(copiedText, 'nim');
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

void test('main-pane interactions route nim passthrough text and escape through callbacks', () => {
  const workspace = createWorkspace();
  workspace.enterNimPane();
  let inputRemainder = '';
  const nimInputs: string[] = [];
  const nimEscapes: string[] = [];

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
    markDirty: () => {},
    handlePassthroughTextInMainPaneMode: ({ mainPaneMode, text }) => {
      nimInputs.push(`${mainPaneMode}:${text}`);
    },
    handleEscapeInMainPaneMode: (mainPaneMode) => {
      nimEscapes.push(mainPaneMode);
    },
  });

  interactions.handleInput(Buffer.from('hello'));
  interactions.handleInput(Buffer.from('\u001b'));

  assert.equal(inputRemainder, '');
  assert.deepEqual(nimInputs, ['nim:hello']);
  assert.deepEqual(nimEscapes, ['nim']);
});

void test('main-pane token router uses home-pane selection context and strips ANSI rows', () => {
  const workspace = createWorkspace();
  workspace.mainPaneMode = 'home';
  workspace.latestTaskPaneView = {
    rows: ['\u001b[31mABCD\u001b[0m'],
    plainRows: ['\u001b[31mABCD\u001b[0m'],
    taskIds: [null],
    repositoryIds: [null],
    actions: [null],
    actionCells: [null],
    top: 10,
    selectedRepositoryId: null,
  };
  const layout = computeDualPaneLayout(100, 24);

  const interactions = createTuiMainPaneInteractions({
    workspace,
    controllerId: 'controller-1',
    getLayout: () => layout,
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
    markDirty: () => {},
  });

  interactions.mainPaneInputTokenRouter.routeTokens({
    tokens: [
      mouseTokenWithFinal(0, layout.rightStartCol, 1, 'M'),
      mouseTokenWithFinal(0, layout.rightStartCol + 2, 1, 'm'),
    ],
    layout,
    conversation: null,
    snapshotForInput: null,
  });

  assert.equal(workspace.selection?.text ?? '', 'ABC');
});

void test('main-pane token router dispatches project github actions', () => {
  const workspace = createWorkspace();
  workspace.mainPaneMode = 'project';
  workspace.projectPaneSnapshot = {
    directoryId: 'dir-1',
    path: '/tmp/dir-1',
    lines: [],
    actionBySourceLineIndex: {},
    actionLineIndexByKind: {
      conversationNew: 0,
      projectClose: 1,
    },
  };
  const layout = computeDualPaneLayout(100, 24);
  const calls: string[] = [];

  const interactions = createTuiMainPaneInteractions({
    workspace,
    controllerId: 'controller-1',
    getLayout: () => layout,
    noteGitActivity: () => {},
    getInputRemainder: () => '',
    setInputRemainder: () => {},
    leftRailPointerInput: {
      handlePointerClick: () => false,
    },
    project: {
      projectPaneActionAtRow: (_snapshot, _rightCols, _paneRows, _scrollTop, rowIndex) => {
        if (rowIndex === 0) {
          return 'project.github.refresh';
        }
        if (rowIndex === 1) {
          return 'project.github.toggle:node-1';
        }
        return null;
      },
      refreshGitHubReview: (directoryId) => {
        calls.push(`refresh:${directoryId}`);
      },
      toggleGitHubNode: (directoryId, nodeId) => {
        calls.push(`toggle:${directoryId}:${nodeId}`);
        return true;
      },
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
    markDirty: () => {},
  });

  interactions.mainPaneInputTokenRouter.routeTokens({
    tokens: [
      mouseTokenWithFinal(0, layout.rightStartCol, 1, 'M'),
      mouseTokenWithFinal(0, layout.rightStartCol, 2, 'M'),
    ],
    layout,
    conversation: null,
    snapshotForInput: null,
  });

  assert.deepEqual(calls, ['refresh:dir-1', 'toggle:dir-1:node-1']);
});

void test('main-pane preflight escape and conversation-copy paths route through runtime and selection extractors', () => {
  const workspace = createWorkspace();
  workspace.mainPaneMode = 'conversation';
  workspace.selection = {
    anchor: { rowAbs: 0, col: 0 },
    focus: { rowAbs: 0, col: 3 },
    text: 'seed',
  };
  let copiedText: string | null = null;
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
      getActiveConversation: () => ({
        sessionId: 'session-1',
        directoryId: 'dir-1',
        controller: null,
        oracle: {
          snapshotWithoutHash: () => ({
            rows: 1,
            cols: 4,
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
            lines: ['seed'],
            richLines: [],
          }),
          isMouseTrackingEnabled: () => false,
          scrollViewport: () => {},
          selectionText: () => 'frame-copy',
        },
      }),
      sendInputToSession: (sessionId, input) => {
        sent.push({ sessionId, text: input.toString('utf8') });
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
    writeTextToClipboard: (text) => {
      copiedText = text;
      return true;
    },
  });

  const escaped = interactions.inputPreflight.nextInput(Buffer.from('\u001b', 'utf8'));
  assert.equal(escaped, null);
  assert.deepEqual(sent, [{ sessionId: 'session-1', text: '\u001b' }]);
  assert.equal(workspace.selection, null);

  workspace.selection = {
    anchor: { rowAbs: 0, col: 0 },
    focus: { rowAbs: 0, col: 3 },
    text: 'seed',
  };
  const copied = interactions.inputPreflight.nextInput(Buffer.from([0x03]));
  assert.equal(copied, null);
  assert.equal(copiedText, 'seed');
});
