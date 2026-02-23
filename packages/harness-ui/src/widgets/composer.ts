import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { Message } from '../widget/message.ts';
import { measureDisplayWidth, TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';
import type { KeyEvent } from '../widget/input.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const layout = new TextLayoutEngine();

export class ComposerSubmitted extends Message {
  constructor(readonly value: string) {
    super();
  }
}

export class ComposerChanged extends Message {
  constructor(readonly value: string) {
    super();
  }
}

interface UndoEntry {
  readonly text: string;
  readonly cursor: number;
}

export interface ComposerProps {
  readonly id?: string;
  readonly placeholder?: string;
  readonly fg?: string;
  readonly bg?: string;
  readonly placeholderFg?: string;
  readonly modeIndicator?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
  readonly maxHistorySize?: number;
}

export class ComposerWidget extends Widget {
  value = reactive('');
  placeholder = reactive('');
  fg = reactive<string | undefined>(undefined);
  bg = reactive<string | undefined>(undefined);
  placeholderFg = reactive<string | undefined>(undefined);
  modeIndicator = reactive('');
  cursorPos = reactive(0);
  scrollTop = reactive(0);

  private history: string[] = [];
  private historyIndex = -1;
  private maxHistory: number;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  constructor(props: ComposerProps = {}) {
    super(props.id);
    this.focusable = true;
    this.maxHistory = props.maxHistorySize ?? 50;
    if (props.placeholder !== undefined) this.placeholder = props.placeholder;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.bg !== undefined) this.bg = props.bg;
    if (props.placeholderFg !== undefined) this.placeholderFg = props.placeholderFg;
    if (props.modeIndicator !== undefined) this.modeIndicator = props.modeIndicator;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  validateCursorPos(pos: number): number {
    return Math.max(0, Math.min(this.value.length, Math.floor(pos)));
  }

  private pushUndo(): void {
    this.undoStack.push({ text: this.value, cursor: this.cursorPos });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private mutate(newValue: string, newCursor: number): void {
    this.pushUndo();
    this.value = newValue;
    this.cursorPos = newCursor;
    this.emit(new ComposerChanged(this.value));
  }

  handleKeypress(event: KeyEvent): boolean {
    if (event.key === 'enter' && !event.shift && !event.ctrl && !event.alt) {
      if (this.value.trim().length > 0) {
        this.history.push(this.value);
        if (this.history.length > this.maxHistory) this.history.shift();
        this.historyIndex = -1;
        this.emit(new ComposerSubmitted(this.value));
        this.value = '';
        this.cursorPos = 0;
      }
      return true;
    }

    if (
      (event.key === 'enter' && (event.shift || event.ctrl || event.alt)) ||
      (event.key === 'j' && event.ctrl)
    ) {
      this.mutate(
        this.value.slice(0, this.cursorPos) + '\n' + this.value.slice(this.cursorPos),
        this.cursorPos + 1,
      );
      return true;
    }

    if (event.key === 'backspace') {
      if (event.ctrl || event.alt) return this.deleteWordBackward();
      if (this.cursorPos > 0) {
        this.mutate(
          this.value.slice(0, this.cursorPos - 1) + this.value.slice(this.cursorPos),
          this.cursorPos - 1,
        );
      }
      return true;
    }

    if (event.key === 'delete') {
      if (event.ctrl || event.alt) return this.deleteWordForward();
      if (this.cursorPos < this.value.length) {
        this.mutate(
          this.value.slice(0, this.cursorPos) + this.value.slice(this.cursorPos + 1),
          this.cursorPos,
        );
      }
      return true;
    }

    if (event.key === 'left') {
      if (event.ctrl || event.alt) {
        this.wordBackward();
        return true;
      }
      this.cursorPos = Math.max(0, this.cursorPos - 1);
      return true;
    }
    if (event.key === 'right') {
      if (event.ctrl || event.alt) {
        this.wordForward();
        return true;
      }
      this.cursorPos = Math.min(this.value.length, this.cursorPos + 1);
      return true;
    }

    if (event.key === 'up') {
      if (this.value.includes('\n')) {
        this.moveCursorVertical(-1);
        return true;
      }
      return this.historyPrevious();
    }
    if (event.key === 'down') {
      if (this.value.includes('\n')) {
        this.moveCursorVertical(1);
        return true;
      }
      return this.historyNext();
    }

    if (event.key === 'a' && event.ctrl) {
      this.cursorPos = this.lineStart();
      return true;
    }
    if (event.key === 'e' && event.ctrl) {
      this.cursorPos = this.lineEnd();
      return true;
    }

    if (event.key === 'k' && event.ctrl) {
      return this.killToLineEnd();
    }
    if (event.key === 'u' && event.ctrl) {
      return this.killToLineStart();
    }

    if (event.key === 'z' && event.ctrl) {
      return this.undo();
    }
    if (event.key === 'z' && event.ctrl && event.shift) {
      return this.redo();
    }

    if (event.key === 'c' && event.ctrl) {
      this.value = '';
      this.cursorPos = 0;
      return true;
    }

    if (event.ctrl || event.alt) return false;
    if (event.key.length === 1 && event.key.charCodeAt(0) >= 0x20) {
      this.mutate(
        this.value.slice(0, this.cursorPos) + event.key + this.value.slice(this.cursorPos),
        this.cursorPos + 1,
      );
      return true;
    }

    return false;
  }

  private wordForward(): void {
    let p = this.cursorPos;
    while (p < this.value.length && /\s/.test(this.value[p]!)) p += 1;
    while (p < this.value.length && !/\s/.test(this.value[p]!)) p += 1;
    this.cursorPos = p;
  }

  private wordBackward(): void {
    let p = this.cursorPos;
    while (p > 0 && /\s/.test(this.value[p - 1]!)) p -= 1;
    while (p > 0 && !/\s/.test(this.value[p - 1]!)) p -= 1;
    this.cursorPos = p;
  }

  private deleteWordBackward(): boolean {
    const start = this.cursorPos;
    this.wordBackward();
    const end = this.cursorPos;
    if (start !== end) {
      this.cursorPos = start;
      this.mutate(this.value.slice(0, end) + this.value.slice(start), end);
    }
    return true;
  }

  private deleteWordForward(): boolean {
    const start = this.cursorPos;
    this.wordForward();
    const end = this.cursorPos;
    if (start !== end) {
      this.cursorPos = start;
      this.mutate(this.value.slice(0, start) + this.value.slice(end), start);
    }
    return true;
  }

  private killToLineEnd(): boolean {
    const le = this.lineEnd();
    if (le > this.cursorPos) {
      this.mutate(this.value.slice(0, this.cursorPos) + this.value.slice(le), this.cursorPos);
    } else if (this.cursorPos < this.value.length && this.value[this.cursorPos] === '\n') {
      this.mutate(
        this.value.slice(0, this.cursorPos) + this.value.slice(this.cursorPos + 1),
        this.cursorPos,
      );
    }
    return true;
  }

  private killToLineStart(): boolean {
    const ls = this.lineStart();
    if (ls < this.cursorPos) {
      this.mutate(this.value.slice(0, ls) + this.value.slice(this.cursorPos), ls);
    }
    return true;
  }

  private lineStart(): number {
    let p = this.cursorPos;
    while (p > 0 && this.value[p - 1] !== '\n') p -= 1;
    return p;
  }

  private lineEnd(): number {
    let p = this.cursorPos;
    while (p < this.value.length && this.value[p] !== '\n') p += 1;
    return p;
  }

  private moveCursorVertical(direction: number): void {
    const lines = this.value.split('\n');
    let lineIdx = 0;
    let acc = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (
        acc + lines[i]!.length >= this.cursorPos &&
        (i === lines.length - 1 || acc + lines[i]!.length >= this.cursorPos)
      ) {
        lineIdx = i;
        break;
      }
      acc += lines[i]!.length + 1;
    }
    const col = this.cursorPos - acc;
    const target = lineIdx + direction;
    if (target < 0 || target >= lines.length) return;
    let newAcc = 0;
    for (let i = 0; i < target; i += 1) newAcc += lines[i]!.length + 1;
    this.cursorPos = newAcc + Math.min(col, lines[target]!.length);
  }

  private historyPrevious(): boolean {
    if (this.history.length === 0) return false;
    if (this.historyIndex === -1) this.historyIndex = this.history.length;
    if (this.historyIndex > 0) {
      this.historyIndex -= 1;
      this.value = this.history[this.historyIndex]!;
      this.cursorPos = this.value.length;
    }
    return true;
  }

  private historyNext(): boolean {
    if (this.historyIndex === -1) return false;
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      this.value = this.history[this.historyIndex]!;
      this.cursorPos = this.value.length;
    } else {
      this.historyIndex = -1;
      this.value = '';
      this.cursorPos = 0;
    }
    return true;
  }

  private undo(): boolean {
    if (this.undoStack.length === 0) return true;
    this.redoStack.push({ text: this.value, cursor: this.cursorPos });
    const entry = this.undoStack.pop()!;
    this.value = entry.text;
    this.cursorPos = entry.cursor;
    return true;
  }

  private redo(): boolean {
    if (this.redoStack.length === 0) return true;
    this.undoStack.push({ text: this.value, cursor: this.cursorPos });
    const entry = this.redoStack.pop()!;
    this.value = entry.text;
    this.cursorPos = entry.cursor;
    return true;
  }

  private ensureCursorVisible(viewRows: number): void {
    const lines = this.value.split('\n');
    let lineIdx = 0;
    let acc = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (acc + lines[i]!.length >= this.cursorPos) {
        lineIdx = i;
        break;
      }
      acc += lines[i]!.length + 1;
    }
    if (lineIdx < this.scrollTop) this.scrollTop = lineIdx;
    else if (lineIdx >= this.scrollTop + viewRows) this.scrollTop = lineIdx - viewRows + 1;
  }

  render(buffer: ClippedCellBuffer): void {
    const fgColor = resolveColor(this.fg);
    const bgColor = resolveColor(this.bg);
    const baseStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: fgColor, bg: bgColor };

    if (bgColor.kind !== 'default') {
      for (let r = 0; r < buffer.rows; r += 1) buffer.fillRow(r, baseStyle);
    }

    if (this.value.length === 0 && !this.focused && this.placeholder.length > 0) {
      const phFg = resolveColor(this.placeholderFg);
      const phStyle: CellStyle = {
        ...DEFAULT_CELL_STYLE,
        fg: phFg.kind !== 'default' ? phFg : { kind: 'indexed', index: 244 },
        bg: bgColor,
      };
      buffer.drawText(0, 0, layout.truncate(this.placeholder, buffer.cols), phStyle);
      if (this.modeIndicator.length > 0) {
        const miW = measureDisplayWidth(this.modeIndicator);
        buffer.drawText(buffer.cols - miW, 0, this.modeIndicator, phStyle);
      }
      return;
    }

    this.ensureCursorVisible(buffer.rows);
    const lines = this.value.split('\n');

    let curLineIdx = 0;
    let acc = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (acc + lines[i]!.length >= this.cursorPos) {
        curLineIdx = i;
        break;
      }
      acc += lines[i]!.length + 1;
    }
    const curCol = this.cursorPos - acc;

    for (let viewRow = 0; viewRow < buffer.rows; viewRow += 1) {
      const lineIdx = this.scrollTop + viewRow;
      if (lineIdx >= lines.length) break;
      buffer.drawText(0, viewRow, layout.truncate(lines[lineIdx]!, buffer.cols), baseStyle);

      if (this.focused && lineIdx === curLineIdx) {
        const cc = measureDisplayWidth(lines[lineIdx]!.slice(0, curCol));
        if (cc < buffer.cols) {
          const cell = buffer.getCell(cc, viewRow);
          if (cell !== null) cell.style = { ...baseStyle, inverse: true };
        }
      }
    }

    if (this.modeIndicator.length > 0) {
      const miW = measureDisplayWidth(this.modeIndicator);
      const miStyle: CellStyle = {
        ...DEFAULT_CELL_STYLE,
        fg: { kind: 'indexed', index: 244 },
        bg: bgColor,
      };
      buffer.drawText(buffer.cols - miW, buffer.rows - 1, this.modeIndicator, miStyle);
    }
  }
}

export function Composer(props: ComposerProps = {}): ComposerWidget {
  return new ComposerWidget(props);
}
