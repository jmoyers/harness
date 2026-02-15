import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildTomlStringArray,
  classifyNotifyRecord,
  normalizeTerminalColorHex,
  parseNotifyRecordLine,
  startCodexLiveSession,
  terminalHexToOscColor,
  type NotifyPayload
} from '../src/codex/live-session.ts';
import type { BrokerAttachmentHandlers } from '../src/pty/session-broker.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';
import { configurePerfCore, shutdownPerfCore } from '../src/perf/perf-core.ts';

class FakeBroker {
  private readonly attachments = new Map<string, BrokerAttachmentHandlers>();
  private nextAttachmentId = 1;
  closeCount = 0;
  detachCount = 0;
  writes: Array<string | Uint8Array> = [];
  resizeCalls: Array<{ cols: number; rows: number }> = [];

  attach(handlers: BrokerAttachmentHandlers, sinceCursor = 0): string {
    void sinceCursor;
    const id = `attachment-${this.nextAttachmentId}`;
    this.nextAttachmentId += 1;
    this.attachments.set(id, handlers);
    return id;
  }

  detach(attachmentId: string): void {
    this.attachments.delete(attachmentId);
    this.detachCount += 1;
  }

  latestCursorValue(): number {
    return 7;
  }

  processId(): number | null {
    return 43210;
  }

  write(data: string | Uint8Array): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizeCalls.push({ cols, rows });
  }

  close(): void {
    this.closeCount += 1;
  }

  emitData(cursor: number, chunk: Buffer): void {
    for (const handlers of this.attachments.values()) {
      handlers.onData({ cursor, chunk });
    }
  }

  emitExit(exit: PtyExit): void {
    for (const handlers of this.attachments.values()) {
      handlers.onExit(exit);
    }
  }
}

void test('buildTomlStringArray escapes quotes and backslashes', () => {
  const value = buildTomlStringArray([
    '/usr/bin/env',
    'node',
    'a"b',
    'c\\d'
  ]);
  assert.equal(value, '["/usr/bin/env","node","a\\"b","c\\\\d"]');
});

void test('terminal color normalization and OSC formatting are deterministic', () => {
  assert.equal(normalizeTerminalColorHex(undefined, '112233'), '112233');
  assert.equal(normalizeTerminalColorHex('#A1b2C3', '112233'), 'a1b2c3');
  assert.equal(normalizeTerminalColorHex(' bad ', '112233'), '112233');
  assert.equal(terminalHexToOscColor('010203'), 'rgb:0101/0202/0303');
  assert.equal(terminalHexToOscColor('nope'), 'rgb:d0d0/d7d7/dede');
});

void test('parseNotifyRecordLine validates json structure', () => {
  assert.equal(parseNotifyRecordLine('not-json'), null);
  assert.equal(parseNotifyRecordLine('1'), null);
  assert.equal(parseNotifyRecordLine('{"ts":1}'), null);
  assert.equal(parseNotifyRecordLine('{"ts":"x","payload":"bad"}'), null);

  const parsed = parseNotifyRecordLine('{"ts":"2026-01-01T00:00:00Z","payload":{"type":"agent-turn-complete"}}');
  assert.deepEqual(parsed, {
    ts: '2026-01-01T00:00:00Z',
    payload: {
      type: 'agent-turn-complete'
    }
  });
});

void test('classifyNotifyRecord maps completion and attention', () => {
  const completion = classifyNotifyRecord({
    ts: 't',
    payload: {
      type: 'agent-turn-complete'
    }
  });
  assert.deepEqual(completion, { type: 'turn-completed' });
  const completionVariant = classifyNotifyRecord({
    ts: 't',
    payload: {
      type: 'agent.turn-completed'
    }
  });
  assert.deepEqual(completionVariant, { type: 'turn-completed' });

  const approval = classifyNotifyRecord({
    ts: 't',
    payload: {
      type: 'item/file-change/request-approval'
    }
  });
  assert.deepEqual(approval, { type: 'attention-required', reason: 'approval' });

  const input = classifyNotifyRecord({
    ts: 't',
    payload: {
      type: 'item/tool/request-input'
    }
  });
  assert.deepEqual(input, { type: 'attention-required', reason: 'user-input' });

  const unknown = classifyNotifyRecord({
    ts: 't',
    payload: {
      message: 'none'
    }
  });
  assert.equal(unknown, null);
});

