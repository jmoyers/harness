import { classifyPaneAt, parseMuxInputChunk, type computeDualPaneLayout } from '../../mux/dual-pane-core.ts';
import { routeInputTokensForConversation } from '../../mux/live-mux/input-forwarding.ts';
import { normalizeMuxKeyboardInputForPty } from '../../mux/input-shortcuts.ts';
import { handleHomePaneDragRelease } from '../../mux/live-mux/home-pane-drop.ts';
import { handleHomePanePointerClick } from '../../mux/live-mux/home-pane-pointer.ts';
import {
  handleHomePaneDragMove,
  handleMainPaneWheelInput,
  handlePaneDividerDragInput,
  handleSeparatorPointerPress,
} from '../../mux/live-mux/pointer-routing.ts';
import { handleProjectPaneActionClick } from '../../mux/live-mux/project-pane-pointer.ts';
import { extractFocusEvents } from '../../mux/live-mux/startup-utils.ts';
import {
  compareSelectionPoints,
  hasAltModifier,
  isCopyShortcutInput,
  isLeftButtonPress,
  isMotionMouseCode,
  pointFromMouseEvent,
  reduceConversationMouseSelection,
  selectionText,
  writeTextToClipboard,
  type PaneSelection,
} from '../../mux/live-mux/selection.ts';
import {
  taskFocusedPaneActionAtCell,
  taskFocusedPaneActionAtRow,
  taskFocusedPaneRepositoryIdAtRow,
  taskFocusedPaneTaskIdAtRow,
} from '../../mux/task-focused-pane.ts';
import type { WorkspaceModel } from '../../domain/workspace.ts';
import type { TerminalSnapshotFrameCore } from '../../terminal/snapshot-oracle.ts';
import { ConversationInputForwarder } from '../../../packages/harness-ui/src/interaction/conversation-input-forwarder.ts';
import { ConversationSelectionInput } from '../../../packages/harness-ui/src/interaction/conversation-selection-input.ts';
import { InputPreflight } from '../../../packages/harness-ui/src/interaction/input-preflight.ts';
import { InputTokenRouter } from '../../../packages/harness-ui/src/interaction/input-token-router.ts';
import { MainPanePointerInput } from '../../../packages/harness-ui/src/interaction/main-pane-pointer-input.ts';
import { PointerRoutingInput } from '../../../packages/harness-ui/src/interaction/pointer-routing-input.ts';
import type { HandlePointerClickInput } from '../../../packages/harness-ui/src/interaction/rail-pointer-input.ts';

interface ActiveConversationLike {
  readonly sessionId: string;
  readonly directoryId: string | null;
  readonly controller: unknown | null;
  readonly oracle: {
    snapshotWithoutHash(): TerminalSnapshotFrameCore;
    isMouseTrackingEnabled(): boolean;
    scrollViewport(deltaRows: number): void;
    selectionText(anchor: PaneSelection['anchor'], focus: PaneSelection['focus']): string;
  };
}

interface TuiMainPaneTaskActions {
  selectTaskById(taskId: string): void;
  selectRepositoryById(repositoryId: string): void;
  runTaskPaneAction(action: 'task.ready' | 'task.draft' | 'task.complete'): void;
  openTaskEditPrompt(taskId: string): void;
  reorderTaskByDrop(draggedTaskId: string, targetTaskId: string): void;
  reorderRepositoryByDrop(draggedRepositoryId: string, targetRepositoryId: string): void;
  handleShortcutInput(input: Buffer): boolean;
}

type WorkspaceProjectPaneSnapshot = NonNullable<WorkspaceModel['projectPaneSnapshot']>;

interface TuiMainPaneProjectActions {
  projectPaneActionAtRow: (
    snapshot: WorkspaceProjectPaneSnapshot,
    rightCols: number,
    paneRows: number,
    projectPaneScrollTop: number,
    rowIndex: number,
  ) => string | null;
  refreshGitHubReview(directoryId: string): void;
  toggleGitHubNode(directoryId: string, nodeId: string): boolean;
  openNewThreadPrompt(directoryId: string): void;
  queueCloseDirectory(directoryId: string): void;
}

interface TuiMainPaneRepositoryActions {
  openRepositoryPromptForEdit(repositoryId: string): void;
}

interface TuiMainPaneSelectionControls {
  pinViewportForSelection(): void;
  releaseViewportPinForSelection(): void;
}

interface TuiMainPaneRuntimeControls<TConversation extends ActiveConversationLike> {
  isShuttingDown(): boolean;
  getActiveConversation(): TConversation | null;
  sendInputToSession(sessionId: string, input: Buffer): void;
  isControlledByLocalHuman(input: {
    readonly conversation: TConversation;
    readonly controllerId: string;
  }): boolean;
  enableInputMode(): void;
}

