import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = resolve(SCRIPT_DIR, 'control-plane-daemon.ts');
const MUX_SCRIPT = resolve(SCRIPT_DIR, 'codex-live-mux.ts');
const DEFAULT_HOST = '127.0.0.1';
const START_TIMEOUT_MS = 5000;

function normalizeSignalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === null) {
    return 1;
  }
  if (signal === 'SIGINT') {
    return 130;
  }
  if (signal === 'SIGTERM') {
    return 143;
  }
  return 1;
}

async function reservePort(host: string): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();

    server.once('error', (error: Error) => {
      reject(error);
    });

    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => {
          reject(new Error('failed to reserve local port'));
        });
        return;
      }

      const port = address.port;
      server.close((error?: Error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function spawnDaemon(host: string, port: number): ChildProcess {
  return spawn(
    process.execPath,
    ['--experimental-strip-types', DAEMON_SCRIPT, '--host', host, '--port', String(port)],
    {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: process.env
    }
  );
}

async function waitForDaemonReady(daemon: ChildProcess): Promise<void> {
  const stdout = daemon.stdout;
  if (stdout === null) {
    throw new Error('failed to capture daemon stdout');
  }

  await new Promise<void>((resolveReady, rejectReady) => {
    let resolved = false;
    let buffer = '';

    const finishReady = (): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeoutHandle);
      stdout.off('data', onData);
      daemon.off('exit', onExit);
      resolveReady();
    };

    const failReady = (error: Error): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeoutHandle);
      stdout.off('data', onData);
      daemon.off('exit', onExit);
      rejectReady(error);
    };

    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      if (buffer.includes('[control-plane] listening')) {
        finishReady();
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      failReady(
        new Error(
          `control-plane daemon exited before ready (code=${code === null ? 'null' : String(code)}, signal=${signal === null ? 'null' : signal})`
        )
      );
    };

    const timeoutHandle = setTimeout(() => {
      failReady(new Error(`timed out waiting ${String(START_TIMEOUT_MS)}ms for daemon startup`));
    }, START_TIMEOUT_MS);

    stdout.on('data', onData);
    daemon.once('exit', onExit);
  });
}

function spawnMuxClient(host: string, port: number, codexArgs: readonly string[]): ChildProcess {
  return spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      MUX_SCRIPT,
      '--harness-server-host',
      host,
      '--harness-server-port',
      String(port),
      ...codexArgs
    ],
    {
      stdio: 'inherit',
      env: process.env
    }
  );
}

async function terminateChild(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill(signal);
  await once(child, 'exit');
}

async function main(): Promise<number> {
  const codexArgs = process.argv.slice(2);
  const host = DEFAULT_HOST;
  const port = await reservePort(host);

  const daemon = spawnDaemon(host, port);
  try {
    await waitForDaemonReady(daemon);
  } catch (error: unknown) {
    await terminateChild(daemon, 'SIGTERM');
    throw error;
  }

  const muxClient = spawnMuxClient(host, port, codexArgs);
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await terminateChild(muxClient, 'SIGTERM').catch(() => undefined);
    await terminateChild(daemon, 'SIGTERM').catch(() => undefined);
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });

  const [code, signal] = (await once(muxClient, 'exit')) as [number | null, NodeJS.Signals | null];
  await terminateChild(daemon, 'SIGTERM').catch(() => undefined);

  if (code !== null) {
    return code;
  }
  return normalizeSignalExitCode(signal);
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  process.stderr.write(
    `codex-live-mux-launch fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
