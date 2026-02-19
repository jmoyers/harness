import { closeSync, createWriteStream, openSync, readSync, type WriteStream } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { TextDecoder } from 'node:util';
import type { TerminalSnapshotFrame } from '../terminal/snapshot-oracle.ts';

interface TerminalRecordingHeader {
  schemaVersion: '1';
  source: string;
  createdAt: string;
  defaultForegroundHex: string;
  defaultBackgroundHex: string;
  ansiPaletteIndexedHex?: Record<string, string>;
}

interface TerminalRecordingFrameSample {
  atMs: number;
  frame: TerminalSnapshotFrame;
}

interface TerminalRecording {
  header: TerminalRecordingHeader;
  frames: TerminalRecordingFrameSample[];
  finishedAtMs: number | null;
}

interface HeaderLineRecord {
  kind: 'header';
  header: TerminalRecordingHeader;
}

interface FrameLineRecord {
  kind: 'frame';
  atMs: number;
  frame: TerminalSnapshotFrame;
}

interface FooterLineRecord {
  kind: 'footer';
  finishedAtMs: number;
}

type RecordingLineRecord = HeaderLineRecord | FrameLineRecord | FooterLineRecord;

interface RecordingWriteStream {
  write(chunk: string): boolean;
  end(callback?: () => void): void;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'finish', listener: () => void): this;
}

interface CreateTerminalRecordingWriterOptions {
  filePath: string;
  source: string;
  defaultForegroundHex: string;
  defaultBackgroundHex: string;
  ansiPaletteIndexedHex?: Readonly<Record<number, string>>;
  minFrameIntervalMs?: number;
  nowMs?: () => number;
  nowIso?: () => string;
  createStream?: (path: string) => RecordingWriteStream;
}

interface TerminalRecordingWriter {
  capture(frame: TerminalSnapshotFrame): boolean;
  close(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeHex6(value: string, fallback: string): string {
  const normalized = value.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }
  return fallback;
}

export function parseOptionalAnsiPaletteIndexedHex(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (!/^\d+$/u.test(key)) {
      continue;
    }
    const parsedKey = Number.parseInt(key, 10);
    if (parsedKey < 0 || parsedKey > 255) {
      continue;
    }
    if (typeof entryValue !== 'string') {
      continue;
    }
    normalized[String(parsedKey)] = normalizeHex6(entryValue, '');
  }

  if (Object.keys(normalized).length === 0) {
    return undefined;
  }

  return normalized;
}

function parseHeader(value: unknown): TerminalRecordingHeader {
  if (!isRecord(value)) {
    throw new Error('recording header is not an object');
  }

  if (value['schemaVersion'] !== '1') {
    throw new Error('recording header schemaVersion must be "1"');
  }

  const source = value['source'];
  const createdAt = value['createdAt'];
  const defaultForegroundHex = value['defaultForegroundHex'];
  const defaultBackgroundHex = value['defaultBackgroundHex'];
  const ansiPaletteIndexedHex = parseOptionalAnsiPaletteIndexedHex(value['ansiPaletteIndexedHex']);
  if (
    typeof source !== 'string' ||
    source.length === 0 ||
    typeof createdAt !== 'string' ||
    createdAt.length === 0 ||
    typeof defaultForegroundHex !== 'string' ||
    typeof defaultBackgroundHex !== 'string'
  ) {
    throw new Error('recording header is missing required fields');
  }

  return {
    schemaVersion: '1',
    source,
    createdAt,
    defaultForegroundHex: normalizeHex6(defaultForegroundHex, 'd0d7de'),
    defaultBackgroundHex: normalizeHex6(defaultBackgroundHex, '0f1419'),
    ...(ansiPaletteIndexedHex !== undefined
      ? {
          ansiPaletteIndexedHex,
        }
      : {}),
  };
}

function parseFrame(value: unknown): TerminalSnapshotFrame {
  if (!isRecord(value)) {
    throw new Error('recording frame is not an object');
  }

  const rows = value['rows'];
  const cols = value['cols'];
  const lines = value['lines'];
  const richLines = value['richLines'];
  if (
    typeof rows !== 'number' ||
    !Number.isInteger(rows) ||
    rows <= 0 ||
    typeof cols !== 'number' ||
    !Number.isInteger(cols) ||
    cols <= 0 ||
    !Array.isArray(lines) ||
    !Array.isArray(richLines)
  ) {
    throw new Error('recording frame shape is invalid');
  }

  return value as unknown as TerminalSnapshotFrame;
}

function parseLineRecord(value: unknown): RecordingLineRecord {
  if (!isRecord(value)) {
    throw new Error('recording line is not an object');
  }

  const kind = value['kind'];
  if (kind === 'header') {
    return {
      kind: 'header',
      header: parseHeader(value['header']),
    };
  }
  if (kind === 'frame') {
    const atMs = value['atMs'];
    if (typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs < 0) {
      throw new Error('recording frame atMs must be a non-negative number');
    }
    return {
      kind: 'frame',
      atMs,
      frame: parseFrame(value['frame']),
    };
  }
  if (kind === 'footer') {
    const finishedAtMs = value['finishedAtMs'];
    if (typeof finishedAtMs !== 'number' || !Number.isFinite(finishedAtMs) || finishedAtMs < 0) {
      throw new Error('recording footer finishedAtMs must be a non-negative number');
    }
    return {
      kind: 'footer',
      finishedAtMs,
    };
  }

  throw new Error('recording line kind is invalid');
}

