import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { computeDualPaneLayout } from '../src/mux/dual-pane-core.ts';
import { RuntimeMainPaneInput } from '../src/services/runtime-main-pane-input.ts';

type RuntimeMainPaneInputOptions = ConstructorParameters<typeof RuntimeMainPaneInput>[0];

interface CapturedMainPaneOptions {
  getMainPaneMode(): string;
  getProjectPaneSnapshot(): object | null;
  getProjectPaneScrollTop(): number;
  actionAtCell(rowIndex: number, colIndex: number): string | null;
  actionAtRow(rowIndex: number): string | null;
  clearTaskEditClickState(): void;
  clearRepositoryEditClickState(): void;
  clearHomePaneDragState(): void;
  getTaskRepositoryDropdownOpen(): boolean;
  setTaskRepositoryDropdownOpen(open: boolean): void;
  taskIdAtRow(rowIndex: number): string | null;
  repositoryIdAtRow(rowIndex: number): string | null;
  rowTextAtRow?(rowIndex: number): string | null;
  runTaskPaneAction(action: 'task.ready' | 'task.draft' | 'task.complete'): void;
  getTaskEditClickState(): { entityId: string; atMs: number } | null;
  getRepositoryEditClickState(): { entityId: string; atMs: number } | null;
  clearTaskPaneNotice(): void;
  setTaskEditClickState(next: { entityId: string; atMs: number } | null): void;
  setRepositoryEditClickState(next: { entityId: string; atMs: number } | null): void;
  setHomePaneDragState(
    next: {
      kind: 'task' | 'repository';
      itemId: string;
      startedRowIndex: number;
      latestRowIndex: number;
      hasDragged: boolean;
    } | null,
  ): void;
  openTaskEditPrompt(taskId: string): void;
  openRepositoryPromptForEdit(repositoryId: string): void;
  markDirty(): void;
}

interface CapturedPointerOptions {
  getPaneDividerDragActive(): boolean;
  setPaneDividerDragActive(active: boolean): void;
  getHomePaneDragState(): object | null;
  setHomePaneDragState(next: object | null): void;
  getMainPaneMode(): string;
  taskIdAtRow(index: number): string | null;
  repositoryIdAtRow(index: number): string | null;
  reorderTaskByDrop(draggedTaskId: string, targetTaskId: string): void;
  reorderRepositoryByDrop(draggedRepositoryId: string, targetRepositoryId: string): void;
  onProjectWheel(delta: number): void;
  onHomeWheel(delta: number): void;
  markDirty(): void;
}

interface CapturedSelectionOptions {
  getSelection(): object | null;
  setSelection(next: object | null): void;
  getSelectionDrag(): object | null;
  setSelectionDrag(next: object | null): void;
  pinViewportForSelection(): void;
  releaseViewportPinForSelection(): void;
  markDirty(): void;
}

interface CapturedRouterOptions {
  getMainPaneMode(): string;
  getHomePaneSelectionContext?(): {
    viewportTop: number;
    totalRows: number;
    resolveSelectionText: (selection: {
      anchor: { rowAbs: number; col: number };
      focus: { rowAbs: number; col: number };
      text: string;
    }) => string;
  } | null;
}

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

function createMainPaneInputOptions(
  workspace: WorkspaceModel,
): ConstructorParameters<typeof RuntimeMainPaneInput>[0] {
  return {
    workspace,
    leftRailPointerInput: {
      handlePointerClick: () => false,
    },
    workspaceActions: {
      runTaskPaneAction: () => {},
      openTaskEditPrompt: () => {},
      openRepositoryPromptForEdit: () => {},
      reorderTaskByDrop: () => {},
      reorderRepositoryByDrop: () => {},
    },
    projectPaneActionAtRow: () => null,
    openNewThreadPrompt: () => {},
    queueCloseDirectory: () => {},
    selectTaskById: () => {},
    selectRepositoryById: () => {},
    taskPaneActionAtCell: () => null,
    taskPaneActionAtRow: () => null,
    taskPaneTaskIdAtRow: () => null,
    taskPaneRepositoryIdAtRow: () => null,
    applyPaneDividerAtCol: () => {},
    pinViewportForSelection: () => {},
    releaseViewportPinForSelection: () => {},
    markDirty: () => {},
    homePaneEditDoubleClickWindowMs: 350,
  };
}

function expectCaptured<T>(value: T, label: string): NonNullable<T> {
  assert.notEqual(value, null, label);
  if (value === null) {
    throw new Error(label);
  }
  return value as NonNullable<T>;
}

