import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'bun:test';
import { parseDiffUiArgs } from '../../../src/diff-ui/args.ts';
import { buildDiffUiModel } from '../../../src/diff-ui/model.ts';
import {
  createDiffUiPagerEventSource,
  decodeDiffUiPagerInput,
  enterDiffUiPagerTerminal,
  runDiffUiPagerProcess,
  runDiffUiPagerSession,
} from '../../../src/diff-ui/pager.ts';
import { createInitialDiffUiState } from '../../../src/diff-ui/state.ts';
import { createSampleDiff } from '../../support/diff-ui-fixture.ts';

class FakePagerInputStream extends EventEmitter {
  isTTY = true;
  readonly rawModeCalls: boolean[] = [];
  resumed = false;
  paused = false;

  setRawMode(mode: boolean): void {
    this.rawModeCalls.push(mode);
  }

  resume(): void {
    this.resumed = true;
  }

  pause(): void {
    this.paused = true;
  }
}

class FakePagerOutputStream extends EventEmitter {
  isTTY = true;
  columns = 100;
  rows = 20;
}

void test('decodeDiffUiPagerInput maps keypresses into diff-ui commands', () => {
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('\u0003', 'utf8')), [
    { type: 'session.quit' },
  ]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('q', 'utf8')), [{ type: 'session.quit' }]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('\u001b', 'utf8')), [
    { type: 'finder.close' },
  ]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('\u001b[A', 'utf8')), [
    { type: 'nav.scroll', delta: -1 },
  ]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('\u001b[B', 'utf8')), [
    { type: 'nav.scroll', delta: 1 },
  ]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('\u001b[5~', 'utf8')), [
    { type: 'nav.page', delta: -1 },
  ]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('\u001b[6~', 'utf8')), [
    { type: 'nav.page', delta: 1 },
  ]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('\u001b[H', 'utf8')), [
    { type: 'nav.scroll', delta: -1_000_000 },
  ]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('\u001b[F', 'utf8')), [
    { type: 'nav.scroll', delta: 1_000_000 },
  ]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('u', 'utf8')), [
    { type: 'view.setMode', mode: 'unified' },
  ]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('s', 'utf8')), [
    { type: 'view.setMode', mode: 'split' },
  ]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('a', 'utf8')), [
    { type: 'view.setMode', mode: 'auto' },
  ]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('/', 'utf8')), [{ type: 'finder.open' }]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('\n', 'utf8')), [{ type: 'finder.accept' }]);
  assert.deepEqual(decodeDiffUiPagerInput(Buffer.from('?', 'utf8')), []);
});

void test('createDiffUiPagerEventSource queues input, resize, and end events', async () => {
  const stdin = new FakePagerInputStream();
  const stdout = new FakePagerOutputStream();
  const source = createDiffUiPagerEventSource({
    stdin,
    stdout,
  });

  stdin.emit('data', Buffer.from('', 'utf8'));
  stdin.emit('data', Buffer.from('j', 'utf8'));
  stdout.emit('resize');
  stdin.emit('end');

  const first = await source.readEvent();
  const second = await source.readEvent();
  const third = await source.readEvent();

  assert.deepEqual(first, {
    type: 'input',
    input: Buffer.from('j', 'utf8'),
  });
  assert.deepEqual(second, {
    type: 'resize',
    width: 100,
    height: 20,
  });
  assert.equal(third, null);

  source.close();
  const afterClose = await source.readEvent();
  assert.equal(afterClose, null);
});

void test('createDiffUiPagerEventSource resolves pending reads when closed', async () => {
  const stdin = new FakePagerInputStream();
  const stdout = new FakePagerOutputStream();
  const source = createDiffUiPagerEventSource({
    stdin,
    stdout,
  });

  const pending = source.readEvent();
  source.close();
  source.close();
  const resolved = await pending;
  assert.equal(resolved, null);
});

void test('enterDiffUiPagerTerminal configures and restores terminal state', () => {
  const stdin = new FakePagerInputStream();
  const stdout = new FakePagerOutputStream();
  let written = '';

  const cleanup = enterDiffUiPagerTerminal({
    stdin,
    stdout,
    writeStdout: (text) => {
      written += text;
    },
  });
  cleanup();

  assert.deepEqual(stdin.rawModeCalls, [true, false]);
  assert.equal(stdin.resumed, true);
  assert.equal(stdin.paused, true);
  assert.equal(written.includes('\u001b[?1049h'), true);
  assert.equal(written.includes('\u001b[?1049l'), true);

  stdin.isTTY = false;
  assert.throws(
    () =>
      enterDiffUiPagerTerminal({
        stdin,
        stdout,
        writeStdout: () => {},
      }),
    /requires interactive TTY/u,
  );
});

