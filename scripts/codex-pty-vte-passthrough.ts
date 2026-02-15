import { startCodexLiveSession } from '../src/codex/live-session.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';

function getTerminalSize(): { cols: number; rows: number } {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (typeof cols === 'number' && cols > 0 && typeof rows === 'number' && rows > 0) {
    return { cols, rows };
  }
  return { cols: 120, rows: 40 };
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

async function main(): Promise<number> {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const codexArgs = process.argv.slice(2);
  const initialSize = getTerminalSize();

  const session = startCodexLiveSession({
    args: codexArgs,
    baseArgs: [],
    useNotifyHook: false,
    env: {
      ...process.env,
      TERM: process.env.TERM ?? 'xterm-256color'
    },
    initialCols: initialSize.cols,
    initialRows: initialSize.rows
  });

  let exit: PtyExit | null = null;
  const waitForExit = new Promise<PtyExit>((resolve) => {
    session.onEvent((event) => {
      if (event.type === 'session-exit') {
        exit = event.exit;
        resolve(event.exit);
      }
    });
  });

  const attachmentId = session.attach({
    onData: (event) => {
      process.stdout.write(event.chunk);
    },
    onExit: () => {
      // handled via event stream
    }
  });

  const onInput = (chunk: Buffer): void => {
    session.write(chunk);
  };

  const onResize = (): void => {
    const size = getTerminalSize();
    session.resize(size.cols, size.rows);
  };

  let restored = false;
  const restoreTerminal = (): void => {
    if (restored) {
      return;
    }
    restored = true;

    process.stdin.off('data', onInput);
    process.stdout.off('resize', onResize);
    process.stdin.pause();

    if (interactive) {
      process.stdin.setRawMode(false);
    }

    session.detach(attachmentId);
    session.close();
  };

  process.once('SIGTERM', () => {
    session.close();
  });
  process.once('SIGHUP', () => {
    session.close();
  });

  if (interactive) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', onInput);
  process.stdout.on('resize', onResize);
  onResize();

  await waitForExit;
  restoreTerminal();

  if (exit === null) {
    return 1;
  }
  return normalizeExitCode(exit);
}

const code = await main();
process.exitCode = code;
