import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startCodexLiveSession, type CodexLiveEvent } from '../src/codex/live-session.ts';
import { SqliteEventStore } from '../src/store/event-store.ts';
import {
  createNormalizedEvent,
  type EventScope,
  type NormalizedEventEnvelope
} from '../src/events/normalized-events.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';

interface MuxOptions {
  codexArgs: string[];
  storePath: string;
  conversationId: string;
  turnId: string;
  scope: EventScope;
}

type ParserMode = 'normal' | 'esc' | 'csi' | 'osc' | 'osc-esc';

class VirtualTerminalScreen {
  private cols: number;
  private rows: number;
  private cells: string[][];
  private cursorRow = 0;
  private cursorCol = 0;
  private savedCursor: { row: number; col: number } | null = null;
  private mode: ParserMode = 'normal';
  private csiBuffer = '';

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.cells = Array.from({ length: this.rows }, () => this.blankLine());
  }

  resize(cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) {
      return;
    }

    const nextCells = Array.from({ length: rows }, (_, rowIdx) => {
      const line = Array.from({ length: cols }, () => ' ');
      if (rowIdx < this.cells.length) {
        const previous = this.cells[rowIdx]!;
        for (let colIdx = 0; colIdx < Math.min(cols, previous.length); colIdx += 1) {
          line[colIdx] = previous[colIdx]!;
        }
      }
      return line;
    });

    this.cols = cols;
    this.rows = rows;
    this.cells = nextCells;
    this.cursorRow = Math.max(0, Math.min(this.rows - 1, this.cursorRow));
    this.cursorCol = Math.max(0, Math.min(this.cols - 1, this.cursorCol));
  }

  ingest(text: string): void {
    for (const char of text) {
      this.processChar(char);
    }
  }

  renderLines(): string[] {
    return this.cells.map((line) => this.trimRight(line.join('')));
  }

  private blankLine(): string[] {
    return Array.from({ length: this.cols }, () => ' ');
  }

  private trimRight(value: string): string {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 32) {
      end -= 1;
    }
    return value.slice(0, end);
  }

  private processChar(char: string): void {
    if (this.mode === 'normal') {
      this.processNormalChar(char);
      return;
    }

    if (this.mode === 'esc') {
      this.processEscChar(char);
      return;
    }

    if (this.mode === 'csi') {
      this.processCsiChar(char);
      return;
    }

    if (this.mode === 'osc') {
      this.processOscChar(char);
      return;
    }

    this.processOscEscChar(char);
  }

  private processNormalChar(char: string): void {
    const code = char.charCodeAt(0);

    if (char === '\u001b') {
      this.mode = 'esc';
      return;
    }

    if (char === '\r') {
      this.cursorCol = 0;
      return;
    }

    if (char === '\n') {
      this.cursorRow += 1;
      if (this.cursorRow >= this.rows) {
        this.scrollUp(1);
        this.cursorRow = this.rows - 1;
      }
      return;
    }

    if (char === '\b') {
      if (this.cursorCol > 0) {
        this.cursorCol -= 1;
      }
      return;
    }

    if (code < 0x20 || code === 0x7f) {
      return;
    }

    this.putChar(char);
  }

  private processEscChar(char: string): void {
    if (char === '[') {
      this.mode = 'csi';
      this.csiBuffer = '';
      return;
    }

    if (char === ']') {
      this.mode = 'osc';
      return;
    }

    this.mode = 'normal';
  }

  private processCsiChar(char: string): void {
    const code = char.charCodeAt(0);
    if (code >= 0x40 && code <= 0x7e) {
      const finalByte = char;
      const rawParams = this.csiBuffer;
      this.mode = 'normal';
      this.csiBuffer = '';
      this.applyCsi(rawParams, finalByte);
      return;
    }

    this.csiBuffer += char;
  }

  private processOscChar(char: string): void {
    if (char === '\u0007') {
      this.mode = 'normal';
      return;
    }

    if (char === '\u001b') {
      this.mode = 'osc-esc';
      return;
    }
  }

  private processOscEscChar(char: string): void {
    if (char === '\\') {
      this.mode = 'normal';
      return;
    }

    this.mode = 'osc';
  }

  private applyCsi(rawParams: string, finalByte: string): void {
    const params = rawParams.replaceAll('?', '').split(';').map((part) => {
      if (part.length === 0) {
        return NaN;
      }
      return Number(part);
    });

    const first = Number.isFinite(params[0]) ? (params[0] as number) : 1;

    if (finalByte === 'A') {
      this.cursorRow = Math.max(0, this.cursorRow - first);
      return;
    }
    if (finalByte === 'B') {
      this.cursorRow = Math.min(this.rows - 1, this.cursorRow + first);
      return;
    }
    if (finalByte === 'C') {
      this.cursorCol = Math.min(this.cols - 1, this.cursorCol + first);
      return;
    }
    if (finalByte === 'D') {
      this.cursorCol = Math.max(0, this.cursorCol - first);
      return;
    }
    if (finalByte === 'E') {
      this.cursorRow = Math.min(this.rows - 1, this.cursorRow + first);
      this.cursorCol = 0;
      return;
    }
    if (finalByte === 'F') {
      this.cursorRow = Math.max(0, this.cursorRow - first);
      this.cursorCol = 0;
      return;
    }
    if (finalByte === 'G') {
      const col = Number.isFinite(params[0]) ? (params[0] as number) : 1;
      this.cursorCol = Math.max(0, Math.min(this.cols - 1, col - 1));
      return;
    }
    if (finalByte === 'H' || finalByte === 'f') {
      const row = Number.isFinite(params[0]) ? (params[0] as number) : 1;
      const col = Number.isFinite(params[1]) ? (params[1] as number) : 1;
      this.cursorRow = Math.max(0, Math.min(this.rows - 1, row - 1));
      this.cursorCol = Math.max(0, Math.min(this.cols - 1, col - 1));
      return;
    }
    if (finalByte === 'J') {
      const mode = Number.isFinite(params[0]) ? (params[0] as number) : 0;
      this.clearScreen(mode);
      return;
    }
    if (finalByte === 'K') {
      const mode = Number.isFinite(params[0]) ? (params[0] as number) : 0;
      this.clearLine(mode);
      return;
    }
    if (finalByte === 'S') {
      this.scrollUp(first);
      return;
    }
    if (finalByte === 'T') {
      this.scrollDown(first);
      return;
    }
    if (finalByte === 's') {
      this.savedCursor = { row: this.cursorRow, col: this.cursorCol };
      return;
    }
    if (finalByte === 'u') {
      if (this.savedCursor !== null) {
        this.cursorRow = this.savedCursor.row;
        this.cursorCol = this.savedCursor.col;
      }
    }
  }

  private putChar(char: string): void {
    this.cells[this.cursorRow]![this.cursorCol] = char;
    this.cursorCol += 1;
    if (this.cursorCol >= this.cols) {
      this.cursorCol = 0;
      this.cursorRow += 1;
      if (this.cursorRow >= this.rows) {
        this.scrollUp(1);
        this.cursorRow = this.rows - 1;
      }
    }
  }

  private clearScreen(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.cells = Array.from({ length: this.rows }, () => this.blankLine());
      this.cursorRow = 0;
      this.cursorCol = 0;
      return;
    }

    if (mode === 1) {
      for (let row = 0; row <= this.cursorRow; row += 1) {
        const end = row === this.cursorRow ? this.cursorCol : this.cols;
        for (let col = 0; col < end; col += 1) {
          this.cells[row]![col] = ' ';
        }
      }
      return;
    }

    for (let row = this.cursorRow; row < this.rows; row += 1) {
      const start = row === this.cursorRow ? this.cursorCol : 0;
      for (let col = start; col < this.cols; col += 1) {
        this.cells[row]![col] = ' ';
      }
    }
  }

  private clearLine(mode: number): void {
    if (mode === 2) {
      this.cells[this.cursorRow] = this.blankLine();
      return;
    }

    if (mode === 1) {
      for (let col = 0; col <= this.cursorCol; col += 1) {
        this.cells[this.cursorRow]![col] = ' ';
      }
      return;
    }

    for (let col = this.cursorCol; col < this.cols; col += 1) {
      this.cells[this.cursorRow]![col] = ' ';
    }
  }

  private scrollUp(lines: number): void {
    for (let idx = 0; idx < lines; idx += 1) {
      this.cells.shift();
      this.cells.push(this.blankLine());
    }
  }

  private scrollDown(lines: number): void {
    for (let idx = 0; idx < lines; idx += 1) {
      this.cells.pop();
      this.cells.unshift(this.blankLine());
    }
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeExitCode(exit: PtyExit): number {
  if (exit.code !== null) {
    return exit.code;
  }
  if (exit.signal !== null) {
    return 128;
  }
  return 1;
}

function mapToNormalizedEvent(
  event: CodexLiveEvent,
  scope: EventScope,
  idFactory: () => string
): NormalizedEventEnvelope | null {
  if (event.type === 'terminal-output') {
    return createNormalizedEvent(
      'provider',
      'provider-text-delta',
      scope,
      {
        kind: 'text-delta',
        threadId: scope.conversationId,
        turnId: scope.turnId ?? 'turn-live',
        delta: event.chunk.toString('utf8')
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'turn-completed') {
    const payloadObject = event.record.payload;
    return createNormalizedEvent(
      'provider',
      'provider-turn-completed',
      scope,
      {
        kind: 'turn',
        threadId: asString(payloadObject['thread-id'], scope.conversationId),
        turnId: asString(payloadObject['turn-id'], scope.turnId ?? 'turn-live'),
        status: 'completed'
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'attention-required') {
    const payloadObject = event.record.payload;
    return createNormalizedEvent(
      'meta',
      'meta-attention-raised',
      scope,
      {
        kind: 'attention',
        threadId: asString(payloadObject['thread-id'], scope.conversationId),
        turnId: asString(payloadObject['turn-id'], scope.turnId ?? 'turn-live'),
        reason: event.reason,
        detail: asString(payloadObject.type, 'notify')
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'notify') {
    const payloadObject = event.record.payload;
    return createNormalizedEvent(
      'meta',
      'meta-notify-observed',
      scope,
      {
        kind: 'notify',
        notifyType: asString(payloadObject.type, 'unknown'),
        raw: payloadObject
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'session-exit') {
    return createNormalizedEvent(
      'meta',
      'meta-attention-cleared',
      scope,
      {
        kind: 'attention',
        threadId: scope.conversationId,
        turnId: scope.turnId ?? 'turn-live',
        reason: 'stalled',
        detail: 'session-exit'
      },
      () => new Date(),
      idFactory
    );
  }

  return null;
}

function summarizeEvent(event: NormalizedEventEnvelope): string {
  const turnId = event.scope.turnId ?? '-';
  const payload = event.payload;

  if (event.type === 'meta-notify-observed' && payload.kind === 'notify') {
    return `${event.ts} notify ${payload.notifyType}`;
  }

  if (event.type === 'meta-attention-raised' && payload.kind === 'attention') {
    return `${event.ts} attention ${payload.reason}`;
  }

  if (event.type === 'provider-turn-completed') {
    return `${event.ts} turn completed (${turnId})`;
  }

  if (event.type === 'meta-attention-cleared') {
    return `${event.ts} session exited`;
  }

  return `${event.ts} ${event.type}`;
}

function terminalSize(): { cols: number; rows: number } {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (typeof cols === 'number' && cols > 0 && typeof rows === 'number' && rows > 0) {
    return { cols, rows };
  }
  return { cols: 120, rows: 40 };
}

function padOrTrim(text: string, width: number): string {
  if (text.length === width) {
    return text;
  }
  if (text.length > width) {
    return text.slice(0, width);
  }
  return `${text}${' '.repeat(width - text.length)}`;
}

function parseArgs(argv: string[]): MuxOptions {
  const conversationId = process.env.HARNESS_CONVERSATION_ID ?? `conversation-${randomUUID()}`;
  const turnId = process.env.HARNESS_TURN_ID ?? `turn-${randomUUID()}`;

  return {
    codexArgs: argv,
    storePath: process.env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite',
    conversationId,
    turnId,
    scope: {
      tenantId: process.env.HARNESS_TENANT_ID ?? 'tenant-local',
      userId: process.env.HARNESS_USER_ID ?? 'user-local',
      workspaceId: process.env.HARNESS_WORKSPACE_ID ?? basename(process.cwd()),
      worktreeId: process.env.HARNESS_WORKTREE_ID ?? 'worktree-local',
      conversationId,
      turnId
    }
  };
}

async function main(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('codex:live:mux requires a TTY stdin/stdout\n');
    return 2;
  }

  const options = parseArgs(process.argv.slice(2));
  const store = new SqliteEventStore(options.storePath);

  let size = terminalSize();
  let paneRows = Math.max(4, size.rows - 1);
  let leftCols = Math.max(20, Math.floor(size.cols * 0.68));
  let rightCols = Math.max(20, size.cols - leftCols - 1);
  const leftScreen = new VirtualTerminalScreen(leftCols, paneRows);
  const eventLines: string[] = [];
  const maxEventLines = 1000;

  const liveSession = startCodexLiveSession({
    args: options.codexArgs,
    env: {
      ...process.env,
      TERM: process.env.TERM ?? 'xterm-256color'
    }
  });

  const idFactory = (): string => `event-${randomUUID()}`;
  let exit: PtyExit | null = null;
  let dirty = true;
  let stop = false;

  const recalcLayout = (): void => {
    size = terminalSize();
    paneRows = Math.max(4, size.rows - 1);
    leftCols = Math.max(20, Math.floor(size.cols * 0.68));
    rightCols = Math.max(20, size.cols - leftCols - 1);
    leftScreen.resize(leftCols, paneRows);
    liveSession.resize(leftCols, paneRows);
    dirty = true;
  };

  const appendEventLine = (line: string): void => {
    eventLines.push(line);
    while (eventLines.length > maxEventLines) {
      eventLines.shift();
    }
    dirty = true;
  };

  const render = (): void => {
    if (!dirty) {
      return;
    }

    const leftRendered = leftScreen.renderLines();
    const rightStart = Math.max(0, eventLines.length - paneRows);
    const rightRendered = eventLines.slice(rightStart);

    const frame: string[] = [];
    frame.push('\u001b[?25l');
    frame.push('\u001b[H\u001b[2J');

    for (let row = 0; row < paneRows; row += 1) {
      const left = padOrTrim(leftRendered[row] ?? '', leftCols);
      const right = padOrTrim(rightRendered[row] ?? '', rightCols);
      frame.push(`${left}│${right}`);
    }

    const status = padOrTrim(
      `[mux] conversation=${options.conversationId} ctrl-] quit`,
      size.cols
    );
    frame.push(status);

    process.stdout.write(frame.join('\n'));
    dirty = false;
  };

  liveSession.onEvent((event) => {
    const normalized = mapToNormalizedEvent(event, options.scope, idFactory);
    if (normalized !== null) {
      store.appendEvents([normalized]);
      if (normalized.type !== 'provider-text-delta') {
        appendEventLine(summarizeEvent(normalized));
      }
    }

    if (event.type === 'terminal-output') {
      leftScreen.ingest(event.chunk.toString('utf8'));
      dirty = true;
    }

    if (event.type === 'session-exit') {
      exit = event.exit;
      stop = true;
      dirty = true;
    }
  });

  const onInput = (chunk: Buffer): void => {
    if (chunk.length === 1 && chunk[0] === 0x1d) {
      stop = true;
      liveSession.close();
      return;
    }
    liveSession.write(chunk);
  };

  const onResize = (): void => {
    recalcLayout();
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', onInput);
  process.stdout.on('resize', onResize);

  recalcLayout();

  const renderTimer = setInterval(() => {
    render();
  }, 33);

  try {
    while (!stop) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  } finally {
    clearInterval(renderTimer);
    process.stdin.off('data', onInput);
    process.stdout.off('resize', onResize);
    process.stdin.pause();
    process.stdin.setRawMode(false);
    liveSession.close();
    store.close();
    process.stdout.write('\u001b[?25h\u001b[0m\n');
  }

  if (exit === null) {
    return 0;
  }
  return normalizeExitCode(exit);
}

const code = await main();
process.exitCode = code;
