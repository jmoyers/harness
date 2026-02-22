const MIN_LEFT_PANE_COLS = 28;
const MIN_RIGHT_PANE_COLS = 20;
const DEFAULT_LEFT_PANE_WIDTH_PERCENT = 30;
const MIN_PANE_WIDTH_PERCENT = 1;
const MAX_PANE_WIDTH_PERCENT = 99;
const DEFAULT_BASE_LAYER_Z_INDEX = 0;
const DEFAULT_OVERLAY_LAYER_Z_INDEX = 100;

export interface UiLayoutRect {
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
}

export type UiLayoutAnchor = 'viewport' | 'left-pane' | 'right-pane' | 'status';

export interface UiLayoutOverlay {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
  readonly anchor?: UiLayoutAnchor;
  readonly zIndex?: number;
  readonly clipToViewport?: boolean;
}

export interface ComputeUiLayoutOptions {
  readonly leftCols?: number;
  readonly paneWidthPercent?: number;
  readonly statusRows?: number;
  readonly overlays?: readonly UiLayoutOverlay[];
}

export interface UiLayoutLayer {
  readonly id: string;
  readonly kind: 'left-pane' | 'separator' | 'right-pane' | 'status' | 'overlay';
  readonly zIndex: number;
  readonly rect: UiLayoutRect;
}

export interface UiDualPaneLayout {
  readonly cols: number;
  readonly rows: number;
  readonly paneRows: number;
  readonly statusRow: number;
  readonly leftCols: number;
  readonly rightCols: number;
  readonly separatorCol: number;
  readonly rightStartCol: number;
  readonly viewport: UiLayoutRect;
  readonly leftPane: UiLayoutRect;
  readonly separator: UiLayoutRect;
  readonly rightPane: UiLayoutRect;
  readonly status: UiLayoutRect;
  readonly layers: readonly UiLayoutLayer[];
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function normalizeInt(value: number, minimum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.floor(value));
}

function normalizePaneWidthPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LEFT_PANE_WIDTH_PERCENT;
  }
  return clamp(value, MIN_PANE_WIDTH_PERCENT, MAX_PANE_WIDTH_PERCENT);
}

function resolveLeftPaneCols(
  normalizedCols: number,
  requestedLeftCols: number | undefined,
  paneWidthPercent: number | undefined,
): number {
  const availablePaneCols = normalizedCols - 1;
  const percent = normalizePaneWidthPercent(paneWidthPercent ?? DEFAULT_LEFT_PANE_WIDTH_PERCENT);
  const defaultLeftCols = Math.round((availablePaneCols * percent) / 100);
  const requested = requestedLeftCols === undefined ? defaultLeftCols : Math.floor(requestedLeftCols);

  let leftCols = clamp(requested, 1, availablePaneCols - 1);
  if (normalizedCols >= MIN_LEFT_PANE_COLS + MIN_RIGHT_PANE_COLS + 1) {
    leftCols = Math.max(MIN_LEFT_PANE_COLS, leftCols);
    const maxLeft = availablePaneCols - MIN_RIGHT_PANE_COLS;
    leftCols = Math.min(leftCols, maxLeft);
  }
  return leftCols;
}

function rect(col: number, row: number, cols: number, rows: number): UiLayoutRect {
  return {
    col,
    row,
    cols: Math.max(1, cols),
    rows: Math.max(1, rows),
  };
}

function anchorRect(
  layout: Omit<UiDualPaneLayout, 'layers'>,
  anchor: UiLayoutAnchor,
): UiLayoutRect {
  if (anchor === 'left-pane') {
    return layout.leftPane;
  }
  if (anchor === 'right-pane') {
    return layout.rightPane;
  }
  if (anchor === 'status') {
    return layout.status;
  }
  return layout.viewport;
}

function intersectRect(left: UiLayoutRect, right: UiLayoutRect): UiLayoutRect | null {
  const startCol = Math.max(left.col, right.col);
  const startRow = Math.max(left.row, right.row);
  const endCol = Math.min(left.col + left.cols - 1, right.col + right.cols - 1);
  const endRow = Math.min(left.row + left.rows - 1, right.row + right.rows - 1);
  if (endCol < startCol || endRow < startRow) {
    return null;
  }
  return rect(startCol, startRow, endCol - startCol + 1, endRow - startRow + 1);
}

export function computeDualPaneLayoutWithLayers(
  cols: number,
  rows: number,
  options: ComputeUiLayoutOptions = {},
): UiDualPaneLayout {
  const normalizedCols = normalizeInt(cols, 3);
  const normalizedRows = normalizeInt(rows, 2);
  const requestedStatusRows = normalizeInt(options.statusRows ?? 1, 1);
  const statusRows = Math.min(requestedStatusRows, normalizedRows - 1);
  const paneRows = normalizedRows - statusRows;
  const statusRow = paneRows + 1;

  const availablePaneCols = normalizedCols - 1;
  const leftCols = resolveLeftPaneCols(normalizedCols, options.leftCols, options.paneWidthPercent);
  const rightCols = availablePaneCols - leftCols;
  const separatorCol = leftCols + 1;
  const rightStartCol = leftCols + 2;

  const layoutBase = {
    cols: normalizedCols,
    rows: normalizedRows,
    paneRows,
    statusRow,
    leftCols,
    rightCols,
    separatorCol,
    rightStartCol,
    viewport: rect(1, 1, normalizedCols, normalizedRows),
    leftPane: rect(1, 1, leftCols, paneRows),
    separator: rect(separatorCol, 1, 1, paneRows),
    rightPane: rect(rightStartCol, 1, rightCols, paneRows),
    status: rect(1, statusRow, normalizedCols, statusRows),
  } satisfies Omit<UiDualPaneLayout, 'layers'>;

  const layers: UiLayoutLayer[] = [
    {
      id: 'left-pane',
      kind: 'left-pane',
      zIndex: DEFAULT_BASE_LAYER_Z_INDEX,
      rect: layoutBase.leftPane,
    },
    {
      id: 'separator',
      kind: 'separator',
      zIndex: DEFAULT_BASE_LAYER_Z_INDEX,
      rect: layoutBase.separator,
    },
    {
      id: 'right-pane',
      kind: 'right-pane',
      zIndex: DEFAULT_BASE_LAYER_Z_INDEX,
      rect: layoutBase.rightPane,
    },
    {
      id: 'status',
      kind: 'status',
      zIndex: DEFAULT_BASE_LAYER_Z_INDEX,
      rect: layoutBase.status,
    },
  ];

  for (const overlay of options.overlays ?? []) {
    if (overlay.id.trim().length === 0) {
      continue;
    }
    const overlayAnchor = anchorRect(layoutBase, overlay.anchor ?? 'viewport');
    const absoluteRect = rect(
      overlayAnchor.col + overlay.col - 1,
      overlayAnchor.row + overlay.row - 1,
      overlay.cols,
      overlay.rows,
    );
    const resolvedRect =
      overlay.clipToViewport === false
        ? absoluteRect
        : intersectRect(absoluteRect, layoutBase.viewport);
    if (resolvedRect === null) {
      continue;
    }
    layers.push({
      id: overlay.id,
      kind: 'overlay',
      zIndex: overlay.zIndex ?? DEFAULT_OVERLAY_LAYER_Z_INDEX,
      rect: resolvedRect,
    });
  }

  const sortedLayers = layers.toSorted((left, right) => {
    if (left.zIndex !== right.zIndex) {
      return left.zIndex - right.zIndex;
    }
    return left.id.localeCompare(right.id);
  });

  return {
    ...layoutBase,
    layers: sortedLayers,
  };
}
