import type { TerminalSnapshotFrameCore } from '../../terminal/snapshot-oracle.ts';

interface SelectionPoint {
  readonly rowAbs: number;
  readonly col: number;
}

export interface PaneSelection {
  readonly anchor: SelectionPoint;
  readonly focus: SelectionPoint;
  readonly text: string;
}

export interface PaneSelectionDrag {
  readonly anchor: SelectionPoint;
  readonly focus: SelectionPoint;
  readonly hasDragged: boolean;
}

export interface SelectionLayout {
  readonly paneRows: number;
  readonly rightCols: number;
  readonly rightStartCol: number;
}

export function compareSelectionPoints(left: SelectionPoint, right: SelectionPoint): number {
  if (left.rowAbs !== right.rowAbs) {
    return left.rowAbs - right.rowAbs;
  }
  return left.col - right.col;
}

export function selectionPointsEqual(left: SelectionPoint, right: SelectionPoint): boolean {
  return left.rowAbs === right.rowAbs && left.col === right.col;
}

export function normalizeSelection(selection: PaneSelection): {
  start: SelectionPoint;
  end: SelectionPoint;
} {
  if (compareSelectionPoints(selection.anchor, selection.focus) <= 0) {
    return {
      start: selection.anchor,
      end: selection.focus,
    };
  }
  return {
    start: selection.focus,
    end: selection.anchor,
  };
}

export function clampPanePoint(
  layout: SelectionLayout,
  frame: Pick<TerminalSnapshotFrameCore, 'viewport'>,
  rowAbs: number,
  col: number,
): SelectionPoint {
  const maxRowAbs = Math.max(0, frame.viewport.totalRows - 1);
  return {
    rowAbs: Math.max(0, Math.min(maxRowAbs, rowAbs)),
    col: Math.max(0, Math.min(layout.rightCols - 1, col)),
  };
}

export function pointFromMouseEvent(
  layout: SelectionLayout,
  frame: Pick<TerminalSnapshotFrameCore, 'viewport'>,
  event: { col: number; row: number },
): SelectionPoint {
  const rowViewport = Math.max(0, Math.min(layout.paneRows - 1, event.row - 1));
  return clampPanePoint(
    layout,
    frame,
    frame.viewport.top + rowViewport,
    event.col - layout.rightStartCol,
  );
}

export function isWheelMouseCode(code: number): boolean {
  return (code & 0b0100_0000) !== 0;
}

export function isMotionMouseCode(code: number): boolean {
  return (code & 0b0010_0000) !== 0;
}

export function hasAltModifier(code: number): boolean {
  return (code & 0b0000_1000) !== 0;
}

export function isLeftButtonPress(code: number, final: 'M' | 'm'): boolean {
  if (final !== 'M') {
    return false;
  }
  if (isWheelMouseCode(code) || isMotionMouseCode(code)) {
    return false;
  }
  return (code & 0b0000_0011) === 0;
}

export function isMouseRelease(final: 'M' | 'm'): boolean {
  return final === 'm';
}

export function isSelectionDrag(code: number, final: 'M' | 'm'): boolean {
  return final === 'M' && isMotionMouseCode(code);
}

interface ReduceConversationMouseSelectionOptions {
  selection: PaneSelection | null;
  selectionDrag: PaneSelectionDrag | null;
  point: SelectionPoint;
  isMainPaneTarget: boolean;
  isLeftButtonPress: boolean;
  isSelectionDrag: boolean;
  isMouseRelease: boolean;
  isWheelMouseCode: boolean;
  selectionTextForPane: (selection: PaneSelection) => string;
}

interface ReduceConversationMouseSelectionResult {
  selection: PaneSelection | null;
  selectionDrag: PaneSelectionDrag | null;
  pinViewport: boolean;
  releaseViewportPin: boolean;
  markDirty: boolean;
  consumed: boolean;
}

