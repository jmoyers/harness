import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'bun:test';
import { configurePerfCore, shutdownPerfCore } from '../src/perf/perf-core.ts';
import { resolvePtyHelperPath, startPtySession, type PtyExit } from '../src/pty/pty_host.ts';

function createCollector() {
  const chunks: Buffer[] = [];
  return {
    onData: (chunk: Buffer): void => {
      chunks.push(chunk);
    },
    readBuffer: (): Buffer => {
      return Buffer.concat(chunks);
    },
    read: (): string => {
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

function waitForMatch(readOutput: () => string, matcher: RegExp, timeoutMs = 3000): Promise<void> {
  return waitForCondition(
    () => matcher.test(readOutput()),
    `pattern: ${matcher.source}`,
    timeoutMs,
  );
}

function waitForCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 3000,
): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`timed out waiting for ${description}`));
        return;
      }

      setTimeout(tick, 10);
    };

    tick();
  });
}

function waitForExit(
  session: ReturnType<typeof startPtySession>,
  timeoutMs = 3000,
): Promise<PtyExit> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timed out waiting for process exit'));
    }, timeoutMs);

    session.once('exit', (result: unknown) => {
      clearTimeout(timer);
      if (!isPtyExit(result)) {
        reject(new Error('invalid exit payload'));
        return;
      }
      resolve(result);
    });
  });
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) {
    throw new Error('cannot compute percentile for empty values');
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rawIndex = Math.ceil((quantile / 100) * sorted.length) - 1;
  const clampedIndex = Math.min(Math.max(rawIndex, 0), sorted.length - 1);
  const value = sorted[clampedIndex];
  if (value === undefined) {
    throw new Error('percentile index out of range');
  }
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface PerfRecord {
  type: string;
  name: string;
  'duration-ns'?: string;
}

function parsePerfRecord(line: string): PerfRecord {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('invalid perf record');
  }

  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.type !== 'string' || typeof candidate.name !== 'string') {
    throw new Error('invalid perf record');
  }

  if (candidate['duration-ns'] !== undefined && typeof candidate['duration-ns'] !== 'string') {
    throw new Error('invalid perf record');
  }
  const durationNs = candidate['duration-ns'];
  const baseRecord = {
    type: candidate.type,
    name: candidate.name,
  };
  if (typeof durationNs === 'string') {
    return {
      ...baseRecord,
      'duration-ns': durationNs,
    };
  }
  return baseRecord;
}

function readPerfRecords(filePath: string): PerfRecord[] {
  const contents = readFileSync(filePath, 'utf8');
  return contents
    .split('\n')
    .filter((line) => line.length > 0)
    .map(parsePerfRecord);
}

afterEach(() => {
  configurePerfCore({ enabled: false });
  shutdownPerfCore();
});

void test('pty-host transparently echoes input using cat', async () => {
  const session = startPtySession({
    command: '/bin/cat',
    commandArgs: [],
  });
  assert.equal(typeof session.processId(), 'number');
  const collector = createCollector();
  session.on('data', collector.onData);

  session.write('hello-pty\n');
  await waitForMatch(collector.read, /hello-pty/);

  session.write(new Uint8Array([0x04]));
  const exit = await waitForExit(session);
  assert.equal(exit.code, 0);
});

void test('pty-host forwards shell output and exits cleanly', async () => {
  const session = startPtySession({
    command: '/bin/sh',
    commandArgs: ['-c', 'printf "ready\\n"'],
  });
  const collector = createCollector();
  session.on('data', collector.onData);

  const exit = await waitForExit(session);
  assert.equal(exit.code, 0);
  assert.match(collector.read(), /ready/);
});

