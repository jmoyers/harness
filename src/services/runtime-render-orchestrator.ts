interface RuntimeRenderStateResult<TConversation, TFrame, TSelection> {
  readonly projectPaneActive: boolean;
  readonly homePaneActive: boolean;
  readonly nimPaneActive: boolean;
  readonly activeConversation: TConversation | null;
  readonly rightFrame: TFrame | null;
  readonly renderSelection: TSelection | null;
  readonly selectionRows: readonly number[];
}

interface RuntimeLeftRailRenderResult<TRailViewRows> {
  readonly ansiRows: readonly string[];
  readonly viewRows: TRailViewRows;
}

interface RuntimeRenderOrchestratorOptions<
  TLayout,
  TConversation,
  TFrame,
  TSelection,
  TSelectionDrag,
  TRailViewRows,
> {
  readonly isScreenDirty: () => boolean;
  readonly clearDirty: () => void;
  readonly prepareRenderState: (
    selection: TSelection | null,
    selectionDrag: TSelectionDrag | null,
  ) => RuntimeRenderStateResult<TConversation, TFrame, TSelection> | null;
  readonly renderLeftRail: (layout: TLayout) => RuntimeLeftRailRenderResult<TRailViewRows>;
  readonly setLatestRailViewRows: (rows: TRailViewRows) => void;
  readonly renderRightRows: (input: {
    layout: TLayout;
    rightFrame: TFrame | null;
    homePaneActive: boolean;
    nimPaneActive: boolean;
    projectPaneActive: boolean;
    activeDirectoryId: string | null;
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

interface RuntimeRenderOrchestratorInput<TLayout, TSelection, TSelectionDrag> {
  readonly shuttingDown: boolean;
  readonly layout: TLayout;
  readonly selection: TSelection | null;
  readonly selectionDrag: TSelectionDrag | null;
}

export class RuntimeRenderOrchestrator<
  TLayout,
  TConversation,
  TFrame,
  TSelection,
  TSelectionDrag,
  TRailViewRows,
> {
  constructor(
    private readonly options: RuntimeRenderOrchestratorOptions<
      TLayout,
      TConversation,
      TFrame,
      TSelection,
      TSelectionDrag,
      TRailViewRows
    >,
  ) {}

  render(input: RuntimeRenderOrchestratorInput<TLayout, TSelection, TSelectionDrag>): void {
    if (input.shuttingDown || !this.options.isScreenDirty()) {
      return;
    }
    const renderState = this.options.prepareRenderState(input.selection, input.selectionDrag);
    if (renderState === null) {
      this.options.clearDirty();
      return;
    }
    const rail = this.options.renderLeftRail(input.layout);
    this.options.setLatestRailViewRows(rail.viewRows);
    const rightRows = this.options.renderRightRows({
      layout: input.layout,
      rightFrame: renderState.rightFrame,
      homePaneActive: renderState.homePaneActive,
      nimPaneActive: renderState.nimPaneActive,
      projectPaneActive: renderState.projectPaneActive,
      activeDirectoryId: this.options.activeDirectoryId(),
    });
    this.options.flushRender({
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
}
