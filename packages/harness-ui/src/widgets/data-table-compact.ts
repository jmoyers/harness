import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

const layout = new TextLayoutEngine();

export type DataTableCompactLineKind = 'border' | 'header' | 'row' | 'meta';

export interface DataTableCompactLine {
  readonly kind: DataTableCompactLineKind;
  readonly text: string;
}

export interface BuildDataTableCompactLinesInput {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly width: number;
  readonly maxRows?: number;
  readonly maxColumnWidth?: number;
}

function tableLineWidth(widths: readonly number[]): number {
  let total = 1;
  for (const width of widths) {
    total += width + 3;
  }
  return total;
}

function normalizeRow(row: readonly string[], columns: number): string[] {
  const normalized = Array.from({ length: columns }, () => '');
  for (let index = 0; index < columns; index += 1) {
    normalized[index] = row[index] ?? '';
  }
  return normalized;
}

function fitWidths(widths: number[], maxWidth: number): void {
  let totalWidth = tableLineWidth(widths);
  while (totalWidth > maxWidth) {
    let widestIndex = -1;
    let widest = 0;
    for (let index = 0; index < widths.length; index += 1) {
      if (widths[index]! > widest) {
        widest = widths[index]!;
        widestIndex = index;
      }
    }
    if (widestIndex === -1 || widest <= 4) break;
    widths[widestIndex] = widest - 1;
    totalWidth = tableLineWidth(widths);
  }
}

function padCell(value: string, width: number): string {
  const truncated = layout.truncate(value, width);
  const pad = Math.max(0, width - layout.measure(truncated));
  return truncated + ' '.repeat(pad);
}

export function buildDataTableCompactLines(
  input: BuildDataTableCompactLinesInput,
): DataTableCompactLine[] {
  const safeWidth = Math.max(12, Math.floor(input.width));
  const maxRows = Math.max(1, Math.floor(input.maxRows ?? 8));
  const maxColumnWidth = Math.max(4, Math.floor(input.maxColumnWidth ?? 48));
  const columnCount = Math.max(1, input.header.length, ...input.rows.map((row) => row.length));
  const normalizedHeader = normalizeRow(
    input.header.length > 0
      ? input.header
      : Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`),
    columnCount,
  );
  const normalizedRows = input.rows.map((row) => normalizeRow(row, columnCount));
  const visibleRows = normalizedRows.slice(0, maxRows);

  const widths = Array.from({ length: columnCount }, () => 4);
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    let maxCellWidth = layout.measure(normalizedHeader[columnIndex]!);
    for (const row of visibleRows) {
      maxCellWidth = Math.max(maxCellWidth, layout.measure(row[columnIndex]!));
    }
    widths[columnIndex] = Math.min(maxColumnWidth, Math.max(4, maxCellWidth));
  }
  fitWidths(widths, safeWidth);

  if (tableLineWidth(widths) > safeWidth) {
    const fallback: DataTableCompactLine[] = [];
    fallback.push({
      kind: 'header',
      text: layout.truncate(normalizedHeader.join(' | '), safeWidth),
    });
    for (const row of visibleRows) {
      fallback.push({ kind: 'row', text: layout.truncate(row.join(' | '), safeWidth) });
    }
    if (normalizedRows.length > visibleRows.length) {
      fallback.push({
        kind: 'meta',
        text: `${normalizedRows.length} rows (showing ${visibleRows.length})`,
      });
    }
    return fallback;
  }

  const border = (left: string, join: string, right: string): string =>
    `${left}${widths.map((width) => '─'.repeat(width + 2)).join(join)}${right}`;
  const rowLine = (cells: readonly string[]): string => {
    let output = '│';
    for (let index = 0; index < columnCount; index += 1) {
      output += ` ${padCell(cells[index] ?? '', widths[index]!)} │`;
    }
    return output;
  };

  const lines: DataTableCompactLine[] = [];
  lines.push({ kind: 'border', text: border('┌', '┬', '┐') });
  lines.push({ kind: 'header', text: rowLine(normalizedHeader) });
  lines.push({ kind: 'border', text: border('├', '┼', '┤') });
  for (const row of visibleRows) {
    lines.push({ kind: 'row', text: rowLine(row) });
  }
  lines.push({ kind: 'border', text: border('└', '┴', '┘') });
  if (normalizedRows.length > visibleRows.length) {
    lines.push({
      kind: 'meta',
      text: `${normalizedRows.length} rows (showing ${visibleRows.length})`,
    });
  }
  return lines;
}

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

export interface DataTableCompactProps {
  readonly id?: string;
  readonly header?: readonly string[];
  readonly rows?: readonly (readonly string[])[];
  readonly maxRows?: number;
  readonly maxColumnWidth?: number;
  readonly fg?: string;
  readonly headerFg?: string;
  readonly borderFg?: string;
  readonly metaFg?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

export class DataTableCompactWidget extends Widget {
  header = reactive<readonly string[]>([]);
  rows = reactive<readonly (readonly string[])[]>([]);
  maxRows = reactive(8);
  maxColumnWidth = reactive(48);
  fg = reactive<string | undefined>(undefined);
  headerFg = reactive<string | undefined>(undefined);
  borderFg = reactive<string | undefined>(undefined);
  metaFg = reactive<string | undefined>(undefined);

  constructor(props: DataTableCompactProps = {}) {
    super(props.id);
    if (props.header !== undefined) this.header = props.header;
    if (props.rows !== undefined) this.rows = props.rows;
    if (props.maxRows !== undefined) this.maxRows = props.maxRows;
    if (props.maxColumnWidth !== undefined) this.maxColumnWidth = props.maxColumnWidth;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.headerFg !== undefined) this.headerFg = props.headerFg;
    if (props.borderFg !== undefined) this.borderFg = props.borderFg;
    if (props.metaFg !== undefined) this.metaFg = props.metaFg;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  render(buffer: ClippedCellBuffer): void {
    const baseStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: resolveColor(this.fg) };
    const headerStyle: CellStyle = {
      ...baseStyle,
      fg: resolveColor(this.headerFg),
      bold: true,
    };
    const borderStyle: CellStyle = {
      ...baseStyle,
      fg: resolveColor(this.borderFg),
    };
    const metaStyle: CellStyle = {
      ...baseStyle,
      fg: resolveColor(this.metaFg),
      dim: true,
    };

    const lines = buildDataTableCompactLines({
      header: this.header,
      rows: this.rows,
      width: buffer.cols,
      maxRows: this.maxRows,
      maxColumnWidth: this.maxColumnWidth,
    });
    const count = Math.min(buffer.rows, lines.length);
    for (let row = 0; row < count; row += 1) {
      const line = lines[row]!;
      const style =
        line.kind === 'border'
          ? borderStyle
          : line.kind === 'header'
            ? headerStyle
            : line.kind === 'meta'
              ? metaStyle
              : baseStyle;
      buffer.drawText(0, row, layout.truncate(line.text, buffer.cols), style);
    }
  }
}

export function DataTableCompact(props: DataTableCompactProps = {}): DataTableCompactWidget {
  return new DataTableCompactWidget(props);
}