export function readTerminalRecording(filePath: string): TerminalRecording {
  const CHUNK_BYTES = 64 * 1024;
  const fd = openSync(filePath, 'r');
  const decoder = new TextDecoder();
  const readBuffer = Buffer.allocUnsafe(CHUNK_BYTES);
  let remainder = '';
  let sawNonEmptyLine = false;
  let header: TerminalRecordingHeader | null = null;
  const frames: TerminalRecordingFrameSample[] = [];
  let finishedAtMs: number | null = null;

  const consumeLine = (line: string): void => {
    if (line.trim().length === 0) {
      return;
    }
    sawNonEmptyLine = true;
    const parsedJson = JSON.parse(line) as unknown;
    const parsedLine = parseLineRecord(parsedJson);
    if (header === null) {
      if (parsedLine.kind !== 'header') {
        throw new Error('recording file must start with a header line');
      }
      header = parsedLine.header;
      return;
    }
    if (parsedLine.kind === 'frame') {
      frames.push({
        atMs: parsedLine.atMs,
        frame: parsedLine.frame,
      });
      return;
    }
    if (parsedLine.kind === 'footer') {
      finishedAtMs = parsedLine.finishedAtMs;
      return;
    }
    throw new Error('recording file contains a non-frame line after header');
  };

  try {
    while (true) {
      const bytesRead = readSync(fd, readBuffer, 0, CHUNK_BYTES, null);
      if (bytesRead <= 0) {
        break;
      }
      const decodedChunk = decoder.decode(readBuffer.subarray(0, bytesRead), {
        stream: true,
      });
      let text = remainder + decodedChunk;
      let newlineIndex = text.indexOf('\n');
      while (newlineIndex !== -1) {
        consumeLine(text.slice(0, newlineIndex));
        text = text.slice(newlineIndex + 1);
        newlineIndex = text.indexOf('\n');
      }
      remainder = text;
    }

    remainder += decoder.decode();
    if (remainder.length > 0) {
      consumeLine(remainder);
    }
  } finally {
    closeSync(fd);
  }

  if (!sawNonEmptyLine) {
    throw new Error('recording file is empty');
  }

  return {
    header: header!,
    frames,
    finishedAtMs,
  };
}

function writeLine(stream: RecordingWriteStream, line: RecordingLineRecord): void {
  stream.write(`${JSON.stringify(line)}\n`);
}

export function createTerminalRecordingWriter(
  options: CreateTerminalRecordingWriterOptions,
): TerminalRecordingWriter {
  const minFrameIntervalMs = Math.max(0, Math.floor(options.minFrameIntervalMs ?? 0));
  const nowMs = options.nowMs ?? (() => performance.now());
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const createStream =
    options.createStream ?? ((filePath: string): WriteStream => createWriteStream(filePath));
  const stream = createStream(options.filePath);
  const startedAtMs = nowMs();
  const ansiPaletteIndexedHex = (() => {
    const sourcePalette = options.ansiPaletteIndexedHex;
    if (sourcePalette === undefined) {
      return undefined;
    }
    const normalized: Record<string, string> = {};
    for (const [key, entryValue] of Object.entries(sourcePalette)) {
      if (!/^\d+$/u.test(key)) {
        continue;
      }
      const parsedKey = Number.parseInt(key, 10);
      if (parsedKey < 0 || parsedKey > 255) {
        continue;
      }
      normalized[String(parsedKey)] = normalizeHex6(entryValue, '');
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  })();

  const header: TerminalRecordingHeader = {
    schemaVersion: '1',
    source: options.source,
    createdAt: nowIso(),
    defaultForegroundHex: normalizeHex6(options.defaultForegroundHex, 'd0d7de'),
    defaultBackgroundHex: normalizeHex6(options.defaultBackgroundHex, '0f1419'),
    ...(ansiPaletteIndexedHex !== undefined
      ? {
          ansiPaletteIndexedHex,
        }
      : {}),
  };
  writeLine(stream, {
    kind: 'header',
    header,
  });

  let closed = false;
  let fatalError: Error | null = null;
  let lastRecordedAtMs: number | null = null;
  let lastFrameHash: string | null = null;

  stream.once('error', (error: Error) => {
    fatalError = error;
  });

  return {
    capture(frame): boolean {
      if (closed || fatalError !== null) {
        return false;
      }

      const atMs = Math.max(0, nowMs() - startedAtMs);
      if (lastFrameHash === frame.frameHash) {
        return false;
      }
      if (lastRecordedAtMs !== null && atMs - lastRecordedAtMs < minFrameIntervalMs) {
        return false;
      }

      writeLine(stream, {
        kind: 'frame',
        atMs,
        frame,
      });
      lastRecordedAtMs = atMs;
      lastFrameHash = frame.frameHash;
      return true;
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      writeLine(stream, {
        kind: 'footer',
        finishedAtMs: Math.max(0, nowMs() - startedAtMs),
      });
      await new Promise<void>((resolve, reject) => {
        stream.once('finish', resolve);
        stream.once('error', reject);
        stream.end();
      });
      if (fatalError !== null) {
        throw fatalError;
      }
    },
  };
}
