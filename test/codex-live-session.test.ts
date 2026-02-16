import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'bun:test';
import {
  buildTomlStringArray,
  normalizeTerminalColorHex,
  parseNotifyRecordLine,
  startCodexLiveSession,
  terminalHexToOscColor
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

void test('terminal color normalization and OSC formatting are deterministic', () => {
  assert.equal(normalizeTerminalColorHex(undefined, '112233'), '112233');
  assert.equal(normalizeTerminalColorHex('#A1b2C3', '112233'), 'a1b2c3');
  assert.equal(normalizeTerminalColorHex(' bad ', '112233'), '112233');
  assert.equal(terminalHexToOscColor('010203'), 'rgb:0101/0202/0303');
  assert.equal(terminalHexToOscColor('nope'), 'rgb:d0d0/d7d7/dede');
});

void test('notify helpers format TOML arrays and parse relay records', () => {
  const expectedNotifyCommand = ['/usr/bin/env', process.execPath, '/tmp/relay.ts'];

  assert.equal(
    buildTomlStringArray(expectedNotifyCommand),
    `[${expectedNotifyCommand.map((value) => JSON.stringify(value)).join(',')}]`
  );
  assert.equal(parseNotifyRecordLine('not-json'), null);
  assert.equal(parseNotifyRecordLine('null'), null);
  assert.equal(parseNotifyRecordLine('{"ts":1}'), null);
  assert.equal(
    parseNotifyRecordLine('{"ts":"2026-01-01T00:00:00.000Z","payload":[]}'),
    null
  );
  assert.equal(
    parseNotifyRecordLine('{"ts":"2026-01-01T00:00:00.000Z","payload":null}'),
    null
  );
  assert.equal(
    parseNotifyRecordLine('{"ts":"2026-01-01T00:00:00.000Z","payload":"x"}'),
    null
  );
  assert.equal(
    parseNotifyRecordLine('{"ts":"2026-01-01T00:00:00.000Z","payload":{"type":"agent-turn-complete"}}')
      ?.payload['type'],
    'agent-turn-complete'
  );
});

void test('codex live session builds bun-native notify command', () => {
  const broker = new FakeBroker();
  let startOptions:
    | {
        command?: string;
        commandArgs?: string[];
        env?: NodeJS.ProcessEnv;
        cwd?: string;
      }
    | undefined;
  const fakeTimer = {
    refresh: () => fakeTimer,
    ref: () => fakeTimer,
    unref: () => fakeTimer,
    hasRef: () => false
  } as unknown as NodeJS.Timeout;
  const session = startCodexLiveSession(
    {
      useNotifyHook: true,
      notifyFilePath: '/tmp/harness-notify-bun.jsonl',
      relayScriptPath: '/tmp/relay.ts'
    },
    {
      startBroker: (options) => {
        startOptions = options;
        return broker;
      },
      readFile: () => '',
      setIntervalFn: () => fakeTimer
    }
  );
  try {
    const notifyArg = startOptions?.commandArgs?.find((arg) => arg.startsWith('notify=['));
    assert.notEqual(notifyArg, undefined);
    assert.equal(notifyArg?.includes(`"${process.execPath}"`), true);
    assert.equal(notifyArg?.includes('"/tmp/relay.ts"'), true);
  } finally {
    session.close();
  }
});

void test('codex live session external notify mode skips codex notify cli injection', async () => {
  const broker = new FakeBroker();
  let startOptions:
    | {
        command?: string;
        commandArgs?: string[];
        env?: NodeJS.ProcessEnv;
        cwd?: string;
      }
    | undefined;
  let notifyContent = '';
  let pollNotify: () => void = () => undefined;
  const fakeTimer = {
    refresh: () => fakeTimer,
    ref: () => fakeTimer,
    unref: () => fakeTimer,
    hasRef: () => false
  } as unknown as NodeJS.Timeout;

  const session = startCodexLiveSession(
    {
      command: 'claude',
      baseArgs: [],
      args: ['--settings', '{"hooks":{}}'],
      useNotifyHook: true,
      notifyMode: 'external',
      notifyFilePath: '/tmp/harness-notify-external.jsonl',
      notifyPollMs: 250
    },
    {
      startBroker: (options) => {
        startOptions = options;
        return broker;
      },
      readFile: () => notifyContent,
      setIntervalFn: (callback) => {
        pollNotify = callback;
        return fakeTimer;
      }
    }
  );

  const notifyTypes: string[] = [];
  const removeListener = session.onEvent((event) => {
    if (event.type === 'notify') {
      const payloadType = event.record.payload['type'];
      if (typeof payloadType === 'string') {
        notifyTypes.push(payloadType);
      }
    }
  });

  assert.equal(startOptions?.commandArgs?.some((arg) => arg.startsWith('notify=[')) ?? false, false);
  notifyContent = '{"ts":"2026-01-01T00:00:00.000Z","payload":{"type":"claude.stop"}}\n';
  pollNotify();
  await delay(0);
  assert.deepEqual(notifyTypes, ['claude.stop']);

  removeListener();
  session.close();
});

void test('codex live session emits notify events when notify hook polling is enabled', async () => {
  const broker = new FakeBroker();
  let startOptions:
    | {
        command?: string;
        commandArgs?: string[];
        env?: NodeJS.ProcessEnv;
        cwd?: string;
      }
    | undefined;
  let pollNotify: () => void = () => undefined;
  let hasPollNotify = false;
  let clearedTimer = false;
  let notifyContent = '';
  const fakeTimer = {
    refresh: () => fakeTimer,
    ref: () => fakeTimer,
    unref: () => fakeTimer,
    hasRef: () => false
  } as unknown as NodeJS.Timeout;

  const session = startCodexLiveSession(
    {
      useNotifyHook: true,
      notifyFilePath: '/tmp/harness-notify.jsonl',
      relayScriptPath: '/tmp/relay.ts',
      notifyPollMs: 250
    },
    {
      startBroker: (options) => {
        startOptions = options;
        return broker;
      },
      readFile: () => notifyContent,
      setIntervalFn: (callback) => {
        pollNotify = callback;
        hasPollNotify = true;
        return fakeTimer;
      },
      clearIntervalFn: (handle) => {
        clearedTimer = handle === fakeTimer;
      }
    }
  );

  const notifyTypes: string[] = [];
  const removeListener = session.onEvent((event) => {
    if (event.type === 'notify') {
      const payloadType = event.record.payload['type'];
      notifyTypes.push(typeof payloadType === 'string' ? payloadType : '');
    }
  });

  assert.notEqual(startOptions, undefined);
  assert.equal(startOptions?.commandArgs?.some((arg) => arg.startsWith('notify=[')), true);
  assert.equal(hasPollNotify, true);

  notifyContent = [
    '{"ts":"2026-01-01T00:00:00.000Z","payload":{"type":"agent-turn-complete"}}',
    '{"ts":"2026-01-01T00:00:00.100Z","payload":{"type":"approval-required"}}',
    'malformed'
  ].join('\n');
  pollNotify();
  await delay(0);

  assert.deepEqual(notifyTypes, ['agent-turn-complete', 'approval-required']);

  removeListener();
  session.close();
  assert.equal(clearedTimer, true);
});

void test('codex live session notify polling handles resets, malformed lines, and read errors', async () => {
  const broker = new FakeBroker();
  let pollNotify: () => void = () => undefined;
  let readCallCount = 0;
  const fakeTimer = {
    refresh: () => fakeTimer,
    ref: () => fakeTimer,
    unref: () => fakeTimer,
    hasRef: () => false
  } as unknown as NodeJS.Timeout;
  const missingFileError = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const deniedFileError = Object.assign(new Error('denied'), { code: 'EACCES' });
  const notifyTypes: string[] = [];

  const session = startCodexLiveSession(
    {
      useNotifyHook: true,
      notifyFilePath: '/tmp/harness-notify.jsonl',
      relayScriptPath: '/tmp/relay.ts',
      notifyPollMs: 25
    },
    {
      startBroker: () => broker,
      readFile: () => {
        readCallCount += 1;
        if (readCallCount === 1) {
          throw missingFileError;
        }
        if (readCallCount === 2) {
          return '{"ts":"2026-01-01T00:00:00.000Z","payload":{"type":"agent-turn-complete"}}';
        }
        if (readCallCount === 3) {
          return '{"ts":"2026-01-01T00:00:00.000Z","payload":{"type":"agent-turn-complete"}}';
        }
        if (readCallCount === 4) {
          return '';
        }
        if (readCallCount === 5) {
          return [
            '',
            'malformed',
            '{"ts":"2026-01-01T00:00:00.100Z","payload":{"type":"approval-required"}}',
            ''
          ].join('\n');
        }
        throw deniedFileError;
      },
      setIntervalFn: (callback) => {
        pollNotify = callback;
        return fakeTimer;
      }
    }
  );

  const removeListener = session.onEvent((event) => {
    if (event.type === 'notify') {
      const payloadType = event.record.payload['type'];
      if (typeof payloadType === 'string') {
        notifyTypes.push(payloadType);
      }
    }
  });

  pollNotify();
  await delay(130);
  pollNotify();
  await delay(130);
  pollNotify();
  await delay(130);
  pollNotify();
  await delay(130);
  pollNotify();
  await delay(130);

  assert.deepEqual(notifyTypes, ['approval-required']);
  pollNotify();
  await delay(130);
  assert.equal(readCallCount, 6);
  assert.deepEqual(notifyTypes, ['approval-required']);

  removeListener();
  session.close();
});

void test('codex live session notify polling supports async readFile dependency', async () => {
  const broker = new FakeBroker();
  let pollNotify: () => void = () => undefined;
  const fakeTimer = {
    refresh: () => fakeTimer,
    ref: () => fakeTimer,
    unref: () => fakeTimer,
    hasRef: () => false
  } as unknown as NodeJS.Timeout;
  const notifyTypes: string[] = [];
  const session = startCodexLiveSession(
    {
      useNotifyHook: true,
      notifyFilePath: '/tmp/harness-notify.jsonl',
      relayScriptPath: '/tmp/relay.ts'
    },
    {
      startBroker: () => broker,
      readFile: () =>
        Promise.resolve('{"ts":"2026-01-01T00:00:00.200Z","payload":{"type":"agent-turn-complete"}}\n'),
      setIntervalFn: (callback) => {
        pollNotify = callback;
        return fakeTimer;
      }
    }
  );

  const removeListener = session.onEvent((event) => {
    if (event.type === 'notify') {
      const payloadType = event.record.payload['type'];
      if (typeof payloadType === 'string') {
        notifyTypes.push(payloadType);
      }
    }
  });

  pollNotify();
  await delay(0);
  assert.deepEqual(notifyTypes, ['agent-turn-complete']);

  removeListener();
  session.close();
});

void test('codex live session notify polling swallows async readFile rejections', async () => {
  const broker = new FakeBroker();
  let pollNotify: () => void = () => undefined;
  const fakeTimer = {
    refresh: () => fakeTimer,
    ref: () => fakeTimer,
    unref: () => fakeTimer,
    hasRef: () => false
  } as unknown as NodeJS.Timeout;
  const session = startCodexLiveSession(
    {
      useNotifyHook: true,
      notifyFilePath: '/tmp/harness-notify.jsonl',
      relayScriptPath: '/tmp/relay.ts'
    },
    {
      startBroker: () => broker,
      readFile: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })),
      setIntervalFn: (callback) => {
        pollNotify = callback;
        return fakeTimer;
      }
    }
  );

  pollNotify();
  await delay(0);
  session.close();
});

