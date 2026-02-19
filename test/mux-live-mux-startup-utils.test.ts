import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  extractFocusEvents,
  formatErrorMessage,
  parseBooleanEnv,
  parsePositiveInt,
  prepareArtifactPath,
  readStartupTerminalSize,
  resolveWorkspacePathForMux,
  restoreTerminalState,
  sanitizeProcessEnv,
  startupTerminalSizeLooksPlausible,
  terminalSize,
} from '../src/mux/live-mux/startup-utils.ts';

function patchProperty<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  value: T[K],
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  Object.defineProperty(obj, key, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor === undefined) {
      delete (obj as Record<string, unknown>)[key as string];
      return;
    }
    Object.defineProperty(obj, key, descriptor);
  };
}

void test('formatErrorMessage prefers stack/message and stringifies unknown values', () => {
  const err = new Error('boom');
  err.stack = 'stack-trace';
  assert.equal(formatErrorMessage(err), 'stack-trace');

  const errWithMessage = new Error('message-only');
  Object.defineProperty(errWithMessage, 'stack', {
    configurable: true,
    value: undefined,
  });
  assert.equal(formatErrorMessage(errWithMessage), 'message-only');

  assert.equal(formatErrorMessage(123), '123');
});

void test('extractFocusEvents strips focus markers while counting transitions', () => {
  const untouched = extractFocusEvents(Buffer.from('plain', 'utf8'));
  assert.equal(untouched.focusInCount, 0);
  assert.equal(untouched.focusOutCount, 0);
  assert.equal(untouched.sanitized.toString('utf8'), 'plain');

  const extracted = extractFocusEvents(Buffer.from('a\u001b[I b\u001b[O c\u001b[I', 'utf8'));
  assert.equal(extracted.focusInCount, 2);
  assert.equal(extracted.focusOutCount, 1);
  assert.equal(extracted.sanitized.toString('utf8'), 'a b c');
});

void test('prepareArtifactPath resolves path and handles overwrite modes', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'mux-startup-utils-'));

  const resolvedNoOverwrite = prepareArtifactPath(join(tempDir, 'nested', 'artifact.log'), false);
  assert.equal(resolvedNoOverwrite, resolve(tempDir, 'nested', 'artifact.log'));

  const resolvedCreated = prepareArtifactPath(join(tempDir, 'created.log'), true);
  assert.equal(readFileSync(resolvedCreated, 'utf8'), '');

  const resolvedTruncated = prepareArtifactPath(join(tempDir, 'truncate.log'), true);
  assert.equal(readFileSync(resolvedTruncated, 'utf8'), '');

  assert.throws(
    () => {
      void prepareArtifactPath(tempDir, true);
    },
    { name: 'Error' },
  );
});

void test('sanitizeProcessEnv keeps only string values', () => {
  const sanitized = sanitizeProcessEnv({
    A: '1',
    B: undefined,
    C: 'hello',
  });
  assert.deepEqual(sanitized, {
    A: '1',
    C: 'hello',
  });
});

void test('terminalSize reads process dimensions with fallback', () => {
  const restoreCols = patchProperty(process.stdout, 'columns', 140);
  const restoreRows = patchProperty(process.stdout, 'rows', 50);
  try {
    assert.deepEqual(terminalSize(), { cols: 140, rows: 50 });
  } finally {
    restoreCols();
    restoreRows();
  }

  const restoreColsInvalid = patchProperty(process.stdout, 'columns', 0);
  const restoreRowsInvalid = patchProperty(process.stdout, 'rows', 0);
  try {
    assert.deepEqual(terminalSize(), { cols: 120, rows: 40 });
  } finally {
    restoreColsInvalid();
    restoreRowsInvalid();
  }
});

void test('startupTerminalSizeLooksPlausible enforces minimum dimensions', () => {
  assert.equal(startupTerminalSizeLooksPlausible({ cols: 40, rows: 10 }), true);
  assert.equal(startupTerminalSizeLooksPlausible({ cols: 39, rows: 10 }), false);
  assert.equal(startupTerminalSizeLooksPlausible({ cols: 40, rows: 9 }), false);
});

