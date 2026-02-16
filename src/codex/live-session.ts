import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startSingleSessionBroker,
  type BrokerAttachmentHandlers,
  type BrokerDataEvent
} from '../pty/session-broker.ts';
import type { PtyExit } from '../pty/pty_host.ts';
import {
  TerminalSnapshotOracle,
  type TerminalSnapshotFrame,
  type TerminalSnapshotFrameCore
} from '../terminal/snapshot-oracle.ts';
import { recordPerfEvent } from '../perf/perf-core.ts';

interface StartPtySessionOptions {
  command?: string;
  commandArgs?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  initialCols?: number;
  initialRows?: number;
}

interface SessionBrokerLike {
  attach(handlers: BrokerAttachmentHandlers, sinceCursor?: number): string;
  detach(attachmentId: string): void;
  latestCursorValue(): number;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): void;
  processId(): number | null;
}

interface StartCodexLiveSessionOptions {
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  baseArgs?: string[];
  useNotifyHook?: boolean;
  notifyFilePath?: string;
  notifyPollMs?: number;
  relayScriptPath?: string;
  maxBacklogBytes?: number;
  initialCols?: number;
  initialRows?: number;
  terminalForegroundHex?: string;
  terminalBackgroundHex?: string;
  enableSnapshotModel?: boolean;
}

interface NotifyRecord {
  ts: string;
  payload: NotifyPayload;
}

interface NotifyPayload {
  [key: string]: unknown;
}

export type CodexLiveEvent =
  | {
      type: 'terminal-output';
      cursor: number;
      chunk: Buffer;
    }
  | {
      type: 'notify';
      record: NotifyRecord;
    }
  | {
      type: 'session-exit';
      exit: PtyExit;
    };

interface LiveSessionDependencies {
  startBroker?: (options?: StartPtySessionOptions, maxBacklogBytes?: number) => SessionBrokerLike;
  readFile?: (path: string) => string;
  setIntervalFn?: (callback: () => void, intervalMs: number) => NodeJS.Timeout;
  clearIntervalFn?: (handle: NodeJS.Timeout) => void;
}

const DEFAULT_COMMAND = 'codex';
const DEFAULT_BASE_ARGS = ['--no-alt-screen'];
const DEFAULT_NOTIFY_POLL_MS = 100;
const DEFAULT_RELAY_SCRIPT_PATH = fileURLToPath(
  new URL('../../scripts/codex-notify-relay.ts', import.meta.url)
);
const DEFAULT_TERMINAL_FOREGROUND_HEX = 'd0d7de';
const DEFAULT_TERMINAL_BACKGROUND_HEX = '0f1419';
const DEFAULT_INDEXED_TERMINAL_HEX_BY_CODE: Readonly<Record<number, string>> = {
  0: '0f1419',
  1: 'f47067',
  2: '8ccf7e',
  3: 'e6c07b',
  4: '6cb6ff',
  5: 'd38aea',
  6: '39c5cf',
  7: 'd0d7de',
  8: '5c6370',
  9: 'ff938a',
  10: 'a4e98c',
  11: 'f4d399',
  12: '8bc5ff',
  13: 'e2a7f3',
  14: '56d4dd',
  15: 'f5f7fa'
};

interface TerminalPalette {
  foregroundOsc: string;
  backgroundOsc: string;
  indexedOscByCode: Readonly<Record<number, string>>;
}

export function normalizeTerminalColorHex(value: string | undefined, fallbackHex: string): string {
  if (typeof value !== 'string') {
    return fallbackHex;
  }

  const normalized = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized.toLowerCase();
  }
  return fallbackHex;
}

export function terminalHexToOscColor(hexColor: string): string {
  const normalized = normalizeTerminalColorHex(hexColor, DEFAULT_TERMINAL_FOREGROUND_HEX);
  const red = normalized.slice(0, 2);
  const green = normalized.slice(2, 4);
  const blue = normalized.slice(4, 6);
  return `rgb:${red}${red}/${green}${green}/${blue}${blue}`;
}

function buildTerminalPalette(options: StartCodexLiveSessionOptions): TerminalPalette {
  const fallbackForeground = normalizeTerminalColorHex(
    options.env?.HARNESS_TERM_FG,
    DEFAULT_TERMINAL_FOREGROUND_HEX
  );
  const fallbackBackground = normalizeTerminalColorHex(
    options.env?.HARNESS_TERM_BG,
    DEFAULT_TERMINAL_BACKGROUND_HEX
  );
  const foreground = normalizeTerminalColorHex(options.terminalForegroundHex, fallbackForeground);
  const background = normalizeTerminalColorHex(options.terminalBackgroundHex, fallbackBackground);
  const indexedOscByCode: Record<number, string> = {};
  for (const [codeText, defaultHex] of Object.entries(DEFAULT_INDEXED_TERMINAL_HEX_BY_CODE)) {
    const code = Number(codeText);
    indexedOscByCode[code] = terminalHexToOscColor(defaultHex);
  }
  return {
    foregroundOsc: terminalHexToOscColor(foreground),
    backgroundOsc: terminalHexToOscColor(background),
    indexedOscByCode
  };
}

