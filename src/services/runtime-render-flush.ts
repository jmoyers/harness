export interface RuntimeRenderFlushResult {
  readonly changedRowCount: number;
  readonly wroteOutput: boolean;
  readonly shouldShowCursor: boolean;
}

export interface RuntimeRenderFlushInput<TConversation, TFrame, TSelection, TLayout> {
  readonly layout: TLayout;
  readonly projectPaneActive: boolean;
  readonly homePaneActive: boolean;
  readonly activeConversation: TConversation | null;
  readonly rightFrame: TFrame | null;
  readonly renderSelection: TSelection | null;
  readonly selectionRows: readonly number[];
  readonly railAnsiRows: readonly string[];
  readonly rightRows: readonly string[];
}

export interface RuntimeRenderFlushOptions<
  TConversation,
  TFrame,
  TSelection,
  TLayout,
  TModalOverlay,
  TStatusRow,
> {
  readonly perfNowNs: () => bigint;
  readonly statusFooterForConversation: (conversation: TConversation) => string;
  readonly currentStatusNotice: () => string | null;
  readonly currentStatusRow: () => TStatusRow;
  readonly onStatusLineComposed?: (input: {
    activeConversation: TConversation | null;
    statusFooter: string;
    statusRow: TStatusRow;
    projectPaneActive: boolean;
    homePaneActive: boolean;
  }) => void;
  readonly buildRenderRows: (
    layout: TLayout,
    railRows: readonly string[],
    rightRows: readonly string[],
    statusRow: TStatusRow,
    statusFooter: string,
  ) => string[];
  readonly buildModalOverlay: () => TModalOverlay | null;
  readonly applyModalOverlay: (rows: string[], overlay: TModalOverlay) => void;
  readonly renderSelectionOverlay: (
    layout: TLayout,
    rightFrame: TFrame,
    selection: TSelection | null,
  ) => string;
  readonly flush: (input: {
    layout: TLayout;
    rows: readonly string[];
    rightFrame: TFrame | null;
    selectionRows: readonly number[];
    selectionOverlay: string;
  }) => RuntimeRenderFlushResult;
  readonly onFlushOutput: (input: {
    activeConversation: TConversation | null;
    rightFrame: TFrame | null;
    rows: readonly string[];
    flushResult: RuntimeRenderFlushResult;
    changedRowCount: number;
  }) => void;
  readonly recordRenderSample: (durationMs: number, changedRowCount: number) => void;
}

export class RuntimeRenderFlush<
  TConversation,
  TFrame,
  TSelection,
  TLayout,
  TModalOverlay,
  TStatusRow,
> {
  constructor(
    private readonly options: RuntimeRenderFlushOptions<
      TConversation,
      TFrame,
      TSelection,
      TLayout,
      TModalOverlay,
      TStatusRow
    >,
  ) {}

  flushRender(input: RuntimeRenderFlushInput<TConversation, TFrame, TSelection, TLayout>): void {
    const renderStartedAtNs = this.options.perfNowNs();
    const baseStatusFooter =
      !input.projectPaneActive && !input.homePaneActive && input.activeConversation !== null
        ? this.options.statusFooterForConversation(input.activeConversation)
        : '';
    const statusNotice = this.options.currentStatusNotice();
    const statusFooter =
      statusNotice === null || statusNotice.length === 0
        ? baseStatusFooter
        : `${baseStatusFooter.length > 0 ? `${baseStatusFooter}  ` : ''}${statusNotice}`;
    const statusRow = this.options.currentStatusRow();
    this.options.onStatusLineComposed?.({
      activeConversation: input.activeConversation,
      statusFooter,
      statusRow,
      projectPaneActive: input.projectPaneActive,
      homePaneActive: input.homePaneActive,
    });
    const rows = this.options.buildRenderRows(
      input.layout,
      input.railAnsiRows,
      input.rightRows,
      statusRow,
      statusFooter,
    );
    const modalOverlay = this.options.buildModalOverlay();
    if (modalOverlay !== null) {
      this.options.applyModalOverlay(rows, modalOverlay);
    }
    const selectionOverlay =
      input.rightFrame === null
        ? ''
        : this.options.renderSelectionOverlay(
            input.layout,
            input.rightFrame,
            input.renderSelection,
          );
    const flushResult = this.options.flush({
      layout: input.layout,
      rows,
      rightFrame: input.rightFrame,
      selectionRows: input.selectionRows,
      selectionOverlay,
    });
    const changedRowCount = flushResult.changedRowCount;
    if (flushResult.wroteOutput) {
      this.options.onFlushOutput({
        activeConversation: input.activeConversation,
        rightFrame: input.rightFrame,
        rows,
        flushResult,
        changedRowCount,
      });
    }
    const renderDurationMs = Number(this.options.perfNowNs() - renderStartedAtNs) / 1e6;
    this.options.recordRenderSample(renderDurationMs, changedRowCount);
  }
}
