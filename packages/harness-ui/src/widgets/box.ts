import { Widget, edgeInsets, type LayoutValue, type EdgeInsets } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { measureDisplayWidth, TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

export type BorderStyle = 'none' | 'single' | 'double' | 'rounded' | 'heavy';
export type BorderEdge = 'top' | 'right' | 'bottom' | 'left';

interface BoxGlyphs {
  readonly tl: string;
  readonly tr: string;
  readonly bl: string;
  readonly br: string;
  readonly h: string;
  readonly v: string;
}

const BORDER_GLYPHS: Record<Exclude<BorderStyle, 'none'>, BoxGlyphs> = {
  single: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
  rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  heavy: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
};

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const layout = new TextLayoutEngine();

export interface BoxProps {
  readonly id?: string;
  readonly borderStyle?: BorderStyle;
  readonly borderEdges?: readonly BorderEdge[];
  readonly borderColor?: string;
  readonly backgroundColor?: string;
  readonly hoverBackgroundColor?: string;
  readonly title?: string;
  readonly titleAlign?: 'left' | 'center' | 'right';
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
  readonly flexShrink?: number;
  readonly flexDirection?: 'row' | 'column';
  readonly gap?: number;
  readonly padding?: EdgeInsets | number;
  readonly alignItems?: 'start' | 'center' | 'end' | 'stretch';
  readonly justifyContent?: 'start' | 'center' | 'end' | 'space-between';
  readonly onMouseOver?: () => void;
  readonly onMouseOut?: () => void;
  readonly onMouseUp?: () => void;
}

export class BoxWidget extends Widget {
  borderStyle = reactive<BorderStyle>('none');
  borderEdges = reactive<readonly BorderEdge[] | null>(null);
  borderColor = reactive<string | undefined>(undefined);
  backgroundColor = reactive<string | undefined>(undefined);
  hoverBackgroundColor = reactive<string | undefined>(undefined);
  hovered = reactive(false);
  title = reactive('');
  titleAlign = reactive<'left' | 'center' | 'right'>('left');

  private _onMouseOver: (() => void) | null = null;
  private _onMouseOut: (() => void) | null = null;
  private _onMouseUp: (() => void) | null = null;

  constructor(props: BoxProps = {}) {
    super(props.id);
    if (props.borderStyle !== undefined) this.borderStyle = props.borderStyle;
    if (props.borderEdges !== undefined) this.borderEdges = props.borderEdges;
    if (props.borderColor !== undefined) this.borderColor = props.borderColor;
    if (props.backgroundColor !== undefined) this.backgroundColor = props.backgroundColor;
    if (props.hoverBackgroundColor !== undefined)
      this.hoverBackgroundColor = props.hoverBackgroundColor;
    if (props.title !== undefined) this.title = props.title;
    if (props.titleAlign !== undefined) this.titleAlign = props.titleAlign;
    if (props.onMouseOver !== undefined) this._onMouseOver = props.onMouseOver;
    if (props.onMouseOut !== undefined) this._onMouseOut = props.onMouseOut;
    if (props.onMouseUp !== undefined) this._onMouseUp = props.onMouseUp;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
    if (props.flexShrink !== undefined) this.flexShrink = props.flexShrink;
    if (props.flexDirection !== undefined) this.flexDirection = props.flexDirection;
    if (props.gap !== undefined) this.gap = props.gap;
    if (props.alignItems !== undefined) this.alignItems = props.alignItems;
    if (props.justifyContent !== undefined) this.justifyContent = props.justifyContent;

    if (props.padding !== undefined) {
      this.padding = typeof props.padding === 'number' ? edgeInsets(props.padding) : props.padding;
    }

    if (props.borderStyle !== undefined && props.borderStyle !== 'none') {
      const bp = this.padding;
      this.padding = edgeInsets(
        Math.max(1, bp.top),
        Math.max(1, bp.right),
        Math.max(1, bp.bottom),
        Math.max(1, bp.left),
      );
    }
  }

  mouseOver(): void {
    this.hovered = true;
    this._onMouseOver?.();
  }

  mouseOut(): void {
    this.hovered = false;
    this._onMouseOut?.();
  }

  mouseUp(): void {
    this._onMouseUp?.();
  }

  private hasEdge(edge: BorderEdge): boolean {
    if (this.borderEdges === null) return true;
    return this.borderEdges.includes(edge);
  }

  render(buffer: ClippedCellBuffer): void {
    const useBg =
      this.hovered && this.hoverBackgroundColor !== undefined
        ? resolveColor(this.hoverBackgroundColor)
        : resolveColor(this.backgroundColor);
    if (useBg.kind !== 'default') {
      const bgStyle: CellStyle = { ...DEFAULT_CELL_STYLE, bg: useBg };
      for (let row = 0; row < buffer.rows; row += 1) {
        buffer.fillRow(row, bgStyle);
      }
    }

    if (this.borderStyle === 'none') return;

    const glyphs = BORDER_GLYPHS[this.borderStyle];
    const borderFg = resolveColor(this.borderColor);
    const borderStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: borderFg,
      bg: useBg.kind !== 'default' ? useBg : DEFAULT_CELL_STYLE.bg,
    };

    if (buffer.rows < 1 || buffer.cols < 1) return;

    const drawTop = this.hasEdge('top');
    const drawBottom = this.hasEdge('bottom');
    const drawLeft = this.hasEdge('left');
    const drawRight = this.hasEdge('right');

    if (drawTop) {
      const hBar = glyphs.h.repeat(
        Math.max(0, buffer.cols - (drawLeft ? 1 : 0) - (drawRight ? 1 : 0)),
      );
      const left = drawLeft ? glyphs.tl : '';
      const right = drawRight ? glyphs.tr : '';
      buffer.drawText(0, 0, `${left}${hBar}${right}`, borderStyle);
    }

    if (drawBottom && buffer.rows > 1) {
      const bottomRow = buffer.rows - 1;
      const hBar = glyphs.h.repeat(
        Math.max(0, buffer.cols - (drawLeft ? 1 : 0) - (drawRight ? 1 : 0)),
      );
      const left = drawLeft ? glyphs.bl : '';
      const right = drawRight ? glyphs.br : '';
      buffer.drawText(0, bottomRow, `${left}${hBar}${right}`, borderStyle);
    }

    const startRow = drawTop ? 1 : 0;
    const endRow = drawBottom ? buffer.rows - 1 : buffer.rows;
    for (let row = startRow; row < endRow; row += 1) {
      if (drawLeft) buffer.drawText(0, row, glyphs.v, borderStyle);
      if (drawRight) buffer.drawText(buffer.cols - 1, row, glyphs.v, borderStyle);
    }

    if (this.title.length > 0 && buffer.cols > 4 && drawTop) {
      const maxTitleWidth = buffer.cols - 4;
      const truncated = layout.truncate(this.title, maxTitleWidth);
      const titleWidth = measureDisplayWidth(truncated);
      const titleText = ` ${truncated} `;

      let col = 1;
      if (this.titleAlign === 'center') {
        col = Math.max(1, Math.floor((buffer.cols - titleWidth - 2) / 2));
      } else if (this.titleAlign === 'right') {
        col = Math.max(1, buffer.cols - titleWidth - 3);
      }

      const titleStyle: CellStyle = {
        ...DEFAULT_CELL_STYLE,
        fg: borderFg,
        bg: useBg.kind !== 'default' ? useBg : DEFAULT_CELL_STYLE.bg,
        bold: true,
      };
      buffer.drawText(col, 0, titleText, titleStyle);
    }
  }
}

export function Box(props: BoxProps = {}, ...children: Widget[]): BoxWidget {
  const box = new BoxWidget(props);
  if (children.length > 0) box.add(...children);
  return box;
}

export function Row(props: Omit<BoxProps, 'flexDirection'> = {}, ...children: Widget[]): BoxWidget {
  return Box({ ...props, flexDirection: 'row' }, ...children);
}

export function Column(
  props: Omit<BoxProps, 'flexDirection'> = {},
  ...children: Widget[]
): BoxWidget {
  return Box({ ...props, flexDirection: 'column' }, ...children);
}

export class SpacerWidget extends Widget {
  constructor(id?: string) {
    super(id);
    this.flexGrow = 1;
  }
  render(): void {}
}

export function Spacer(id?: string): SpacerWidget {
  return new SpacerWidget(id);
}
