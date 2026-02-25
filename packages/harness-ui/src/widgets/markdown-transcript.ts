import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';
import { parseMarkdown, type MarkdownBlock, type MarkdownSpan } from './markdown.ts';
import { buildDataTableCompactLines, type DataTableCompactLine } from './data-table-compact.ts';

const layout = new TextLayoutEngine();

export type MarkdownTranscriptLineKind =
  | 'blank'
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'list-item'
  | 'code-line'
  | 'horizontal-rule'
  | 'diff-add'
  | 'diff-remove'
  | 'table-border'
  | 'table-header'
  | 'table-row'
  | 'table-meta';

export interface MarkdownTranscriptLine {
  readonly kind: MarkdownTranscriptLineKind;
  readonly text: string;
}

export interface BuildMarkdownTranscriptLinesInput {
  readonly text: string;
  readonly width: number;
  readonly tableMaxRows?: number;
}

function plainText(spans: readonly MarkdownSpan[]): string {
  return spans.map((span) => span.text).join('');
}

function isTableDelimiterRow(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function isTableDataRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && trimmed.replace(/\|/g, '').trim().length > 0;
}

function splitTableRow(line: string): readonly string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((cell) => cell.trim());
}

type TranscriptBlock =
  | { readonly kind: 'markdown'; readonly block: MarkdownBlock }
  | {
      readonly kind: 'table';
      readonly header: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

function parseTranscriptBlocks(text: string): readonly TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  const lines = text.split('\n');
  const markdownBuffer: string[] = [];

  const flushMarkdown = (): void => {
    if (markdownBuffer.length === 0) return;
    for (const block of parseMarkdown(markdownBuffer.join('\n'))) {
      blocks.push({ kind: 'markdown', block });
    }
    markdownBuffer.length = 0;
  };

  for (let index = 0; index < lines.length; ) {
    const current = lines[index]!;
    const next = index + 1 < lines.length ? lines[index + 1]! : null;
    if (next !== null && isTableDataRow(current) && isTableDelimiterRow(next)) {
      flushMarkdown();
      const header = splitTableRow(current);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && isTableDataRow(lines[index]!)) {
        rows.push([...splitTableRow(lines[index]!)]);
        index += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    markdownBuffer.push(current);
    index += 1;
  }

  flushMarkdown();
  return blocks;
}

function pushWrapped(
  lines: MarkdownTranscriptLine[],
  kind: MarkdownTranscriptLineKind,
  text: string,
  width: number,
  prefix = '',
): void {
  const safeWidth = Math.max(1, width - layout.measure(prefix));
  const wrapped = layout.wrap(text, safeWidth);
  const source = wrapped.length > 0 ? wrapped : [''];
  for (const line of source) {
    lines.push({ kind, text: `${prefix}${line}` });
  }
}

function mapTableLineKind(kind: DataTableCompactLine['kind']): MarkdownTranscriptLineKind {
  if (kind === 'border') return 'table-border';
  if (kind === 'header') return 'table-header';
  if (kind === 'meta') return 'table-meta';
  return 'table-row';
}

function renderMarkdownBlock(
  lines: MarkdownTranscriptLine[],
  block: MarkdownBlock,
  width: number,
): void {
  switch (block.kind) {
    case 'blank':
      lines.push({ kind: 'blank', text: '' });
      return;
    case 'heading':
      pushWrapped(lines, 'heading', plainText(block.spans), width);
      return;
    case 'blockquote':
      pushWrapped(lines, 'blockquote', plainText(block.spans), width, '▌ ');
      return;
    case 'list-item': {
      const indent = '  '.repeat(Math.max(0, block.level ?? 0));
      pushWrapped(lines, 'list-item', plainText(block.spans), width, `${indent}• `);
      return;
    }
    case 'code-block': {
      const source = block.rawLines && block.rawLines.length > 0 ? block.rawLines : [''];
      for (const rawLine of source) {
        pushWrapped(lines, 'code-line', rawLine, width);
      }
      return;
    }
    case 'horizontal-rule':
      lines.push({ kind: 'horizontal-rule', text: '─'.repeat(Math.max(4, width)) });
      return;
    case 'paragraph': {
      const text = plainText(block.spans);
      if (text.startsWith('+') && text.length > 1) {
        pushWrapped(lines, 'diff-add', text, width);
      } else if (text.startsWith('-') && text.length > 1) {
        pushWrapped(lines, 'diff-remove', text, width);
      } else {
        pushWrapped(lines, 'paragraph', text, width);
      }
      return;
    }
    default:
      return;
  }
}

export function buildMarkdownTranscriptLines(
  input: BuildMarkdownTranscriptLinesInput,
): MarkdownTranscriptLine[] {
  const safeWidth = Math.max(8, Math.floor(input.width));
  const lines: MarkdownTranscriptLine[] = [];
  for (const block of parseTranscriptBlocks(input.text)) {
    if (block.kind === 'table') {
      const tableLines = buildDataTableCompactLines({
        header: block.header,
        rows: block.rows,
        width: safeWidth,
        ...(input.tableMaxRows === undefined ? {} : { maxRows: input.tableMaxRows }),
      });
      for (const tableLine of tableLines) {
        lines.push({ kind: mapTableLineKind(tableLine.kind), text: tableLine.text });
      }
    } else {
      renderMarkdownBlock(lines, block.block, safeWidth);
    }
  }
  return lines;
}

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

export interface MarkdownTranscriptColors {
  readonly text?: string;
  readonly heading?: string;
  readonly quote?: string;
  readonly code?: string;
  readonly meta?: string;
  readonly add?: string;
  readonly remove?: string;
  readonly border?: string;
}

export interface MarkdownTranscriptProps {
  readonly id?: string;
  readonly content?: string;
  readonly tableMaxRows?: number;
  readonly colors?: MarkdownTranscriptColors;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

export class MarkdownTranscriptWidget extends Widget {
  content = reactive('');
  tableMaxRows = reactive(8);
  colors = reactive<MarkdownTranscriptColors>({});

  constructor(props: MarkdownTranscriptProps = {}) {
    super(props.id);
    if (props.content !== undefined) this.content = props.content;
    if (props.tableMaxRows !== undefined) this.tableMaxRows = props.tableMaxRows;
    if (props.colors !== undefined) this.colors = props.colors;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  render(buffer: ClippedCellBuffer): void {
    const c = this.colors;
    const baseStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: resolveColor(c.text) };
    const headingStyle: CellStyle = { ...baseStyle, fg: resolveColor(c.heading), bold: true };
    const quoteStyle: CellStyle = { ...baseStyle, fg: resolveColor(c.quote), dim: true };
    const codeStyle: CellStyle = { ...baseStyle, fg: resolveColor(c.code) };
    const borderStyle: CellStyle = { ...baseStyle, fg: resolveColor(c.border) };
    const addStyle: CellStyle = { ...baseStyle, fg: resolveColor(c.add) };
    const removeStyle: CellStyle = { ...baseStyle, fg: resolveColor(c.remove) };
    const metaStyle: CellStyle = { ...baseStyle, fg: resolveColor(c.meta), dim: true };

    const lines = buildMarkdownTranscriptLines({
      text: this.content,
      width: buffer.cols,
      tableMaxRows: this.tableMaxRows,
    });
    const count = Math.min(buffer.rows, lines.length);
    for (let row = 0; row < count; row += 1) {
      const line = lines[row]!;
      const style =
        line.kind === 'heading' || line.kind === 'table-header'
          ? headingStyle
          : line.kind === 'blockquote'
            ? quoteStyle
            : line.kind === 'code-line'
              ? codeStyle
              : line.kind === 'table-border' || line.kind === 'horizontal-rule'
                ? borderStyle
                : line.kind === 'diff-add'
                  ? addStyle
                  : line.kind === 'diff-remove'
                    ? removeStyle
                    : line.kind === 'table-meta'
                      ? metaStyle
                      : baseStyle;
      buffer.drawText(0, row, layout.truncate(line.text, buffer.cols), style);
    }
  }
}

export function MarkdownTranscript(props: MarkdownTranscriptProps = {}): MarkdownTranscriptWidget {
  return new MarkdownTranscriptWidget(props);
}
