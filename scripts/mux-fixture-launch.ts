import { once } from 'node:events';
import { mkdirSync, truncateSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadHarnessConfig } from '../src/config/config-core.ts';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';
import {
  configurePerfCore,
  recordPerfEvent,
  shutdownPerfCore,
  startPerfSpan
} from '../src/perf/perf-core.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = resolve(SCRIPT_DIR, 'control-plane-daemon-fixture.ts');
const MUX_SCRIPT = resolve(SCRIPT_DIR, 'harness-core.ts');
const DEFAULT_HOST = '127.0.0.1';
const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 1500;

function tsRuntimeArgs(scriptPath: string, args: readonly string[] = []): string[] {
  return [scriptPath, ...args];
}

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

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function resolveInvocationDirectory(): string {
  return process.env.HARNESS_INVOKE_CWD ?? process.env.INIT_CWD ?? process.cwd();
}

function prepareArtifactPath(path: string, overwriteOnStart: boolean): string {
  const resolvedPath = resolve(path);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  if (overwriteOnStart) {
    try {
      truncateSync(resolvedPath, 0);
    } catch (error: unknown) {
      const code = (error as { code?: unknown }).code;
      if (code !== 'ENOENT') {
        throw error;
      }
      writeFileSync(resolvedPath, '', 'utf8');
    }
  }
  return resolvedPath;
}

function configureProcessPerf(invocationDirectory: string): { enabled: boolean; filePath: string } {
  const loadedConfig = loadHarnessConfig({ cwd: invocationDirectory });
  const configEnabled = loadedConfig.config.debug.enabled && loadedConfig.config.debug.perf.enabled;
  const perfEnabled = parseBooleanEnv(process.env.HARNESS_PERF_ENABLED, configEnabled);
  const configuredPath = resolve(invocationDirectory, loadedConfig.config.debug.perf.filePath);
  const envPath = process.env.HARNESS_PERF_FILE_PATH;
  const perfFilePath =
    typeof envPath === 'string' && envPath.trim().length > 0
      ? resolve(invocationDirectory, envPath)
      : configuredPath;
  const shouldTruncate = parseBooleanEnv(
    process.env.HARNESS_PERF_TRUNCATE_ON_START,
    loadedConfig.config.debug.overwriteArtifactsOnStart
  );

  if (perfEnabled) {
    prepareArtifactPath(perfFilePath, shouldTruncate);
  }

  configurePerfCore({
    enabled: perfEnabled,
    filePath: perfFilePath
  });

  recordPerfEvent('launch-fixture.perf.configured', {
    process: 'launch-fixture',
    enabled: perfEnabled,
    filePath: perfFilePath,
    truncateOnStart: shouldTruncate
  });

  return {
    enabled: perfEnabled,
    filePath: perfFilePath
  };
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

function defaultFixtureArgs(invocationDirectory: string): string[] {
  const fixturePath = resolve(invocationDirectory, 'assets/codex-startup-fixture.txt');
  return [
    '-lc',
    `cat ${JSON.stringify(fixturePath)}; printf '\n'; sleep 600`
  ];
}

function spawnDaemon(
  host: string,
  port: number,
  authToken: string,
  invocationDirectory: string,
  perfSettings: { enabled: boolean; filePath: string },
  runId: string
): ChildProcess {
  return spawn(
    process.execPath,
    tsRuntimeArgs(DAEMON_SCRIPT, ['--host', host, '--port', String(port)]),
    {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        HARNESS_CONTROL_PLANE_AUTH_TOKEN: authToken,
        HARNESS_INVOKE_CWD: invocationDirectory,
        HARNESS_PERF_ENABLED: perfSettings.enabled ? '1' : '0',
        HARNESS_PERF_FILE_PATH: perfSettings.filePath,
        HARNESS_PERF_TRUNCATE_ON_START: '0',
        HARNESS_CONTROL_PLANE_DB_PATH: resolve(invocationDirectory, `.harness/control-plane-fixture-${runId}.sqlite`)
      }
    }
  );
}

