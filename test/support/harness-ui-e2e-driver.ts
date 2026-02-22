import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startPtySession, type PtyExit } from '../../src/pty/pty_host.ts';
import { TerminalSnapshotOracle } from '../../src/terminal/snapshot-oracle.ts';

const HARNESS_SCRIPT_PATH = resolve(process.cwd(), 'scripts/harness.ts');

export interface HarnessUiE2EDriverOptions {
  readonly workspace: string;
  readonly args?: readonly string[];
  readonly cols?: number;
  readonly rows?: number;
  readonly env?: Record<string, string | undefined>;
}

interface SnapshotTextCell {
  readonly row: number;
  readonly col: number;
}

function tsRuntimeArgs(scriptPath: string, args: readonly string[] = []): string[] {
  return [scriptPath, ...args];
}

function isPtyExit(value: unknown): value is PtyExit {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { code?: unknown; signal?: unknown };
  const codeOk = typeof candidate.code === 'number' || candidate.code === null;
  const signalOk = typeof candidate.signal === 'string' || candidate.signal === null;
  return codeOk && signalOk;
}

function waitForExit(
  session: ReturnType<typeof startPtySession>,
  timeoutMs: number,
): Promise<PtyExit> {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      rejectExit(new Error('timed out waiting for harness-ui e2e session exit'));
    }, timeoutMs);
    session.once('exit', (result: unknown) => {
      clearTimeout(timer);
      if (!isPtyExit(result)) {
        rejectExit(new Error('received malformed pty exit payload'));
        return;
      }
      resolveExit(result);
    });
  });
}

function defaultEnv(workspace: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HARNESS_INVOKE_CWD: workspace,
    XDG_CONFIG_HOME: resolve(workspace, '.harness-xdg'),
  };
}

function mergeDriverEnv(
  workspace: string,
  overrides: Record<string, string | undefined> | undefined,
): NodeJS.ProcessEnv {
  const merged = {
    ...defaultEnv(workspace),
    ...(overrides ?? {}),
  };
  if (overrides !== undefined) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete merged[key];
      }
    }
  }
  return merged;
}

export class HarnessUiE2EDriver {
  private readonly oracle: TerminalSnapshotOracle;
  private readonly session: ReturnType<typeof startPtySession>;
  private readonly waitForSessionExit: Promise<PtyExit>;
  private closed = false;

  public readonly keyboard: {
    type: (text: string) => void;
    press: (key: 'Enter' | 'Escape' | 'Ctrl+C') => void;
    openCommandMenu: (timeoutMs?: number) => Promise<void>;
  };

  public readonly mouse: {
    click: (col: number, row: number) => void;
  };

  constructor(options: HarnessUiE2EDriverOptions) {
    const cols = Math.max(40, Math.floor(options.cols ?? 100));
    const rows = Math.max(10, Math.floor(options.rows ?? 30));
    this.oracle = new TerminalSnapshotOracle(cols, rows);
    this.session = startPtySession({
      command: process.execPath,
      commandArgs: tsRuntimeArgs(HARNESS_SCRIPT_PATH, options.args ?? []),
      cwd: options.workspace,
      env: mergeDriverEnv(options.workspace, options.env),
      initialCols: cols,
      initialRows: rows,
    });
    this.waitForSessionExit = waitForExit(this.session, 60_000);
    this.session.on('data', (chunk: Buffer) => {
      this.oracle.ingest(chunk);
    });

    this.keyboard = {
      type: (text) => {
        this.session.write(text);
      },
      press: (key) => {
        if (key === 'Enter') {
          this.session.write('\n');
          return;
        }
        if (key === 'Escape') {
          this.session.write('\u001b');
          return;
        }
        this.session.write('\u0003');
      },
      openCommandMenu: async (timeoutMs = 12_000) => {
        const attempts = [
          '\u001bz',
          '\u0010',
          '\u001b[112;5u',
          '\u001b[27;5;112~',
          '\u001b[112;9u',
          '\u001b[27;9;112~',
        ] as const;
        const startedAt = Date.now();
        let attemptIndex = 0;
        while (Date.now() - startedAt < timeoutMs) {
          this.session.write(attempts[attemptIndex % attempts.length]!);
          attemptIndex += 1;
          try {
            await this.waitForText('Command Menu', 600);
            return;
          } catch {
            await delay(50);
          }
        }
        throw new Error('timed out opening command menu');
      },
    };

    this.mouse = {
      click: (col, row) => {
        const safeCol = Math.max(1, Math.floor(col));
        const safeRow = Math.max(1, Math.floor(row));
        this.session.write(`\u001b[<0;${String(safeCol)};${String(safeRow)}M`);
        this.session.write(`\u001b[<0;${String(safeCol)};${String(safeRow)}m`);
      },
    };
  }

  public snapshotLines(): readonly string[] {
    return this.oracle.snapshotWithoutHash().lines;
  }

  public locator(text: string): {
    waitFor: (timeoutMs?: number) => Promise<SnapshotTextCell>;
    click: (timeoutMs?: number) => Promise<void>;
    isVisible: () => boolean;
  } {
    return {
      waitFor: async (timeoutMs = 12_000) => await this.waitForText(text, timeoutMs),
      click: async (timeoutMs = 12_000) => {
        const cell = await this.waitForText(text, timeoutMs);
        this.mouse.click(cell.col, cell.row);
      },
      isVisible: () => this.snapshotLines().some((line) => line.includes(text)),
    };
  }

  public async waitForText(text: string, timeoutMs: number): Promise<SnapshotTextCell> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const frame = this.oracle.snapshotWithoutHash();
      const rowIndex = frame.lines.findIndex((line) => line.includes(text));
      if (rowIndex >= 0) {
        return {
          row: rowIndex + 1,
          col: frame.lines[rowIndex]!.indexOf(text) + 1,
        };
      }
      await delay(40);
    }
    throw new Error(`timed out waiting for snapshot text: ${text}`);
  }

  public async waitForTextGone(text: string, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const hasText = this.oracle
        .snapshotWithoutHash()
        .lines.some((line) => line.includes(text));
      if (!hasText) {
        return;
      }
      await delay(40);
    }
    throw new Error(`timed out waiting for snapshot text removal: ${text}`);
  }

  public async close(timeoutMs = 15_000): Promise<PtyExit> {
    if (this.closed) {
      return await this.waitForSessionExit;
    }
    this.closed = true;
    this.keyboard.press('Ctrl+C');
    const exit = await Promise.race([
      this.waitForSessionExit,
      delay(timeoutMs).then(() => {
        throw new Error('timed out closing harness-ui e2e driver');
      }),
    ]);
    return exit;
  }
}
