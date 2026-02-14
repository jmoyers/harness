import assert from 'node:assert/strict';
import test from 'node:test';
import {
  startSingleSessionBroker,
  type BrokerAttachmentHandlers,
  type BrokerDataEvent
} from '../src/pty/session-broker.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';

function waitForCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 5000
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
    }
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
    }
  };
}

async function closeBrokerGracefully(
  broker: ReturnType<typeof startSingleSessionBroker>,
  timeoutMs = 5000
): Promise<void> {
  const closer = createAttachmentCollector();
  broker.attach(closer.handlers);
  broker.close();
  await waitForCondition(() => closer.exit() !== null, 'broker shutdown', timeoutMs);
}

void test('single-session broker supports detach and reattach with cursor replay', async () => {
  const broker = startSingleSessionBroker({
    command: '/bin/cat',
    commandArgs: []
  });
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
  const broker = startSingleSessionBroker({
    command: '/bin/cat',
    commandArgs: []
  }, 8);
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
    commandArgs: ['-c', 'exit 7']
  });

  const early = createAttachmentCollector();
  broker.attach(early.handlers);
  await waitForCondition(() => early.exit() !== null, 'early exit delivery');

  const late = createAttachmentCollector();
  broker.attach(late.handlers);
  await waitForCondition(() => late.exit() !== null, 'late exit delivery');
  assert.equal(late.exit()?.code, 7);
});

void test('single-session broker truncates oversized chunks to tail backlog window', async () => {
  const broker = startSingleSessionBroker({
    command: '/bin/cat',
    commandArgs: []
  }, 4);

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

void test('single-session broker forwards resize to underlying PTY session', async () => {
  const broker = startSingleSessionBroker({
    command: '/bin/sh',
    commandArgs: ['-i'],
    env: {
      ...process.env,
      PS1: ''
    }
  });

  try {
    const collector = createAttachmentCollector();
    broker.attach(collector.handlers);

    broker.resize(90, 30);
    broker.write('stty size\n');
    broker.write('exit\n');

    await waitForCondition(() => collector.readText().includes('30 90'), 'resized terminal dimensions');
    await waitForCondition(() => collector.exit() !== null, 'resize test exit');
    assert.equal(collector.exit()?.code, 0);
  } finally {
    await closeBrokerGracefully(broker);
  }
});
