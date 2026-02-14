import { createWriteStream, readFileSync, type WriteStream } from 'node:fs';
import type { TerminalSnapshotFrame } from '../terminal/snapshot-oracle.ts';

interface TerminalRecordingHeader {
  schemaVersion: '1';
  source: string;
  createdAt: string;
  defaultForegroundHex: string;
  defaultBackgroundHex: string;
}

interface TerminalRecordingFrameSample {
  atMs: number;
  frame: TerminalSnapshotFrame;
}

interface TerminalRecording {
  header: TerminalRecordingHeader;
  frames: TerminalRecordingFrameSample[];
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

type RecordingLineRecord = HeaderLineRecord | FrameLineRecord;

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
    defaultBackgroundHex: normalizeHex6(defaultBackgroundHex, '0f1419')
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
      header: parseHeader(value['header'])
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
      frame: parseFrame(value['frame'])
    };
  }

  throw new Error('recording line kind is invalid');
}

export function readTerminalRecording(filePath: string): TerminalRecording {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('recording file is empty');
  }

  const parsed = lines.map((line) => {
    const parsedJson = JSON.parse(line) as unknown;
    return parseLineRecord(parsedJson);
  });

  const first = parsed[0];
  if (first === undefined || first.kind !== 'header') {
    throw new Error('recording file must start with a header line');
  }

  const frames: TerminalRecordingFrameSample[] = [];
  for (let idx = 1; idx < parsed.length; idx += 1) {
    const line = parsed[idx];
    if (line?.kind !== 'frame') {
      throw new Error('recording file contains a non-frame line after header');
    }
    frames.push({
      atMs: line.atMs,
      frame: line.frame
    });
  }

  return {
    header: first.header,
    frames
  };
}

function writeLine(stream: RecordingWriteStream, line: RecordingLineRecord): void {
  stream.write(`${JSON.stringify(line)}\n`);
}

export function createTerminalRecordingWriter(
  options: CreateTerminalRecordingWriterOptions
): TerminalRecordingWriter {
  const minFrameIntervalMs = Math.max(0, Math.floor(options.minFrameIntervalMs ?? 0));
  const nowMs = options.nowMs ?? (() => Date.now());
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const createStream = options.createStream ?? ((filePath: string): WriteStream => createWriteStream(filePath));
  const stream = createStream(options.filePath);

  const header: TerminalRecordingHeader = {
    schemaVersion: '1',
    source: options.source,
    createdAt: nowIso(),
    defaultForegroundHex: normalizeHex6(options.defaultForegroundHex, 'd0d7de'),
    defaultBackgroundHex: normalizeHex6(options.defaultBackgroundHex, '0f1419')
  };
  writeLine(stream, {
    kind: 'header',
    header
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

      const atMs = nowMs();
      if (lastFrameHash === frame.frameHash) {
        return false;
      }
      if (lastRecordedAtMs !== null && atMs - lastRecordedAtMs < minFrameIntervalMs) {
        return false;
      }

      writeLine(stream, {
        kind: 'frame',
        atMs,
        frame
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
      await new Promise<void>((resolve, reject) => {
        stream.once('finish', resolve);
        stream.once('error', reject);
        stream.end();
      });
      if (fatalError !== null) {
        throw fatalError;
      }
    }
  };
}
