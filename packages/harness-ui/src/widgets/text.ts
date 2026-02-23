import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { measureDisplayWidth, TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

export type TextAlign = 'left' | 'center' | 'right';

export interface TextProps {
  readonly id?: string;
  readonly content?: string;
  readonly fg?: string;
  readonly bg?: string;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly align?: TextAlign;
  readonly wrap?: boolean;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const layout = new TextLayoutEngine();

export class TextWidget extends Widget {
  content = reactive('');
  fg = reactive<string | undefined>(undefined);
  bg = reactive<string | undefined>(undefined);
  bold = reactive(false);
  dim = reactive(false);
  italic = reactive(false);
  underline = reactive(false);
  align = reactive<TextAlign>('left');
  wrap = reactive(true);

  constructor(props: TextProps = {}) {
    super(props.id);
    if (props.content !== undefined) this.content = props.content;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.bg !== undefined) this.bg = props.bg;
    if (props.bold !== undefined) this.bold = props.bold;
    if (props.dim !== undefined) this.dim = props.dim;
    if (props.italic !== undefined) this.italic = props.italic;
    if (props.underline !== undefined) this.underline = props.underline;
    if (props.align !== undefined) this.align = props.align;
    if (props.wrap !== undefined) this.wrap = props.wrap;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  private resolveStyle(): CellStyle {
    return {
      fg: resolveColor(this.fg),
      bg: resolveColor(this.bg),
      bold: this.bold,
      dim: this.dim,
      italic: this.italic,
      underline: this.underline,
      inverse: false,
    };
  }

  render(buffer: ClippedCellBuffer): void {
    const style = this.resolveStyle();
    const text = this.content;

    if (text.length === 0) return;

    const lines = this.wrap ? layout.wrap(text, buffer.cols) : text.split('\n');

    for (let i = 0; i < lines.length && i < buffer.rows; i += 1) {
      const line = lines[i]!;
      const truncated = layout.truncate(line, buffer.cols);
      const textWidth = measureDisplayWidth(truncated);

      let col = 0;
      if (this.align === 'center') {
        col = Math.max(0, Math.floor((buffer.cols - textWidth) / 2));
      } else if (this.align === 'right') {
        col = Math.max(0, buffer.cols - textWidth);
      }

      buffer.drawText(col, i, truncated, style);
    }
  }
}

export function Text(props: TextProps = {}): TextWidget {
  return new TextWidget(props);
}