export function reduceConversationMouseSelection(
  options: ReduceConversationMouseSelectionOptions,
): ReduceConversationMouseSelectionResult {
  const startSelection = options.isMainPaneTarget && options.isLeftButtonPress;
  const updateSelection =
    options.selectionDrag !== null && options.isMainPaneTarget && options.isSelectionDrag;
  const releaseSelection = options.selectionDrag !== null && options.isMouseRelease;

  if (startSelection) {
    return {
      selection: null,
      selectionDrag: {
        anchor: options.point,
        focus: options.point,
        hasDragged: false,
      },
      pinViewport: true,
      releaseViewportPin: false,
      markDirty: true,
      consumed: true,
    };
  }

  if (updateSelection && options.selectionDrag !== null) {
    return {
      selection: options.selection,
      selectionDrag: {
        anchor: options.selectionDrag.anchor,
        focus: options.point,
        hasDragged:
          options.selectionDrag.hasDragged ||
          !selectionPointsEqual(options.selectionDrag.anchor, options.point),
      },
      pinViewport: false,
      releaseViewportPin: false,
      markDirty: true,
      consumed: true,
    };
  }

  if (releaseSelection && options.selectionDrag !== null) {
    const finalized = {
      anchor: options.selectionDrag.anchor,
      focus: options.point,
      hasDragged:
        options.selectionDrag.hasDragged ||
        !selectionPointsEqual(options.selectionDrag.anchor, options.point),
    };
    if (finalized.hasDragged) {
      const completedSelection: PaneSelection = {
        anchor: finalized.anchor,
        focus: finalized.focus,
        text: '',
      };
      return {
        selection: {
          ...completedSelection,
          text: options.selectionTextForPane(completedSelection),
        },
        selectionDrag: null,
        pinViewport: false,
        releaseViewportPin: false,
        markDirty: true,
        consumed: true,
      };
    }
    return {
      selection: null,
      selectionDrag: null,
      pinViewport: false,
      releaseViewportPin: true,
      markDirty: true,
      consumed: true,
    };
  }

  if (options.selection !== null && !options.isWheelMouseCode) {
    return {
      selection: null,
      selectionDrag: null,
      pinViewport: false,
      releaseViewportPin: true,
      markDirty: true,
      consumed: false,
    };
  }

  return {
    selection: options.selection,
    selectionDrag: options.selectionDrag,
    pinViewport: false,
    releaseViewportPin: false,
    markDirty: false,
    consumed: false,
  };
}

function cellGlyphForOverlay(frame: TerminalSnapshotFrameCore, row: number, col: number): string {
  const line = frame.richLines[row];
  if (line === undefined) {
    return ' ';
  }
  const cell = line.cells[col];
  if (cell === undefined) {
    return ' ';
  }
  if (cell.continued) {
    return ' ';
  }
  return cell.glyph.length > 0 ? cell.glyph : ' ';
}

export function renderSelectionOverlay(
  layout: SelectionLayout,
  frame: TerminalSnapshotFrameCore,
  selection: PaneSelection | null,
): string {
  if (selection === null) {
    return '';
  }

  const { start, end } = normalizeSelection(selection);
  const visibleStartAbs = frame.viewport.top;
  const visibleEndAbs = frame.viewport.top + frame.rows - 1;
  const paintStartAbs = Math.max(start.rowAbs, visibleStartAbs);
  const paintEndAbs = Math.min(end.rowAbs, visibleEndAbs);
  if (paintEndAbs < paintStartAbs) {
    return '';
  }

  let output = '';
  for (let rowAbs = paintStartAbs; rowAbs <= paintEndAbs; rowAbs += 1) {
    const row = rowAbs - frame.viewport.top;
    const rowStartCol = rowAbs === start.rowAbs ? start.col : 0;
    const rowEndCol = rowAbs === end.rowAbs ? end.col : frame.cols - 1;
    if (rowEndCol < rowStartCol) {
      continue;
    }

    output += `\u001b[${String(row + 1)};${String(layout.rightStartCol + rowStartCol)}H\u001b[7m`;
    for (let col = rowStartCol; col <= rowEndCol; col += 1) {
      output += cellGlyphForOverlay(frame, row, col);
    }
    output += '\u001b[0m';
  }

  return output;
}

