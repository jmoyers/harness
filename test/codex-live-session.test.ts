import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
  let startOptions: { command?: string; commandArgs?: string[]; env?: NodeJS.ProcessEnv } | undefined;

  const session = startCodexLiveSession(
    {
      command: 'codex-custom',
      args: ['--model', 'gpt-5.3-codex'],
      env: { ...process.env, HARNESS_TEST: '1' },
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

void test('codex live session replies to OSC terminal color queries', () => {
  const broker = new FakeBroker();
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
  broker.emitData(7, Buffer.from('\u001b]12;?\u0007', 'utf8'));
  broker.emitData(8, Buffer.from('\u001b]10;?\u001bX\u0007', 'utf8'));

  assert.deepEqual(
    broker.writes.map((entry) => String(entry)),
    [
      '\u001b]10;rgb:a0a0/b1b1/c2c2\u0007',
      '\u001b]11;rgb:0d0d/0e0e/0f0f\u001b\\'
    ]
  );

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
  let startOptions: { command?: string; commandArgs?: string[]; env?: NodeJS.ProcessEnv } | undefined;

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
  const snapshot = session.snapshot();
  assert.equal(snapshot.cols, 120);
  assert.equal(snapshot.rows, 35);
  session.close();
});