void test('readStartupTerminalSize returns immediate plausible size and probes when needed', async () => {
  const immediate = await readStartupTerminalSize({
    terminalSizeReader: () => ({ cols: 120, rows: 40 }),
  });
  assert.deepEqual(immediate, { cols: 120, rows: 40 });

  let reads = 0;
  let nowMs = 0;
  const probed = await readStartupTerminalSize({
    terminalSizeReader: () => {
      reads += 1;
      if (reads === 1) {
        return { cols: 10, rows: 5 };
      }
      return { cols: 80, rows: 24 };
    },
    now: () => nowMs,
    sleep: (ms) => {
      nowMs += ms;
      return Promise.resolve();
    },
    timeoutMs: 50,
    intervalMs: 10,
  });
  assert.deepEqual(probed, { cols: 80, rows: 24 });

  nowMs = 0;
  let nonGrowthReads = 0;
  const nonGrowingProbe = await readStartupTerminalSize({
    terminalSizeReader: () => {
      nonGrowthReads += 1;
      if (nonGrowthReads === 1) {
        return { cols: 10, rows: 5 };
      }
      if (nonGrowthReads === 2) {
        return { cols: 9, rows: 5 };
      }
      return { cols: 80, rows: 24 };
    },
    now: () => nowMs,
    sleep: (ms) => {
      nowMs += ms;
      return Promise.resolve();
    },
    timeoutMs: 50,
    intervalMs: 10,
  });
  assert.deepEqual(nonGrowingProbe, { cols: 80, rows: 24 });

  nowMs = 0;
  let probeReads = 0;
  const fallback = await readStartupTerminalSize({
    terminalSizeReader: () => {
      probeReads += 1;
      return probeReads === 1 ? { cols: 2, rows: 2 } : { cols: 3, rows: 3 };
    },
    now: () => nowMs,
    sleep: (ms) => {
      nowMs += ms;
      return Promise.resolve();
    },
    timeoutMs: 15,
    intervalMs: 10,
  });
  assert.deepEqual(fallback, { cols: 120, rows: 40 });

  let defaultSleepReads = 0;
  const viaDefaultSleep = await readStartupTerminalSize({
    terminalSizeReader: () => {
      defaultSleepReads += 1;
      return defaultSleepReads === 1 ? { cols: 10, rows: 5 } : { cols: 80, rows: 24 };
    },
    timeoutMs: 20,
    intervalMs: 1,
  });
  assert.deepEqual(viaDefaultSleep, { cols: 80, rows: 24 });

  const restoreCols = patchProperty(process.stdout, 'columns', 120);
  const restoreRows = patchProperty(process.stdout, 'rows', 40);
  try {
    const usingDefaultReader = await readStartupTerminalSize();
    assert.deepEqual(usingDefaultReader, { cols: 120, rows: 40 });
  } finally {
    restoreCols();
    restoreRows();
  }
});

void test('parsePositiveInt and parseBooleanEnv normalize input values', () => {
  assert.equal(parsePositiveInt(undefined, 5), 5);
  assert.equal(parsePositiveInt('17', 5), 17);
  assert.equal(parsePositiveInt('-1', 5), 5);
  assert.equal(parsePositiveInt('abc', 5), 5);
  assert.equal(parsePositiveInt('9'.repeat(400), 5), 5);

  assert.equal(parseBooleanEnv(undefined, true), true);
  assert.equal(parseBooleanEnv(' yes ', false), true);
  assert.equal(parseBooleanEnv('0', true), false);
  assert.equal(parseBooleanEnv('invalid', true), true);
});

void test('resolveWorkspacePathForMux resolves invocation-relative and home paths', () => {
  assert.equal(
    resolveWorkspacePathForMux('/tmp/work', './repo', '/Users/example'),
    resolve('/tmp/work/repo'),
  );
  assert.equal(
    resolveWorkspacePathForMux('/tmp/work', '~/repo', '/Users/example'),
    '/Users/example/repo',
  );
  assert.equal(
    resolveWorkspacePathForMux('/tmp/work', '~/repo', ''),
    resolve('/tmp/work/~', 'repo'),
  );
});

void test('restoreTerminalState toggles modes and tolerates tty failures', () => {
  const writes: string[] = [];
  const restoreWrite = patchProperty(process.stdout, 'write', ((value: string) => {
    writes.push(value);
    return true;
  }) as typeof process.stdout.write);

  let rawMode: boolean | null = null;
  let paused = false;
  const restoreIsTTY = patchProperty(process.stdin, 'isTTY', true);
  const restoreSetRawMode = patchProperty(process.stdin, 'setRawMode', ((value: boolean) => {
    rawMode = value;
  }) as typeof process.stdin.setRawMode);
  const restorePause = patchProperty(process.stdin, 'pause', (() => {
    paused = true;
    return process.stdin;
  }) as typeof process.stdin.pause);

  try {
    restoreTerminalState(true, null, 'DISABLE-SEQUENCE');
    assert.equal(writes.includes('DISABLE-SEQUENCE'), true);
    assert.equal(
      writes.some((value) => value.endsWith('\n')),
      true,
    );
    assert.equal(rawMode, false);
    assert.equal(paused, true);
  } finally {
    restoreWrite();
    restoreIsTTY();
    restoreSetRawMode();
    restorePause();
  }

  const restoreWriteThrows = patchProperty(process.stdout, 'write', (() => {
    throw new Error('write failed');
  }) as typeof process.stdout.write);
  const restoreIsTTYFalse = patchProperty(process.stdin, 'isTTY', false);
  try {
    restoreTerminalState(false, () => {
      throw new Error('restore-input-modes-failed');
    });
  } finally {
    restoreWriteThrows();
    restoreIsTTYFalse();
  }

  const restoreWriteNoop = patchProperty(process.stdout, 'write', ((value: string) => {
    void value;
    return true;
  }) as typeof process.stdout.write);
  const restoreIsTTYTrue = patchProperty(process.stdin, 'isTTY', true);
  const restoreSetRawModeThrows = patchProperty(process.stdin, 'setRawMode', (() => {
    throw new Error('set-raw-failed');
  }) as typeof process.stdin.setRawMode);
  const restorePauseThrows = patchProperty(process.stdin, 'pause', (() => {
    throw new Error('pause-failed');
  }) as typeof process.stdin.pause);
  try {
    restoreTerminalState(false);
  } finally {
    restoreWriteNoop();
    restoreIsTTYTrue();
    restoreSetRawModeThrows();
    restorePauseThrows();
  }
});
