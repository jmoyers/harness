import { SqliteEventStore } from '../src/store/event-store.ts';
import type { NormalizedEventEnvelope } from '../src/events/normalized-events.ts';

interface SnapshotOptions {
  conversationId: string;
  tenantId: string;
  userId: string;
  dbPath: string;
  cols: number;
  rows: number;
  pollMs: number;
  follow: boolean;
  fromNow: boolean;
  json: boolean;
  clearBetweenFrames: boolean;
  exitOnSessionEnd: boolean;
}

type ParserMode = 'normal' | 'esc' | 'csi' | 'osc' | 'osc-esc';

class VirtualTerminalScreen {
  private readonly cols: number;
  private readonly rows: number;
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

  ingest(text: string): void {
    for (const char of text) {
      this.processChar(char);
    }
  }

  render(): string {
    const rendered = this.cells.map((line) => this.trimRight(line.join('')));
    while (rendered.length > 0 && rendered[rendered.length - 1] === '') {
      rendered.pop();
    }
    if (rendered.length === 0) {
      return '(empty)';
    }
    return rendered.join('\n');
  }

  cursor(): { row: number; col: number } {
    return {
      row: this.cursorRow + 1,
      col: this.cursorCol + 1
    };
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
      return;
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

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseArgs(argv: string[]): SnapshotOptions {
  const envConversationId = process.env.HARNESS_CONVERSATION_ID;
  const envTenantId = process.env.HARNESS_TENANT_ID ?? 'tenant-local';
  const envUserId = process.env.HARNESS_USER_ID ?? 'user-local';
  const envDbPath = process.env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite';

  let conversationId = envConversationId;
  let tenantId = envTenantId;
  let userId = envUserId;
  let dbPath = envDbPath;
  let cols = parsePositiveInteger(process.env.HARNESS_SNAPSHOT_COLS, 120);
  let rows = parsePositiveInteger(process.env.HARNESS_SNAPSHOT_ROWS, 40);
  let pollMs = parsePositiveInteger(process.env.HARNESS_SNAPSHOT_POLL_MS, 200);
  let follow = false;
  let fromNow = false;
  let json = false;
  let clearBetweenFrames = true;
  let exitOnSessionEnd = true;

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    if (arg === '--conversation-id') {
      conversationId = argv[idx + 1];
      idx += 1;
      continue;
    }
    if (arg === '--tenant-id') {
      tenantId = argv[idx + 1] ?? tenantId;
      idx += 1;
      continue;
    }
    if (arg === '--user-id') {
      userId = argv[idx + 1] ?? userId;
      idx += 1;
      continue;
    }
    if (arg === '--db-path') {
      dbPath = argv[idx + 1] ?? dbPath;
      idx += 1;
      continue;
    }
    if (arg === '--cols') {
      cols = parsePositiveInteger(argv[idx + 1], cols);
      idx += 1;
      continue;
    }
    if (arg === '--rows') {
      rows = parsePositiveInteger(argv[idx + 1], rows);
      idx += 1;
      continue;
    }
    if (arg === '--poll-ms') {
      pollMs = parsePositiveInteger(argv[idx + 1], pollMs);
      idx += 1;
      continue;
    }
    if (arg === '--follow') {
      follow = true;
      continue;
    }
    if (arg === '--from-now') {
      fromNow = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      clearBetweenFrames = false;
      continue;
    }
    if (arg === '--no-clear') {
      clearBetweenFrames = false;
      continue;
    }
    if (arg === '--no-exit-on-session-end') {
      exitOnSessionEnd = false;
      continue;
    }
  }

  if (typeof conversationId !== 'string' || conversationId.length === 0) {
    process.stderr.write(
      'usage: npm run codex:live:snapshot -- --conversation-id <id> [--follow] [--from-now] [--json]\n'
    );
    process.exit(2);
  }

  return {
    conversationId,
    tenantId,
    userId,
    dbPath,
    cols,
    rows,
    pollMs,
    follow,
    fromNow,
    json,
    clearBetweenFrames,
    exitOnSessionEnd
  };
}

function isSessionExitEvent(event: NormalizedEventEnvelope): boolean {
  if (event.type !== 'meta-attention-cleared') {
    return false;
  }
  const payload = event.payload;
  if (payload.kind !== 'attention') {
    return false;
  }
  return payload.detail === 'session-exit';
}

function isSqliteBusyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const withCode = error as { code?: unknown };
  return withCode.code === 'ERR_SQLITE_BUSY';
}

function printFrame(
  screen: VirtualTerminalScreen,
  options: SnapshotOptions,
  lastRowId: number,
  atTs: string
): void {
  const rendered = screen.render();
  const cursor = screen.cursor();
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        kind: 'snapshot-frame',
        conversationId: options.conversationId,
        rowId: lastRowId,
        cursor,
        ts: atTs,
        screen: rendered
      })}\n`
    );
    return;
  }

  if (options.clearBetweenFrames) {
    process.stdout.write('\u001bc');
  }
  process.stdout.write(
    `[snapshot] conversation=${options.conversationId} rowId=${String(lastRowId)} cursor=${String(cursor.row)},${String(cursor.col)} ts=${atTs}\n`
  );
  process.stdout.write(`${rendered}\n`);
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const store = new SqliteEventStore(options.dbPath);
  const screen = new VirtualTerminalScreen(options.cols, options.rows);
  let lastRowId = 0;
  let sawSessionExit = false;
  let stop = false;

  process.once('SIGINT', () => {
    stop = true;
  });
  process.once('SIGTERM', () => {
    stop = true;
  });

  try {
    if (options.fromNow) {
      const baseline = store.listEvents({
        tenantId: options.tenantId,
        userId: options.userId,
        conversationId: options.conversationId,
        afterRowId: 0,
        limit: 1_000_000
      });
      if (baseline.length > 0) {
        lastRowId = baseline[baseline.length - 1]!.rowId;
      }
    }

    process.stderr.write(
      `[snapshot] conversation=${options.conversationId} tenant=${options.tenantId} user=${options.userId} db=${options.dbPath} follow=${String(options.follow)} fromNow=${String(options.fromNow)}\n`
    );

    while (!stop) {
      let rows: ReturnType<SqliteEventStore['listEvents']>;
      try {
        rows = store.listEvents({
          tenantId: options.tenantId,
          userId: options.userId,
          conversationId: options.conversationId,
          afterRowId: lastRowId,
          limit: 500
        });
      } catch (error) {
        if (isSqliteBusyError(error)) {
          await new Promise((resolve) => {
            setTimeout(resolve, options.pollMs);
          });
          continue;
        }
        throw error;
      }

      let changed = false;
      let frameTs = new Date().toISOString();

      for (const row of rows) {
        lastRowId = row.rowId;
        frameTs = row.event.ts;
        if (row.event.type === 'provider-text-delta' && row.event.payload.kind === 'text-delta') {
          const delta = String(row.event.payload.delta ?? '');
          screen.ingest(delta);
          changed = true;
        }

        if (isSessionExitEvent(row.event)) {
          sawSessionExit = true;
        }
      }

      if (changed || (!options.follow && rows.length === 0)) {
        printFrame(screen, options, lastRowId, frameTs);
      }

      if (!options.follow) {
        return 0;
      }

      if (options.exitOnSessionEnd && sawSessionExit) {
        return 0;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, options.pollMs);
      });
    }

    return 0;
  } finally {
    store.close();
  }
}

const exitCode = await main();
process.exitCode = exitCode;
