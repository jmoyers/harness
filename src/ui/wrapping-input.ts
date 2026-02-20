import { wrapTextForColumns } from '../terminal/snapshot-oracle.ts';

interface WrappingInputBuffer {
  readonly text: string;
  readonly cursor: number;
}

interface RenderWrappingInputLinesOptions {
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

export function renderWrappingInputLines(
  options: RenderWrappingInputLinesOptions,
): readonly string[] {
  const cursor = normalizedCursor(options.buffer);
  const cursorToken = options.cursorToken ?? '█';
  const linePrefix = options.linePrefix ?? '';
  const cursorVisible = options.cursorVisible ?? true;
  const textWithCursor = !cursorVisible
    ? options.buffer.text
    : cursor >= options.buffer.text.length
      ? `${options.buffer.text}${cursorToken}`
      : options.buffer.text.slice(0, cursor) + cursorToken + options.buffer.text.slice(cursor + 1);
  const logicalLines = textWithCursor.split('\n');
  const wrapped: string[] = [];
  for (const line of logicalLines) {
    wrapped.push(...wrapTextForColumns(`${linePrefix}${line}`, options.width));
  }
  return wrapped.length === 0 ? [''] : wrapped;
}