void test('codex live session emits terminal and notify-derived events', () => {
  const broker = new FakeBroker();
  const setIntervalCalls: Array<{ callback: () => void; interval: number }> = [];
  const clearHandles: Array<NodeJS.Timeout> = [];
  let notifyContent = '';
  const readFileCalls: string[] = [];
  let startOptions: { command?: string; commandArgs?: string[]; env?: NodeJS.ProcessEnv; cwd?: string } | undefined;

  const session = startCodexLiveSession(
    {
      command: 'codex-custom',
      args: ['--model', 'gpt-5.3-codex'],
      env: { ...process.env, HARNESS_TEST: '1' },
      cwd: '/tmp/harness-session',
      notifyFilePath: '/tmp/harness-notify.jsonl',
      notifyPollMs: 250,
      relayScriptPath: '/tmp/relay.ts'
    },
    {
      startBroker: (options) => {
        startOptions = options;
        return broker;
      },
      readFile: (path) => {
        readFileCalls.push(path);
        return notifyContent;
      },
      setIntervalFn: (callback, intervalMs) => {
        setIntervalCalls.push({ callback, interval: intervalMs });
        return { hasRef: () => true } as unknown as NodeJS.Timeout;
      },
      clearIntervalFn: (handle) => {
        clearHandles.push(handle);
      }
    }
  );

  const events: string[] = [];
  const unsubscribe = session.onEvent((event) => {
    events.push(event.type);
  });

  broker.emitData(3, Buffer.from('hello', 'utf8'));
  broker.emitExit({ code: 0, signal: null });

  const firstSnapshot = session.snapshot();
  assert.equal(firstSnapshot.lines[0], 'hello');
  assert.equal(firstSnapshot.activeScreen, 'primary');

  notifyContent = [
    JSON.stringify({
      ts: '2026-02-14T04:00:00.000Z',
      payload: {
        type: 'agent-turn-complete'
      } satisfies NotifyPayload
    }),
    JSON.stringify({
      ts: '2026-02-14T04:00:01.000Z',
      payload: {
        type: 'item/tool/request-input'
      } satisfies NotifyPayload
    }),
    ''
  ].join('\n');

  const poll = setIntervalCalls[0];
  assert.ok(poll !== undefined);
  assert.equal(poll?.interval, 250);
  poll?.callback();

  assert.deepEqual(events, [
    'terminal-output',
    'session-exit',
    'notify',
    'turn-completed',
    'notify',
    'attention-required'
  ]);

  assert.equal(startOptions?.command, 'codex-custom');
  assert.deepEqual(startOptions?.commandArgs, [
    '--no-alt-screen',
    '-c',
    'notify=["/usr/bin/env","' + process.execPath + '","--experimental-strip-types","/tmp/relay.ts","/tmp/harness-notify.jsonl"]',
    '--model',
    'gpt-5.3-codex'
  ]);
  assert.equal(startOptions?.env?.HARNESS_TEST, '1');
  assert.equal(startOptions?.cwd, '/tmp/harness-session');
  assert.equal(readFileCalls.length, 1);

  // Re-poll with no new bytes to exercise empty-delta path.
  poll?.callback();

  // Truncated file plus invalid lines should be tolerated.
  notifyContent = [
    '',
    'not-json',
    JSON.stringify({
      ts: '2026-02-14T04:00:03.000Z',
      payload: {
        type: 'item/unknown'
      } satisfies NotifyPayload
    }),
    ''
  ].join('\n');
  poll?.callback();

  const attachmentId = session.attach({
    onData: () => {
      // no-op
    },
    onExit: () => {
      // no-op
    }
  });
  session.detach(attachmentId);
  assert.equal(session.latestCursorValue(), 7);
  assert.equal(session.processId(), 43210);
  session.write('abc');
  session.resize(100, 40);
  session.scrollViewport(-1);
  session.setFollowOutput(false);
  let followSnapshot = session.snapshot();
  assert.equal(followSnapshot.viewport.followOutput, false);
  session.setFollowOutput(true);
  followSnapshot = session.snapshot();
  assert.equal(followSnapshot.viewport.followOutput, true);
  const resizedSnapshot = session.snapshot();
  assert.equal(resizedSnapshot.cols, 100);
  assert.equal(resizedSnapshot.rows, 40);
  assert.equal(broker.writes.length, 1);
  assert.deepEqual(broker.resizeCalls, [{ cols: 100, rows: 40 }]);

  unsubscribe();
  broker.emitData(4, Buffer.from('ignored', 'utf8'));
  assert.equal(events.includes('terminal-output'), true);

  session.close();
  session.close();
  assert.equal(broker.closeCount, 1);
  assert.equal(broker.detachCount, 2);
  assert.equal(clearHandles.length, 1);
});