type TerminalQueryParserMode = 'normal' | 'esc' | 'csi' | 'osc' | 'osc-esc' | 'dcs' | 'dcs-esc';

const DEFAULT_DA1_REPLY = '\u001b[?62;4;6;22c';
const DEFAULT_DA2_REPLY = '\u001b[>1;10;0c';
const CELL_PIXEL_HEIGHT = 16;
const CELL_PIXEL_WIDTH = 8;

function tsRuntimeArgs(scriptPath: string, args: readonly string[] = []): string[] {
  return [scriptPath, ...args];
}

export function buildTomlStringArray(values: string[]): string {
  const escaped = values.map((value) => {
    const withBackslashEscaped = value.replaceAll('\\', '\\\\');
    const withQuoteEscaped = withBackslashEscaped.replaceAll('"', '\\"');
    return `"${withQuoteEscaped}"`;
  });
  return `[${escaped.join(',')}]`;
}

export function parseNotifyRecordLine(line: string): NotifyRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as { ts?: unknown; payload?: unknown };
  if (typeof record.ts !== 'string') {
    return null;
  }
  if (typeof record.payload !== 'object' || record.payload === null || Array.isArray(record.payload)) {
    return null;
  }
  return {
    ts: record.ts,
    payload: record.payload as NotifyPayload
  };
}

class TerminalQueryResponder {
  private mode: TerminalQueryParserMode = 'normal';
  private oscPayload = '';
  private csiPayload = '';
  private dcsPayload = '';
  private readonly palette: TerminalPalette;
  private readonly readFrame: () => TerminalSnapshotFrameCore;
  private readonly writeReply: (reply: string) => void;

  constructor(
    palette: TerminalPalette,
    readFrame: () => TerminalSnapshotFrameCore,
    writeReply: (reply: string) => void
  ) {
    this.palette = palette;
    this.readFrame = readFrame;
    this.writeReply = writeReply;
  }

  ingest(chunk: Uint8Array): void {
    const text = Buffer.from(chunk).toString('utf8');
    for (const char of text) {
      this.processChar(char);
    }
  }

  private processChar(char: string): void {
    if (this.mode === 'normal') {
      if (char === '\u001b') {
        this.mode = 'esc';
      }
      return;
    }

    if (this.mode === 'esc') {
      if (char === ']') {
        this.mode = 'osc';
        this.oscPayload = '';
      } else if (char === '[') {
        this.mode = 'csi';
        this.csiPayload = '';
      } else if (char === 'P') {
        this.mode = 'dcs';
        this.dcsPayload = '';
      } else {
        this.mode = 'normal';
      }
      return;
    }

    if (this.mode === 'csi') {
      const code = char.charCodeAt(0);
      if (code >= 0x40 && code <= 0x7e) {
        this.respondToCsiQuery(`${this.csiPayload}${char}`);
        this.mode = 'normal';
        this.csiPayload = '';
        return;
      }
      if (char === '\u001b') {
        this.mode = 'esc';
        this.csiPayload = '';
        return;
      }
      this.csiPayload += char;
      return;
    }

    if (this.mode === 'osc') {
      if (char === '\u0007') {
        this.respondToOscQuery(this.oscPayload, true);
        this.mode = 'normal';
        return;
      }
      if (char === '\u001b') {
        this.mode = 'osc-esc';
        return;
      }
      this.oscPayload += char;
      return;
    }

    if (this.mode === 'dcs') {
      if (char === '\u001b') {
        this.mode = 'dcs-esc';
        return;
      }
      this.dcsPayload += char;
      return;
    }

    if (this.mode === 'dcs-esc') {
      if (char === '\\') {
        this.observeDcsQuery(this.dcsPayload);
        this.mode = 'normal';
        this.dcsPayload = '';
        return;
      }
      this.dcsPayload += '\u001b';
      this.dcsPayload += char;
      this.mode = 'dcs';
      return;
    }

    if (char === '\\') {
      this.respondToOscQuery(this.oscPayload, false);
      this.mode = 'normal';
      return;
    }

    this.oscPayload += '\u001b';
    this.oscPayload += char;
    this.mode = 'osc';
  }

