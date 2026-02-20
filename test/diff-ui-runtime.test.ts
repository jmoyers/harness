import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'bun:test';
import type { DiffBuilder } from '../src/diff/types.ts';
import { runDiffUiCli } from '../src/diff-ui/runtime.ts';
import { createSampleDiff } from './support/diff-ui-fixture.ts';

function createBuilder(): DiffBuilder {
  return {
    build: async () => ({
      diff: createSampleDiff(),
      diagnostics: {
        elapsedMs: 1,
        peakBufferBytes: 10,
        parseWarnings: [],
      },
    }),
    stream: async function* () {
      // no-op
    },
  };
}

function createEmptyBuilder(): DiffBuilder {
  return {
    build: async () => ({
      diff: {
        ...createSampleDiff(),
        files: [],
        totals: {
          filesChanged: 0,
          additions: 0,
          deletions: 0,
          binaryFiles: 0,
          generatedFiles: 0,
          hunks: 0,
          lines: 0,
        },
      },
      diagnostics: {
        elapsedMs: 1,
        peakBufferBytes: 1,
        parseWarnings: [],
      },
    }),
    stream: async function* () {
      // no-op
    },
  };
}

void test('runDiffUiCli renders one-shot document output', async () => {
  let stdout = '';
  let stderr = '';

  const result = await runDiffUiCli({
    argv: ['--width', '90', '--height', '10', '--theme', 'plain'],
    cwd: '/repo',
    env: {},
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: (text) => {
      stderr += text;
    },
    createBuilder,
    isStdoutTty: false,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.renderedLines.length > 0, true);
  assert.equal(
    result.events.some((event) => event.type === 'diff.loaded'),
    true,
  );
  assert.equal(stdout.includes('File 1/2: src/a.ts'), true);
  assert.equal(stderr, '');
});

void test('runDiffUiCli supports rpc/json-events command flow', async () => {
  let stdout = '';
  let stderr = '';
  const rpcCommands = [
    '42',
    '{"type":1}',
    '{"type":"view.setMode","mode":"invalid"}',
    '{"type":"nav.gotoFile","index":"x"}',
    '{"type":"finder.query","query":5}',
    '{"type":"finder.open"}',
    '{"type":"finder.close"}',
    '{"type":"finder.query","query":"read"}',
    '{"type":"finder.move","delta":1}',
    '{"type":"finder.accept"}',
    '{"type":"nav.scroll","delta":2}',
    '{"type":"nav.page","delta":1}',
    '{"type":"nav.gotoFile","index":0}',
    '{"type":"nav.gotoHunk","index":0}',
    '{"type":"search.set","query":"const"}',
    '{"type":"view.setMode","mode":"unified"}',
    '{"type":"unknown"}',
    'not-json',
    '{"type":"session.quit"}',
  ].join('\n');

  const result = await runDiffUiCli({
    argv: ['--json-events', '--rpc-stdio', '--width', '100', '--height', '12', '--watch'],
    cwd: '/repo',
    env: {},
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: (text) => {
      stderr += text;
    },
    readStdinText: () => rpcCommands,
    createBuilder,
    isStdoutTty: false,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.events.some((event) => event.type === 'session.quit'),
    true,
  );
  assert.equal(
    result.events.some((event) => event.type === 'warning'),
    true,
  );
  assert.equal(
    result.events.some((event) => event.type === 'state.changed'),
    true,
  );
  assert.equal(
    result.events.some((event) => event.type === 'render.completed'),
    true,
  );

  const emitted = stdout
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string });
  assert.equal(emitted.length >= 5, true);
  assert.equal(
    emitted.some((event) => event.type === 'diff.loaded'),
    true,
  );
  assert.equal(stderr, '');
});

