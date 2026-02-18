import type { WorkspaceModel } from '../domain/workspace.ts';
import type { LeftRailPointerInput } from '../ui/left-rail-pointer-input.ts';
import { MainPanePointerInput } from '../ui/main-pane-pointer-input.ts';
import { PointerRoutingInput } from '../ui/pointer-routing-input.ts';
import { ConversationSelectionInput } from '../ui/conversation-selection-input.ts';
import { InputTokenRouter } from '../ui/input-token-router.ts';

type ProjectPaneSnapshot = NonNullable<WorkspaceModel['projectPaneSnapshot']>;
type MainPanePointerInputOptions = ConstructorParameters<
  typeof MainPanePointerInput<ProjectPaneSnapshot>
>[0];
type PointerRoutingInputOptions = ConstructorParameters<typeof PointerRoutingInput>[0];
type ConversationSelectionInputOptions = ConstructorParameters<
  typeof ConversationSelectionInput
>[0];
type InputTokenRouterOptions = ConstructorParameters<typeof InputTokenRouter>[0];

type RouteTokensInput = Parameters<InputTokenRouter['routeTokens']>[0];
type RouteTokensResult = ReturnType<InputTokenRouter['routeTokens']>;

interface RuntimeMainPaneWorkspaceActions {
  runTaskPaneAction(action: 'task.ready' | 'task.draft' | 'task.complete'): void;
  openTaskEditPrompt(taskId: string): void;
  openRepositoryPromptForEdit(repositoryId: string): void;
  reorderTaskByDrop(draggedTaskId: string, targetTaskId: string): void;
  reorderRepositoryByDrop(draggedRepositoryId: string, targetRepositoryId: string): void;
}

interface RuntimeMainPaneInputOptions {
  readonly workspace: WorkspaceModel;
  readonly leftRailPointerInput: Pick<LeftRailPointerInput, 'handlePointerClick'>;
  readonly workspaceActions: RuntimeMainPaneWorkspaceActions;
  readonly projectPaneActionAtRow: MainPanePointerInputOptions['projectPaneActionAtRow'];
  readonly openNewThreadPrompt: MainPanePointerInputOptions['openNewThreadPrompt'];
  readonly queueCloseDirectory: MainPanePointerInputOptions['queueCloseDirectory'];
  readonly selectTaskById: MainPanePointerInputOptions['selectTaskById'];
  readonly selectRepositoryById: MainPanePointerInputOptions['selectRepositoryById'];
  readonly taskPaneActionAtCell: (
    view: WorkspaceModel['latestTaskPaneView'],
    rowIndex: number,
    colIndex: number,
  ) => ReturnType<MainPanePointerInputOptions['actionAtCell']>;
  readonly taskPaneActionAtRow: (
    view: WorkspaceModel['latestTaskPaneView'],
    rowIndex: number,
  ) => ReturnType<MainPanePointerInputOptions['actionAtRow']>;
  readonly taskPaneTaskIdAtRow: (
    view: WorkspaceModel['latestTaskPaneView'],
    rowIndex: number,
  ) => ReturnType<MainPanePointerInputOptions['taskIdAtRow']>;
  readonly taskPaneRepositoryIdAtRow: (
    view: WorkspaceModel['latestTaskPaneView'],
    rowIndex: number,
  ) => ReturnType<MainPanePointerInputOptions['repositoryIdAtRow']>;
  readonly applyPaneDividerAtCol: PointerRoutingInputOptions['applyPaneDividerAtCol'];
  readonly pinViewportForSelection: ConversationSelectionInputOptions['pinViewportForSelection'];
  readonly releaseViewportPinForSelection: ConversationSelectionInputOptions['releaseViewportPinForSelection'];
  readonly markDirty: () => void;
  readonly homePaneEditDoubleClickWindowMs: number;
  readonly nowMs?: () => number;
}

interface RuntimeMainPaneInputDependencies {
  readonly createMainPanePointerInput?: (
    options: MainPanePointerInputOptions,
  ) => Pick<
    MainPanePointerInput<ProjectPaneSnapshot>,
    'handleProjectPanePointerClick' | 'handleHomePanePointerClick'
  >;
  readonly createPointerRoutingInput?: (
    options: PointerRoutingInputOptions,
  ) => Pick<
    PointerRoutingInput,
    | 'handlePaneDividerDrag'
    | 'handleHomePaneDragRelease'
    | 'handleSeparatorPointerPress'
    | 'handleMainPaneWheel'
    | 'handleHomePaneDragMove'
  >;
  readonly createConversationSelectionInput?: (
    options: ConversationSelectionInputOptions,
  ) => Pick<ConversationSelectionInput, 'clearSelectionOnTextToken' | 'handleMouseSelection'>;
  readonly createInputTokenRouter?: (
    options: InputTokenRouterOptions,
  ) => Pick<InputTokenRouter, 'routeTokens'>;
}

export class RuntimeMainPaneInput {
  private readonly inputTokenRouter: Pick<InputTokenRouter, 'routeTokens'>;

