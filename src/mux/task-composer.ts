export interface TaskComposerBuffer {
  readonly text: string;
  readonly cursor: number;
}

interface VerticalMoveResult {
  readonly next: TaskComposerBuffer;
  readonly hitBoundary: boolean;
}

interface LineRange {
  readonly start: number;
  readonly end: number;
}

function clampCursor(text: string, cursor: number): number {
  if (!Number.isFinite(cursor)) {
    return text.length;
  }
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

function lineRanges(text: string): readonly LineRange[] {
  if (text.length === 0) {
    return [{ start: 0, end: 0 }];
  }
  const ranges: LineRange[] = [];
  let start = 0;
  for (let idx = 0; idx < text.length; idx += 1) {
    if (text[idx] !== '\n') {
      continue;
    }
    ranges.push({ start, end: idx });
    start = idx + 1;
  }
  ranges.push({ start, end: text.length });
  return ranges;
}

function locateCursorLine(
  text: string,
  cursor: number,
): {
  readonly ranges: readonly LineRange[];
  readonly lineIndex: number;
  readonly column: number;
} {
  const ranges = lineRanges(text);
  let lineIndex = 0;
  let column = 0;
  for (let idx = 0; idx < ranges.length; idx += 1) {
    const range = ranges[idx]!;
    if (cursor >= range.start && cursor <= range.end) {
      lineIndex = idx;
      column = cursor - range.start;
      break;
    }
  }
  return {
    ranges,
    lineIndex,
    column,
  };
}

function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9_]/u.test(char);
}

export function createTaskComposerBuffer(text = ''): TaskComposerBuffer {
  return {
    text,
    cursor: text.length,
  };
}

export function normalizeTaskComposerBuffer(buffer: TaskComposerBuffer): TaskComposerBuffer {
  return {
    text: buffer.text,
    cursor: clampCursor(buffer.text, buffer.cursor),
  };
}

export function replaceTaskComposerText(
  buffer: TaskComposerBuffer,
  text: string,
  cursor = text.length,
): TaskComposerBuffer {
  return {
    text,
    cursor: clampCursor(text, cursor),
  };
}

export function insertTaskComposerText(
  buffer: TaskComposerBuffer,
  value: string,
): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  const head = normalized.text.slice(0, normalized.cursor);
  const tail = normalized.text.slice(normalized.cursor);
  const nextText = `${head}${value}${tail}`;
  return {
    text: nextText,
    cursor: normalized.cursor + value.length,
  };
}

export function taskComposerBackspace(buffer: TaskComposerBuffer): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  if (normalized.cursor === 0) {
    return normalized;
  }
  const nextText =
    normalized.text.slice(0, normalized.cursor - 1) + normalized.text.slice(normalized.cursor);
  return {
    text: nextText,
    cursor: normalized.cursor - 1,
  };
}

export function taskComposerDeleteForward(buffer: TaskComposerBuffer): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  if (normalized.cursor >= normalized.text.length) {
    return normalized;
  }
  const nextText =
    normalized.text.slice(0, normalized.cursor) + normalized.text.slice(normalized.cursor + 1);
  return {
    text: nextText,
    cursor: normalized.cursor,
  };
}

export function taskComposerMoveLeft(buffer: TaskComposerBuffer): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  return {
    text: normalized.text,
    cursor: Math.max(0, normalized.cursor - 1),
  };
}

export function taskComposerMoveRight(buffer: TaskComposerBuffer): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  return {
    text: normalized.text,
    cursor: Math.min(normalized.text.length, normalized.cursor + 1),
  };
}

export function taskComposerMoveLineStart(buffer: TaskComposerBuffer): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  const located = locateCursorLine(normalized.text, normalized.cursor);
  return {
    text: normalized.text,
    cursor: located.ranges[located.lineIndex]!.start,
  };
}