async function waitForDaemonReady(daemon: ChildProcess): Promise<void> {
  const stdout = daemon.stdout;
  if (stdout === null) {
    throw new Error('failed to capture daemon stdout');
  }

  const readySpan = startPerfSpan('launch-fixture.startup.daemon-ready-wait', {
    process: 'launch-fixture',
    daemonPid: daemon.pid ?? -1
  });

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
      readySpan.end({ ready: true });
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
      readySpan.end({ ready: false, message: error.message });
      rejectReady(error);
    };

    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      if (buffer.includes('[control-plane-fixture] listening')) {
        finishReady();
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      failReady(
        new Error(
          `control-plane fixture daemon exited before ready (code=${code === null ? 'null' : String(code)}, signal=${signal === null ? 'null' : signal})`
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

function spawnMuxClient(
  host: string,
  port: number,
  authToken: string,
  fixtureArgs: readonly string[],
  invocationDirectory: string,
  perfSettings: { enabled: boolean; filePath: string },
  runId: string
): ChildProcess {
  return spawn(
    process.execPath,
    tsRuntimeArgs(MUX_SCRIPT, [
      '--harness-server-host',
      host,
      '--harness-server-port',
      String(port),
      ...fixtureArgs
    ]),
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        HARNESS_MUX_CTRL_C_EXITS: '1',
        HARNESS_CONTROL_PLANE_AUTH_TOKEN: authToken,
        HARNESS_INVOKE_CWD: invocationDirectory,
        HARNESS_PERF_ENABLED: perfSettings.enabled ? '1' : '0',
        HARNESS_PERF_FILE_PATH: perfSettings.filePath,
        HARNESS_PERF_TRUNCATE_ON_START: '0',
        HARNESS_CONTROL_PLANE_DB_PATH: resolve(invocationDirectory, `.harness/control-plane-fixture-${runId}.sqlite`),
        HARNESS_EVENTS_DB_PATH: resolve(invocationDirectory, `.harness/events-fixture-${runId}.sqlite`),
        HARNESS_CONVERSATION_ID: `conversation-fixture-${runId}`
      }
    }
  );
}

async function terminateChild(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill(signal);
  const exited = await Promise.race<boolean>([
    once(child, 'exit').then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, STOP_TIMEOUT_MS);
    })
  ]);
  if (exited) {
    return;
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGKILL');
  await once(child, 'exit');
}

function normalizeChildExitCode(exit: readonly [number | null, NodeJS.Signals | null]): number {
  const [code, signal] = exit;
  if (code !== null) {
    return code;
  }
  return normalizeSignalExitCode(signal);
}

async function main(): Promise<number> {
  const invocationDirectory = resolveInvocationDirectory();
  loadHarnessSecrets({ cwd: invocationDirectory });
  const perfSettings = configureProcessPerf(invocationDirectory);
  const startupSpan = startPerfSpan('launch-fixture.startup.bootstrap', {
    process: 'launch-fixture'
  });
  recordPerfEvent('launch-fixture.startup.begin', {
    process: 'launch-fixture'
  });

  const host = DEFAULT_HOST;
  const runId = randomUUID();
  const fixtureArgs = process.argv.length > 2 ? process.argv.slice(2) : defaultFixtureArgs(invocationDirectory);
  const port = await reservePort(host);
  recordPerfEvent('launch-fixture.startup.port-reserved', {
    process: 'launch-fixture',
    port
  });
  const authToken = `token-${randomUUID()}`;

  const daemon = spawnDaemon(host, port, authToken, invocationDirectory, perfSettings, runId);
  const daemonReady = waitForDaemonReady(daemon).then(() => {
    recordPerfEvent('launch-fixture.startup.daemon-ready', {
      process: 'launch-fixture',
      daemonPid: daemon.pid ?? -1
    });
  });

  const muxClient = spawnMuxClient(host, port, authToken, fixtureArgs, invocationDirectory, perfSettings, runId);
  recordPerfEvent('launch-fixture.startup.mux-spawned', {
    process: 'launch-fixture',
    muxPid: muxClient.pid ?? -1
  });

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

  await daemonReady;
  startupSpan.end({ ready: true });

  const muxExit = (await once(muxClient, 'exit')) as [number | null, NodeJS.Signals | null];
  recordPerfEvent('launch-fixture.runtime.mux-exited', {
    process: 'launch-fixture',
    code: muxExit[0] ?? -1,
    signal: muxExit[1] ?? 'null'
  });
  await terminateChild(daemon, 'SIGTERM').catch(() => undefined);
  return normalizeChildExitCode(muxExit);
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  process.stderr.write(
    `mux fixture launch fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
} finally {
  shutdownPerfCore();
}
