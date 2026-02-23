import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { measureDisplayWidth, TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const layout = new TextLayoutEngine();

export type ColumnAlign = 'left' | 'center' | 'right';

export interface TableColumn {
  readonly header: string;
  readonly width?: number;
  readonly flexGrow?: number;
  readonly align?: ColumnAlign;
}

export interface TableProps {
  readonly id?: string;
  readonly columns?: readonly TableColumn[];
  readonly rows?: readonly (readonly string[])[];
  readonly fg?: string;
  readonly headerFg?: string;
  readonly headerBg?: string;
  readonly borderFg?: string;
  readonly showHeader?: boolean;
  readonly showBorder?: boolean;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

function resolveColumnWidths(columns: readonly TableColumn[], totalWidth: number): number[] {
  const widths: number[] = [];
  let fixedTotal = 0;
  let growTotal = 0;
  for (const col of columns) {
    if (col.width !== undefined && col.width > 0) {
      widths.push(col.width);
      fixedTotal += col.width;
    } else {
      widths.push(0);
      growTotal += col.flexGrow ?? 1;
    }
  }
  const separators = Math.max(0, columns.length - 1);
  const remaining = Math.max(0, totalWidth - fixedTotal - separators);
  for (let i = 0; i < columns.length; i += 1) {
    if (widths[i] === 0) {
      const grow = columns[i]!.flexGrow ?? 1;
      widths[i] = growTotal > 0 ? Math.floor((remaining * grow) / growTotal) : 0;
    }
  }
  return widths;
}

function alignText(text: string, width: number, align: ColumnAlign): string {
  const truncated = layout.truncate(text, width);
  const textWidth = measureDisplayWidth(truncated);
  const pad = Math.max(0, width - textWidth);
  if (align === 'right') return ' '.repeat(pad) + truncated;
  if (align === 'center') {
    const left = Math.floor(pad / 2);
    return ' '.repeat(left) + truncated + ' '.repeat(pad - left);
  }
  return truncated + ' '.repeat(pad);
}

export class TableWidget extends Widget {
  columns = reactive<readonly TableColumn[]>([]);
  rows = reactive<readonly (readonly string[])[]>([]);
  fg = reactive<string | undefined>(undefined);
  headerFg = reactive<string | undefined>(undefined);
  headerBg = reactive<string | undefined>(undefined);
  borderFg = reactive<string | undefined>(undefined);
  showHeader = reactive(true);
  showBorder = reactive(true);

  constructor(props: TableProps = {}) {
    super(props.id);
    if (props.columns !== undefined) this.columns = props.columns;
    if (props.rows !== undefined) this.rows = props.rows;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.headerFg !== undefined) this.headerFg = props.headerFg;
    if (props.headerBg !== undefined) this.headerBg = props.headerBg;
    if (props.borderFg !== undefined) this.borderFg = props.borderFg;
    if (props.showHeader !== undefined) this.showHeader = props.showHeader;
    if (props.showBorder !== undefined) this.showBorder = props.showBorder;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  render(buffer: ClippedCellBuffer): void {
    if (this.columns.length === 0) return;
    const fgColor = resolveColor(this.fg);
    const hdrFg = resolveColor(this.headerFg);
    const hdrBg = resolveColor(this.headerBg);
    const brdFg = resolveColor(this.borderFg);

    const bodyStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: fgColor };
    const headerStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: hdrFg.kind !== 'default' ? hdrFg : fgColor,
      bg: hdrBg,
      bold: true,
    };
    const borderStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: brdFg.kind !== 'default' ? brdFg : { kind: 'indexed', index: 240 },
    };

    const colWidths = resolveColumnWidths(this.columns, buffer.cols);
    let viewRow = 0;

    if (this.showHeader && viewRow < buffer.rows) {
      let col = 0;
      for (let i = 0; i < this.columns.length; i += 1) {
        const colDef = this.columns[i]!;
        const w = colWidths[i]!;
        const aligned = alignText(colDef.header, w, colDef.align ?? 'left');
        buffer.drawText(col, viewRow, aligned, headerStyle);
        col += w;
        if (i < this.columns.length - 1 && col < buffer.cols) {
          buffer.drawText(col, viewRow, '│', borderStyle);
          col += 1;
        }
      }
      viewRow += 1;
    }

    if (this.showBorder && this.showHeader && viewRow < buffer.rows) {
      let col = 0;
      for (let i = 0; i < this.columns.length; i += 1) {
        const w = colWidths[i]!;
        buffer.drawText(col, viewRow, '─'.repeat(w), borderStyle);
        col += w;
        if (i < this.columns.length - 1 && col < buffer.cols) {
          buffer.drawText(col, viewRow, '┼', borderStyle);
          col += 1;
        }
      }
      viewRow += 1;
    }

    for (const row of this.rows) {
      if (viewRow >= buffer.rows) break;
      let col = 0;
      for (let i = 0; i < this.columns.length; i += 1) {
        const w = colWidths[i]!;
        const cellText = row[i] ?? '';
        const align = this.columns[i]!.align ?? 'left';
        const aligned = alignText(cellText, w, align);
        buffer.drawText(col, viewRow, aligned, bodyStyle);
        col += w;
        if (i < this.columns.length - 1 && col < buffer.cols) {
          buffer.drawText(col, viewRow, '│', borderStyle);
          col += 1;
        }
      }
      viewRow += 1;
    }
  }
}

export function Table(props: TableProps = {}): TableWidget {
  return new TableWidget(props);
}