void test('runtime main pane input composes constructors and delegates token routing', () => {
  const workspace = createWorkspace();
  const calls: string[] = [];
  const options = {
    ...createMainPaneInputOptions(workspace),
    workspaceActions: {
      runTaskPaneAction: (
        action: Parameters<RuntimeMainPaneInputOptions['workspaceActions']['runTaskPaneAction']>[0],
      ) => {
        calls.push(`runTaskPaneAction:${action}`);
      },
      openTaskEditPrompt: (
        taskId: Parameters<
          RuntimeMainPaneInputOptions['workspaceActions']['openTaskEditPrompt']
        >[0],
      ) => {
        calls.push(`openTaskEditPrompt:${taskId}`);
      },
      openRepositoryPromptForEdit: (
        repositoryId: Parameters<
          RuntimeMainPaneInputOptions['workspaceActions']['openRepositoryPromptForEdit']
        >[0],
      ) => {
        calls.push(`openRepositoryPromptForEdit:${repositoryId}`);
      },
      reorderTaskByDrop: (
        draggedTaskId: Parameters<
          RuntimeMainPaneInputOptions['workspaceActions']['reorderTaskByDrop']
        >[0],
        targetTaskId: Parameters<
          RuntimeMainPaneInputOptions['workspaceActions']['reorderTaskByDrop']
        >[1],
      ) => {
        calls.push(`reorderTaskByDrop:${draggedTaskId}:${targetTaskId}`);
      },
      reorderRepositoryByDrop: (
        draggedRepositoryId: Parameters<
          RuntimeMainPaneInputOptions['workspaceActions']['reorderRepositoryByDrop']
        >[0],
        targetRepositoryId: Parameters<
          RuntimeMainPaneInputOptions['workspaceActions']['reorderRepositoryByDrop']
        >[1],
      ) => {
        calls.push(`reorderRepositoryByDrop:${draggedRepositoryId}:${targetRepositoryId}`);
      },
    },
    taskPaneActionAtCell: (
      _view: WorkspaceModel['latestTaskPaneView'],
      row: number,
      col: number,
    ) => {
      calls.push(`taskPaneActionAtCell:${row}:${col}`);
      return null;
    },
    taskPaneActionAtRow: (_view: WorkspaceModel['latestTaskPaneView'], row: number) => {
      calls.push(`taskPaneActionAtRow:${row}`);
      return null;
    },
    taskPaneTaskIdAtRow: (_view: WorkspaceModel['latestTaskPaneView'], row: number) => {
      calls.push(`taskPaneTaskIdAtRow:${row}`);
      return row === 0 ? 'task-1' : null;
    },
    taskPaneRepositoryIdAtRow: (_view: WorkspaceModel['latestTaskPaneView'], row: number) => {
      calls.push(`taskPaneRepositoryIdAtRow:${row}`);
      return row === 0 ? 'repo-1' : null;
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    pinViewportForSelection: () => {
      calls.push('pinViewportForSelection');
    },
    releaseViewportPinForSelection: () => {
      calls.push('releaseViewportForSelection');
    },
  } as const;
  const routeResult = {
    routedTokens: [],
    snapshotForInput: null,
  };
  let capturedNowMs = 0;
  let createInputTokenRouterCalls = 0;
  let leftPointerHandled = false;
  let capturedMainPaneOptions: CapturedMainPaneOptions | null = null;
  let capturedPointerOptions: CapturedPointerOptions | null = null;
  let capturedSelectionOptions: CapturedSelectionOptions | null = null;
  let capturedRouterOptions: CapturedRouterOptions | null = null;
  const runtimeMainPaneInput = new RuntimeMainPaneInput(
    {
      ...options,
      nowMs: () => 1234,
      leftRailPointerInput: {
        handlePointerClick: () => {
          leftPointerHandled = true;
          return false;
        },
      },
    },
    {
      createMainPanePointerInput: (nextMainPaneOptions) => {
        capturedMainPaneOptions = nextMainPaneOptions as unknown as CapturedMainPaneOptions;
        capturedNowMs = nextMainPaneOptions.nowMs();
        return {
          handleProjectPanePointerClick: () => false,
          handleHomePanePointerClick: () => false,
        };
      },
      createPointerRoutingInput: (pointerRoutingOptions) => {
        capturedPointerOptions = pointerRoutingOptions as unknown as CapturedPointerOptions;
        return {
          handlePaneDividerDrag: () => false,
          handleHomePaneDragRelease: () => false,
          handleSeparatorPointerPress: () => false,
          handleMainPaneWheel: () => false,
          handleHomePaneDragMove: () => false,
        };
      },
      createConversationSelectionInput: (conversationSelectionOptions) => {
        capturedSelectionOptions =
          conversationSelectionOptions as unknown as CapturedSelectionOptions;
        return {
          clearSelectionOnTextToken: () => false,
          handleMouseSelection: () => false,
        };
      },
      createInputTokenRouter: (routerOptions) => {
        capturedRouterOptions = routerOptions as unknown as CapturedRouterOptions;
        createInputTokenRouterCalls += 1;
        routerOptions.leftRailPointerInput.handlePointerClick({
          clickEligible: true,
          paneRows: 1,
          leftCols: 1,
          pointerRow: 1,
          pointerCol: 1,
        });
        return {
          routeTokens: () => routeResult,
        };
      },
    },
  );

  const mainPaneOptions = expectCaptured(
    capturedMainPaneOptions as CapturedMainPaneOptions | null,
    'captured main-pane options should be set',
  );
  const pointerOptions = expectCaptured(
    capturedPointerOptions as CapturedPointerOptions | null,
    'captured pointer options should be set',
  );
  const selectionOptions = expectCaptured(
    capturedSelectionOptions as CapturedSelectionOptions | null,
    'captured selection options should be set',
  );
  const routerOptions = expectCaptured(
    capturedRouterOptions as CapturedRouterOptions | null,
    'captured token-router options should be set',
  );

  workspace.taskPaneTaskEditClickState = {
    entityId: 'task-existing',
    atMs: 1,
  };
  workspace.taskPaneRepositoryEditClickState = {
    entityId: 'repo-existing',
    atMs: 1,
  };
  workspace.homePaneDragState = {
    kind: 'task',
    itemId: 'task-existing',
    startedRowIndex: 0,
    latestRowIndex: 1,
    hasDragged: true,
  };
  workspace.taskPaneNotice = 'notice';
  workspace.taskRepositoryDropdownOpen = false;
  mainPaneOptions.getMainPaneMode();
  mainPaneOptions.getProjectPaneSnapshot();
  mainPaneOptions.getProjectPaneScrollTop();
  mainPaneOptions.actionAtCell(0, 1);
  mainPaneOptions.actionAtRow(0);
  mainPaneOptions.clearTaskEditClickState();
  mainPaneOptions.clearRepositoryEditClickState();
  mainPaneOptions.clearHomePaneDragState();
  mainPaneOptions.getTaskRepositoryDropdownOpen();
  mainPaneOptions.setTaskRepositoryDropdownOpen(true);
  mainPaneOptions.taskIdAtRow(0);
  mainPaneOptions.repositoryIdAtRow(0);
  mainPaneOptions.rowTextAtRow?.(0);
  mainPaneOptions.runTaskPaneAction('task.ready');
  mainPaneOptions.getTaskEditClickState();
  mainPaneOptions.getRepositoryEditClickState();
  mainPaneOptions.clearTaskPaneNotice();
  mainPaneOptions.setTaskEditClickState({ entityId: 'task-next', atMs: 2 });
  mainPaneOptions.setRepositoryEditClickState({ entityId: 'repo-next', atMs: 2 });
  mainPaneOptions.setHomePaneDragState({
    kind: 'repository',
    itemId: 'repo-next',
    startedRowIndex: 2,
    latestRowIndex: 3,
    hasDragged: false,
  });
  mainPaneOptions.openTaskEditPrompt('task-1');
  mainPaneOptions.openRepositoryPromptForEdit('repo-1');
  mainPaneOptions.markDirty();

  workspace.paneDividerDragActive = false;
  pointerOptions.getPaneDividerDragActive();
  pointerOptions.setPaneDividerDragActive(true);
  workspace.homePaneDragState = {
    kind: 'task',
    itemId: 'task-next',
    startedRowIndex: 3,
    latestRowIndex: 4,
    hasDragged: true,
  };
  pointerOptions.getHomePaneDragState();
  pointerOptions.setHomePaneDragState(null);
  pointerOptions.getMainPaneMode();
  pointerOptions.taskIdAtRow(0);
  pointerOptions.repositoryIdAtRow(0);
  pointerOptions.reorderTaskByDrop('task-1', 'task-2');
  pointerOptions.reorderRepositoryByDrop('repo-1', 'repo-2');
  workspace.projectPaneScrollTop = 2;
  pointerOptions.onProjectWheel(-10);
  workspace.taskPaneScrollTop = 2;
  pointerOptions.onHomeWheel(-10);
  pointerOptions.markDirty();

  selectionOptions.getSelection();
  selectionOptions.setSelection(null);
  selectionOptions.getSelectionDrag();
  selectionOptions.setSelectionDrag(null);
  selectionOptions.pinViewportForSelection();
  selectionOptions.releaseViewportPinForSelection();
  selectionOptions.markDirty();
  routerOptions.getMainPaneMode();
  workspace.latestTaskPaneView = {
    rows: ['\u001b[31m hello world \u001b[0m'],
    plainRows: [' hello world '],
    taskIds: [null],
    repositoryIds: [null],
    actions: [null],
    actionCells: [null],
    top: 3,
    selectedRepositoryId: null,
  };
  const homeSelectionContext = routerOptions.getHomePaneSelectionContext?.() ?? null;
  assert.notEqual(homeSelectionContext, null);
  assert.equal(homeSelectionContext?.viewportTop, 3);
  assert.equal(homeSelectionContext?.totalRows, 4);
  assert.equal(
    homeSelectionContext?.resolveSelectionText({
      anchor: { rowAbs: 3, col: 1 },
      focus: { rowAbs: 3, col: 5 },
      text: '',
    }),
    'hello',
  );
  workspace.latestTaskPaneView = {
    rows: ['\u001b[31m ansi line \u001b[0m'],
    taskIds: [null],
    repositoryIds: [null],
    actions: [null],
    actionCells: [null],
    top: 0,
    selectedRepositoryId: null,
  };
  const ansiFallbackContext = routerOptions.getHomePaneSelectionContext?.() ?? null;
  assert.equal(
    ansiFallbackContext?.resolveSelectionText({
      anchor: { rowAbs: 0, col: 1 },
      focus: { rowAbs: 0, col: 4 },
      text: '',
    }),
    'ansi',
  );

  const result = runtimeMainPaneInput.routeTokens({
    tokens: [],
    layout: computeDualPaneLayout(80, 24),
    conversation: null,
    snapshotForInput: null,
  });

  assert.equal(capturedNowMs, 1234);
  assert.equal(createInputTokenRouterCalls, 1);
  assert.equal(leftPointerHandled, true);
  assert.equal(workspace.taskPaneTaskEditClickState?.entityId, 'task-next');
  assert.equal(workspace.taskPaneRepositoryEditClickState?.entityId, 'repo-next');
  assert.equal(workspace.taskRepositoryDropdownOpen, true);
  assert.equal(workspace.paneDividerDragActive, true);
  assert.equal(workspace.projectPaneScrollTop, 0);
  assert.equal(workspace.taskPaneScrollTop, 0);
  assert.ok(calls.includes('taskPaneActionAtCell:0:1'));
  assert.ok(calls.includes('taskPaneActionAtRow:0'));
  assert.ok(calls.includes('runTaskPaneAction:task.ready'));
  assert.ok(calls.includes('openTaskEditPrompt:task-1'));
  assert.ok(calls.includes('openRepositoryPromptForEdit:repo-1'));
  assert.ok(calls.includes('reorderTaskByDrop:task-1:task-2'));
  assert.ok(calls.includes('reorderRepositoryByDrop:repo-1:repo-2'));
  assert.equal(result, routeResult);
});

void test('runtime main pane input default dependency path is usable', () => {
  const workspace = createWorkspace();
  const runtimeMainPaneInput = new RuntimeMainPaneInput(createMainPaneInputOptions(workspace));

  const result = runtimeMainPaneInput.routeTokens({
    tokens: [],
    layout: computeDualPaneLayout(100, 30),
    conversation: null,
    snapshotForInput: null,
  });

  assert.deepEqual(result, {
    routedTokens: [],
    snapshotForInput: null,
  });
});

void test('runtime main pane input uses default nowMs when override is omitted', () => {
  const workspace = createWorkspace();
  let observedNowMs = 0;
  new RuntimeMainPaneInput(createMainPaneInputOptions(workspace), {
    createMainPanePointerInput: (options) => {
      observedNowMs = options.nowMs();
      return {
        handleProjectPanePointerClick: () => false,
        handleHomePanePointerClick: () => false,
      };
    },
    createPointerRoutingInput: () => ({
      handlePaneDividerDrag: () => false,
      handleHomePaneDragRelease: () => false,
      handleSeparatorPointerPress: () => false,
      handleMainPaneWheel: () => false,
      handleHomePaneDragMove: () => false,
    }),
    createConversationSelectionInput: () => ({
      clearSelectionOnTextToken: () => false,
      handleMouseSelection: () => false,
    }),
    createInputTokenRouter: () => ({
      routeTokens: (input) => ({
        routedTokens: [...input.tokens],
        snapshotForInput: input.snapshotForInput,
      }),
    }),
  });

  assert.equal(Number.isFinite(observedNowMs), true);
});
