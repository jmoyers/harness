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

export function flushRuntimeRender<
  TConversation,
  TFrame,
  TSelection,
  TLayout,
  TModalOverlay,
  TStatusRow,
>(
  options: RuntimeRenderFlushOptions<
    TConversation,
    TFrame,
    TSelection,
    TLayout,
    TModalOverlay,
    TStatusRow
  >,
  input: RuntimeRenderFlushInput<TConversation, TFrame, TSelection, TLayout>,
): void {
  const renderStartedAtNs = options.perfNowNs();
  const baseStatusFooter =
    !input.projectPaneActive && !input.homePaneActive && input.activeConversation !== null
      ? options.statusFooterForConversation(input.activeConversation)
      : '';
  const statusNotice = options.currentStatusNotice();
  const statusFooter =
    statusNotice === null || statusNotice.length === 0
      ? baseStatusFooter
      : `${baseStatusFooter.length > 0 ? `${baseStatusFooter}  ` : ''}${statusNotice}`;
  const statusRow = options.currentStatusRow();
  options.onStatusLineComposed?.({
    activeConversation: input.activeConversation,
    statusFooter,
    statusRow,
    projectPaneActive: input.projectPaneActive,
    homePaneActive: input.homePaneActive,
  });
  const rows = options.buildRenderRows(
    input.layout,
    input.railAnsiRows,
    input.rightRows,
    statusRow,
    statusFooter,
  );
  const modalOverlay = options.buildModalOverlay();
  if (modalOverlay !== null) {
    options.applyModalOverlay(rows, modalOverlay);
  }
  const selectionOverlay =
    input.rightFrame === null
      ? ''
      : options.renderSelectionOverlay(input.layout, input.rightFrame, input.renderSelection);
  const flushResult = options.flush({
    layout: input.layout,
    rows,
    rightFrame: input.rightFrame,
    selectionRows: input.selectionRows,
    selectionOverlay,
  });
  const changedRowCount = flushResult.changedRowCount;
  if (flushResult.wroteOutput) {
    options.onFlushOutput({
      activeConversation: input.activeConversation,
      rightFrame: input.rightFrame,
      rows,
      flushResult,
      changedRowCount,
    });
  }
  const renderDurationMs = Number(options.perfNowNs() - renderStartedAtNs) / 1e6;
  options.recordRenderSample(renderDurationMs, changedRowCount);
}