void test('pty-host runs command in provided cwd', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'harness-pty-cwd-'));
  const session = startPtySession({
    command: '/bin/sh',
    commandArgs: ['-c', 'pwd'],
    cwd,
  });
  const collector = createCollector();
  session.on('data', collector.onData);

  try {
    const exit = await waitForExit(session);
    assert.equal(exit.code, 0);
    assert.match(collector.read(), new RegExp(escapeRegExp(cwd)));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

void test('pty-host forwards stderr output through data stream', async () => {
  const session = startPtySession({
    command: '/bin/sh',
    commandArgs: ['-c', 'printf "stderr-ready\\n" 1>&2'],
  });
  const collector = createCollector();
  session.on('data', collector.onData);

  const exit = await waitForExit(session);
  assert.equal(exit.code, 0);
  assert.match(collector.read(), /stderr-ready/);
});

void test('pty-host resize updates terminal size seen by shell', async () => {
  const session = startPtySession({
    command: '/bin/sh',
    commandArgs: ['-i'],
    env: {
      ...process.env,
      PS1: '',
    },
  });
  const collector = createCollector();
  session.on('data', collector.onData);

  session.resize(120, 40);
  session.write('stty size\n');
  session.write('exit\n');

  const exit = await waitForExit(session);
  assert.equal(exit.code, 0);
  assert.match(collector.read(), /40 120/);
});

void test('pty-host applies initial terminal size before first command', async () => {
  const session = startPtySession({
    command: '/bin/sh',
    commandArgs: ['-i'],
    env: {
      ...process.env,
      PS1: '',
    },
    initialCols: 67,
    initialRows: 23,
  });
  const collector = createCollector();
  session.on('data', collector.onData);

  session.write('stty size\n');
  session.write('exit\n');

  const exit = await waitForExit(session);
  assert.equal(exit.code, 0);
  assert.match(collector.read(), /23 67/);
});

void test('pty-host close command exits default interactive shell session', async () => {
  const session = startPtySession();
  session.close();
  const exit = await waitForExit(session);
  assert.notEqual(exit.code, null);
});

void test('pty-host resolves helper path from preferred defaults and explicit overrides', () => {
  const resolvedDefault = resolvePtyHelperPath(
    undefined,
    ['/missing/helper', '/preferred/helper'],
    (path) => path === '/preferred/helper',
  );
  assert.equal(resolvedDefault, '/preferred/helper');

  const resolvedFallback = resolvePtyHelperPath(
    undefined,
    ['/fallback/helper', '/missing/helper'],
    () => false,
  );
  assert.equal(resolvedFallback, '/fallback/helper');

  const resolvedExplicit = resolvePtyHelperPath('/explicit/helper', ['/unused'], () => false);
  assert.equal(resolvedExplicit, '/explicit/helper');
});

void test('pty-host helper path resolver rejects empty candidate lists', () => {
  assert.throws(
    () => resolvePtyHelperPath(undefined, [], () => false),
    /pty helper path candidates must include at least one path/,
  );
});

void test('pty-host emits error when helper executable cannot be launched', async () => {
  const session = startPtySession({
    helperPath: '/path/that/does/not/exist',
  });
  assert.equal(session.processId(), null);

  const error = await new Promise<Error>((resolve) => {
    session.once('error', resolve);
  });

  assert.match(error.message, /ENOENT/);
});

void test(
  'pty-host supports interactive vim editing flow',
  async () => {
    const tempPath = mkdtempSync(join(tmpdir(), 'harness-vim-'));
    const notePath = join(tempPath, 'note.txt');

    try {
      const session = startPtySession({
        command: '/usr/bin/vim',
        commandArgs: ['-Nu', 'NONE', '-n', notePath],
        env: {
          ...process.env,
          TERM: process.env.TERM ?? 'xterm-256color',
        },
      });
      const collector = createCollector();
      session.on('data', collector.onData);

      await waitForCondition(
        () => collector.read().length > 0,
        'vim initial terminal output',
        5000,
      );
      await delay(100);

      session.write('iharness-vim-checkpoint');
      session.write('\u001b');
      session.write(':wq\r');

      const exit = await waitForExit(session, 10000);
      assert.equal(exit.code, 0);
      assert.match(readFileSync(notePath, 'utf8'), /harness-vim-checkpoint/);
    } finally {
      rmSync(tempPath, { recursive: true, force: true });
    }
  },
  { timeout: 20000 },
);

void test('pty-host preserves terminal control sequences in output stream', async () => {
  const expectedSequences = [
    '\u001b[?1049h',
    '\u001b[?25l',
    '\u001b[?2004h',
    '\u001b[?1000h',
    '\u001b[38;2;1;2;3m',
    '\u001b[0m',
    '\u001b[?1000l',
    '\u001b[?2004l',
    '\u001b[?25h',
    '\u001b[?1049l',
  ];

  const session = startPtySession({
    command: '/bin/sh',
    commandArgs: [
      '-c',
      'printf "\\033[?1049h\\033[?25l\\033[?2004h\\033[?1000h\\033[38;2;1;2;3mX\\033[0m\\033[?1000l\\033[?2004l\\033[?25h\\033[?1049l\\n"',
    ],
  });
  const collector = createCollector();
  session.on('data', collector.onData);

  const exit = await waitForExit(session);
  assert.equal(exit.code, 0);

  const output = collector.readBuffer();
  for (const sequence of expectedSequences) {
    assert.equal(output.includes(Buffer.from(sequence, 'utf8')), true);
  }
});

void test(
  'pty-host perf emits stdout chunk events when no write probe is pending',
  async () => {
    const tempPath = mkdtempSync(join(tmpdir(), 'harness-perf-empty-'));
    const perfFilePath = join(tempPath, 'perf.jsonl');

    try {
      configurePerfCore({
        enabled: true,
        filePath: perfFilePath,
      });

      const session = startPtySession({
        command: '/bin/sh',
        commandArgs: [
          '-c',
          'for i in $(seq 1 12); do printf "stdout-without-probe-$i\\n"; sleep 0.01; done',
        ],
      });

      const exit = await waitForExit(session, 10000);
      assert.equal(exit.code, 0);

      configurePerfCore({
        enabled: false,
        filePath: perfFilePath,
      });
      shutdownPerfCore();

      const records = readPerfRecords(perfFilePath);
      assert.ok(
        records.some((record) => record.type === 'event' && record.name === 'pty.stdout.chunk'),
      );
      assert.equal(
        records.some(
          (record) => record.type === 'span' && record.name === 'pty.keystroke.roundtrip',
        ),
        false,
      );
    } finally {
      configurePerfCore({ enabled: false });
      shutdownPerfCore();
      rmSync(tempPath, { recursive: true, force: true });
    }
  },
  { timeout: 10000 },
);

void test(
  'pty-host trims roundtrip output window when buffered stdout exceeds max bytes',
  async () => {
    const tempPath = mkdtempSync(join(tmpdir(), 'harness-perf-window-'));
    const perfFilePath = join(tempPath, 'perf.jsonl');
    let session: ReturnType<typeof startPtySession> | null = null;

    try {
      configurePerfCore({
        enabled: true,
        filePath: perfFilePath,
      });

      session = startPtySession({
        command: '/bin/cat',
        commandArgs: [],
      });

      const internals = session as unknown as {
        pendingRoundtripProbes: Array<{
          probeId: number;
          payloadLength: number;
          matchPayloads: Buffer[];
          startedAtNs: bigint;
        }>;
        outputWindow: Buffer;
        trackRoundtrip: (chunk: Buffer) => void;
      };
      internals.pendingRoundtripProbes.push({
        probeId: 1,
        payloadLength: 5,
        matchPayloads: [Buffer.from('never-match-probe', 'utf8')],
        startedAtNs: process.hrtime.bigint(),
      });
      internals.trackRoundtrip(Buffer.alloc(9000, 0x41));

      assert.equal(internals.pendingRoundtripProbes.length, 1);
      assert.equal(internals.outputWindow.length, 8192);
      session.write(new Uint8Array([0x04]));
      const exit = await waitForExit(session, 5000);
      assert.equal(exit.code, 0);
      session = null;
    } finally {
      if (session !== null) {
        session.write(new Uint8Array([0x04]));
        await waitForExit(session, 1000).catch(() => undefined);
      }
      configurePerfCore({ enabled: false });
      shutdownPerfCore();
      rmSync(tempPath, { recursive: true, force: true });
    }
  },
  { timeout: 10000 },
);

void test(
  'pty-host bounds pending roundtrip probes when probe list grows beyond the cap',
  async () => {
    const tempPath = mkdtempSync(join(tmpdir(), 'harness-perf-probe-cap-'));
    const perfFilePath = join(tempPath, 'perf.jsonl');
    let session: ReturnType<typeof startPtySession> | null = null;

    try {
      configurePerfCore({
        enabled: true,
        filePath: perfFilePath,
      });

      session = startPtySession({
        command: '/bin/cat',
        commandArgs: [],
      });

      const internals = session as unknown as {
        pendingRoundtripProbes: Array<{
          probeId: number;
          payloadLength: number;
          matchPayloads: Buffer[];
          startedAtNs: bigint;
        }>;
        trackRoundtrip: (chunk: Buffer) => void;
        constructor: {
          MAX_PENDING_ROUNDTRIP_PROBES: number;
        };
      };
      const maxPending = internals.constructor.MAX_PENDING_ROUNDTRIP_PROBES;
      assert.ok(maxPending > 0);

      for (let idx = 0; idx < maxPending + 8; idx += 1) {
        internals.pendingRoundtripProbes.push({
          probeId: idx + 1,
          payloadLength: 8,
          matchPayloads: [Buffer.from(`never-match-${idx}`, 'utf8')],
          startedAtNs: process.hrtime.bigint(),
        });
      }
      internals.trackRoundtrip(Buffer.from('x', 'utf8'));

      assert.equal(internals.pendingRoundtripProbes.length, maxPending);
      assert.equal(internals.pendingRoundtripProbes[0]?.probeId, 9);
      session.write(new Uint8Array([0x04]));
      const exit = await waitForExit(session, 5000);
      assert.equal(exit.code, 0);
      session = null;
    } finally {
      if (session !== null) {
        session.write(new Uint8Array([0x04]));
        await waitForExit(session, 1000).catch(() => undefined);
      }
      configurePerfCore({ enabled: false });
      shutdownPerfCore();
      rmSync(tempPath, { recursive: true, force: true });
    }
  },
  { timeout: 10000 },
);

void test(
  'pty-host expires stale roundtrip probes before matching',
  async () => {
    const tempPath = mkdtempSync(join(tmpdir(), 'harness-perf-probe-expiry-'));
    const perfFilePath = join(tempPath, 'perf.jsonl');
    let session: ReturnType<typeof startPtySession> | null = null;

    try {
      configurePerfCore({
        enabled: true,
        filePath: perfFilePath,
      });

      session = startPtySession({
        command: '/bin/cat',
        commandArgs: [],
      });

      const internals = session as unknown as {
        pendingRoundtripProbes: Array<{
          probeId: number;
          payloadLength: number;
          matchPayloads: Buffer[];
          startedAtNs: bigint;
        }>;
        trackRoundtrip: (chunk: Buffer) => void;
        constructor: {
          ROUNDTRIP_PROBE_MAX_AGE_NS: bigint;
        };
      };
      const ttlNs = internals.constructor.ROUNDTRIP_PROBE_MAX_AGE_NS;
      assert.ok(ttlNs > 0n);
      const nowNs = process.hrtime.bigint();

      internals.pendingRoundtripProbes.push(
        {
          probeId: 1,
          payloadLength: 4,
          matchPayloads: [Buffer.from('stale-probe', 'utf8')],
          startedAtNs: nowNs - ttlNs - 1n,
        },
        {
          probeId: 2,
          payloadLength: 4,
          matchPayloads: [Buffer.from('fresh-probe', 'utf8')],
          startedAtNs: nowNs,
        },
      );

      internals.trackRoundtrip(Buffer.from('zzz', 'utf8'));

      assert.equal(internals.pendingRoundtripProbes.length, 1);
      assert.equal(internals.pendingRoundtripProbes[0]?.probeId, 2);
      session.write(new Uint8Array([0x04]));
      const exit = await waitForExit(session, 5000);
      assert.equal(exit.code, 0);
      session = null;
    } finally {
      if (session !== null) {
        session.write(new Uint8Array([0x04]));
        await waitForExit(session, 1000).catch(() => undefined);
      }
      configurePerfCore({ enabled: false });
      shutdownPerfCore();
      rmSync(tempPath, { recursive: true, force: true });
    }
  },
  { timeout: 10000 },
);

void test(
  'pty-host emits keystroke roundtrip instrumentation with low latency',
  async () => {
    const tempPath = mkdtempSync(join(tmpdir(), 'harness-perf-'));
    const perfFilePath = join(tempPath, 'perf.jsonl');

    try {
      configurePerfCore({
        enabled: true,
        filePath: perfFilePath,
      });

      const session = startPtySession({
        command: '/bin/cat',
        commandArgs: [],
      });
      const collector = createCollector();
      session.on('data', collector.onData);

      const sampleCount = 300;
      for (let idx = 0; idx < sampleCount; idx += 1) {
        const marker = `roundtrip-${idx}`;
        session.write(`${marker}\n`);
        await waitForMatch(collector.read, new RegExp(escapeRegExp(marker)));
      }

      session.write(new Uint8Array([0x04]));
      const exit = await waitForExit(session, 10000);
      assert.equal(exit.code, 0);

      configurePerfCore({
        enabled: false,
        filePath: perfFilePath,
      });
      shutdownPerfCore();

      const records = readPerfRecords(perfFilePath);
      const spans = records.filter((record) => {
        return record.type === 'span' && record.name === 'pty.keystroke.roundtrip';
      });

      assert.equal(spans.length, sampleCount);
      const durationsMs = spans.map((span) => {
        if (span['duration-ns'] === undefined) {
          throw new Error('missing duration');
        }
        return Number(BigInt(span['duration-ns'])) / 1_000_000;
      });

      const p50 = percentile(durationsMs, 50);
      const p95 = percentile(durationsMs, 95);
      const p99 = percentile(durationsMs, 99);

      assert.ok(p50 <= 5, `expected p50 <= 5ms, got ${p50.toFixed(3)}ms`);
      assert.ok(p95 <= 10, `expected p95 <= 10ms, got ${p95.toFixed(3)}ms`);
      assert.ok(p99 <= 15, `expected p99 <= 15ms, got ${p99.toFixed(3)}ms`);
    } finally {
      configurePerfCore({ enabled: false });
      shutdownPerfCore();
      rmSync(tempPath, { recursive: true, force: true });
    }
  },
  { timeout: 30000 },
);