void test('runDiffUiCli can use default stdin reader path for rpc mode', async () => {
  let stdout = '';
  let stderr = '';
  const result = await runDiffUiCli({
    argv: ['--json-events', '--rpc-stdio', '--width', '100', '--height', '12'],
    cwd: '/repo',
    env: {},
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: (text) => {
      stderr += text;
    },
    createBuilder,
    isStdoutTty: false,
    stdoutCols: 100,
    stdoutRows: 12,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(stdout.includes('diff.loaded'), true);
  assert.equal(stderr, '');
});

void test('runDiffUiCli default rpc stdin reader does not block on tty stdin', async () => {
  let stdout = '';
  let stderr = '';
  const originalIsStdinTty = process.stdin.isTTY;

  Object.defineProperty(process.stdin, 'isTTY', {
    value: true,
    configurable: true,
  });

  try {
    const result = await runDiffUiCli({
      argv: ['--json-events', '--rpc-stdio', '--width', '100', '--height', '12'],
      cwd: '/repo',
      env: {},
      writeStdout: (text) => {
        stdout += text;
      },
      writeStderr: (text) => {
        stderr += text;
      },
      createBuilder,
      isStdoutTty: false,
      stdoutCols: 100,
      stdoutRows: 12,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(
      result.events.some((event) => event.type === 'diff.loaded'),
      true,
    );
    assert.equal(
      result.events.some((event) => event.type === 'session.quit'),
      false,
    );
    assert.equal(stdout.includes('diff.loaded'), true);
    assert.equal(stderr, '');
  } finally {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsStdinTty,
      configurable: true,
    });
  }
});

void test('runDiffUiCli surfaces parse/build failures', async () => {
  let stderrParse = '';
  const badArgs = await runDiffUiCli({
    argv: ['--definitely-unknown-flag'],
    cwd: '/repo',
    env: {},
    writeStderr: (text) => {
      stderrParse += text;
    },
    createBuilder,
    isStdoutTty: false,
  });

  assert.equal(badArgs.exitCode, 1);
  assert.equal(stderrParse.includes('unknown option'), true);

  let stderrBuild = '';
  const badBuilder = await runDiffUiCli({
    argv: [],
    cwd: '/repo',
    env: {},
    writeStderr: (text) => {
      stderrBuild += text;
    },
    createBuilder: () => ({
      build: async () => {
        throw new Error('diff build failed');
      },
      stream: async function* () {
        // no-op
      },
    }),
    isStdoutTty: false,
  });

  assert.equal(badBuilder.exitCode, 1);
  assert.equal(stderrBuild.includes('diff build failed'), true);
});

void test('runDiffUiCli default stdout/stderr writers are exercised', async () => {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let capturedStdout = '';
  let capturedStderr = '';

  process.stdout.write = ((chunk: unknown) => {
    capturedStdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    capturedStderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    const ok = await runDiffUiCli({
      argv: ['--json-events', '--width', '80', '--height', '8'],
      cwd: '/repo',
      env: {},
      createBuilder,
      isStdoutTty: false,
    });
    assert.equal(ok.exitCode, 0);

    const fail = await runDiffUiCli({
      argv: ['--totally-unknown-option'],
      cwd: '/repo',
      env: {},
      createBuilder,
      isStdoutTty: false,
    });
    assert.equal(fail.exitCode, 1);
  } finally {
    process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
    process.stderr.write = originalStderrWrite as typeof process.stderr.write;
  }

  assert.equal(capturedStdout.includes('diff.loaded'), true);
  assert.equal(capturedStderr.includes('unknown option'), true);
});

void test('runDiffUiCli does not print blank output for empty document diffs', async () => {
  let stdout = '';
  const result = await runDiffUiCli({
    argv: [],
    cwd: '/repo',
    env: {},
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: () => {},
    createBuilder: createEmptyBuilder,
    isStdoutTty: false,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.renderedLines.length, 0);
  assert.equal(stdout, '');
});

void test('runDiffUiCli forwards rename limit git options into diff builder', async () => {
  let capturedRenameLimit: number | null = null;
  let capturedNoRenames: boolean | null = null;

  const result = await runDiffUiCli({
    argv: ['--json-events', '--renames', '--rename-limit', '5'],
    cwd: '/repo',
    env: {},
    writeStdout: () => {},
    writeStderr: () => {},
    createBuilder: () => ({
      build: async (options) => {
        capturedNoRenames = options.git?.noRenames ?? null;
        capturedRenameLimit = options.git?.renameLimit ?? null;
        return {
          diff: createSampleDiff(),
          diagnostics: {
            elapsedMs: 1,
            peakBufferBytes: 1,
            parseWarnings: [],
          },
        };
      },
      stream: async function* () {
        // no-op
      },
    }),
    isStdoutTty: false,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(capturedNoRenames, false);
  assert.equal(capturedRenameLimit, 5);
});

interface FakePagerInputStream extends EventEmitter {
  isTTY: boolean;
  setRawMode: (mode: boolean) => void;
  resume: () => void;
  pause: () => void;
}

interface FakePagerOutputStream extends EventEmitter {
  isTTY: boolean;
  columns: number;
  rows: number;
}

void test('runDiffUiCli supports interactive pager mode', async () => {
  let stdout = '';
  let stderr = '';
  const input = new EventEmitter() as FakePagerInputStream;
  input.isTTY = true;
  input.setRawMode = () => {};
  input.resume = () => {};
  input.pause = () => {};
  const output = new EventEmitter() as FakePagerOutputStream;
  output.isTTY = true;
  output.columns = 90;
  output.rows = 12;

  const resultPromise = runDiffUiCli({
    argv: ['--pager', '--theme', 'plain'],
    cwd: '/repo',
    env: {},
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: (text) => {
      stderr += text;
    },
    createBuilder,
    isStdoutTty: true,
    pagerStdin: input,
    pagerStdout: output,
  });

  setTimeout(() => {
    input.emit('data', Buffer.from('q', 'utf8'));
  }, 0);
  const result = await resultPromise;

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.events.some((event) => event.type === 'session.quit'),
    true,
  );
  assert.equal(stdout.includes('\u001b[?1049h'), true);
  assert.equal(stdout.includes('\u001b[?1049l'), true);
  assert.equal(stderr, '');
});

void test('runDiffUiCli honors --no-pager in tty mode', async () => {
  let stdout = '';
  const result = await runDiffUiCli({
    argv: ['--no-pager', '--theme', 'plain'],
    cwd: '/repo',
    env: {},
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: () => {},
    createBuilder,
    isStdoutTty: true,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.events.some((event) => event.type === 'session.quit'),
    false,
  );
  assert.equal(stdout.includes('File 1/2: src/a.ts'), true);
});