export function taskComposerMoveLineEnd(buffer: TaskComposerBuffer): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  const located = locateCursorLine(normalized.text, normalized.cursor);
  return {
    text: normalized.text,
    cursor: located.ranges[located.lineIndex]!.end,
  };
}

export function taskComposerMoveWordLeft(buffer: TaskComposerBuffer): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  let cursor = normalized.cursor;
  while (cursor > 0 && /\s/u.test(normalized.text[cursor - 1]!)) {
    cursor -= 1;
  }
  while (cursor > 0 && isWordChar(normalized.text[cursor - 1]!)) {
    cursor -= 1;
  }
  return {
    text: normalized.text,
    cursor,
  };
}

export function taskComposerMoveWordRight(buffer: TaskComposerBuffer): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  let cursor = normalized.cursor;
  while (cursor < normalized.text.length && /\s/u.test(normalized.text[cursor]!)) {
    cursor += 1;
  }
  while (cursor < normalized.text.length && isWordChar(normalized.text[cursor]!)) {
    cursor += 1;
  }
  return {
    text: normalized.text,
    cursor,
  };
}

export function taskComposerDeleteWordLeft(buffer: TaskComposerBuffer): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  const moved = taskComposerMoveWordLeft(normalized);
  if (moved.cursor === normalized.cursor) {
    return normalized;
  }
  return {
    text: normalized.text.slice(0, moved.cursor) + normalized.text.slice(normalized.cursor),
    cursor: moved.cursor,
  };
}

export function taskComposerDeleteToLineStart(buffer: TaskComposerBuffer): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  const lineStart = taskComposerMoveLineStart(normalized).cursor;
  if (lineStart === normalized.cursor) {
    return normalized;
  }
  return {
    text: normalized.text.slice(0, lineStart) + normalized.text.slice(normalized.cursor),
    cursor: lineStart,
  };
}

export function taskComposerDeleteToLineEnd(buffer: TaskComposerBuffer): TaskComposerBuffer {
  const normalized = normalizeTaskComposerBuffer(buffer);
  const lineEnd = taskComposerMoveLineEnd(normalized).cursor;
  if (lineEnd === normalized.cursor) {
    return normalized;
  }
  return {
    text: normalized.text.slice(0, normalized.cursor) + normalized.text.slice(lineEnd),
    cursor: normalized.cursor,
  };
}

export function taskComposerMoveVertical(
  buffer: TaskComposerBuffer,
  direction: -1 | 1,
): VerticalMoveResult {
  const normalized = normalizeTaskComposerBuffer(buffer);
  const located = locateCursorLine(normalized.text, normalized.cursor);
  const targetLineIndex = located.lineIndex + direction;
  if (targetLineIndex < 0 || targetLineIndex >= located.ranges.length) {
    return {
      next: normalized,
      hitBoundary: true,
    };
  }
  const target = located.ranges[targetLineIndex]!;
  const targetLength = target.end - target.start;
  return {
    next: {
      text: normalized.text,
      cursor: target.start + Math.min(located.column, targetLength),
    },
    hitBoundary: false,
  };
}

export function taskComposerVisibleLines(
  buffer: TaskComposerBuffer,
  cursorToken = '_',
): readonly string[] {
  const normalized = normalizeTaskComposerBuffer(buffer);
  const textWithCursor =
    normalized.text.slice(0, normalized.cursor) +
    cursorToken +
    normalized.text.slice(normalized.cursor);
  return textWithCursor.split('\n');
}

export function taskComposerTextFromTaskFields(title: string, body: string): string {
  if (body.length > 0) {
    return body;
  }
  return title;
}

export function taskFieldsFromComposerText(text: string): {
  readonly title: string | null;
  readonly body: string;
} {
  const normalized = text.replace(/\r\n/gu, '\n');
  const lines = normalized.split('\n');
  const firstLine = lines[0] ?? '';
  const title = firstLine.trim();
  return {
    title: title.length === 0 ? null : title,
    body: normalized,
  };
}