  private respondToOscQuery(payload: string, useBellTerminator: boolean): void {
    const trimmedPayload = payload.trim();
    const terminator = useBellTerminator ? '\u0007' : '\u001b\\';
    let handled = false;

    if (trimmedPayload === '10;?') {
      this.writeReply(`\u001b]10;${this.palette.foregroundOsc}${terminator}`);
      handled = true;
    }

    if (!handled && trimmedPayload === '11;?') {
      this.writeReply(`\u001b]11;${this.palette.backgroundOsc}${terminator}`);
      handled = true;
    }

    if (!handled && trimmedPayload.startsWith('4;') && trimmedPayload.endsWith(';?')) {
      const parts = trimmedPayload.split(';');
      if (parts.length === 3) {
        const code = Number.parseInt(parts[1]!, 10);
        if (Number.isInteger(code)) {
          const color = this.palette.indexedOscByCode[code];
          if (typeof color === 'string') {
            this.writeReply(`\u001b]4;${String(code)};${color}${terminator}`);
            handled = true;
          }
        }
      }
    }
    this.recordQueryObservation('osc', trimmedPayload, handled);
  }

  private respondToCsiQuery(payload: string): void {
    const frame = this.readFrame();
    let handled = false;

    if (payload === 'c' || payload === '0c') {
      this.writeReply(DEFAULT_DA1_REPLY);
      handled = true;
    }

    if (!handled && (payload === '>c' || payload === '>0c')) {
      this.writeReply(DEFAULT_DA2_REPLY);
      handled = true;
    }

    if (!handled && payload === '5n') {
      this.writeReply('\u001b[0n');
      handled = true;
    }

    if (!handled && payload === '6n') {
      const row = Math.max(1, Math.floor(frame.cursor.row + 1));
      const col = Math.max(1, Math.floor(frame.cursor.col + 1));
      this.writeReply(`\u001b[${String(row)};${String(col)}R`);
      handled = true;
    }

    if (!handled && payload === '14t') {
      const pixelHeight = Math.max(1, frame.rows * CELL_PIXEL_HEIGHT);
      const pixelWidth = Math.max(1, frame.cols * CELL_PIXEL_WIDTH);
      this.writeReply(`\u001b[4;${String(pixelHeight)};${String(pixelWidth)}t`);
      handled = true;
    }

    if (!handled && payload === '16t') {
      this.writeReply(`\u001b[6;${String(CELL_PIXEL_HEIGHT)};${String(CELL_PIXEL_WIDTH)}t`);
      handled = true;
    }

    if (!handled && payload === '18t') {
      this.writeReply(`\u001b[8;${String(frame.rows)};${String(frame.cols)}t`);
      handled = true;
    }

    if (!handled && payload === '?u') {
      this.writeReply('\u001b[?0u');
      handled = true;
    }
    this.recordQueryObservation('csi', payload, handled);
  }

  private observeDcsQuery(payload: string): void {
    const trimmedPayload = payload.trim();
    this.recordQueryObservation('dcs', trimmedPayload, false);
  }

  private recordQueryObservation(kind: 'csi' | 'osc' | 'dcs', payload: string, handled: boolean): void {
    if (kind === 'csi' && !this.isLikelyCsiQueryPayload(payload)) {
      return;
    }
    if (kind === 'osc' && !payload.includes('?')) {
      return;
    }
    recordPerfEvent('codex.terminal-query', {
      kind,
      payload: payload.slice(0, 120),
      handled
    });
  }

  private isLikelyCsiQueryPayload(payload: string): boolean {
    if (/^(?:c|0c|>c|>0c)$/.test(payload)) {
      return true;
    }
    if (/^[0-9]*n$/.test(payload)) {
      return true;
    }
    if (/^(?:14|16|18)t$/.test(payload)) {
      return true;
    }
    if (/^>0q$/.test(payload)) {
      return true;
    }
    if (/^\?[0-9;]*\$p$/.test(payload)) {
      return true;
    }
    if (payload === '?u') {
      return true;
    }
    return false;
  }
}

class CodexLiveSession {
  private readonly broker: SessionBrokerLike;
  private readonly readFile: (path: string) => string;
  private readonly clearIntervalFn: (handle: NodeJS.Timeout) => void;
  private readonly notifyFilePath: string;
  private readonly listeners = new Set<(event: CodexLiveEvent) => void>();
  private readonly snapshotOracle: TerminalSnapshotOracle;
  private readonly snapshotModelEnabled: boolean;
  private readonly terminalQueryResponder: TerminalQueryResponder;
  private readonly brokerAttachmentId: string;
  private readonly notifyTimer: NodeJS.Timeout | null;
  private notifyOffset = 0;
  private notifyRemainder = '';
  private closed = false;