  constructor(
    options: RuntimeMainPaneInputOptions,
    dependencies: RuntimeMainPaneInputDependencies = {},
  ) {
    const nowMs = options.nowMs ?? (() => Date.now());
    const createMainPanePointerInput =
      dependencies.createMainPanePointerInput ??
      ((mainPaneOptions: MainPanePointerInputOptions) =>
        new MainPanePointerInput(mainPaneOptions));
    const createPointerRoutingInput =
      dependencies.createPointerRoutingInput ??
      ((pointerOptions: PointerRoutingInputOptions) => new PointerRoutingInput(pointerOptions));
    const createConversationSelectionInput =
      dependencies.createConversationSelectionInput ??
      ((selectionOptions: ConversationSelectionInputOptions) =>
        new ConversationSelectionInput(selectionOptions));
    const createInputTokenRouter =
      dependencies.createInputTokenRouter ??
      ((tokenRouterOptions: InputTokenRouterOptions) => new InputTokenRouter(tokenRouterOptions));

    const mainPanePointerInput = createMainPanePointerInput({
      getMainPaneMode: () => options.workspace.mainPaneMode,
      getProjectPaneSnapshot: () => options.workspace.projectPaneSnapshot,
      getProjectPaneScrollTop: () => options.workspace.projectPaneScrollTop,
      projectPaneActionAtRow: options.projectPaneActionAtRow,
      openNewThreadPrompt: options.openNewThreadPrompt,
      queueCloseDirectory: options.queueCloseDirectory,
      actionAtCell: (rowIndex, colIndex) =>
        options.taskPaneActionAtCell(options.workspace.latestTaskPaneView, rowIndex, colIndex),
      actionAtRow: (rowIndex) =>
        options.taskPaneActionAtRow(options.workspace.latestTaskPaneView, rowIndex),
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
        options.taskPaneTaskIdAtRow(options.workspace.latestTaskPaneView, rowIndex),
      repositoryIdAtRow: (rowIndex) =>
        options.taskPaneRepositoryIdAtRow(options.workspace.latestTaskPaneView, rowIndex),
      selectTaskById: options.selectTaskById,
      selectRepositoryById: options.selectRepositoryById,
      runTaskPaneAction: (action) => {
        options.workspaceActions.runTaskPaneAction(action);
      },
      nowMs,
      homePaneEditDoubleClickWindowMs: options.homePaneEditDoubleClickWindowMs,
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
      openTaskEditPrompt: (taskId) => {
        options.workspaceActions.openTaskEditPrompt(taskId);
      },
      openRepositoryPromptForEdit: (repositoryId) => {
        options.workspaceActions.openRepositoryPromptForEdit(repositoryId);
      },
      markDirty: options.markDirty,
    });

    const pointerRoutingInput = createPointerRoutingInput({
      getPaneDividerDragActive: () => options.workspace.paneDividerDragActive,
      setPaneDividerDragActive: (active) => {
        options.workspace.paneDividerDragActive = active;
      },
      applyPaneDividerAtCol: options.applyPaneDividerAtCol,
      getHomePaneDragState: () => options.workspace.homePaneDragState,
      setHomePaneDragState: (next) => {
        options.workspace.homePaneDragState = next;
      },
      getMainPaneMode: () => options.workspace.mainPaneMode,
      taskIdAtRow: (index) => options.taskPaneTaskIdAtRow(options.workspace.latestTaskPaneView, index),
      repositoryIdAtRow: (index) =>
        options.taskPaneRepositoryIdAtRow(options.workspace.latestTaskPaneView, index),
      reorderTaskByDrop: (draggedTaskId, targetTaskId) => {
        options.workspaceActions.reorderTaskByDrop(draggedTaskId, targetTaskId);
      },
      reorderRepositoryByDrop: (draggedRepositoryId, targetRepositoryId) => {
        options.workspaceActions.reorderRepositoryByDrop(draggedRepositoryId, targetRepositoryId);
      },
      onProjectWheel: (delta) => {
        options.workspace.projectPaneScrollTop = Math.max(0, options.workspace.projectPaneScrollTop + delta);
      },
      onHomeWheel: (delta) => {
        options.workspace.taskPaneScrollTop = Math.max(0, options.workspace.taskPaneScrollTop + delta);
      },
      markDirty: options.markDirty,
    });

    const conversationSelectionInput = createConversationSelectionInput({
      getSelection: () => options.workspace.selection,
      setSelection: (next) => {
        options.workspace.selection = next;
      },
      getSelectionDrag: () => options.workspace.selectionDrag,
      setSelectionDrag: (next) => {
        options.workspace.selectionDrag = next;
      },
      pinViewportForSelection: options.pinViewportForSelection,
      releaseViewportPinForSelection: options.releaseViewportPinForSelection,
      markDirty: options.markDirty,
    });

    this.inputTokenRouter = createInputTokenRouter({
      getMainPaneMode: () => options.workspace.mainPaneMode,
      pointerRoutingInput,
      mainPanePointerInput,
      leftRailPointerInput: options.leftRailPointerInput,
      conversationSelectionInput,
    });
  }

  routeTokens(input: RouteTokensInput): RouteTokensResult {
    return this.inputTokenRouter.routeTokens(input);
  }
}
