function isWideCodePoint(codePoint: number): boolean {
  const ranges: ReadonlyArray<readonly [number, number]> = [
    [0x1100, 0x115f],
    [0x2329, 0x232a],
    [0x2e80, 0xa4cf],
    [0xac00, 0xd7a3],
    [0xf900, 0xfaff],
    [0xfe10, 0xfe19],
    [0xfe30, 0xfe6f],
    [0xff00, 0xff60],
    [0xffe0, 0xffe6],
    [0x1f300, 0x1faff],
  ];
  for (const [start, end] of ranges) {
    if (codePoint >= start && codePoint <= end) {
      return true;
    }
  }
  return false;
}

export function measureDisplayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
      continue;
    }
    if (/\p{Mark}/u.test(char)) {
      continue;
    }
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

export function wrapTextForColumns(text: string, cols: number): string[] {
  if (cols <= 0) {
    return [''];
  }

  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const char of text) {
    if (char === '\n') {
      lines.push(current);
      current = '';
      currentWidth = 0;
      continue;
    }
    const charWidth = Math.max(1, measureDisplayWidth(char));
    if (currentWidth + charWidth > cols) {
      lines.push(current);
      current = '';
      currentWidth = 0;
    }
    current += char;
    currentWidth += charWidth;
  }
  lines.push(current);
  return lines;
}

export interface WrappingInputBuffer {
  readonly text: string;
  readonly cursor: number;
}

export interface RenderWrappingInputLinesOptions {
  readonly buffer: WrappingInputBuffer;
  readonly width: number;
  readonly cursorVisible?: boolean;
  readonly cursorToken?: string;
  readonly linePrefix?: string;
}

function normalizedCursor(buffer: WrappingInputBuffer): number {
  if (!Number.isFinite(buffer.cursor)) {
    return buffer.text.length;
  }
  return Math.max(0, Math.min(buffer.text.length, Math.floor(buffer.cursor)));
}

function consumedGlyphsText(consumed: ReadonlyArray<{ glyph: string; width: number }>): string {
  let output = '';
  for (const entry of consumed) {
    output += entry.glyph;
  }
  return output;
}

export class TextLayoutEngine {
  public measure(text: string): number {
    return measureDisplayWidth(text);
  }

  public wrap(text: string, cols: number): readonly string[] {
    return wrapTextForColumns(text, cols);
  }

  public truncate(text: string, width: number): string {
    const safeWidth = Math.max(0, Math.floor(width));
    if (safeWidth === 0 || text.length === 0) {
      return '';
    }

    const consumed: Array<{ glyph: string; width: number }> = [];
    let consumedWidth = 0;
    let truncated = false;
    for (const glyph of text) {
      const glyphWidth = Math.max(1, this.measure(glyph));
      if (consumedWidth + glyphWidth > safeWidth) {
        truncated = true;
        break;
      }
      consumed.push({ glyph, width: glyphWidth });
      consumedWidth += glyphWidth;
    }

    if (!truncated) {
      return consumedGlyphsText(consumed);
    }
    if (safeWidth === 1) {
      return '…';
    }
    while (consumed.length > 0 && consumedWidth + 1 > safeWidth) {
      const removed = consumed.pop()!;
      consumedWidth -= removed.width;
    }
    return `${consumedGlyphsText(consumed)}…`;
  }
}

export class WrappingInputRenderer {
  constructor(private readonly layout: TextLayoutEngine = new TextLayoutEngine()) {}

  public renderLines(options: RenderWrappingInputLinesOptions): readonly string[] {
    const cursor = normalizedCursor(options.buffer);
    const cursorToken = options.cursorToken ?? '█';
    const linePrefix = options.linePrefix ?? '';
    const cursorVisible = options.cursorVisible ?? true;
    const textWithCursor = !cursorVisible
      ? options.buffer.text
      : cursor >= options.buffer.text.length
        ? `${options.buffer.text}${cursorToken}`
        : options.buffer.text.slice(0, cursor) +
          cursorToken +
          options.buffer.text.slice(cursor + 1);
    const logicalLines = textWithCursor.split('\n');
    const wrapped: string[] = [];
    for (const line of logicalLines) {
      wrapped.push(...this.layout.wrap(`${linePrefix}${line}`, options.width));
    }
    return wrapped.length === 0 ? [''] : wrapped;
  }
}
