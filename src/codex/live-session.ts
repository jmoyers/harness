import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  startSingleSessionBroker,
  type BrokerAttachmentHandlers,
  type BrokerDataEvent
} from '../pty/session-broker.ts';
import type { PtyExit } from '../pty/pty_host.ts';
import { TerminalSnapshotOracle, type TerminalSnapshotFrame } from '../terminal/snapshot-oracle.ts';

interface StartPtySessionOptions {
  command?: string;
  commandArgs?: string[];
  env?: NodeJS.ProcessEnv;
}

interface SessionBrokerLike {
  attach(handlers: BrokerAttachmentHandlers, sinceCursor?: number): string;
  detach(attachmentId: string): void;
  latestCursorValue(): number;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface NotifyRecord {
  ts: string;
  payload: NotifyPayload;
}

export interface NotifyPayload {
  [key: string]: unknown;
}

interface StartCodexLiveSessionOptions {
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
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
      type: 'turn-completed';
      record: NotifyRecord;
    }
  | {
      type: 'attention-required';
      reason: string;
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
const DEFAULT_RELAY_SCRIPT_PATH = join(process.cwd(), 'scripts/codex-notify-relay.ts');
const DEFAULT_TERMINAL_FOREGROUND_HEX = 'd0d7de';
const DEFAULT_TERMINAL_BACKGROUND_HEX = '0f1419';

interface TerminalPalette {
  foregroundOsc: string;
  backgroundOsc: string;
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
  return {
    foregroundOsc: terminalHexToOscColor(foreground),
    backgroundOsc: terminalHexToOscColor(background)
  };
}

type OscParserMode = 'normal' | 'esc' | 'osc' | 'osc-esc';

class OscQueryResponder {
  private mode: OscParserMode = 'normal';
  private oscPayload = '';
  private readonly palette: TerminalPalette;
  private readonly writeReply: (reply: string) => void;

  constructor(palette: TerminalPalette, writeReply: (reply: string) => void) {
    this.palette = palette;
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
      } else {
        this.mode = 'normal';
      }
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

    if (trimmedPayload === '10;?') {
      this.writeReply(`\u001b]10;${this.palette.foregroundOsc}${terminator}`);
      return;
    }

    if (trimmedPayload === '11;?') {
      this.writeReply(`\u001b]11;${this.palette.backgroundOsc}${terminator}`);
    }
  }
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
  if (typeof record.payload !== 'object' || record.payload === null) {
    return null;
  }

  return {
    ts: record.ts,
    payload: record.payload as NotifyPayload
  };
}

export function classifyNotifyRecord(record: NotifyRecord):
| { type: 'turn-completed' }
| { type: 'attention-required'; reason: string }
| null {
  const eventType = record.payload.type;
  if (typeof eventType !== 'string') {
    return null;
  }

  if (eventType === 'agent-turn-complete') {
    return { type: 'turn-completed' };
  }

  if (eventType.includes('approval')) {
    return { type: 'attention-required', reason: 'approval' };
  }

  if (eventType.includes('input')) {
    return { type: 'attention-required', reason: 'user-input' };
  }

  return null;
}

class CodexLiveSession {
  private readonly broker: SessionBrokerLike;
  private readonly readFile: (path: string) => string;
  private readonly clearIntervalFn: (handle: NodeJS.Timeout) => void;
  private readonly notifyFilePath: string;
  private readonly listeners = new Set<(event: CodexLiveEvent) => void>();
  private readonly snapshotOracle: TerminalSnapshotOracle;
  private readonly oscQueryResponder: OscQueryResponder;
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

    const command = options.command ?? DEFAULT_COMMAND;
    const useNotifyHook = options.useNotifyHook ?? true;
    const notifyPollMs = options.notifyPollMs ?? DEFAULT_NOTIFY_POLL_MS;
    this.notifyFilePath = options.notifyFilePath ?? join(tmpdir(), `harness-codex-notify-${process.pid}.jsonl`);

    const relayScriptPath = resolve(options.relayScriptPath ?? DEFAULT_RELAY_SCRIPT_PATH);
    const notifyCommand = [
      '/usr/bin/env',
      process.execPath,
      '--experimental-strip-types',
      relayScriptPath,
      this.notifyFilePath
    ];

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
      commandArgs
    };
    if (options.env !== undefined) {
      startOptions.env = options.env;
    }

    this.broker = startBroker(startOptions, options.maxBacklogBytes);
    this.oscQueryResponder = new OscQueryResponder(buildTerminalPalette(options), (reply) => {
      this.broker.write(reply);
    });

    this.brokerAttachmentId = this.broker.attach({
      onData: (event: BrokerDataEvent) => {
        this.oscQueryResponder.ingest(event.chunk);
        this.snapshotOracle.ingest(event.chunk);
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
      const errorWithCode = error as { code?: unknown };
      if (errorWithCode.code === 'ENOENT') {
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

      const classification = classifyNotifyRecord(record);
      if (classification === null) {
        continue;
      }

      if (classification.type === 'turn-completed') {
        this.emit({
          type: 'turn-completed',
          record
        });
        continue;
      }

      this.emit({
        type: 'attention-required',
        reason: classification.reason,
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