void test('codex live session can disable snapshot ingest while preserving output events', () => {
  const broker = new FakeBroker();
  const session = startCodexLiveSession(
    {
      useNotifyHook: false,
      enableSnapshotModel: false
    },
    {
      startBroker: () => broker
    }
  );

  const observedChunks: string[] = [];
  const removeListener = session.onEvent((event) => {
    if (event.type === 'terminal-output') {
      observedChunks.push(event.chunk.toString('utf8'));
    }
  });

  broker.emitData(1, Buffer.from('hello', 'utf8'));

  assert.deepEqual(observedChunks, ['hello']);
  const snapshot = session.snapshot();
  assert.equal(snapshot.lines[0], '');
  assert.equal(snapshot.cursor.row, 0);
  assert.equal(snapshot.cursor.col, 0);

  removeListener();
  session.close();
});

void test('codex live session replies to OSC terminal color queries', () => {
  const broker = new FakeBroker();
  const perfPath = join(tmpdir(), `harness-query-perf-${Date.now().toString(36)}.jsonl`);
  configurePerfCore({
    enabled: true,
    filePath: perfPath
  });
  const session = startCodexLiveSession(
    {
      useNotifyHook: false,
      env: {
        ...process.env,
        HARNESS_TERM_FG: '#010203',
        HARNESS_TERM_BG: '#040506'
      },
      terminalForegroundHex: '#a0b1c2',
      terminalBackgroundHex: '0d0e0f'
    },
    {
      startBroker: () => broker,
      readFile: () => '',
      setIntervalFn: () => {
        throw new Error('notify polling should be disabled');
      },
      clearIntervalFn: () => {
        // no-op
      }
    }
  );

  broker.emitData(1, Buffer.from('x', 'utf8'));
  broker.emitData(2, Buffer.from('\u001b[', 'utf8'));
  broker.emitData(3, Buffer.from('\u001b]10;?\u0007', 'utf8'));
  broker.emitData(4, Buffer.from('\u001b]11;?', 'utf8'));
  broker.emitData(5, Buffer.from('\u001b', 'utf8'));
  broker.emitData(6, Buffer.from('\\', 'utf8'));
  broker.emitData(6, Buffer.from('\u001b]4;12;?\u0007', 'utf8'));
  broker.emitData(6, Buffer.from('\u001b]4;999;?\u0007', 'utf8'));
  broker.emitData(6, Buffer.from('\u001b]4;12;13;?\u0007', 'utf8'));
  broker.emitData(6, Buffer.from('\u001b]4;bad;?\u0007', 'utf8'));
  broker.emitData(7, Buffer.from('\u001b]12;?\u0007', 'utf8'));
  broker.emitData(8, Buffer.from('\u001b]10;?\u001bX\u0007', 'utf8'));
  broker.emitData(9, Buffer.from('\u001b[c', 'utf8'));
  broker.emitData(10, Buffer.from('\u001b[>c', 'utf8'));
  broker.emitData(10, Buffer.from('\u001b[0c', 'utf8'));
  broker.emitData(10, Buffer.from('\u001b[>0c', 'utf8'));
  broker.emitData(11, Buffer.from('\u001b[5n', 'utf8'));
  broker.emitData(12, Buffer.from('\u001b[6n', 'utf8'));
  broker.emitData(13, Buffer.from('\u001b[14t', 'utf8'));
  broker.emitData(14, Buffer.from('\u001b[16t', 'utf8'));
  broker.emitData(15, Buffer.from('\u001b[18t', 'utf8'));
  broker.emitData(16, Buffer.from('\u001bX', 'utf8'));
  broker.emitData(17, Buffer.from('\u001b[12\u001b', 'utf8'));
  broker.emitData(18, Buffer.from('\u001b[19t', 'utf8'));
  broker.emitData(19, Buffer.from('\u001b[>0q', 'utf8'));
  broker.emitData(20, Buffer.from('\u001b[?25$p', 'utf8'));
  broker.emitData(21, Buffer.from('\u001bP+q544e\u001b\\', 'utf8'));
  broker.emitData(22, Buffer.from('\u001bP+qfoo\u001bX\u001b\\', 'utf8'));
  broker.emitData(23, Buffer.from('\u001b[?u', 'utf8'));
  broker.emitData(24, Buffer.from('\u001b[>7u', 'utf8'));
  broker.emitData(25, Buffer.from('\u001b[1;1H', 'utf8'));
  broker.emitData(26, Buffer.from('\u001b]12;plain-text\u0007', 'utf8'));

  const writes = broker.writes.map((entry) => String(entry));
  const isCursorReply = (value: string): boolean => {
    if (!value.startsWith('\u001b[') || !value.endsWith('R')) {
      return false;
    }
    return /^\d+;\d+$/.test(value.slice(2, -1));
  };
  const cursorReplies = writes.filter((value) => isCursorReply(value));
  assert.equal(cursorReplies.length, 1);
  const cursorPayload = (cursorReplies[0] ?? '').slice(2, -1);
  const [cursorRow] = cursorPayload.split(';');
  assert.equal(cursorRow, '1');

  const nonCursorReplies = writes.filter((value) => !isCursorReply(value));
  assert.deepEqual(nonCursorReplies, [
    '\u001b]10;rgb:a0a0/b1b1/c2c2\u0007',
    '\u001b]11;rgb:0d0d/0e0e/0f0f\u001b\\',
    '\u001b]4;12;rgb:8b8b/c5c5/ffff\u0007',
    '\u001b[?62;4;6;22c',
    '\u001b[>1;10;0c',
    '\u001b[?62;4;6;22c',
    '\u001b[>1;10;0c',
    '\u001b[0n',
    '\u001b[4;384;640t',
    '\u001b[6;16;8t',
    '\u001b[8;24;80t',
    '\u001b[?0u'
  ]);

  session.close();
  configurePerfCore({
    enabled: false
  });
  shutdownPerfCore();
  const perfLines = readFileSync(perfPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const queryRecords = perfLines
    .map((line) => JSON.parse(line) as { name?: string; attrs?: Record<string, unknown> })
    .filter((record) => record.name === 'codex.terminal-query')
    .map((record) => record.attrs ?? {});

  assert.equal(
    queryRecords.some(
      (attrs) => attrs.kind === 'csi' && attrs.payload === '>0q' && attrs.handled === false
    ),
    true
  );
  assert.equal(
    queryRecords.some(
      (attrs) => attrs.kind === 'csi' && attrs.payload === '?25$p' && attrs.handled === false
    ),
    true
  );
  assert.equal(
    queryRecords.some(
      (attrs) => attrs.kind === 'csi' && attrs.payload === '?u' && attrs.handled === true
    ),
    true
  );
  assert.equal(
    queryRecords.some(
      (attrs) => attrs.kind === 'dcs' && attrs.payload === '+q544e' && attrs.handled === false
    ),
    true
  );
  assert.equal(
    queryRecords.some(
      (attrs) =>
        attrs.kind === 'dcs' && String(attrs.payload).includes('+qfoo') && attrs.handled === false
    ),
    true
  );
  assert.equal(
    queryRecords.some((attrs) => attrs.kind === 'csi' && attrs.payload === '>7u'),
    false
  );
  assert.equal(
    queryRecords.some((attrs) => attrs.kind === 'csi' && attrs.payload === '1;1H'),
    false
  );
  assert.equal(
    queryRecords.some((attrs) => attrs.kind === 'osc' && attrs.payload === '12;plain-text'),
    false
  );
  rmSync(perfPath, { force: true });
});

void test('codex live session ignores OSC indexed queries with non-numeric indices', () => {
  const broker = new FakeBroker();
  const session = startCodexLiveSession(
    {
      useNotifyHook: false
    },
    {
      startBroker: () => broker,
      readFile: () => '',
      setIntervalFn: () => {
        throw new Error('notify polling should be disabled');
      },
      clearIntervalFn: () => {
        // no-op
      }
    }
  );

  broker.emitData(1, Buffer.from('\u001b]4;bad;?\u0007', 'utf8'));
  assert.deepEqual(broker.writes, []);
  session.close();
});

void test('codex live session e2e completes terminal query handshake with configured size', async () => {
  const startupScript = [
    "const required = [",
    "  '\\u001b]10;rgb:1111/2222/3333\\u0007',",
    "  '\\u001b]11;rgb:4444/5555/6666\\u0007',",
    "  '\\u001b]4;12;rgb:8b8b/c5c5/ffff\\u0007',",
    "  '\\u001b[?62;4;6;22c',",
    "  '\\u001b[>1;10;0c',",
    "  '\\u001b[0n',",
    "  '\\u001b[1;1R',",
    "  '\\u001b[8;29;91t'",
    '];',
    "let observed = '';",
    "const finish = (ok) => {",
    "  process.stdout.write(ok ? 'READY\\n' : `MISSING:${JSON.stringify(observed)}\\n`);",
    '  process.exit(ok ? 0 : 2);',
    '};',
    'const timeout = setTimeout(() => finish(false), 1200);',
    "process.stdin.setEncoding('utf8');",
    'if (process.stdin.isTTY) { process.stdin.setRawMode(true); }',
    'process.stdin.resume();',
    'process.stdin.on(\'data\', (chunk) => {',
    '  observed += chunk;',
    '  if (required.every((token) => observed.includes(token))) {',
    '    clearTimeout(timeout);',
    '    finish(true);',
    '  }',
    '});',
    "process.stdout.write('\\u001b]10;?\\u0007\\u001b]11;?\\u0007\\u001b]4;12;?\\u0007\\u001b[c\\u001b[>c\\u001b[5n\\u001b[6n\\u001b[18t');"
  ].join('\n');

  const session = startCodexLiveSession({
    command: process.execPath,
    baseArgs: [],
    args: ['-e', startupScript],
    useNotifyHook: false,
    initialCols: 91,
    initialRows: 29,
    terminalForegroundHex: '#112233',
    terminalBackgroundHex: '#445566'
  });

  const startedAt = process.hrtime.bigint();
  const handshakeDurationMs = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('timed out waiting for startup handshake output'));
    }, 2500);
    let output = '';
    const attachmentId = session.attach({
      onData: (event) => {
        output += event.chunk.toString('utf8');
        if (!/READY\r?\n/.test(output)) {
          return;
        }
        clearTimeout(timeout);
        session.detach(attachmentId);
        const elapsedNs = process.hrtime.bigint() - startedAt;
        resolve(Number(elapsedNs) / 1_000_000);
      },
      onExit: (exit) => {
        if (exit.code === 0 && /READY\r?\n/.test(output)) {
          return;
        }
        clearTimeout(timeout);
        reject(
          new Error(
            `startup handshake exited with code ${String(exit.code)} output=${JSON.stringify(output)}`
          )
        );
      }
    });
  });

  assert.ok(handshakeDurationMs < 2000, `expected fast handshake, got ${String(handshakeDurationMs)}ms`);
  session.close();
});

