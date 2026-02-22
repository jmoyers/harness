interface RuntimeRenderStateResult<TConversation, TFrame, TSelection> {
  readonly projectPaneActive: boolean;
  readonly homePaneActive: boolean;
  readonly activeConversation: TConversation | null;
  readonly rightFrame: TFrame | null;
  readonly renderSelection: TSelection | null;
  readonly selectionRows: readonly number[];
}

interface RuntimeLeftRailRenderResult<TRailViewRows> {
  readonly ansiRows: readonly string[];
  readonly viewRows: TRailViewRows;
}

export interface RuntimeRenderOrchestratorOptions<
  TLayout,
  TConversation,
  TFrame,
  TSelection,
  TSelectionDrag,
  TRailViewRows,
  TRenderSnapshot,
> {
  readonly isScreenDirty: () => boolean;
  readonly clearDirty: () => void;
  readonly readRenderSnapshot: () => TRenderSnapshot;
  readonly prepareRenderState: (
    selection: TSelection | null,
    selectionDrag: TSelectionDrag | null,
  ) => RuntimeRenderStateResult<TConversation, TFrame, TSelection> | null;
  readonly renderLeftRail: (
    layout: TLayout,
    snapshot: TRenderSnapshot,
  ) => RuntimeLeftRailRenderResult<TRailViewRows>;
  readonly setLatestRailViewRows: (rows: TRailViewRows) => void;
  readonly renderRightRows: (input: {
    layout: TLayout;
    rightFrame: TFrame | null;
    homePaneActive: boolean;
    projectPaneActive: boolean;
    activeDirectoryId: string | null;
    snapshot: TRenderSnapshot;
  }) => readonly string[];
  readonly flushRender: (input: {
    layout: TLayout;
    projectPaneActive: boolean;
    homePaneActive: boolean;
    activeConversation: TConversation | null;
    rightFrame: TFrame | null;
    renderSelection: TSelection | null;
    selectionRows: readonly number[];
    railAnsiRows: readonly string[];
    rightRows: readonly string[];
  }) => void;
  readonly activeDirectoryId: () => string | null;
}

export interface RuntimeRenderOrchestratorInput<TLayout, TSelection, TSelectionDrag> {
  readonly shuttingDown: boolean;
  readonly layout: TLayout;
  readonly selection: TSelection | null;
  readonly selectionDrag: TSelectionDrag | null;
}

export function orchestrateRuntimeRender<
  TLayout,
  TConversation,
  TFrame,
  TSelection,
  TSelectionDrag,
  TRailViewRows,
  TRenderSnapshot,
>(
  options: RuntimeRenderOrchestratorOptions<
    TLayout,
    TConversation,
    TFrame,
    TSelection,
    TSelectionDrag,
    TRailViewRows,
    TRenderSnapshot
  >,
  input: RuntimeRenderOrchestratorInput<TLayout, TSelection, TSelectionDrag>,
): void {
  if (input.shuttingDown || !options.isScreenDirty()) {
    return;
  }
  const renderState = options.prepareRenderState(input.selection, input.selectionDrag);
  if (renderState === null) {
    options.clearDirty();
    return;
  }
  const snapshot = options.readRenderSnapshot();
  const rail = options.renderLeftRail(input.layout, snapshot);
  options.setLatestRailViewRows(rail.viewRows);
  const rightRows = options.renderRightRows({
    layout: input.layout,
    rightFrame: renderState.rightFrame,
    homePaneActive: renderState.homePaneActive,
    projectPaneActive: renderState.projectPaneActive,
    activeDirectoryId: options.activeDirectoryId(),
    snapshot,
  });
  options.flushRender({
    layout: input.layout,
    projectPaneActive: renderState.projectPaneActive,
    homePaneActive: renderState.homePaneActive,
    activeConversation: renderState.activeConversation,
    rightFrame: renderState.rightFrame,
    renderSelection: renderState.renderSelection,
    selectionRows: renderState.selectionRows,
    railAnsiRows: rail.ansiRows,
    rightRows,
  });
}
