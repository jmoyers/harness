import { resolve } from 'node:path';
import { startCodexLiveSession } from '../src/codex/live-session.ts';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import { loadHarnessConfig, resolveHarnessConfigPath } from '../src/config/config-core.ts';
import {
  resolveHarnessRuntimePath,
  resolveHarnessWorkspaceDirectory,
} from '../src/config/harness-paths.ts';
import { migrateLegacyHarnessLayout } from '../src/config/harness-runtime-migration.ts';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';
import {
  configurePerfCore,
  recordPerfEvent,
  shutdownPerfCore,
  startPerfSpan,
} from '../src/perf/perf-core.ts';

interface DaemonOptions {
  host: string;
  port: number;
  authToken: string | null;
  stateDbPath: string;
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
  const configuredPath = resolveHarnessRuntimePath(
    invocationDirectory,
    loadedConfig.config.debug.perf.filePath,
  );
  const envPath = process.env.HARNESS_PERF_FILE_PATH;
  const perfFilePath =
    typeof envPath === 'string' && envPath.trim().length > 0
      ? resolveHarnessRuntimePath(invocationDirectory, envPath)
      : configuredPath;

  configurePerfCore({
    enabled: perfEnabled,
    filePath: perfFilePath,
  });

  recordPerfEvent('daemon.perf.configured', {
    process: 'daemon',
    enabled: perfEnabled,
    filePath: perfFilePath,
  });
}

function parseArgs(argv: string[], invocationDirectory: string): DaemonOptions {
  const defaultHost = process.env.HARNESS_CONTROL_PLANE_HOST ?? '127.0.0.1';
  const defaultPortRaw = process.env.HARNESS_CONTROL_PLANE_PORT ?? '7777';
  const defaultAuthToken = process.env.HARNESS_CONTROL_PLANE_AUTH_TOKEN ?? null;
  const defaultStateDbPath = resolveHarnessRuntimePath(
    invocationDirectory,
    '.harness/control-plane.sqlite',
  );

  let host = defaultHost;
  let portRaw = defaultPortRaw;
  let authToken = defaultAuthToken;
  let stateDbPath = defaultStateDbPath;

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
      stateDbPath = resolveHarnessRuntimePath(invocationDirectory, value);
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
  const workspaceRuntimeRoot = resolveHarnessWorkspaceDirectory(invocationDirectory, process.env);
  const normalizedRuntimeRoot = resolve(workspaceRuntimeRoot);
  const normalizedStateDbPath = resolve(stateDbPath);
  if (
    normalizedStateDbPath !== normalizedRuntimeRoot &&
    !normalizedStateDbPath.startsWith(`${normalizedRuntimeRoot}/`)
  ) {
    throw new Error(
      `invalid --state-db-path: ${stateDbPath}. state db path must be under workspace runtime root ${workspaceRuntimeRoot}`,
    );
  }

  return {
    host,
    port,
    authToken,
    stateDbPath,
  };
}