void test('codex live session e2e preserves terminal width across startup and resize', async () => {
  const command = '/bin/sh';
  const commandScript =
    'stty size; while IFS= read -r line; do if [ "$line" = "size" ]; then stty size; fi; done';

  const session = startCodexLiveSession({
    command,
    baseArgs: [],
    args: ['-lc', commandScript],
    useNotifyHook: false,
    initialCols: 91,
    initialRows: 29
  });

  let exited: PtyExit | null = null;
  const attachmentId = session.attach({
    onData: () => {
      // handled below via polling snapshot
    },
    onExit: (exit) => {
      exited = exit;
    }
  });

  const waitForLine = async (pattern: RegExp, timeoutMs: number): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (exited !== null) {
        throw new Error(`session exited early: code=${String(exited.code)} signal=${String(exited.signal)}`);
      }
      const frame = session.snapshot();
      if (frame.lines.some((line) => pattern.test(line))) {
        return;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
    throw new Error(`timed out waiting for line: ${String(pattern)}`);
  };

  await waitForLine(/^29 91$/, 2500);

  session.resize(73, 21);
  session.write('size\n');
  await waitForLine(/^21 73$/, 2500);

  session.detach(attachmentId);
  session.close();
});

void test('codex live session handles disabled notify hook and poll edge cases', () => {
  const broker = new FakeBroker();
  let callCount = 0;
  const clearHandles: Array<NodeJS.Timeout> = [];

  const session = startCodexLiveSession(
    {
      useNotifyHook: false,
      notifyFilePath: '/tmp/notify-disabled.jsonl'
    },
    {
      startBroker: () => broker,
      readFile: () => {
        callCount += 1;
        if (callCount === 1) {
          const enoent = new Error('missing') as Error & { code: string };
          enoent.code = 'ENOENT';
          throw enoent;
        }
        if (callCount === 2) {
          return '{"ts":"x","payload":{"type":"agent-turn-complete"}}\n';
        }
        return '';
      },
      setIntervalFn: () => {
        throw new Error('setInterval should not be called when notify is disabled');
      },
      clearIntervalFn: (handle) => {
        clearHandles.push(handle);
      }
    }
  );

  const events: string[] = [];
  session.onEvent((event) => {
    events.push(event.type);
  });

  // No notify timer should exist; exercise event path directly.
  broker.emitData(1, Buffer.from('x', 'utf8'));

  session.close();
  assert.deepEqual(events, ['terminal-output']);
  assert.equal(clearHandles.length, 0);
});

