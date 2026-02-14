import assert from 'node:assert/strict';
import test from 'node:test';
import { startPtySession, type PtyExit } from '../src/pty/pty_host.ts';

function createCollector() {
  const chunks: Buffer[] = [];
  return {
    onData: (chunk: Buffer): void => {
      chunks.push(chunk);
    },
    read: (): string => {
      return Buffer.concat(chunks).toString('utf8');
    }
  };
}

function waitForMatch(readOutput: () => string, matcher: RegExp, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (matcher.test(readOutput())) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`timed out waiting for pattern: ${matcher.source}`));
        return;
      }

      setTimeout(tick, 10);
    };

    tick();
  });
}

function waitForExit(session: ReturnType<typeof startPtySession>, timeoutMs = 3000): Promise<PtyExit> {
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

void test('pty-host transparently echoes input using cat', async () => {
  const session = startPtySession({
    command: '/bin/cat',
    commandArgs: []
  });
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
    commandArgs: ['-c', 'printf "ready\\n"']
  });
  const collector = createCollector();
  session.on('data', collector.onData);

  const exit = await waitForExit(session);
  assert.equal(exit.code, 0);
  assert.match(collector.read(), /ready/);
});

void test('pty-host forwards stderr output through data stream', async () => {
  const session = startPtySession({
    command: '/bin/sh',
    commandArgs: ['-c', 'printf "stderr-ready\\n" 1>&2']
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
      PS1: ''
    }
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

void test('pty-host close command exits default interactive shell session', async () => {
  const session = startPtySession();
  session.close();
  const exit = await waitForExit(session);
  assert.notEqual(exit.code, null);
});

void test('pty-host emits error when helper executable cannot be launched', async () => {
  const session = startPtySession({
    pythonPath: '/path/that/does/not/exist'
  });

  const error = await new Promise<Error>((resolve) => {
    session.once('error', resolve);
  });

  assert.match(error.message, /ENOENT/);
});
