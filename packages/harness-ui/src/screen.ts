import {
  cursorStyleEqual,
  cursorStyleToDecscusr,
  diffRenderedRows,
  findAnsiIntegrityIssues,
  type RenderCursorStyle,
} from './frame-primitives.ts';

export type ScreenCursorStyle = RenderCursorStyle;

interface ScreenLayout {
  readonly paneRows: number;
  readonly rightCols: number;
  readonly rightStartCol: number;
}

interface ScreenRenderFrame {
  readonly modes: {
    readonly bracketedPaste: boolean;
  };
  readonly cursor: {
    readonly style: ScreenCursorStyle;
    readonly visible: boolean;
    readonly row: number;
    readonly col: number;
  };
  readonly viewport: {
    readonly followOutput: boolean;
  };
}

export interface ScreenFlushInput {
  readonly layout: ScreenLayout;
  readonly rows: readonly string[];
  readonly rightFrame: ScreenRenderFrame | null;
  readonly selectionRows: readonly number[];
  readonly selectionOverlay: string;
  readonly validateAnsi: boolean;
}

interface ScreenFlushResult {
  readonly wroteOutput: boolean;
  readonly changedRowCount: number;
  readonly shouldShowCursor: boolean;
}

export interface ScreenWriter {
  writeOutput(output: string): void;
  writeError(output: string): void;
}

export class ProcessScreenWriter implements ScreenWriter {
  constructor() {}

  writeOutput(output: string): void {
    process.stdout.write(output);
  }

  writeError(output: string): void {
    process.stderr.write(output);
  }
}

export interface ScreenAnsiValidator {
  findIssues(rows: readonly string[]): readonly string[];
}

export class DefaultScreenAnsiValidator implements ScreenAnsiValidator {
  constructor() {}

  findIssues(rows: readonly string[]): readonly string[] {
    return findAnsiIntegrityIssues(rows);
  }
}

const TERMINAL_SYNC_UPDATE_BEGIN = '\u001b[?2026h';
const TERMINAL_SYNC_UPDATE_END = '\u001b[?2026l';

function mergeUniqueRows(left: readonly number[], right: readonly number[]): readonly number[] {
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
  const output = [...merged];
  for (let index = 1; index < output.length; index += 1) {
    const value = output[index]!;
    let insertIndex = index - 1;
    while (insertIndex >= 0 && output[insertIndex]! > value) {
      output[insertIndex + 1] = output[insertIndex]!;
      insertIndex -= 1;
    }
    output[insertIndex + 1] = value;
  }
  return output;
}

export class Screen {
  private dirty = true;
  private previousRows: readonly string[] = [];
  private previousSelectionRows: readonly number[] = [];
  private forceFullClear = true;
  private renderedCursorVisible: boolean | null = null;
  private renderedCursorStyle: ScreenCursorStyle | null = null;
  private renderedBracketedPaste: boolean | null = null;
  private ansiValidationReported = false;

  constructor(
    private readonly writer: ScreenWriter = new ProcessScreenWriter(),
    private readonly ansiValidator: ScreenAnsiValidator = new DefaultScreenAnsiValidator(),
  ) {}

  isDirty(): boolean {
    return this.dirty;
  }

  markDirty(): void {
    this.dirty = true;
  }

  clearDirty(): void {
    this.dirty = false;
  }

  resetFrameCache(): void {
    this.previousRows = [];
    this.forceFullClear = true;
  }

  flush(input: ScreenFlushInput): ScreenFlushResult {
    if (!this.dirty) {
      return {
        wroteOutput: false,
        changedRowCount: 0,
        shouldShowCursor: false,
      };
    }

    if (input.validateAnsi) {
      const issues = this.ansiValidator.findIssues(input.rows);
      if (issues.length > 0 && !this.ansiValidationReported) {
        this.ansiValidationReported = true;
        this.writer.writeError(`[mux] ansi-integrity-failed ${issues.join(' | ')}\n`);
      }
    }

    const diff = this.forceFullClear
      ? diffRenderedRows(input.rows, [])
      : diffRenderedRows(input.rows, this.previousRows);
    const overlayResetRows = mergeUniqueRows(this.previousSelectionRows, input.selectionRows);

    let output = '';
    if (this.forceFullClear) {
      output += '\u001b[?25l\u001b[H\u001b[2J';
      this.forceFullClear = false;
      this.renderedCursorVisible = false;
      this.renderedCursorStyle = null;
      this.renderedBracketedPaste = null;
    }
    output += diff.output;

    if (overlayResetRows.length > 0) {
      const changedRows = new Set<number>(diff.changedRows);
      for (const row of overlayResetRows) {
        if (row < 0 || row >= input.layout.paneRows || changedRows.has(row)) {
          continue;
        }
        const rowContent = input.rows[row] ?? '';
        output += `\u001b[${String(row + 1)};1H\u001b[2K${rowContent}`;
      }
    }

    let shouldShowCursor = false;
    if (input.rightFrame !== null) {
      const shouldEnableBracketedPaste = input.rightFrame.modes.bracketedPaste;
      if (this.renderedBracketedPaste !== shouldEnableBracketedPaste) {
        output += shouldEnableBracketedPaste ? '\u001b[?2004h' : '\u001b[?2004l';
        this.renderedBracketedPaste = shouldEnableBracketedPaste;
      }

      if (!cursorStyleEqual(this.renderedCursorStyle, input.rightFrame.cursor.style)) {
        output += cursorStyleToDecscusr(input.rightFrame.cursor.style);
        this.renderedCursorStyle = input.rightFrame.cursor.style;
      }

      output += input.selectionOverlay;
      shouldShowCursor =
        input.rightFrame.viewport.followOutput &&
        input.rightFrame.cursor.visible &&
        input.rightFrame.cursor.row >= 0 &&
        input.rightFrame.cursor.row < input.layout.paneRows &&
        input.rightFrame.cursor.col >= 0 &&
        input.rightFrame.cursor.col < input.layout.rightCols;

      if (shouldShowCursor) {
        if (this.renderedCursorVisible !== true) {
          output += '\u001b[?25h';
          this.renderedCursorVisible = true;
        }
        output += `\u001b[${String(input.rightFrame.cursor.row + 1)};${String(input.layout.rightStartCol + input.rightFrame.cursor.col)}H`;
      } else if (this.renderedCursorVisible !== false) {
        output += '\u001b[?25l';
        this.renderedCursorVisible = false;
      }
    } else {
      if (this.renderedBracketedPaste !== false) {
        output += '\u001b[?2004l';
        this.renderedBracketedPaste = false;
      }
      if (this.renderedCursorVisible !== false) {
        output += '\u001b[?25l';
        this.renderedCursorVisible = false;
      }
    }

    if (output.length > 0) {
      this.writer.writeOutput(`${TERMINAL_SYNC_UPDATE_BEGIN}${output}${TERMINAL_SYNC_UPDATE_END}`);
    }

    this.previousRows = diff.nextRows;
    this.previousSelectionRows = input.selectionRows;
    this.dirty = false;
    return {
      wroteOutput: output.length > 0,
      changedRowCount: diff.changedRows.length,
      shouldShowCursor,
    };
  }
}