async function main(): Promise<number> {
  const invocationDirectory = resolveInvocationDirectory();
  const gatewayRunIdRaw = process.env.HARNESS_GATEWAY_RUN_ID;
  const gatewayRunId =
    typeof gatewayRunIdRaw === 'string' && gatewayRunIdRaw.trim().length > 0
      ? gatewayRunIdRaw.trim()
      : `gateway-run-${process.pid}`;
  migrateLegacyHarnessLayout(invocationDirectory, process.env);
  loadHarnessSecrets({ cwd: invocationDirectory });
  configureProcessPerf(invocationDirectory);
  const loadedConfig = loadHarnessConfig({ cwd: invocationDirectory });
  const serverSnapshotModelEnabled = loadedConfig.config.debug.mux.serverSnapshotModelEnabled;
  const codexLaunchDirectoryModes: Record<string, 'yolo' | 'standard'> = {};
  for (const [directoryPath, mode] of Object.entries(
    loadedConfig.config.codex.launch.directoryModes,
  )) {
    codexLaunchDirectoryModes[resolve(invocationDirectory, directoryPath)] = mode;
  }
  const cursorLaunchDirectoryModes: Record<string, 'yolo' | 'standard'> = {};
  for (const [directoryPath, mode] of Object.entries(
    loadedConfig.config.cursor.launch.directoryModes,
  )) {
    cursorLaunchDirectoryModes[resolve(invocationDirectory, directoryPath)] = mode;
  }
  const startupSpan = startPerfSpan('daemon.startup.total', {
    process: 'daemon',
    gatewayRunId,
  });
  recordPerfEvent('daemon.startup.begin', {
    process: 'daemon',
    gatewayRunId,
  });
  const options = parseArgs(process.argv.slice(2), invocationDirectory);
  const workspaceRuntimeRoot = resolveHarnessWorkspaceDirectory(invocationDirectory, process.env);
  const configPath = resolveHarnessConfigPath(invocationDirectory, process.env);
  process.stdout.write(
    `[control-plane] boot runId=${gatewayRunId} pid=${String(process.pid)} ppid=${String(process.ppid)} workspaceRoot=${invocationDirectory} runtimeRoot=${workspaceRuntimeRoot} config=${configPath} db=${options.stateDbPath}\n`,
  );

  const listenSpan = startPerfSpan('daemon.startup.listen', {
    process: 'daemon',
    gatewayRunId,
  });
  const serverOptions: Parameters<typeof startControlPlaneStreamServer>[0] = {
    host: options.host,
    port: options.port,
    stateStorePath: options.stateDbPath,
    codexTelemetry: loadedConfig.config.codex.telemetry,
    codexHistory: loadedConfig.config.codex.history,
    codexLaunch: {
      defaultMode: loadedConfig.config.codex.launch.defaultMode,
      directoryModes: codexLaunchDirectoryModes,
    },
    critique: loadedConfig.config.critique,
    agentInstall: {
      codex: loadedConfig.config.codex.install,
      claude: loadedConfig.config.claude.install,
      cursor: loadedConfig.config.cursor.install,
      critique: loadedConfig.config.critique.install,
    },
    cursorLaunch: {
      defaultMode: loadedConfig.config.cursor.launch.defaultMode,
      directoryModes: cursorLaunchDirectoryModes,
    },
    gitStatus: {
      enabled: loadedConfig.config.mux.git.enabled,
      pollMs: loadedConfig.config.mux.git.idlePollMs,
      maxConcurrency: loadedConfig.config.mux.git.maxConcurrency,
      minDirectoryRefreshMs: Math.max(loadedConfig.config.mux.git.idlePollMs, 30_000),
    },
    github: {
      enabled: loadedConfig.config.github.enabled,
      apiBaseUrl: loadedConfig.config.github.apiBaseUrl,
      tokenEnvVar: loadedConfig.config.github.tokenEnvVar,
      pollMs: loadedConfig.config.github.pollMs,
      maxConcurrency: loadedConfig.config.github.maxConcurrency,
      branchStrategy: loadedConfig.config.github.branchStrategy,
      viewerLogin: loadedConfig.config.github.viewerLogin,
    },
    lifecycleHooks: loadedConfig.config.hooks.lifecycle,
    startSession: (input) => {
      const sessionOptions: Parameters<typeof startCodexLiveSession>[0] = {
        args: input.args,
        initialCols: input.initialCols,
        initialRows: input.initialRows,
        enableSnapshotModel: serverSnapshotModelEnabled,
      };
      if (input.command !== undefined) {
        sessionOptions.command = input.command;
      }
      if (input.baseArgs !== undefined) {
        sessionOptions.baseArgs = input.baseArgs;
      }
      if (input.useNotifyHook !== undefined) {
        sessionOptions.useNotifyHook = input.useNotifyHook;
      }
      if (input.notifyMode !== undefined) {
        sessionOptions.notifyMode = input.notifyMode;
      }
      if (input.notifyFilePath !== undefined) {
        sessionOptions.notifyFilePath = input.notifyFilePath;
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
    },
  };
  if (options.authToken !== null) {
    serverOptions.authToken = options.authToken;
  }
  const server = await startControlPlaneStreamServer(serverOptions);
  listenSpan.end({ listening: true });

  const address = server.address();
  recordPerfEvent('daemon.startup.listening', {
    process: 'daemon',
    gatewayRunId,
    host: address.address,
    port: address.port,
    auth: options.authToken === null ? 'off' : 'on',
  });
  startupSpan.end({ listening: true });
  process.stdout.write(
    `[control-plane] listening host=${address.address} port=${String(address.port)} auth=${options.authToken === null ? 'off' : 'on'} db=${options.stateDbPath} runId=${gatewayRunId}\n`,
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
  recordPerfEvent('daemon.runtime.stop-requested', {
    process: 'daemon',
  });
  await server.close();
  recordPerfEvent('daemon.runtime.closed', {
    process: 'daemon',
  });
  return 0;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  process.stderr.write(
    `control-plane daemon fatal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  shutdownPerfCore();
}