interface TuiMainPaneModalRouting {
  routeModalInput(input: Buffer): boolean;
}

interface TuiMainPaneShortcutHandlers {
  handleRepositoryFoldInput(input: Buffer): boolean;
  handleGlobalShortcutInput(input: Buffer): boolean;
}

interface TuiMainPaneLayoutActions {
  applyPaneDividerAtCol(col: number): void;
}

interface TuiLeftRailPointerInput {
  handlePointerClick(input: HandlePointerClickInput): boolean;
}

type RuntimeLayout = ReturnType<typeof computeDualPaneLayout>;

export interface TuiMainPaneInteractionsOptions<TConversation extends ActiveConversationLike> {
  readonly workspace: WorkspaceModel;
  readonly controllerId: string;
  readonly getLayout: () => RuntimeLayout;
  readonly noteGitActivity: (directoryId: string | null) => void;
  readonly getInputRemainder: () => string;
  readonly setInputRemainder: (next: string) => void;
  readonly leftRailPointerInput: TuiLeftRailPointerInput;
  readonly project: TuiMainPaneProjectActions;
  readonly task: TuiMainPaneTaskActions;
  readonly repository: TuiMainPaneRepositoryActions;
  readonly selection: TuiMainPaneSelectionControls;
  readonly runtime: TuiMainPaneRuntimeControls<TConversation>;
  readonly modal: TuiMainPaneModalRouting;
  readonly shortcuts: TuiMainPaneShortcutHandlers;
  readonly layout: TuiMainPaneLayoutActions;
  readonly markDirty: () => void;
  readonly nowMs?: () => number;
  readonly homePaneEditDoubleClickWindowMs?: number;
  readonly writeTextToClipboard?: (text: string) => boolean;
}

export interface TuiMainPaneInteractions {
  readonly handleInput: (input: Buffer) => void;
  readonly mainPaneInputTokenRouter: InputTokenRouter;
  readonly inputPreflight: InputPreflight;
}

const DEFAULT_HOME_PANE_EDIT_DOUBLE_CLICK_WINDOW_MS = 350;

