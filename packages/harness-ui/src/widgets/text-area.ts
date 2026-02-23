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

export class TextAreaChanged extends Message {
  constructor(readonly value: string) {
    super();
  }
}

export class TextAreaSubmitted extends Message {
  constructor(readonly value: string) {
    super();
  }
}

export interface TextAreaProps {
  readonly id?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly fg?: string;
  readonly bg?: string;
  readonly placeholderFg?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

interface LineRange {
  readonly start: number;
  readonly end: number;
}

function lineRanges(text: string): readonly LineRange[] {
  if (text.length === 0) return [{ start: 0, end: 0 }];
  const ranges: LineRange[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      ranges.push({ start, end: i });
      start = i + 1;
    }
  }
  ranges.push({ start, end: text.length });
  return ranges;
}

function locateCursor(
  text: string,
  cursor: number,
): { lineIndex: number; column: number; ranges: readonly LineRange[] } {
  const ranges = lineRanges(text);
  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i]!;
    if (cursor >= range.start && cursor <= range.end) {
      return { lineIndex: i, column: cursor - range.start, ranges };
    }
  }
  const last = ranges.length - 1;
  return { lineIndex: last, column: cursor - ranges[last]!.start, ranges };
}

export class TextAreaWidget extends Widget {
  value = reactive('');
  placeholder = reactive('');
  fg = reactive<string | undefined>(undefined);
  bg = reactive<string | undefined>(undefined);
  placeholderFg = reactive<string | undefined>(undefined);
  cursorPos = reactive(0);
  scrollTop = reactive(0);

  constructor(props: TextAreaProps = {}) {
    super(props.id);
    this.focusable = true;
    if (props.value !== undefined) {
      this.value = props.value;
      this.cursorPos = props.value.length;
    }
    if (props.placeholder !== undefined) this.placeholder = props.placeholder;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.bg !== undefined) this.bg = props.bg;
    if (props.placeholderFg !== undefined) this.placeholderFg = props.placeholderFg;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  validateCursorPos(pos: number): number {
    return Math.max(0, Math.min(this.value.length, Math.floor(pos)));
  }

  get lineCount(): number {
    return lineRanges(this.value).length;
  }

  handleKeypress(event: KeyEvent): boolean {
    if (event.key === 'enter') {
      const before = this.value.slice(0, this.cursorPos);
      const after = this.value.slice(this.cursorPos);
      this.value = `${before}\n${after}`;
      this.cursorPos = this.cursorPos + 1;
      this.emit(new TextAreaChanged(this.value));
      return true;
    }

    if (event.key === 'backspace') {
      if (this.cursorPos > 0) {
        const before = this.value.slice(0, this.cursorPos - 1);
        const after = this.value.slice(this.cursorPos);
        this.value = before + after;
        this.cursorPos = this.cursorPos - 1;
        this.emit(new TextAreaChanged(this.value));
      }
      return true;
    }

    if (event.key === 'delete') {
      if (this.cursorPos < this.value.length) {
        const before = this.value.slice(0, this.cursorPos);
        const after = this.value.slice(this.cursorPos + 1);
        this.value = before + after;
        this.emit(new TextAreaChanged(this.value));
      }
      return true;
    }

    if (event.key === 'left') {
      this.cursorPos = Math.max(0, this.cursorPos - 1);
      return true;
    }
    if (event.key === 'right') {
      this.cursorPos = Math.min(this.value.length, this.cursorPos + 1);
      return true;
    }

    if (event.key === 'up') {
      this.moveCursorVertical(-1);
      return true;
    }
    if (event.key === 'down') {
      this.moveCursorVertical(1);
      return true;
    }

    if (event.key === 'home') {
      const { ranges, lineIndex } = locateCursor(this.value, this.cursorPos);
      this.cursorPos = ranges[lineIndex]!.start;
      return true;
    }
    if (event.key === 'end') {
      const { ranges, lineIndex } = locateCursor(this.value, this.cursorPos);
      this.cursorPos = ranges[lineIndex]!.end;
      return true;
    }

    if (event.ctrl || event.alt) return false;
    if (event.key.length === 1 && event.key.charCodeAt(0) >= 0x20) {
      const before = this.value.slice(0, this.cursorPos);
      const after = this.value.slice(this.cursorPos);
      this.value = before + event.key + after;
      this.cursorPos = this.cursorPos + 1;
      this.emit(new TextAreaChanged(this.value));
      return true;
    }

    return false;
  }

  private moveCursorVertical(direction: number): void {
    const { ranges, lineIndex, column } = locateCursor(this.value, this.cursorPos);
    const targetLine = lineIndex + direction;
    if (targetLine < 0 || targetLine >= ranges.length) return;
    const target = ranges[targetLine]!;
    const lineLen = target.end - target.start;
    this.cursorPos = target.start + Math.min(column, lineLen);
  }

  private ensureCursorVisible(viewRows: number): void {
    const { lineIndex } = locateCursor(this.value, this.cursorPos);
    if (lineIndex < this.scrollTop) {
      this.scrollTop = lineIndex;
    } else if (lineIndex >= this.scrollTop + viewRows) {
      this.scrollTop = lineIndex - viewRows + 1;
    }
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
      const truncated = layout.truncate(this.placeholder, buffer.cols);
      buffer.drawText(0, 0, truncated, phStyle);
      return;
    }

    this.ensureCursorVisible(buffer.rows);
    const lines = this.value.split('\n');
    const { lineIndex, column } = locateCursor(this.value, this.cursorPos);

    for (let viewRow = 0; viewRow < buffer.rows; viewRow += 1) {
      const lineIdx = this.scrollTop + viewRow;
      if (lineIdx >= lines.length) break;
      const line = lines[lineIdx]!;
      const truncated = layout.truncate(line, buffer.cols);
      buffer.drawText(0, viewRow, truncated, baseStyle);

      if (this.focused && lineIdx === lineIndex) {
        const cursorCol = measureDisplayWidth(line.slice(0, column));
        if (cursorCol < buffer.cols) {
          const cursorStyle: CellStyle = { ...baseStyle, inverse: true };
          const cell = buffer.getCell(cursorCol, viewRow);
          if (cell !== null) cell.style = cursorStyle;
        }
      }
    }
  }
}

export function TextArea(props: TextAreaProps = {}): TextAreaWidget {
  return new TextAreaWidget(props);
}