  constructor(
    options: StartCodexLiveSessionOptions = {},
    dependencies: LiveSessionDependencies = {}
  ) {
    const initialCols = options.initialCols ?? 80;
    const initialRows = options.initialRows ?? 24;
    this.snapshotOracle = new TerminalSnapshotOracle(initialCols, initialRows);
    this.snapshotModelEnabled = options.enableSnapshotModel ?? true;

    const command = options.command ?? DEFAULT_COMMAND;
    const useNotifyHook = options.useNotifyHook ?? false;
    const notifyPollMs = options.notifyPollMs ?? DEFAULT_NOTIFY_POLL_MS;
    this.notifyFilePath =
      options.notifyFilePath ??
      join(tmpdir(), `harness-codex-notify-${process.pid}-${randomUUID()}.jsonl`);
    const relayScriptPath = resolve(options.relayScriptPath ?? DEFAULT_RELAY_SCRIPT_PATH);
    const notifyCommand = ['/usr/bin/env', process.execPath, ...tsRuntimeArgs(relayScriptPath, [this.notifyFilePath])];
    const commandArgs = [
      ...(options.baseArgs ?? DEFAULT_BASE_ARGS),
      ...(useNotifyHook ? ['-c', `notify=${buildTomlStringArray(notifyCommand)}`] : []),
      ...(options.args ?? [])
    ];

    const startBroker = dependencies.startBroker ?? startSingleSessionBroker;
    this.readFile = dependencies.readFile ?? ((path) => readFileSync(path, 'utf8'));
    const setIntervalFn = dependencies.setIntervalFn ?? setInterval;
    this.clearIntervalFn = dependencies.clearIntervalFn ?? clearInterval;

    const startOptions: StartPtySessionOptions = {
      command,
      commandArgs,
      initialCols,
      initialRows
    };
    if (options.env !== undefined) {
      startOptions.env = options.env;
    }
    if (options.cwd !== undefined) {
      startOptions.cwd = options.cwd;
    }

    this.broker = startBroker(startOptions, options.maxBacklogBytes);
    this.terminalQueryResponder = new TerminalQueryResponder(
      buildTerminalPalette(options),
      () => this.snapshotOracle.snapshotWithoutHash(),
      (reply) => {
        this.broker.write(reply);
      }
    );

    this.brokerAttachmentId = this.broker.attach({
      onData: (event: BrokerDataEvent) => {
        this.terminalQueryResponder.ingest(event.chunk);
        if (this.snapshotModelEnabled) {
          this.snapshotOracle.ingest(event.chunk);
        }
        this.emit({
          type: 'terminal-output',
          cursor: event.cursor,
          chunk: Buffer.from(event.chunk)
        });
      },
      onExit: (exit: PtyExit) => {
        this.emit({
          type: 'session-exit',
          exit
        });
      }
    });

    if (useNotifyHook) {
      this.notifyTimer = setIntervalFn(() => {
        this.pollNotifyFile();
      }, notifyPollMs);
      this.notifyTimer.unref?.();
    } else {
      this.notifyTimer = null;
    }
  }

  onEvent(listener: (event: CodexLiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  attach(handlers: BrokerAttachmentHandlers, sinceCursor = 0): string {
    return this.broker.attach(handlers, sinceCursor);
  }

  detach(attachmentId: string): void {
    this.broker.detach(attachmentId);
  }

  latestCursorValue(): number {
    return this.broker.latestCursorValue();
  }

  processId(): number | null {
    return this.broker.processId();
  }

  write(data: string | Uint8Array): void {
    this.broker.write(data);
  }

  resize(cols: number, rows: number): void {
    this.broker.resize(cols, rows);
    this.snapshotOracle.resize(cols, rows);
  }

  scrollViewport(deltaRows: number): void {
    this.snapshotOracle.scrollViewport(deltaRows);
  }

  setFollowOutput(followOutput: boolean): void {
    this.snapshotOracle.setFollowOutput(followOutput);
  }

  snapshot(): TerminalSnapshotFrame {
    return this.snapshotOracle.snapshot();
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    if (this.notifyTimer !== null) {
      this.clearIntervalFn(this.notifyTimer);
    }
    this.broker.detach(this.brokerAttachmentId);
    this.broker.close();
  }

  private pollNotifyFile(): void {
    let content: string;
    try {
      content = this.readFile(this.notifyFilePath);
    } catch (error) {
      const withCode = error as { code?: unknown };
      if (withCode.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    if (content.length < this.notifyOffset) {
      this.notifyOffset = 0;
      this.notifyRemainder = '';
    }
    const delta = content.slice(this.notifyOffset);
    if (delta.length === 0) {
      return;
    }
    this.notifyOffset = content.length;
    const buffered = `${this.notifyRemainder}${delta}`;
    const lines = buffered.split('\n');
    this.notifyRemainder = lines.pop()!;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const record = parseNotifyRecordLine(trimmed);
      if (record === null) {
        continue;
      }
      this.emit({
        type: 'notify',
        record
      });
    }
  }

  private emit(event: CodexLiveEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function startCodexLiveSession(
  options: StartCodexLiveSessionOptions = {},
  dependencies: LiveSessionDependencies = {}
): CodexLiveSession {
  return new CodexLiveSession(options, dependencies);
}