void test('codex live session propagate non-ENOENT notify read errors', () => {
  const broker = new FakeBroker();
  const setIntervalCalls: Array<{ callback: () => void; interval: number }> = [];

  startCodexLiveSession(
    {
      notifyFilePath: '/tmp/notify-error.jsonl'
    },
    {
      startBroker: () => broker,
      readFile: () => {
        throw new Error('boom');
      },
      setIntervalFn: (callback, intervalMs) => {
        setIntervalCalls.push({ callback, interval: intervalMs });
        return { hasRef: () => true } as unknown as NodeJS.Timeout;
      },
      clearIntervalFn: () => {
        // no-op
      }
    }
  );

  const poll = setIntervalCalls[0];
  assert.ok(poll !== undefined);
  assert.throws(() => {
    poll?.callback();
  }, /boom/);
});

void test('codex live session ignores ENOENT notify read errors', () => {
  const broker = new FakeBroker();
  const setIntervalCalls: Array<{ callback: () => void; interval: number }> = [];

  startCodexLiveSession(
    {
      notifyFilePath: '/tmp/notify-enoent.jsonl'
    },
    {
      startBroker: () => broker,
      readFile: () => {
        const enoent = new Error('missing') as Error & { code: string };
        enoent.code = 'ENOENT';
        throw enoent;
      },
      setIntervalFn: (callback, intervalMs) => {
        setIntervalCalls.push({ callback, interval: intervalMs });
        return { hasRef: () => true } as unknown as NodeJS.Timeout;
      },
      clearIntervalFn: () => {
        // no-op
      }
    }
  );

  const poll = setIntervalCalls[0];
  assert.ok(poll !== undefined);
  assert.doesNotThrow(() => {
    poll?.callback();
  });
});

