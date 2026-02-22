import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'bun:test';
import {
  startSingleSessionBroker,
  type BrokerAttachmentHandlers,
  type BrokerDataEvent,
} from '../../../src/pty/session-broker.ts';
import type { startPtySession, PtyExit } from '../../../src/pty/pty_host.ts';

function waitForCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 5000,
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

function createAttachmentCollector() {
  const events: BrokerDataEvent[] = [];
  let lastExit: PtyExit | null = null;
  const handlers: BrokerAttachmentHandlers = {
    onData: (event: BrokerDataEvent) => {
      events.push(event);
    },
    onExit: (exit: PtyExit) => {
      lastExit = exit;
    },
  };

  return {
    handlers,
    readText: (): string => {
      return Buffer.concat(events.map((event) => event.chunk)).toString('utf8');
    },
    lastCursor: (): number => {
      if (events.length === 0) {
        return 0;
      }
      const lastEvent = events[events.length - 1];
      if (lastEvent === undefined) {
        return 0;
      }
      return lastEvent.cursor;
    },
    exit: (): PtyExit | null => {
      return lastExit;
    },
  };
}

class FakePtySession extends EventEmitter {
  write(): void {}
  resize(): void {}
  close(): void {}
  processId(): number | null {
    return 777;
  }
}

async function closeBrokerGracefully(
  broker: ReturnType<typeof startSingleSessionBroker>,
  timeoutMs = 5000,
): Promise<void> {
  const closer = createAttachmentCollector();
  broker.attach(closer.handlers);
  broker.close();
  await waitForCondition(() => closer.exit() !== null, 'broker shutdown', timeoutMs);
}

void test('single-session broker supports detach and reattach with cursor replay', async () => {
  const broker = startSingleSessionBroker({
    command: '/bin/cat',
    commandArgs: [],
  });
  assert.equal(typeof broker.processId(), 'number');
  try {
    const first = createAttachmentCollector();
    const firstAttachmentId = broker.attach(first.handlers);

    broker.write('alpha\n');
    await waitForCondition(() => first.readText().includes('alpha'), 'alpha echo');

    const firstCursor = first.lastCursor();
    assert.ok(firstCursor > 0);
    broker.detach(firstAttachmentId);

    broker.write('missed\n');
    await waitForCondition(() => broker.latestCursorValue() > firstCursor, 'cursor advance');

    const second = createAttachmentCollector();
    broker.attach(second.handlers, firstCursor);
    await waitForCondition(() => second.readText().includes('missed'), 'replayed missed output');

    broker.write('live\n');
    await waitForCondition(() => second.readText().includes('live'), 'live output after reattach');

    broker.write(new Uint8Array([0x04]));
    await waitForCondition(() => second.exit() !== null, 'session exit');
    assert.notEqual(second.exit(), null);
  } finally {
    await closeBrokerGracefully(broker);
  }
});

void test('single-session broker trims replay backlog to configured byte limit', async () => {
  const broker = startSingleSessionBroker(
    {
      command: '/bin/cat',
      commandArgs: [],
    },
    8,
  );
  try {
    const attachment = createAttachmentCollector();
    broker.attach(attachment.handlers);

    broker.write('12345\n');
    await waitForCondition(() => attachment.readText().includes('12345'), 'first output');
    const firstCursor = attachment.lastCursor();

    broker.write('abcdef\n');
    await waitForCondition(() => attachment.readText().includes('abcdef'), 'second output');
    const secondCursor = attachment.lastCursor();
    assert.ok(secondCursor > firstCursor);

    const replay = createAttachmentCollector();
    broker.attach(replay.handlers, 0);
    await waitForCondition(() => replay.readText().includes('abcdef'), 'replayed tail output');
    assert.equal(replay.readText().includes('12345'), false);
  } finally {
    await closeBrokerGracefully(broker);
  }
});

