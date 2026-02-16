const DEFAULT_PANE_WIDTH_PERCENT = 30;
const MIN_PANE_WIDTH_PERCENT = 1;
const MAX_PANE_WIDTH_PERCENT = 99;

export function normalizePaneWidthPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PANE_WIDTH_PERCENT;
  }
  if (value < MIN_PANE_WIDTH_PERCENT) {
    return MIN_PANE_WIDTH_PERCENT;
  }
  if (value > MAX_PANE_WIDTH_PERCENT) {
    return MAX_PANE_WIDTH_PERCENT;
  }
  return value;
}

export function leftColsFromPaneWidthPercent(cols: number, paneWidthPercent: number): number {
  const availablePaneCols = Math.max(2, cols - 1);
  const normalizedPercent = normalizePaneWidthPercent(paneWidthPercent);
  const requestedLeftCols = Math.round((availablePaneCols * normalizedPercent) / 100);
  return Math.max(1, Math.min(availablePaneCols - 1, requestedLeftCols));
}

export function paneWidthPercentFromLayout(layout: { cols: number; leftCols: number }): number {
  const availablePaneCols = Math.max(2, layout.cols - 1);
  const percent = (layout.leftCols / availablePaneCols) * 100;
  const rounded = Math.round(percent * 100) / 100;
  return normalizePaneWidthPercent(rounded);
}