void test('codex live session supports default dependency paths', async () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-codex-live-defaults-'));
  const notifyPath = join(dirPath, 'notify.jsonl');
  writeFileSync(notifyPath, '', 'utf8');

  const session = startCodexLiveSession({
    command: '/bin/echo',
    args: ['hello'],
    notifyFilePath: notifyPath,
    notifyPollMs: 5
  });

  await new Promise((resolve) => {
    setTimeout(resolve, 25);
  });
  session.close();
  assert.equal(session.latestCursorValue() >= 0, true);

  rmSync(dirPath, { recursive: true, force: true });
});

void test('codex live session supports custom base args without notify hook', () => {
  const broker = new FakeBroker();
  let startOptions:
    | {
        command?: string;
        commandArgs?: string[];
        env?: NodeJS.ProcessEnv;
        initialCols?: number;
        initialRows?: number;
      }
    | undefined;

  const session = startCodexLiveSession(
    {
      baseArgs: ['--no-alt-screen', '--search'],
      useNotifyHook: false,
      initialCols: 120,
      initialRows: 35
    },
    {
      startBroker: (options) => {
        startOptions = options;
        return broker;
      },
      readFile: () => '',
      setIntervalFn: () => {
        throw new Error('setInterval should not be called when notify is disabled');
      },
      clearIntervalFn: () => {
        // no-op
      }
    }
  );

  assert.deepEqual(startOptions?.commandArgs, ['--no-alt-screen', '--search']);
  assert.equal(startOptions?.initialCols, 120);
  assert.equal(startOptions?.initialRows, 35);
  const snapshot = session.snapshot();
  assert.equal(snapshot.cols, 120);
  assert.equal(snapshot.rows, 35);
  session.close();
});

