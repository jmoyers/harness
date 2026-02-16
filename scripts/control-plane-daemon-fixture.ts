import { resolve } from 'node:path';
import { startCodexLiveSession } from '../src/codex/live-session.ts';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import { loadHarnessConfig } from '../src/config/config-core.ts';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';
import {
  configurePerfCore,
  recordPerfEvent,
  shutdownPerfCore,
  startPerfSpan
} from '../src/perf/perf-core.ts';

interface DaemonOptions {
  host: string;
  port: number;
  authToken: string | null;
  stateDbPath: string;
  fixtureCommand: string;
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

function configureProcessPerf(invocationDirectory: string): void {
  const loadedConfig = loadHarnessConfig({ cwd: invocationDirectory });
  const configEnabled = loadedConfig.config.debug.enabled && loadedConfig.config.debug.perf.enabled;
  const perfEnabled = parseBooleanEnv(process.env.HARNESS_PERF_ENABLED, configEnabled);
  const configuredPath = resolve(invocationDirectory, loadedConfig.config.debug.perf.filePath);
  const envPath = process.env.HARNESS_PERF_FILE_PATH;
  const perfFilePath =
    typeof envPath === 'string' && envPath.trim().length > 0
      ? resolve(invocationDirectory, envPath)
      : configuredPath;

  configurePerfCore({
    enabled: perfEnabled,
    filePath: perfFilePath
  });

  recordPerfEvent('daemon-fixture.perf.configured', {
    process: 'daemon-fixture',
    enabled: perfEnabled,
    filePath: perfFilePath
  });
}

function parseArgs(argv: string[]): DaemonOptions {
  const defaultHost = process.env.HARNESS_CONTROL_PLANE_HOST ?? '127.0.0.1';
  const defaultPortRaw = process.env.HARNESS_CONTROL_PLANE_PORT ?? '7777';
  const defaultAuthToken = process.env.HARNESS_CONTROL_PLANE_AUTH_TOKEN ?? null;
  const defaultStateDbPath = process.env.HARNESS_CONTROL_PLANE_DB_PATH ?? '.harness/control-plane-fixture.sqlite';
  const defaultFixtureCommand = process.env.HARNESS_FIXTURE_COMMAND ?? '/bin/sh';

  let host = defaultHost;
  let portRaw = defaultPortRaw;
  let authToken = defaultAuthToken;
  let stateDbPath = defaultStateDbPath;
  let fixtureCommand = defaultFixtureCommand;

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx]!;
    if (arg === '--host') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --host');
      }
      host = value;
      idx += 1;
      continue;
    }

    if (arg === '--port') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --port');
      }
      portRaw = value;
      idx += 1;
      continue;
    }

    if (arg === '--auth-token') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --auth-token');
      }
      authToken = value;
      idx += 1;
      continue;
    }

    if (arg === '--state-db-path') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --state-db-path');
      }
      stateDbPath = value;
      idx += 1;
      continue;
    }

    if (arg === '--fixture-command') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --fixture-command');
      }
      fixtureCommand = value;
      idx += 1;
      continue;
    }
  }

  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid --port value: ${portRaw}`);
  }

  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!loopbackHosts.has(host) && authToken === null) {
    throw new Error('non-loopback hosts require --auth-token or HARNESS_CONTROL_PLANE_AUTH_TOKEN');
  }

  return {
    host,
    port,
    authToken,
    stateDbPath,
    fixtureCommand
  };
}

async function main(): Promise<number> {
  const invocationDirectory = resolveInvocationDirectory();
  loadHarnessSecrets({ cwd: invocationDirectory });
  configureProcessPerf(invocationDirectory);
  const loadedConfig = loadHarnessConfig({ cwd: invocationDirectory });
  const serverSnapshotModelEnabled = loadedConfig.config.debug.mux.serverSnapshotModelEnabled;
  const startupSpan = startPerfSpan('daemon-fixture.startup.total', {
    process: 'daemon-fixture'
  });
  recordPerfEvent('daemon-fixture.startup.begin', {
    process: 'daemon-fixture'
  });
  const options = parseArgs(process.argv.slice(2));

  const listenSpan = startPerfSpan('daemon-fixture.startup.listen', {
    process: 'daemon-fixture'
  });
  const serverOptions: Parameters<typeof startControlPlaneStreamServer>[0] = {
    host: options.host,
    port: options.port,
    stateStorePath: options.stateDbPath,
    codexTelemetry: loadedConfig.config.codex.telemetry,
    codexHistory: loadedConfig.config.codex.history,
    gitStatus: {
      enabled: loadedConfig.config.mux.git.enabled,
      pollMs: loadedConfig.config.mux.git.idlePollMs,
      maxConcurrency: loadedConfig.config.mux.git.maxConcurrency,
      minDirectoryRefreshMs: Math.max(loadedConfig.config.mux.git.idlePollMs, 30_000)
    },
    lifecycleHooks: loadedConfig.config.hooks.lifecycle,
    startSession: (input) => {
      const sessionOptions: Parameters<typeof startCodexLiveSession>[0] = {
        command: options.fixtureCommand,
        baseArgs: [],
        args: input.args,
        initialCols: input.initialCols,
        initialRows: input.initialRows,
        enableSnapshotModel: serverSnapshotModelEnabled
      };
      if (input.useNotifyHook !== undefined) {
        sessionOptions.useNotifyHook = input.useNotifyHook;
      }
      if (input.env !== undefined) {
        sessionOptions.env = input.env;
      }
      if (input.cwd !== undefined) {
        sessionOptions.cwd = input.cwd;
      }
      if (input.terminalForegroundHex !== undefined) {
        sessionOptions.terminalForegroundHex = input.terminalForegroundHex;
      }
      if (input.terminalBackgroundHex !== undefined) {
        sessionOptions.terminalBackgroundHex = input.terminalBackgroundHex;
      }
      return startCodexLiveSession(sessionOptions);
    }
  };
  if (options.authToken !== null) {
    serverOptions.authToken = options.authToken;
  }
  const server = await startControlPlaneStreamServer(serverOptions);
  listenSpan.end({ listening: true });

  const address = server.address();
  recordPerfEvent('daemon-fixture.startup.listening', {
    process: 'daemon-fixture',
    host: address.address,
    port: address.port,
    auth: options.authToken === null ? 'off' : 'on',
    fixtureCommand: options.fixtureCommand
  });
  startupSpan.end({ listening: true });
  process.stdout.write(
    `[control-plane-fixture] listening host=${address.address} port=${String(address.port)} auth=${options.authToken === null ? 'off' : 'on'} db=${options.stateDbPath} cmd=${options.fixtureCommand}\n`
  );

  let stopRequested = false;
  let resolveStop: (() => void) | null = null;
  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  const requestStop = (): void => {
    if (stopRequested) {
      return;
    }
    stopRequested = true;
    resolveStop?.();
  };

  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);

  await stopPromise;
  recordPerfEvent('daemon-fixture.runtime.stop-requested', {
    process: 'daemon-fixture'
  });
  await server.close();
  recordPerfEvent('daemon-fixture.runtime.closed', {
    process: 'daemon-fixture'
  });
  return 0;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  process.stderr.write(
    `control-plane daemon fixture fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
} finally {
  shutdownPerfCore();
}
