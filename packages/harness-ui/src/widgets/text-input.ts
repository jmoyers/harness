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

export class InputChanged extends Message {
  constructor(readonly value: string) {
    super();
  }
}

export class InputSubmitted extends Message {
  constructor(readonly value: string) {
    super();
  }
}

export interface TextInputProps {
  readonly id?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly fg?: string;
  readonly bg?: string;
  readonly placeholderFg?: string;
  readonly cursorChar?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
}

export class TextInputWidget extends Widget {
  value = reactive('');
  placeholder = reactive('');
  fg = reactive<string | undefined>(undefined);
  bg = reactive<string | undefined>(undefined);
  placeholderFg = reactive<string | undefined>(undefined);
  cursorChar = reactive('█');
  cursorPos = reactive(0);

  constructor(props: TextInputProps = {}) {
    super(props.id);
    this.focusable = true;
    this.height = props.height ?? 1;
    if (props.width !== undefined) this.width = props.width;
    if (props.value !== undefined) {
      this.value = props.value;
      this.cursorPos = props.value.length;
    }
    if (props.placeholder !== undefined) this.placeholder = props.placeholder;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.bg !== undefined) this.bg = props.bg;
    if (props.placeholderFg !== undefined) this.placeholderFg = props.placeholderFg;
    if (props.cursorChar !== undefined) this.cursorChar = props.cursorChar;
  }

  validateCursorPos(pos: number): number {
    return Math.max(0, Math.min(this.value.length, Math.floor(pos)));
  }

  handleKeypress(event: KeyEvent): boolean {
    if (event.key === 'enter') {
      this.emit(new InputSubmitted(this.value));
      return true;
    }

    if (event.key === 'backspace') {
      if (this.cursorPos > 0) {
        const before = this.value.slice(0, this.cursorPos - 1);
        const after = this.value.slice(this.cursorPos);
        this.value = before + after;
        this.cursorPos = this.cursorPos - 1;
        this.emit(new InputChanged(this.value));
      }
      return true;
    }

    if (event.key === 'delete') {
      if (this.cursorPos < this.value.length) {
        const before = this.value.slice(0, this.cursorPos);
        const after = this.value.slice(this.cursorPos + 1);
        this.value = before + after;
        this.emit(new InputChanged(this.value));
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

    if (event.key === 'home') {
      this.cursorPos = 0;
      return true;
    }

    if (event.key === 'end') {
      this.cursorPos = this.value.length;
      return true;
    }

    if (event.ctrl || event.alt) return false;
    if (event.key.length === 1 && event.key.charCodeAt(0) >= 0x20) {
      const before = this.value.slice(0, this.cursorPos);
      const after = this.value.slice(this.cursorPos);
      this.value = before + event.key + after;
      this.cursorPos = this.cursorPos + 1;
      this.emit(new InputChanged(this.value));
      return true;
    }

    return false;
  }

  render(buffer: ClippedCellBuffer): void {
    const fgColor = resolveColor(this.fg);
    const bgColor = resolveColor(this.bg);
    const baseStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: fgColor, bg: bgColor };

    if (bgColor.kind !== 'default') {
      for (let r = 0; r < buffer.rows; r += 1) {
        buffer.fillRow(r, baseStyle);
      }
    }

    if (this.value.length === 0 && !this.focused) {
      if (this.placeholder.length > 0) {
        const phFg = resolveColor(this.placeholderFg);
        const phStyle: CellStyle = {
          ...DEFAULT_CELL_STYLE,
          fg: phFg.kind !== 'default' ? phFg : { kind: 'indexed', index: 244 },
          bg: bgColor,
        };
        const truncated = layout.truncate(this.placeholder, buffer.cols);
        buffer.drawText(0, 0, truncated, phStyle);
      }
      return;
    }

    const displayText = this.value;
    const cursorInRange =
      this.focused && this.cursorPos >= 0 && this.cursorPos <= displayText.length;

    if (!cursorInRange) {
      const truncated = layout.truncate(displayText, buffer.cols);
      buffer.drawText(0, 0, truncated, baseStyle);
      return;
    }

    const before = displayText.slice(0, this.cursorPos);
    const after = displayText.slice(this.cursorPos);
    const cursorGlyph =
      this.cursorPos < displayText.length ? displayText[this.cursorPos]! : this.cursorChar;
    const renderText =
      this.cursorPos < displayText.length
        ? before + cursorGlyph + after.slice(1)
        : before + this.cursorChar;

    const truncated = layout.truncate(renderText, buffer.cols);
    buffer.drawText(0, 0, truncated, baseStyle);

    const cursorCol = measureDisplayWidth(before);
    if (cursorCol < buffer.cols) {
      const cursorStyle: CellStyle = { ...baseStyle, inverse: true };
      const cell = buffer.getCell(cursorCol, 0);
      if (cell !== null) {
        cell.style = cursorStyle;
      }
    }
  }
}

export function TextInput(props: TextInputProps = {}): TextInputWidget {
  return new TextInputWidget(props);
}
