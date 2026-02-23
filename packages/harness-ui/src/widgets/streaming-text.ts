import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const layout = new TextLayoutEngine();

export interface StreamingTextProps {
  readonly id?: string;
  readonly fg?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
  readonly showCursor?: boolean;
}

export class StreamingTextWidget extends Widget {
  content = reactive('');
  fg = reactive<string | undefined>(undefined);
  showCursor = reactive(true);
  streaming = reactive(true);
  scrollOffset = reactive(0);

  constructor(props: StreamingTextProps = {}) {
    super(props.id);
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
    if (props.showCursor !== undefined) this.showCursor = props.showCursor;
  }

  append(text: string): void {
    this.content = this.content + text;
  }

  reset(): void {
    this.content = '';
    this.scrollOffset = 0;
  }

  finish(): void {
    this.streaming = false;
  }

  render(buffer: ClippedCellBuffer): void {
    const lines = this.content.split('\n');
    if (this.streaming) {
      this.scrollOffset = Math.max(0, lines.length - buffer.rows);
    }
    const fgColor = resolveColor(this.fg);
    const style: CellStyle = { ...DEFAULT_CELL_STYLE, fg: fgColor };
    const cursorStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: fgColor, inverse: true };

    const visibleStart = Math.max(0, this.scrollOffset);

    for (let viewRow = 0; viewRow < buffer.rows; viewRow += 1) {
      const lineIdx = visibleStart + viewRow;
      if (lineIdx >= lines.length) break;
      const line = lines[lineIdx]!;
      const truncated = layout.truncate(line, buffer.cols);
      buffer.drawText(0, viewRow, truncated, style);
    }

    if (this.streaming && this.showCursor) {
      const lastVisibleLine = visibleStart + buffer.rows - 1;
      if (lines.length - 1 <= lastVisibleLine) {
        const lastLine = lines[lines.length - 1] ?? '';
        const cursorCol = layout.measure(lastLine);
        const cursorRow = lines.length - 1 - visibleStart;
        if (cursorRow >= 0 && cursorRow < buffer.rows && cursorCol < buffer.cols) {
          const cell = buffer.getCell(cursorCol, cursorRow);
          if (cell !== null) cell.style = cursorStyle;
        }
      }
    }
  }
}

export function StreamingText(props: StreamingTextProps = {}): StreamingTextWidget {
  return new StreamingTextWidget(props);
}