export function selectionVisibleRows(
  frame: Pick<TerminalSnapshotFrameCore, 'viewport' | 'rows'>,
  selection: PaneSelection | null,
): readonly number[] {
  if (selection === null) {
    return [];
  }

  const { start, end } = normalizeSelection(selection);
  const visibleStartAbs = frame.viewport.top;
  const visibleEndAbs = frame.viewport.top + frame.rows - 1;
  const paintStartAbs = Math.max(start.rowAbs, visibleStartAbs);
  const paintEndAbs = Math.min(end.rowAbs, visibleEndAbs);
  if (paintEndAbs < paintStartAbs) {
    return [];
  }

  const rows: number[] = [];
  for (let rowAbs = paintStartAbs; rowAbs <= paintEndAbs; rowAbs += 1) {
    rows.push(rowAbs - frame.viewport.top);
  }
  return rows;
}

export function mergeUniqueRows(
  left: readonly number[],
  right: readonly number[],
): readonly number[] {
  if (left.length === 0) {
    return right;
  }
  if (right.length === 0) {
    return left;
  }
  const merged = new Set<number>();
  for (const row of left) {
    merged.add(row);
  }
  for (const row of right) {
    merged.add(row);
  }
  return [...merged].sort((a, b) => a - b);
}

export function selectionText(
  frame: TerminalSnapshotFrameCore,
  selection: PaneSelection | null,
): string {
  if (selection === null) {
    return '';
  }

  if (selection.text.length > 0) {
    return selection.text;
  }

  const { start, end } = normalizeSelection(selection);
  const rows: string[] = [];
  const visibleStartAbs = frame.viewport.top;
  const visibleEndAbs = frame.viewport.top + frame.rows - 1;
  const readStartAbs = Math.max(start.rowAbs, visibleStartAbs);
  const readEndAbs = Math.min(end.rowAbs, visibleEndAbs);
  for (let rowAbs = readStartAbs; rowAbs <= readEndAbs; rowAbs += 1) {
    const row = rowAbs - frame.viewport.top;
    const rowStartCol = rowAbs === start.rowAbs ? start.col : 0;
    const rowEndCol = rowAbs === end.rowAbs ? end.col : frame.cols - 1;
    if (rowEndCol < rowStartCol) {
      rows.push('');
      continue;
    }

    let line = '';
    for (let col = rowStartCol; col <= rowEndCol; col += 1) {
      const lineRef = frame.richLines[row];
      const cell = lineRef?.cells[col];
      if (cell === undefined || cell.continued) {
        continue;
      }
      line += cell.glyph;
    }
    rows.push(line);
  }
  return rows.join('\n');
}

export function isCopyShortcutInput(input: Buffer): boolean {
  if (input.length === 1 && input[0] === 0x03) {
    return true;
  }

  const text = input.toString('utf8');
  const prefixes = ['\u001b[99;', '\u001b[67;'] as const;
  for (const prefix of prefixes) {
    let startIndex = text.indexOf(prefix);
    while (startIndex !== -1) {
      let index = startIndex + prefix.length;
      while (
        index < text.length &&
        text.charCodeAt(index) >= 0x30 &&
        text.charCodeAt(index) <= 0x39
      ) {
        index += 1;
      }
      if (index > startIndex + prefix.length && text[index] === 'u') {
        return true;
      }
      startIndex = text.indexOf(prefix, startIndex + 1);
    }
  }
  return false;
}

export function writeTextToClipboard(
  value: string,
  writer: (payload: string) => unknown = (payload) => process.stdout.write(payload),
): boolean {
  if (value.length === 0) {
    return false;
  }

  try {
    const encoded = Buffer.from(value, 'utf8').toString('base64');
    writer(`\u001b]52;c;${encoded}\u0007`);
    return true;
  } catch {
    return false;
  }
}