void test('runDiffUiPagerSession handles input commands, resize, and quit', async () => {
  const model = buildDiffUiModel(createSampleDiff());
  const options = parseDiffUiArgs(['--pager', '--theme', 'plain'], {
    cwd: '/repo',
    env: {},
    isStdoutTty: true,
  });
  const initialState = createInitialDiffUiState(model, options.viewMode, 90);
  const queue = [
    { type: 'input', input: Buffer.from('j', 'utf8') },
    { type: 'input', input: Buffer.from('?', 'utf8') },
    { type: 'resize', width: 120, height: 30 },
    { type: 'input', input: Buffer.from('q', 'utf8') },
  ] as const;
  let cursor = 0;
  let flushCount = 0;
  let stderrOutput = '';

  const result = await runDiffUiPagerSession({
    model,
    options,
    initialState,
    initialWidth: 90,
    initialHeight: 12,
    eventSource: {
      readEvent: async () => {
        const next = queue[cursor];
        cursor += 1;
        return next ?? null;
      },
      close: () => {},
    },
    writeStdout: () => {},
    writeStderr: (text) => {
      stderrOutput += text;
    },
    createScreen: (writer) => {
      writer.writeError('[pager-test] createScreen init\n');
      return {
        markDirty: () => {},
        flush: () => {
          flushCount += 1;
          return {
            wroteOutput: true,
            changedRowCount: 1,
            shouldShowCursor: false,
          };
        },
      };
    },
  });

  assert.equal(flushCount >= 3, true);
  assert.equal(stderrOutput.includes('[pager-test] createScreen init'), true);
  assert.equal(result.renderedLines.length > 0, true);
  assert.equal(
    result.events.some((event) => event.type === 'session.quit'),
    true,
  );
});

void test('runDiffUiPagerSession exits when event stream ends', async () => {
  const model = buildDiffUiModel(createSampleDiff());
  const options = parseDiffUiArgs(['--pager', '--theme', 'plain'], {
    cwd: '/repo',
    env: {},
    isStdoutTty: true,
  });
  const initialState = createInitialDiffUiState(model, options.viewMode, 90);

  const result = await runDiffUiPagerSession({
    model,
    options,
    initialState,
    initialWidth: 90,
    initialHeight: 12,
    eventSource: {
      readEvent: async () => null,
      close: () => {},
    },
    writeStdout: () => {},
    writeStderr: () => {},
    createScreen: () => ({
      markDirty: () => {},
      flush: () => ({
        wroteOutput: true,
        changedRowCount: 1,
        shouldShowCursor: false,
      }),
    }),
  });

  assert.equal(
    result.events.some((event) => event.type === 'session.quit'),
    true,
  );
});

void test('runDiffUiPagerProcess wires terminal setup, event source, and cleanup', async () => {
  const model = buildDiffUiModel(createSampleDiff());
  const options = parseDiffUiArgs(['--pager', '--theme', 'plain'], {
    cwd: '/repo',
    env: {},
    isStdoutTty: true,
  });
  const initialState = createInitialDiffUiState(model, options.viewMode, 90);
  const stdin = new FakePagerInputStream();
  const stdout = new FakePagerOutputStream();
  let written = '';

  const promise = runDiffUiPagerProcess({
    model,
    options,
    initialState,
    writeStdout: (text) => {
      written += text;
    },
    writeStderr: () => {},
    stdin,
    stdout,
    createScreen: () => ({
      markDirty: () => {},
      flush: () => ({
        wroteOutput: true,
        changedRowCount: 1,
        shouldShowCursor: false,
      }),
    }),
  });

  stdin.emit('data', Buffer.from('q', 'utf8'));
  const result = await promise;
  assert.equal(
    result.events.some((event) => event.type === 'session.quit'),
    true,
  );
  assert.equal(stdin.paused, true);
  assert.equal(written.includes('\u001b[?1049h'), true);
  assert.equal(written.includes('\u001b[?1049l'), true);
});
