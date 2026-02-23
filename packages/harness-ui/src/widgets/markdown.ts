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

export type MarkdownSpanKind = 'text' | 'bold' | 'italic' | 'code' | 'link' | 'link-text';

export interface MarkdownSpan {
  readonly kind: MarkdownSpanKind;
  readonly text: string;
}

export type MarkdownBlockKind =
  | 'paragraph'
  | 'heading'
  | 'code-block'
  | 'blockquote'
  | 'list-item'
  | 'horizontal-rule'
  | 'blank';

export interface MarkdownBlock {
  readonly kind: MarkdownBlockKind;
  readonly level?: number;
  readonly language?: string;
  readonly spans: readonly MarkdownSpan[];
  readonly rawLines?: readonly string[];
}

export function parseMarkdown(text: string): MarkdownBlock[] {
  const lines = text.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim().length === 0) {
      blocks.push({ kind: 'blank', spans: [] });
      i += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const codeBlock: MarkdownBlock = {
        kind: 'code-block',
        spans: [],
        rawLines: codeLines,
        ...(lang.length > 0 ? { language: lang } : {}),
      };
      blocks.push(codeBlock);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch !== null) {
      const level = headingMatch[1]!.length;
      blocks.push({ kind: 'heading', level, spans: parseInlineSpans(headingMatch[2]!) });
      i += 1;
      continue;
    }

    if (line.match(/^[-*_]{3,}\s*$/)) {
      blocks.push({ kind: 'horizontal-rule', spans: [] });
      i += 1;
      continue;
    }

    if (line.startsWith('> ')) {
      blocks.push({ kind: 'blockquote', spans: parseInlineSpans(line.slice(2)) });
      i += 1;
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)]) (.*)$/);
    if (listMatch !== null) {
      const indent = listMatch[1]!.length;
      blocks.push({
        kind: 'list-item',
        level: Math.floor(indent / 2),
        spans: parseInlineSpans(listMatch[3]!),
      });
      i += 1;
      continue;
    }

    blocks.push({ kind: 'paragraph', spans: parseInlineSpans(line) });
    i += 1;
  }

  return blocks;
}