void test('codex live session default notify polling swallows non-ENOENT filesystem errors', async () => {
  const broker = new FakeBroker();
  let pollNotify: () => void = () => undefined;
  const fakeTimer = {
    refresh: () => fakeTimer,
    ref: () => fakeTimer,
    unref: () => fakeTimer,
    hasRef: () => false
  } as unknown as NodeJS.Timeout;
  const session = startCodexLiveSession(
    {
      useNotifyHook: true,
      notifyFilePath: tmpdir(),
      relayScriptPath: '/tmp/relay.ts'
    },
    {
      startBroker: () => broker,
      setIntervalFn: (callback) => {
        pollNotify = callback;
        return fakeTimer;
      }
    }
  );

  pollNotify();
  await delay(0);
  session.close();
});

void test('codex live session notify polling backs off when no new bytes are available', async () => {
  const broker = new FakeBroker();
  let pollNotify: () => void = () => undefined;
  let readCallCount = 0;
  const fakeTimer = {
    refresh: () => fakeTimer,
    ref: () => fakeTimer,
    unref: () => fakeTimer,
    hasRef: () => false
  } as unknown as NodeJS.Timeout;
  const session = startCodexLiveSession(
    {
      useNotifyHook: true,
      notifyFilePath: '/tmp/harness-notify.jsonl',
      relayScriptPath: '/tmp/relay.ts',
      notifyPollMs: 100
    },
    {
      startBroker: () => broker,
      readFile: () => {
        readCallCount += 1;
        return '';
      },
      setIntervalFn: (callback) => {
        pollNotify = callback;
        return fakeTimer;
      }
    }
  );

  pollNotify();
  await delay(0);
  pollNotify();
  await delay(0);
  pollNotify();
  await delay(0);

  assert.equal(readCallCount, 1);
  session.close();
});