function stripAnsiSgr(value: string): string {
  let output = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index]!;
    if (char === '\u001b' && value[index + 1] === '[') {
      index += 2;
      while (index < value.length) {
        const nextChar = value[index]!;
        if (nextChar >= '@' && nextChar <= '~') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function selectionTextFromHomePaneRows(
  rows: readonly string[],
  viewportTop: number,
  selection: PaneSelection,
): string {
  const normalized =
    compareSelectionPoints(selection.anchor, selection.focus) <= 0
      ? {
          start: selection.anchor,
          end: selection.focus,
        }
      : {
          start: selection.focus,
          end: selection.anchor,
        };
  const selectedRows: string[] = [];
  for (let rowAbs = normalized.start.rowAbs; rowAbs <= normalized.end.rowAbs; rowAbs += 1) {
    const rowIndex = rowAbs - viewportTop;
    const rowText = rows[rowIndex] ?? '';
    const rowStart = rowAbs === normalized.start.rowAbs ? normalized.start.col : 0;
    const rowEnd = rowAbs === normalized.end.rowAbs ? normalized.end.col : rowText.length - 1;
    if (rowEnd < rowStart || rowStart >= rowText.length) {
      selectedRows.push('');
      continue;
    }
    const start = Math.max(0, rowStart);
    const endExclusive = Math.min(rowText.length, rowEnd + 1);
    selectedRows.push(rowText.slice(start, endExclusive));
  }
  return selectedRows.join('\n');
}

export function createTuiMainPaneInteractions<TConversation extends ActiveConversationLike>(
  options: TuiMainPaneInteractionsOptions<TConversation>,
): TuiMainPaneInteractions {
  const nowMs = options.nowMs ?? (() => Date.now());
  const homePaneEditDoubleClickWindowMs =
    options.homePaneEditDoubleClickWindowMs ?? DEFAULT_HOME_PANE_EDIT_DOUBLE_CLICK_WINDOW_MS;
  const writeClipboard = options.writeTextToClipboard ?? writeTextToClipboard;

  const mainPanePointerInput = new MainPanePointerInput<WorkspaceProjectPaneSnapshot>(
    {
      getMainPaneMode: () => options.workspace.mainPaneMode,
      getProjectPaneSnapshot: () => options.workspace.projectPaneSnapshot,
      getProjectPaneScrollTop: () => options.workspace.projectPaneScrollTop,
      projectPaneActionAtRow: options.project.projectPaneActionAtRow,
      openNewThreadPrompt: options.project.openNewThreadPrompt,
      queueCloseDirectory: options.project.queueCloseDirectory,
      actionAtCell: (rowIndex, colIndex) =>
        taskFocusedPaneActionAtCell(options.workspace.latestTaskPaneView, rowIndex, colIndex),
      actionAtRow: (rowIndex) =>
        taskFocusedPaneActionAtRow(options.workspace.latestTaskPaneView, rowIndex),
      clearTaskEditClickState: () => {
        options.workspace.taskPaneTaskEditClickState = null;
      },
      clearRepositoryEditClickState: () => {
        options.workspace.taskPaneRepositoryEditClickState = null;
      },
      clearHomePaneDragState: () => {
        options.workspace.homePaneDragState = null;
      },
      getTaskRepositoryDropdownOpen: () => options.workspace.taskRepositoryDropdownOpen,
      setTaskRepositoryDropdownOpen: (open) => {
        options.workspace.taskRepositoryDropdownOpen = open;
      },
      taskIdAtRow: (rowIndex) =>
        taskFocusedPaneTaskIdAtRow(options.workspace.latestTaskPaneView, rowIndex),
      repositoryIdAtRow: (rowIndex) =>
        taskFocusedPaneRepositoryIdAtRow(options.workspace.latestTaskPaneView, rowIndex),
      rowTextAtRow: (rowIndex) => options.workspace.latestTaskPaneView.plainRows?.[rowIndex] ?? null,
      selectTaskById: options.task.selectTaskById,
      selectRepositoryById: options.task.selectRepositoryById,
      runTaskPaneAction: options.task.runTaskPaneAction,
      nowMs,
      homePaneEditDoubleClickWindowMs,
      getTaskEditClickState: () => options.workspace.taskPaneTaskEditClickState,
      getRepositoryEditClickState: () => options.workspace.taskPaneRepositoryEditClickState,
      clearTaskPaneNotice: () => {
        options.workspace.taskPaneNotice = null;
      },
      setTaskEditClickState: (next) => {
        options.workspace.taskPaneTaskEditClickState = next;
      },
      setRepositoryEditClickState: (next) => {
        options.workspace.taskPaneRepositoryEditClickState = next;
      },
      setHomePaneDragState: (next) => {
        options.workspace.homePaneDragState = next;
      },
      openTaskEditPrompt: options.task.openTaskEditPrompt,
      openRepositoryPromptForEdit: options.repository.openRepositoryPromptForEdit,
      markDirty: options.markDirty,
    },
    {
      handleProjectPaneActionClick: (input) =>
        handleProjectPaneActionClick({
          ...input,
          handleProjectPaneAction: (action, directoryId) => {
            if (action === 'project.github.refresh') {
              options.project.refreshGitHubReview(directoryId);
              return true;
            }
            const togglePrefix = 'project.github.toggle:';
            if (!action.startsWith(togglePrefix)) {
              return false;
            }
            const nodeId = action.slice(togglePrefix.length).trim();
            if (nodeId.length === 0) {
              return false;
            }
            return options.project.toggleGitHubNode(directoryId, nodeId);
          },
        }),
      handleHomePanePointerClick,
    },
  );

  const pointerRoutingInput = new PointerRoutingInput(
    {
      getPaneDividerDragActive: () => options.workspace.paneDividerDragActive,
      setPaneDividerDragActive: (active) => {
        options.workspace.paneDividerDragActive = active;
      },
      applyPaneDividerAtCol: options.layout.applyPaneDividerAtCol,
      getHomePaneDragState: () => options.workspace.homePaneDragState,
      setHomePaneDragState: (next) => {
        options.workspace.homePaneDragState = next;
      },
      getMainPaneMode: () => options.workspace.mainPaneMode,
      taskIdAtRow: (index) => taskFocusedPaneTaskIdAtRow(options.workspace.latestTaskPaneView, index),
      repositoryIdAtRow: (index) =>
        taskFocusedPaneRepositoryIdAtRow(options.workspace.latestTaskPaneView, index),
      reorderTaskByDrop: options.task.reorderTaskByDrop,
      reorderRepositoryByDrop: options.task.reorderRepositoryByDrop,
      onProjectWheel: (delta) => {
        options.workspace.projectPaneScrollTop = Math.max(0, options.workspace.projectPaneScrollTop + delta);
      },
      onHomeWheel: (delta) => {
        options.workspace.taskPaneScrollTop = Math.max(0, options.workspace.taskPaneScrollTop + delta);
      },
      markDirty: options.markDirty,
    },
    {
      handlePaneDividerDragInput,
      handleHomePaneDragRelease,
      handleSeparatorPointerPress,
      handleMainPaneWheelInput,
      handleHomePaneDragMove,
    },
  );

  const conversationSelectionInput = new ConversationSelectionInput(
    {
      getSelection: () => options.workspace.selection,
      setSelection: (next) => {
        options.workspace.selection = next;
      },
      getSelectionDrag: () => options.workspace.selectionDrag,
      setSelectionDrag: (next) => {
        options.workspace.selectionDrag = next;
      },
      pinViewportForSelection: options.selection.pinViewportForSelection,
      releaseViewportPinForSelection: options.selection.releaseViewportPinForSelection,
      markDirty: options.markDirty,
    },
    {
      pointFromMouseEvent,
      reduceConversationMouseSelection,
      selectionText,
    },
  );

  const mainPaneInputTokenRouter = new InputTokenRouter(
    {
      getMainPaneMode: () => options.workspace.mainPaneMode,
      getHomePaneSelectionContext: () => {
        const plainRows =
          options.workspace.latestTaskPaneView.plainRows ?? options.workspace.latestTaskPaneView.rows;
        const rows = plainRows.map((row) => stripAnsiSgr(row));
        const viewportTop = Math.max(0, options.workspace.latestTaskPaneView.top);
        return {
          viewportTop,
          totalRows: Math.max(1, viewportTop + rows.length),
          resolveSelectionText: (selection) =>
            selectionTextFromHomePaneRows(rows, viewportTop, selection),
        };
      },
      pointerRoutingInput,
      mainPanePointerInput,
      leftRailPointerInput: options.leftRailPointerInput,
      conversationSelectionInput,
    },
    {
      classifyPaneAt: (layout, col, row) =>
        classifyPaneAt(layout as Parameters<typeof classifyPaneAt>[0], col, row),
      isLeftButtonPress,
      hasAltModifier,
      hasShiftModifier: (code) => (code & 0b0000_0100) !== 0,
      isMotionMouseCode,
    },
  );

  const inputPreflight = new InputPreflight(
    {
      isShuttingDown: options.runtime.isShuttingDown,
      routeModalInput: options.modal.routeModalInput,
      handleEscapeInput: (input) => {
        if (options.workspace.selection !== null || options.workspace.selectionDrag !== null) {
          options.workspace.selection = null;
          options.workspace.selectionDrag = null;
          options.selection.releaseViewportPinForSelection();
          options.markDirty();
        }
        if (options.workspace.mainPaneMode === 'conversation') {
          const escapeTarget = options.runtime.getActiveConversation();
          if (escapeTarget !== null) {
            options.runtime.sendInputToSession(escapeTarget.sessionId, input);
          }
        }
      },
      onFocusIn: () => {
        options.runtime.enableInputMode();
        options.markDirty();
      },
      onFocusOut: () => {
        options.markDirty();
      },
      handleRepositoryFoldInput: options.shortcuts.handleRepositoryFoldInput,
      handleGlobalShortcutInput: options.shortcuts.handleGlobalShortcutInput,
      handleTaskPaneShortcutInput: (input) => {
        const handled = options.task.handleShortcutInput(input);
        if (handled && (options.workspace.selection !== null || options.workspace.selectionDrag !== null)) {
          options.workspace.selection = null;
          options.workspace.selectionDrag = null;
          options.selection.releaseViewportPinForSelection();
          options.markDirty();
        }
        return handled;
      },
      handleCopyShortcutInput: (input) => {
        if (options.workspace.selection === null || !isCopyShortcutInput(input)) {
          return false;
        }
        let textToCopy = options.workspace.selection.text;
        if (options.workspace.mainPaneMode === 'conversation') {
          const active = options.runtime.getActiveConversation();
          if (active === null) {
            return true;
          }
          const selectedFrame = active.oracle.snapshotWithoutHash();
          textToCopy = selectionText(selectedFrame, options.workspace.selection);
        }
        if (textToCopy.length === 0) {
          return true;
        }
        const copied = writeClipboard(textToCopy);
        if (copied) {
          options.markDirty();
        }
        return true;
      },
    },
    {
      extractFocusEvents,
    },
  );

  const conversationInputForwarder = new ConversationInputForwarder<
    TerminalSnapshotFrameCore,
    TConversation
  >({
    getInputRemainder: options.getInputRemainder,
    setInputRemainder: options.setInputRemainder,
    getMainPaneMode: () => options.workspace.mainPaneMode,
    getLayout: options.getLayout,
    inputTokenRouter: mainPaneInputTokenRouter,
    getActiveConversation: options.runtime.getActiveConversation,
    markDirty: options.markDirty,
    isControlledByLocalHuman: options.runtime.isControlledByLocalHuman,
    controllerId: options.controllerId,
    sendInputToSession: options.runtime.sendInputToSession,
    noteGitActivity: options.noteGitActivity,
    parseMuxInputChunk,
    routeInputTokensForConversation,
    classifyPaneAt,
    normalizeMuxKeyboardInputForPty,
  });

  const handleInput = (input: Buffer): void => {
    const sanitized = inputPreflight.nextInput(input);
    if (sanitized === null) {
      return;
    }
    conversationInputForwarder.handleInput(sanitized);
  };

  return {
    handleInput,
    mainPaneInputTokenRouter,
    inputPreflight,
  };
}