function parseInlineSpans(text: string): MarkdownSpan[] {
  const spans: MarkdownSpan[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch !== null) {
      spans.push({ kind: 'bold', text: boldMatch[1]! });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch !== null) {
      spans.push({ kind: 'italic', text: italicMatch[1]! });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch !== null) {
      spans.push({ kind: 'code', text: codeMatch[1]! });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch !== null) {
      spans.push({ kind: 'link-text', text: linkMatch[1]! });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    const nextSpecial = remaining.search(/[*`[]/);
    if (nextSpecial > 0) {
      spans.push({ kind: 'text', text: remaining.slice(0, nextSpecial) });
      remaining = remaining.slice(nextSpecial);
    } else if (nextSpecial === -1) {
      spans.push({ kind: 'text', text: remaining });
      remaining = '';
    } else {
      spans.push({ kind: 'text', text: remaining[0]! });
      remaining = remaining.slice(1);
    }
  }

  return spans;
}

export interface MarkdownThemeColors {
  readonly text?: string;
  readonly heading?: string;
  readonly bold?: string;
  readonly italic?: string;
  readonly code?: string;
  readonly codeBlock?: string;
  readonly codeBlockBg?: string;
  readonly blockquote?: string;
  readonly link?: string;
  readonly listMarker?: string;
  readonly horizontalRule?: string;
}

export interface MarkdownProps {
  readonly id?: string;
  readonly content?: string;
  readonly colors?: MarkdownThemeColors;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

export class MarkdownWidget extends Widget {
  content = reactive('');
  colors = reactive<MarkdownThemeColors>({});
  scrollOffset = reactive(0);

  constructor(props: MarkdownProps = {}) {
    super(props.id);
    if (props.content !== undefined) this.content = props.content;
    if (props.colors !== undefined) this.colors = props.colors;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  append(text: string): void {
    this.content = this.content + text;
  }

  private resolveStyle(kind: MarkdownSpanKind | MarkdownBlockKind): CellStyle {
    const c = this.colors;
    const base = DEFAULT_CELL_STYLE;
    if (kind === 'heading') return { ...base, fg: resolveColor(c.heading), bold: true };
    if (kind === 'bold') return { ...base, fg: resolveColor(c.bold ?? c.text), bold: true };
    if (kind === 'italic') return { ...base, fg: resolveColor(c.italic ?? c.text), italic: true };
    if (kind === 'code') return { ...base, fg: resolveColor(c.code) };
    if (kind === 'link' || kind === 'link-text')
      return { ...base, fg: resolveColor(c.link), underline: true };
    if (kind === 'blockquote') return { ...base, fg: resolveColor(c.blockquote), dim: true };
    if (kind === 'code-block') return { ...base, fg: resolveColor(c.codeBlock) };
    if (kind === 'list-item') return { ...base, fg: resolveColor(c.text) };
    if (kind === 'horizontal-rule')
      return { ...base, fg: resolveColor(c.horizontalRule), dim: true };
    return { ...base, fg: resolveColor(c.text) };
  }

  render(buffer: ClippedCellBuffer): void {
    const blocks = parseMarkdown(this.content);
    const rendered = this.renderBlocks(blocks, buffer.cols);
    const totalLines = rendered.length;

    if (totalLines > buffer.rows) {
      this.scrollOffset = Math.max(0, totalLines - buffer.rows);
    }

    for (let viewRow = 0; viewRow < buffer.rows; viewRow += 1) {
      const lineIdx = this.scrollOffset + viewRow;
      if (lineIdx >= rendered.length) break;
      const spans = rendered[lineIdx]!;
      let col = 0;
      for (const span of spans) {
        const truncated = layout.truncate(span.text, buffer.cols - col);
        if (truncated.length > 0) {
          buffer.drawText(col, viewRow, truncated, span.style);
          col += measureDisplayWidth(truncated);
        }
      }
    }
  }

  private renderBlocks(
    blocks: readonly MarkdownBlock[],
    width: number,
  ): ReadonlyArray<ReadonlyArray<{ text: string; style: CellStyle }>> {
    const lines: Array<Array<{ text: string; style: CellStyle }>> = [];

    for (const block of blocks) {
      if (block.kind === 'blank') {
        lines.push([]);
        continue;
      }

      if (block.kind === 'horizontal-rule') {
        lines.push([{ text: '─'.repeat(width), style: this.resolveStyle('horizontal-rule') }]);
        continue;
      }

      if (block.kind === 'code-block') {
        const cbStyle = this.resolveStyle('code-block');
        const bgColor = resolveColor(this.colors.codeBlockBg);
        const cbStyleWithBg: CellStyle =
          bgColor.kind !== 'default' ? { ...cbStyle, bg: bgColor } : cbStyle;
        const lang = block.language ?? '';
        if (lang.length > 0) {
          lines.push([{ text: `  ${lang}`, style: { ...cbStyleWithBg, dim: true } }]);
        }
        for (const rawLine of block.rawLines ?? []) {
          lines.push([{ text: `  ${rawLine}`, style: cbStyleWithBg }]);
        }
        continue;
      }

      if (block.kind === 'heading') {
        const prefix = '#'.repeat(block.level ?? 1) + ' ';
        const headStyle = this.resolveStyle('heading');
        const spanLine = this.renderSpanLine(block.spans, headStyle);
        lines.push([{ text: prefix, style: headStyle }, ...spanLine]);
        continue;
      }

      if (block.kind === 'blockquote') {
        const marker = '▌ ';
        const bqStyle = this.resolveStyle('blockquote');
        const spanLine = this.renderSpanLine(block.spans, bqStyle);
        lines.push([{ text: marker, style: bqStyle }, ...spanLine]);
        continue;
      }

      if (block.kind === 'list-item') {
        const indent = '  '.repeat(block.level ?? 0);
        const marker = '• ';
        const markerStyle = this.resolveStyle('list-item');
        const lmColor = resolveColor(this.colors.listMarker);
        const markerColorStyle: CellStyle =
          lmColor.kind !== 'default' ? { ...markerStyle, fg: lmColor } : markerStyle;
        const spanLine = this.renderSpanLine(block.spans, markerStyle);
        lines.push([{ text: `${indent}${marker}`, style: markerColorStyle }, ...spanLine]);
        continue;
      }

      const paraStyle = this.resolveStyle('paragraph');
      const spanLine = this.renderSpanLine(block.spans, paraStyle);
      lines.push(spanLine);
    }

    return lines;
  }

  private renderSpanLine(
    spans: readonly MarkdownSpan[],
    defaultStyle: CellStyle,
  ): Array<{ text: string; style: CellStyle }> {
    return spans.map((span) => ({
      text: span.text,
      style: span.kind === 'text' ? defaultStyle : this.resolveStyle(span.kind),
    }));
  }
}

export function Markdown(props: MarkdownProps = {}): MarkdownWidget {
  return new MarkdownWidget(props);
}