void test('codex live session tolerates notify timers that do not expose unref', () => {
  const broker = new FakeBroker();
  let pollNotify: () => void = () => undefined;
  const fakeTimer = {} as unknown as NodeJS.Timeout;
  const session = startCodexLiveSession(
    {
      useNotifyHook: true,
      notifyFilePath: '/tmp/harness-notify.jsonl',
      relayScriptPath: '/tmp/relay.ts'
    },
    {
      startBroker: () => broker,
      readFile: () => '',
      setIntervalFn: (callback) => {
        pollNotify = callback;
        return fakeTimer;
      }
    }
  );

  pollNotify();
  session.close();
});

void test('codex live session default notify polling handles missing relay file path', async () => {
  const session = startCodexLiveSession({
    command: '/bin/echo',
    baseArgs: [],
    args: ['ok'],
    useNotifyHook: true,
    notifyPollMs: 10
  });

  await new Promise((resolve) => {
    setTimeout(resolve, 40);
  });
  session.close();
});

void test('codex live session emits terminal and exit events', () => {
  const broker = new FakeBroker();
  let startOptions:
    | {
        command?: string;
        commandArgs?: string[];
        env?: NodeJS.ProcessEnv;
        cwd?: string;
      }
    | undefined;

  const session = startCodexLiveSession(
    {
      command: 'codex-custom',
      args: ['--model', 'gpt-5.3-codex'],
      env: { ...process.env, HARNESS_TEST: '1' },
      cwd: '/tmp/harness-session'
    },
    {
      startBroker: (options) => {
        startOptions = options;
        return broker;
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

  assert.deepEqual(events, ['terminal-output', 'session-exit']);

  assert.equal(startOptions?.command, 'codex-custom');
  assert.deepEqual(startOptions?.commandArgs, ['--no-alt-screen', '--model', 'gpt-5.3-codex']);
  assert.equal(startOptions?.env?.HARNESS_TEST, '1');
  assert.equal(startOptions?.cwd, '/tmp/harness-session');

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
});

void test('codex live session can disable snapshot ingest while preserving output events', () => {
  const broker = new FakeBroker();
  const session = startCodexLiveSession(
    {
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
      env: {
        ...process.env,
        HARNESS_TERM_FG: '#010203',
        HARNESS_TERM_BG: '#040506'
      },
      terminalForegroundHex: '#a0b1c2',
      terminalBackgroundHex: '0d0e0f'
    },
    {
      startBroker: () => broker
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
    {},
    {
      startBroker: () => broker
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
    "process.stdin.on('data', (chunk) => {",
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
    let readyAtNs: bigint | null = null;
    const attachmentId = session.attach({
      onData: (event) => {
        output += event.chunk.toString('utf8');
        if (!/READY\r?\n/.test(output)) {
          return;
        }
        if (readyAtNs === null) {
          readyAtNs = process.hrtime.bigint();
        }
      },
      onExit: (exit) => {
        clearTimeout(timeout);
        session.detach(attachmentId);
        if (exit.code === 0 && readyAtNs !== null) {
          const elapsedNs = readyAtNs - startedAt;
          resolve(Number(elapsedNs) / 1_000_000);
          return;
        }
        reject(new Error(`startup handshake exited with code ${String(exit.code)} output=${JSON.stringify(output)}`));
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

void test('codex live session supports default dependency paths', async () => {
  const session = startCodexLiveSession({
    command: '/bin/echo',
    args: ['hello']
  });

  await new Promise((resolve) => {
    setTimeout(resolve, 25);
  });
  session.close();
  assert.equal(session.latestCursorValue() >= 0, true);
});

void test('codex live session supports custom base args', () => {
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
      initialCols: 120,
      initialRows: 35
    },
    {
      startBroker: (options) => {
        startOptions = options;
        return broker;
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