void test('codex live session uses unique default notify file per session', () => {
  const brokerA = new FakeBroker();
  const brokerB = new FakeBroker();
  const startOptions: Array<{ command?: string; commandArgs?: string[]; env?: NodeJS.ProcessEnv }> = [];
  const intervalCallbacks: Array<() => void> = [];
  const intervalHandles: NodeJS.Timeout[] = [];

  const startSession = (broker: FakeBroker) =>
    startCodexLiveSession(
      {},
      {
        startBroker: (options) => {
          startOptions.push(options ?? {});
          return broker;
        },
        readFile: () => '',
        setIntervalFn: (callback) => {
          intervalCallbacks.push(callback);
          const handle = { hasRef: () => true } as unknown as NodeJS.Timeout;
          intervalHandles.push(handle);
          return handle;
        },
        clearIntervalFn: () => {
          // no-op
        }
      }
    );

  const sessionA = startSession(brokerA);
  const sessionB = startSession(brokerB);

  const extractNotifyPath = (
    args: readonly string[] | undefined
  ): string | null => {
    if (args === undefined) {
      return null;
    }
    const configArg = args.find((value) => value.startsWith('notify=['));
    if (configArg === undefined) {
      return null;
    }
    const match = /"([^"]+\.jsonl)"/.exec(configArg);
    return match?.[1] ?? null;
  };

  const notifyPathA = extractNotifyPath(startOptions[0]?.commandArgs);
  const notifyPathB = extractNotifyPath(startOptions[1]?.commandArgs);
  assert.notEqual(notifyPathA, null);
  assert.notEqual(notifyPathB, null);
  assert.notEqual(notifyPathA, notifyPathB);
  assert.equal(intervalCallbacks.length, 2);
  assert.equal(intervalHandles.length, 2);

  sessionA.close();
  sessionB.close();
});
