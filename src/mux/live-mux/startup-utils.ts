import { appendFileSync, mkdirSync, truncateSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DISABLE_MUX_INPUT_MODES } from '../terminal-input-modes.ts';
import { resolveWorkspacePath } from '../workspace-path.ts';

const DEFAULT_STARTUP_TERMINAL_MIN_COLS = 40;
const DEFAULT_STARTUP_TERMINAL_MIN_ROWS = 10;
const DEFAULT_STARTUP_TERMINAL_PROBE_TIMEOUT_MS = 250;
const DEFAULT_STARTUP_TERMINAL_PROBE_INTERVAL_MS = 10;

interface FocusEventExtraction {
  readonly sanitized: Buffer;
  readonly focusInCount: number;
  readonly focusOutCount: number;
}

interface StartupTerminalProbeOptions {
  readonly terminalSizeReader?: () => { cols: number; rows: number };
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

export function restoreTerminalState(
  newline: boolean,
  restoreInputModes: (() => void) | null = null,
  disableInputModes = DISABLE_MUX_INPUT_MODES,
): void {
  try {
    if (restoreInputModes === null) {
      process.stdout.write(disableInputModes);
    } else {
      restoreInputModes();
    }
    process.stdout.write(`\u001b[?25h\u001b[0m${newline ? '\n' : ''}`);
  } catch {
    // Best-effort restore only.
  }

  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // Best-effort restore only.
    }
    try {
      process.stdin.pause();
    } catch {
      // Best-effort restore only.
    }
  }
}

export function extractFocusEvents(chunk: Buffer): FocusEventExtraction {
  const text = chunk.toString('utf8');
  const focusInCount = text.split('\u001b[I').length - 1;
  const focusOutCount = text.split('\u001b[O').length - 1;

  if (focusInCount === 0 && focusOutCount === 0) {
    return {
      sanitized: chunk,
      focusInCount: 0,
      focusOutCount: 0,
    };
  }

  const sanitizedText = text.replaceAll('\u001b[I', '').replaceAll('\u001b[O', '');
  return {
    sanitized: Buffer.from(sanitizedText, 'utf8'),
    focusInCount,
    focusOutCount,
  };
}

export function prepareArtifactPath(path: string, overwriteOnStart: boolean): string {
  const resolvedPath = resolve(path);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  if (overwriteOnStart) {
    try {
      truncateSync(resolvedPath, 0);
    } catch (error: unknown) {
      const code = (error as { code?: unknown }).code;
      if (code !== 'ENOENT') {
        throw error;
      }
      appendFileSync(resolvedPath, '', 'utf8');
    }
  }
  return resolvedPath;
}

export function sanitizeProcessEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function terminalSize(): { cols: number; rows: number } {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (typeof cols === 'number' && cols > 0 && typeof rows === 'number' && rows > 0) {
    return { cols, rows };
  }
  return { cols: 120, rows: 40 };
}

export function startupTerminalSizeLooksPlausible(size: { cols: number; rows: number }): boolean {
  return (
    size.cols >= DEFAULT_STARTUP_TERMINAL_MIN_COLS && size.rows >= DEFAULT_STARTUP_TERMINAL_MIN_ROWS
  );
}

export async function readStartupTerminalSize(
  options: StartupTerminalProbeOptions = {},
): Promise<{ cols: number; rows: number }> {
  const terminalSizeReader = options.terminalSizeReader ?? terminalSize;
  const sleep =
    options.sleep ??
    (async (ms: number): Promise<void> => {
      await new Promise((resolveTimer) => {
        setTimeout(resolveTimer, ms);
      });
    });
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_STARTUP_TERMINAL_PROBE_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_STARTUP_TERMINAL_PROBE_INTERVAL_MS;

  let best = terminalSizeReader();
  const startedAtMs = now();
  while (!startupTerminalSizeLooksPlausible(best) && now() - startedAtMs < timeoutMs) {
    await sleep(intervalMs);
    const next = terminalSizeReader();
    if (next.cols * next.rows > best.cols * best.rows) {
      best = next;
    }
    if (startupTerminalSizeLooksPlausible(next)) {
      return next;
    }
  }
  return startupTerminalSizeLooksPlausible(best) ? best : { cols: 120, rows: 40 };
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || !/^\d+$/u.test(trimmed)) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

export function resolveWorkspacePathForMux(
  invocationDirectory: string,
  value: string,
  home = process.env.HOME,
): string {
  const resolvedHome = typeof home === 'string' && home.length > 0 ? home : null;
  return resolveWorkspacePath(invocationDirectory, value, resolvedHome);
}