void test('single-session broker immediately notifies newly attached handlers after exit', async () => {
  const broker = startSingleSessionBroker({
    command: '/bin/sh',
    commandArgs: ['-c', 'exit 7'],
  });

  const early = createAttachmentCollector();
  broker.attach(early.handlers);
  await waitForCondition(() => early.exit() !== null, 'early exit delivery');

  const late = createAttachmentCollector();
  broker.attach(late.handlers);
  await waitForCondition(() => late.exit() !== null, 'late exit delivery');
  assert.equal(late.exit()?.code, 7);
});

void test('single-session broker maps spawn errors to a terminal exit state', async () => {
  const broker = startSingleSessionBroker({
    helperPath: '/path/that/does/not/exist',
  });
  assert.equal(broker.processId(), null);

  const collector = createAttachmentCollector();
  broker.attach(collector.handlers);
  await waitForCondition(() => collector.exit() !== null, 'spawn error exit delivery');
  assert.deepEqual(collector.exit(), {
    code: null,
    signal: null,
  });
});

void test('single-session broker suppresses duplicate exit notifications', async () => {
  const fake = new FakePtySession();
  const broker = startSingleSessionBroker(undefined, undefined, {
    startSession: () => fake as unknown as ReturnType<typeof startPtySession>,
  });

  const exits: PtyExit[] = [];
  broker.attach({
    onData: () => {},
    onExit: (exit) => {
      exits.push(exit);
    },
  });

  fake.emit('exit', {
    code: 0,
    signal: null,
  } satisfies PtyExit);
  fake.emit('error', new Error('duplicate-terminal-signal'));

  await waitForCondition(() => exits.length > 0, 'first exit delivery');
  assert.equal(exits.length, 1);
  assert.deepEqual(exits[0], {
    code: 0,
    signal: null,
  });
});

void test('single-session broker truncates oversized chunks to tail backlog window', async () => {
  const broker = startSingleSessionBroker(
    {
      command: '/bin/cat',
      commandArgs: [],
    },
    4,
  );

  try {
    const live = createAttachmentCollector();
    broker.attach(live.handlers);

    broker.write('oversized\n');
    await waitForCondition(() => live.readText().includes('oversized'), 'oversized output');

    const replay = createAttachmentCollector();
    broker.attach(replay.handlers, 0);
    await waitForCondition(() => replay.readText().length > 0, 'replay output');
    assert.equal(replay.readText().includes('oversized'), false);
  } finally {
    await closeBrokerGracefully(broker);
  }
});

void test('single-session broker evicts oldest backlog entries when cumulative bytes exceed limit', async () => {
  const fake = new FakePtySession();
  const broker = startSingleSessionBroker(undefined, 6, {
    startSession: () => fake as unknown as ReturnType<typeof startPtySession>,
  });

  const live = createAttachmentCollector();
  broker.attach(live.handlers);
  fake.emit('data', Buffer.from('abcd'));
  fake.emit('data', Buffer.from('efgh'));
  await waitForCondition(() => live.readText().includes('efgh'), 'live output for eviction path');

  const replay = createAttachmentCollector();
  broker.attach(replay.handlers, 0);
  await waitForCondition(() => replay.readText().length > 0, 'replayed tail after eviction');
  assert.equal(replay.readText().includes('abcd'), false);
  assert.equal(replay.readText().includes('efgh'), true);

  fake.emit('exit', {
    code: 0,
    signal: null,
  } satisfies PtyExit);
  await waitForCondition(() => replay.exit() !== null, 'eviction path exit');
});

void test('single-session broker forwards resize to underlying PTY session', async () => {
  const broker = startSingleSessionBroker({
    command: '/bin/sh',
    commandArgs: ['-i'],
    env: {
      ...process.env,
      PS1: '',
    },
  });

  try {
    const collector = createAttachmentCollector();
    broker.attach(collector.handlers);

    broker.resize(90, 30);
    broker.write('stty size\n');
    broker.write('exit\n');

    await waitForCondition(
      () => collector.readText().includes('30 90'),
      'resized terminal dimensions',
    );
    await waitForCondition(() => collector.exit() !== null, 'resize test exit');
    assert.equal(collector.exit()?.code, 0);
  } finally {
    await closeBrokerGracefully(broker);
  }
});
