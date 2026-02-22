import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'bun:test';
import { RuntimeNimCliSession } from '../../../../src/services/runtime-nim-cli-session.ts';
import { type startPtySession } from '../../../../src/pty/pty_host.ts';

type StartPtySessionFn = typeof startPtySession;

class FakePtySession extends EventEmitter {
  public readonly writes: string[] = [];
  public readonly resizes: Array<{ cols: number; rows: number }> = [];
  public closeCalls = 0;

  write(data: string): void {
    this.writes.push(data);
    if (data.includes('/exit\n')) {
      this.emit('exit', { code: 0, signal: null });
    }
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  close(): void {
    this.closeCalls += 1;
    this.emit('exit', { code: 0, signal: null });
  }
}

test('runtime nim cli session starts subprocess, parses output, and updates view model', async () => {
  const fake = new FakePtySession();
  let capturedStartArgs: readonly string[] = [];
  const dirtyEvents: string[] = [];
  const fakeStartPtySession = ((options: { commandArgs?: string[] }) => {
    capturedStartArgs = options.commandArgs ?? [];
    return fake as unknown as ReturnType<StartPtySessionFn>;
  }) as unknown as StartPtySessionFn;
  const session = new RuntimeNimCliSession({
    invocationDirectory: '/tmp/workspace',
    tenantId: 'tenant-a',
    userId: 'user-a',
    markDirty: () => {
      dirtyEvents.push('dirty');
    },
    sessionName: 'scope-a',
    model: 'mock/echo-v1',
    useMock: true,
    harnessScriptPath: '/tmp/harness.ts',
    startPtySession: fakeStartPtySession,
  });

  await session.start();
  assert.deepEqual(capturedStartArgs, [
    '/tmp/harness.ts',
    '--session',
    'scope-a',
    'nim',
    '--tenant-id',
    'tenant-a',
    '--user-id',
    'user-a',
    '--model',
    'mock/echo-v1',
    '--ui-mode',
    'debug',
    '--mock',
  ]);

  fake.emit(
    'data',
    Buffer.from(
      '\u001b[0mnim tui ready session=s-123 model=mock/echo-v1 provider=mock\r\nrun started run-1\r\nrun completed completed\r\n',
      'utf8',
    ),
  );

  const view = session.snapshot();
  assert.equal(view.sessionId, 's-123');
  assert.equal(view.status, 'idle');
  assert.equal(view.activeRunId, null);
  assert.equal(view.transcriptLines.some((line) => line.includes('nim subprocess ready')), true);
  assert.equal(view.transcriptLines.some((line) => line.includes('run started run-1')), true);
  assert.equal(view.transcriptLines.some((line) => line.includes('run completed completed')), true);
  assert.equal(dirtyEvents.length > 0, true);

  await session.dispose();
});

test('runtime nim cli session submits and queues composer input, handles escape, and resizes', async () => {
  const fake = new FakePtySession();
  const fakeStartPtySession = (() => {
    return fake as unknown as ReturnType<StartPtySessionFn>;
  }) as unknown as StartPtySessionFn;
  const session = new RuntimeNimCliSession({
    invocationDirectory: '/tmp/workspace',
    tenantId: 'tenant-a',
    userId: 'user-a',
    markDirty: () => undefined,
    sessionName: null,
    model: 'mock/echo-v1',
    useMock: true,
    harnessScriptPath: '/tmp/harness.ts',
    startPtySession: fakeStartPtySession,
  });

  await session.start();
  session.handleInputChunk('abc');
  assert.equal(session.snapshot().composerText, 'abc');
  session.handleInputChunk('\b');
  assert.equal(session.snapshot().composerText, 'ab');
  session.handleInputChunk('\n');
  assert.equal(session.snapshot().composerText, '');
  session.handleInputChunk('queued text');
  assert.equal(session.snapshot().composerText, 'queued text');
  session.handleInputChunk('\t');
  assert.equal(session.snapshot().composerText, '');
  session.handleEscape();
  session.resize(10, 3);

  assert.equal(fake.writes.includes('ab\n'), true);
  assert.equal(fake.writes.includes('/queue queued text\n'), true);
  assert.equal(fake.writes.includes('\t'), false);
  assert.equal(fake.writes.includes('/abort\n'), true);
  assert.deepEqual(fake.resizes, [{ cols: 20, rows: 6 }]);

  await session.dispose();
  assert.equal(fake.writes.includes('/exit\n'), true);
});

test('runtime nim cli session preserves explicit /queue commands when tab is pressed', async () => {
  const fake = new FakePtySession();
  const fakeStartPtySession = (() => {
    return fake as unknown as ReturnType<StartPtySessionFn>;
  }) as unknown as StartPtySessionFn;
  const session = new RuntimeNimCliSession({
    invocationDirectory: '/tmp/workspace',
    tenantId: 'tenant-a',
    userId: 'user-a',
    markDirty: () => undefined,
    sessionName: null,
    model: 'mock/echo-v1',
    useMock: true,
    harnessScriptPath: '/tmp/harness.ts',
    startPtySession: fakeStartPtySession,
  });

  await session.start();
  session.handleInputChunk('/queue high fix now');
  session.handleInputChunk('\t');

  assert.equal(fake.writes.includes('/queue high fix now\n'), true);
  await session.dispose();
});
