import { once } from 'node:events';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import { parseStreamCommand } from '../src/control-plane/stream-command-parser.ts';
import type { StreamCommand } from '../src/control-plane/stream-protocol.ts';
import { runHarnessAnimate } from './harness-animate.ts';
import {
  GATEWAY_RECORD_VERSION,
  DEFAULT_GATEWAY_DB_PATH,
  isLoopbackHost,
  normalizeGatewayHost,
  normalizeGatewayPort,
  normalizeGatewayStateDbPath,
  parseGatewayRecordText,
  resolveGatewayLogPath,
  resolveGatewayRecordPath,
  resolveInvocationDirectory,
  serializeGatewayRecord,
  type GatewayRecord,
} from '../src/cli/gateway-record.ts';
import { loadHarnessConfig } from '../src/config/config-core.ts';
import {
  resolveHarnessRuntimePath,
  resolveHarnessWorkspaceDirectory,
} from '../src/config/harness-paths.ts';
import { migrateLegacyHarnessLayout } from '../src/config/harness-runtime-migration.ts';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';
import {
  buildCursorManagedHookRelayCommand,
  ensureManagedCursorHooksInstalled,
  uninstallManagedCursorHooks,
} from '../src/cursor/managed-hooks.ts';
import {
  buildInspectorProfileStartExpression,
  buildInspectorProfileStopExpression,
  connectGatewayInspector,
  DEFAULT_PROFILE_INSPECT_TIMEOUT_MS,
  evaluateInspectorExpression,
  InspectorWebSocketClient,
  type InspectorProfileState,
  readInspectorProfileState,
} from './harness-inspector.ts';
import {
  parseActiveStatusTimelineState,
  resolveDefaultStatusTimelineOutputPath,
  resolveStatusTimelineStatePath,
  STATUS_TIMELINE_MODE,
  STATUS_TIMELINE_STATE_VERSION,
} from '../src/mux/live-mux/status-timeline-state.ts';
import {
  parseActiveRenderTraceState,
  resolveDefaultRenderTraceOutputPath,
  resolveRenderTraceStatePath,
  RENDER_TRACE_MODE,
  RENDER_TRACE_STATE_VERSION,
} from '../src/mux/live-mux/render-trace-state.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DAEMON_SCRIPT_PATH = resolve(SCRIPT_DIR, 'control-plane-daemon.ts');
const DEFAULT_MUX_SCRIPT_PATH = resolve(SCRIPT_DIR, 'harness-core.ts');
const DEFAULT_CURSOR_HOOK_RELAY_SCRIPT_PATH = resolve(SCRIPT_DIR, 'cursor-hook-relay.ts');
const DEFAULT_GATEWAY_START_RETRY_WINDOW_MS = 6000;
const DEFAULT_GATEWAY_START_RETRY_DELAY_MS = 40;
const DEFAULT_GATEWAY_STOP_TIMEOUT_MS = 5000;
const DEFAULT_GATEWAY_STOP_POLL_MS = 50;
const DEFAULT_PROFILE_ROOT_PATH = 'profiles';
const DEFAULT_SESSION_ROOT_PATH = 'sessions';
const PROFILE_STATE_FILE_NAME = 'active-profile.json';
const PROFILE_CLIENT_FILE_NAME = 'client.cpuprofile';
const PROFILE_GATEWAY_FILE_NAME = 'gateway.cpuprofile';
const DEFAULT_HARNESS_UPDATE_PACKAGE = '@jmoyers/harness@latest';
const PROFILE_STATE_VERSION = 2;
const PROFILE_LIVE_INSPECT_MODE = 'live-inspector';
const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

interface GatewayStartOptions {
  host?: string;
  port?: number;
  authToken?: string;
  stateDbPath?: string;
}

interface GatewayStopOptions {
  force: boolean;
  timeoutMs: number;
  cleanupOrphans: boolean;
}

interface ParsedGatewayCommand {
  type: 'start' | 'stop' | 'status' | 'restart' | 'run' | 'call';
  startOptions?: GatewayStartOptions;
  stopOptions?: GatewayStopOptions;
  callJson?: string;
}

interface ParsedProfileRunCommand {
  type: 'run';
  profileDir: string | null;
  muxArgs: readonly string[];
}

interface ParsedProfileStartCommand {
  type: 'start';
  profileDir: string | null;
}

interface ProfileStopOptions {
  timeoutMs: number;
}

interface ParsedProfileStopCommand {
  type: 'stop';
  stopOptions: ProfileStopOptions;
}

type ParsedProfileCommand =
  | ParsedProfileRunCommand
  | ParsedProfileStartCommand
  | ParsedProfileStopCommand;

interface ParsedStatusTimelineStartCommand {
  type: 'start';
  outputPath: string | null;
}

interface ParsedStatusTimelineStopCommand {
  type: 'stop';
}

type ParsedStatusTimelineCommand =
  | ParsedStatusTimelineStartCommand
  | ParsedStatusTimelineStopCommand;

interface ParsedRenderTraceStartCommand {
  type: 'start';
  outputPath: string | null;
  conversationId: string | null;
}

interface ParsedRenderTraceStopCommand {
  type: 'stop';
}

type ParsedRenderTraceCommand = ParsedRenderTraceStartCommand | ParsedRenderTraceStopCommand;

interface ParsedCursorHooksCommand {
  type: 'install' | 'uninstall';
  hooksFilePath: string | null;
}

interface RuntimeCpuProfileOptions {
  cpuProfileDir: string;
  cpuProfileName: string;
}

interface RuntimeInspectOptions {
  readonly gatewayRuntimeArgs: readonly string[];
  readonly clientRuntimeArgs: readonly string[];
}

interface SessionPaths {
  recordPath: string;
  logPath: string;
  defaultStateDbPath: string;
  profileDir: string;
  profileStatePath: string;
  statusTimelineStatePath: string;
  defaultStatusTimelineOutputPath: string;
  renderTraceStatePath: string;
  defaultRenderTraceOutputPath: string;
}

interface ParsedGlobalCliOptions {
  sessionName: string | null;
  argv: readonly string[];
}

interface ResolvedGatewaySettings {
  host: string;
  port: number;
  authToken: string | null;
  stateDbPath: string;
}

interface GatewayProbeResult {
  connected: boolean;
  sessionCount: number;
  liveSessionCount: number;
  error: string | null;
}

interface EnsureGatewayResult {
  record: GatewayRecord;
  started: boolean;
}

interface ProcessTableEntry {
  pid: number;
  ppid: number;
  command: string;
}

interface OrphanProcessCleanupResult {
  matchedPids: readonly number[];
  terminatedPids: readonly number[];
  failedPids: readonly number[];
  errorMessage: string | null;
}

interface ActiveProfileState {
  version: number;
  mode: typeof PROFILE_LIVE_INSPECT_MODE;
  pid: number;
  host: string;
  port: number;
  stateDbPath: string;
  profileDir: string;
  gatewayProfilePath: string;
  inspectWebSocketUrl: string;
  startedAt: string;
}

interface ActiveStatusTimelineState {
  version: number;
  mode: typeof STATUS_TIMELINE_MODE;
  outputPath: string;
  sessionName: string | null;
  startedAt: string;
}

interface ActiveRenderTraceState {
  version: number;
  mode: typeof RENDER_TRACE_MODE;
  outputPath: string;
  sessionName: string | null;
  conversationId: string | null;
  startedAt: string;
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

function tsRuntimeArgs(
  scriptPath: string,
  args: readonly string[] = [],
  runtimeArgs: readonly string[] = [],
): string[] {
  return [...runtimeArgs, scriptPath, ...args];
}

function readCliValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parsePortFlag(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`invalid ${flag} value: ${value}`);
  }
  return parsed;
}

function parsePositiveIntFlag(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`invalid ${flag} value: ${value}`);
  }
  return parsed;
}

function parseSessionName(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!SESSION_NAME_PATTERN.test(trimmed)) {
    throw new Error(`invalid --session value: ${rawValue}`);
  }
  return trimmed;
}

function parseGlobalCliOptions(argv: readonly string[]): ParsedGlobalCliOptions {
  if (argv[0] !== '--session') {
    return {
      sessionName: null,
      argv,
    };
  }
  const sessionName = parseSessionName(readCliValue(argv, 0, '--session'));
  return {
    sessionName,
    argv: argv.slice(2),
  };
}

function resolveSessionPaths(
  invocationDirectory: string,
  sessionName: string | null,
): SessionPaths {
  const workspaceDirectory = resolveHarnessWorkspaceDirectory(invocationDirectory, process.env);
  const statusTimelineStatePath = resolveStatusTimelineStatePath(
    invocationDirectory,
    sessionName,
    process.env,
  );
  const defaultStatusTimelineOutputPath = resolveDefaultStatusTimelineOutputPath(
    invocationDirectory,
    sessionName,
    process.env,
  );
  const renderTraceStatePath = resolveRenderTraceStatePath(
    invocationDirectory,
    sessionName,
    process.env,
  );
  const defaultRenderTraceOutputPath = resolveDefaultRenderTraceOutputPath(
    invocationDirectory,
    sessionName,
    process.env,
  );
  if (sessionName === null) {
    return {
      recordPath: resolveGatewayRecordPath(invocationDirectory, process.env),
      logPath: resolveGatewayLogPath(invocationDirectory, process.env),
      defaultStateDbPath: resolveHarnessRuntimePath(
        invocationDirectory,
        DEFAULT_GATEWAY_DB_PATH,
        process.env,
      ),
      profileDir: resolve(workspaceDirectory, DEFAULT_PROFILE_ROOT_PATH),
      profileStatePath: resolve(workspaceDirectory, PROFILE_STATE_FILE_NAME),
      statusTimelineStatePath,
      defaultStatusTimelineOutputPath,
      renderTraceStatePath,
      defaultRenderTraceOutputPath,
    };
  }
  const sessionRoot = resolve(workspaceDirectory, DEFAULT_SESSION_ROOT_PATH, sessionName);
  return {
    recordPath: resolve(sessionRoot, 'gateway.json'),
    logPath: resolve(sessionRoot, 'gateway.log'),
    defaultStateDbPath: resolve(sessionRoot, 'control-plane.sqlite'),
    profileDir: resolve(workspaceDirectory, DEFAULT_PROFILE_ROOT_PATH, sessionName),
    profileStatePath: resolve(sessionRoot, PROFILE_STATE_FILE_NAME),
    statusTimelineStatePath,
    defaultStatusTimelineOutputPath,
    renderTraceStatePath,
    defaultRenderTraceOutputPath,
  };
}

function parseProfileRunCommand(argv: readonly string[]): ParsedProfileRunCommand {
  let profileDir: string | null = null;
  const muxArgs: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--profile-dir') {
      profileDir = readCliValue(argv, index, '--profile-dir');
      index += 1;
      continue;
    }
    muxArgs.push(arg);
  }
  return {
    type: 'run',
    profileDir,
    muxArgs,
  };
}

function parseProfileStartCommand(argv: readonly string[]): ParsedProfileStartCommand {
  let profileDir: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--profile-dir') {
      profileDir = readCliValue(argv, index, '--profile-dir');
      index += 1;
      continue;
    }
    throw new Error(`unknown profile option: ${arg}`);
  }
  return {
    type: 'start',
    profileDir,
  };
}

function parseProfileStopOptions(argv: readonly string[]): ProfileStopOptions {
  const options: ProfileStopOptions = {
    timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--timeout-ms') {
      options.timeoutMs = parsePositiveIntFlag(
        readCliValue(argv, index, '--timeout-ms'),
        '--timeout-ms',
      );
      index += 1;
      continue;
    }
    throw new Error(`unknown profile option: ${arg}`);
  }
  return options;
}

function parseProfileStopCommand(argv: readonly string[]): ParsedProfileStopCommand {
  return {
    type: 'stop',
    stopOptions: parseProfileStopOptions(argv),
  };
}

function parseProfileCommand(argv: readonly string[]): ParsedProfileCommand {
  if (argv.length === 0) {
    return parseProfileRunCommand(argv);
  }
  const subcommand = argv[0]!;
  const rest = argv.slice(1);
  if (subcommand === 'start') {
    return parseProfileStartCommand(rest);
  }
  if (subcommand === 'stop') {
    return parseProfileStopCommand(rest);
  }
  if (subcommand === 'run') {
    return parseProfileRunCommand(rest);
  }
  if (subcommand.startsWith('-')) {
    return parseProfileRunCommand(argv);
  }
  return parseProfileRunCommand(argv);
}

function parseStatusTimelineStartCommand(
  argv: readonly string[],
): ParsedStatusTimelineStartCommand {
  let outputPath: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--output-path') {
      outputPath = readCliValue(argv, index, '--output-path');
      index += 1;
      continue;
    }
    throw new Error(`unknown status-timeline option: ${arg}`);
  }
  return {
    type: 'start',
    outputPath,
  };
}

function parseStatusTimelineStopCommand(argv: readonly string[]): ParsedStatusTimelineStopCommand {
  if (argv.length > 0) {
    throw new Error(`unknown status-timeline option: ${argv[0]}`);
  }
  return {
    type: 'stop',
  };
}

function parseStatusTimelineCommand(argv: readonly string[]): ParsedStatusTimelineCommand {
  if (argv.length === 0) {
    return parseStatusTimelineStartCommand(argv);
  }
  const subcommand = argv[0]!;
  const rest = argv.slice(1);
  if (subcommand === 'start') {
    return parseStatusTimelineStartCommand(rest);
  }
  if (subcommand === 'stop') {
    return parseStatusTimelineStopCommand(rest);
  }
  if (subcommand.startsWith('-')) {
    return parseStatusTimelineStartCommand(argv);
  }
  throw new Error(`unknown status-timeline subcommand: ${subcommand}`);
}

function parseRenderTraceStartCommand(argv: readonly string[]): ParsedRenderTraceStartCommand {
  let outputPath: string | null = null;
  let conversationId: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--output-path') {
      outputPath = readCliValue(argv, index, '--output-path');
      index += 1;
      continue;
    }
    if (arg === '--conversation-id') {
      const value = readCliValue(argv, index, '--conversation-id').trim();
      if (value.length === 0) {
        throw new Error('invalid --conversation-id value: empty string');
      }
      conversationId = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown render-trace option: ${arg}`);
  }
  return {
    type: 'start',
    outputPath,
    conversationId,
  };
}

function parseRenderTraceStopCommand(argv: readonly string[]): ParsedRenderTraceStopCommand {
  if (argv.length > 0) {
    throw new Error(`unknown render-trace option: ${argv[0]}`);
  }
  return {
    type: 'stop',
  };
}

function parseRenderTraceCommand(argv: readonly string[]): ParsedRenderTraceCommand {
  if (argv.length === 0) {
    return parseRenderTraceStartCommand(argv);
  }
  const subcommand = argv[0]!;
  const rest = argv.slice(1);
  if (subcommand === 'start') {
    return parseRenderTraceStartCommand(rest);
  }
  if (subcommand === 'stop') {
    return parseRenderTraceStopCommand(rest);
  }
  if (subcommand.startsWith('-')) {
    return parseRenderTraceStartCommand(argv);
  }
  throw new Error(`unknown render-trace subcommand: ${subcommand}`);
}

function parseCursorHooksOptions(argv: readonly string[]): { hooksFilePath: string | null } {
  const options = {
    hooksFilePath: null as string | null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--hooks-file') {
      options.hooksFilePath = readCliValue(argv, index, '--hooks-file');
      index += 1;
      continue;
    }
    throw new Error(`unknown cursor-hooks option: ${arg}`);
  }
  return options;
}

function parseCursorHooksCommand(argv: readonly string[]): ParsedCursorHooksCommand {
  if (argv.length === 0) {
    throw new Error('missing cursor-hooks subcommand');
  }
  const subcommand = argv[0]!;
  const options = parseCursorHooksOptions(argv.slice(1));
  if (subcommand === 'install') {
    return {
      type: 'install',
      hooksFilePath: options.hooksFilePath,
    };
  }
  if (subcommand === 'uninstall') {
    return {
      type: 'uninstall',
      hooksFilePath: options.hooksFilePath,
    };
  }
  throw new Error(`unknown cursor-hooks subcommand: ${subcommand}`);
}

function buildCpuProfileRuntimeArgs(options: RuntimeCpuProfileOptions): readonly string[] {
  return [
    '--cpu-prof',
    '--cpu-prof-dir',
    options.cpuProfileDir,
    '--cpu-prof-name',
    options.cpuProfileName,
  ];
}

function resolveInspectRuntimeOptions(invocationDirectory: string): RuntimeInspectOptions {
  const loadedConfig = loadHarnessConfig({ cwd: invocationDirectory });
  const debugConfig = loadedConfig.config.debug;
  if (!debugConfig.enabled || !debugConfig.inspect.enabled) {
    return {
      gatewayRuntimeArgs: [],
      clientRuntimeArgs: [],
    };
  }
  return {
    gatewayRuntimeArgs: [
      `--inspect=localhost:${String(debugConfig.inspect.gatewayPort)}/harness-gateway`,
    ],
    clientRuntimeArgs: [
      `--inspect=localhost:${String(debugConfig.inspect.clientPort)}/harness-client`,
    ],
  };
}

function removeFileIfExists(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

async function reservePort(host: string): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => {
          reject(new Error('failed to reserve local port'));
        });
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function parseGatewayStartOptions(argv: readonly string[]): GatewayStartOptions {
  const options: GatewayStartOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--host') {
      options.host = readCliValue(argv, index, '--host');
      index += 1;
      continue;
    }
    if (arg === '--port') {
      options.port = parsePortFlag(readCliValue(argv, index, '--port'), '--port');
      index += 1;
      continue;
    }
    if (arg === '--auth-token') {
      options.authToken = readCliValue(argv, index, '--auth-token');
      index += 1;
      continue;
    }
    if (arg === '--state-db-path') {
      options.stateDbPath = readCliValue(argv, index, '--state-db-path');
      index += 1;
      continue;
    }
    throw new Error(`unknown gateway option: ${arg}`);
  }
  return options;
}

function parseGatewayStopOptions(argv: readonly string[]): GatewayStopOptions {
  const options: GatewayStopOptions = {
    force: false,
    timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
    cleanupOrphans: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--cleanup-orphans') {
      options.cleanupOrphans = true;
      continue;
    }
    if (arg === '--no-cleanup-orphans') {
      options.cleanupOrphans = false;
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = parsePositiveIntFlag(
        readCliValue(argv, index, '--timeout-ms'),
        '--timeout-ms',
      );
      index += 1;
      continue;
    }
    throw new Error(`unknown gateway option: ${arg}`);
  }
  return options;
}

function parseGatewayCallOptions(argv: readonly string[]): { json: string } {
  let json: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--json') {
      json = readCliValue(argv, index, '--json');
      index += 1;
      continue;
    }
    if (json === null) {
      json = arg;
      continue;
    }
    throw new Error(`unknown gateway option: ${arg}`);
  }
  if (json === null) {
    throw new Error(
      'missing command json; use `harness gateway call --json \'{"type":"session.list"}\'`',
    );
  }
  return { json };
}

function parseGatewayCommand(argv: readonly string[]): ParsedGatewayCommand {
  if (argv.length === 0) {
    throw new Error('missing gateway subcommand');
  }
  const subcommand = argv[0]!;
  const rest = argv.slice(1);
  if (subcommand === 'start') {
    return {
      type: 'start',
      startOptions: parseGatewayStartOptions(rest),
    };
  }
  if (subcommand === 'run') {
    return {
      type: 'run',
      startOptions: parseGatewayStartOptions(rest),
    };
  }
  if (subcommand === 'restart') {
    return {
      type: 'restart',
      startOptions: parseGatewayStartOptions(rest),
    };
  }
  if (subcommand === 'stop') {
    return {
      type: 'stop',
      stopOptions: parseGatewayStopOptions(rest),
    };
  }
  if (subcommand === 'status') {
    if (rest.length > 0) {
      throw new Error(`unknown gateway option: ${rest[0]}`);
    }
    return {
      type: 'status',
    };
  }
  if (subcommand === 'call') {
    const parsed = parseGatewayCallOptions(rest);
    return {
      type: 'call',
      callJson: parsed.json,
    };
  }
  throw new Error(`unknown gateway subcommand: ${subcommand}`);
}

function resolveHarnessUpdatePackageSpec(env: NodeJS.ProcessEnv): string {
  const configured = env.HARNESS_UPDATE_PACKAGE;
  if (typeof configured !== 'string') {
    return DEFAULT_HARNESS_UPDATE_PACKAGE;
  }
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_HARNESS_UPDATE_PACKAGE;
}

function formatExecErrorOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Buffer) {
    return value.toString('utf8');
  }
  return '';
}

function runHarnessUpdateCommand(invocationDirectory: string, env: NodeJS.ProcessEnv): number {
  const packageSpec = resolveHarnessUpdatePackageSpec(env);
  process.stdout.write(`updating Harness package: ${packageSpec}\n`);
  try {
    const stdout = execFileSync('bun', ['add', '-g', '--trust', packageSpec], {
      cwd: invocationDirectory,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (stdout.length > 0) {
      process.stdout.write(stdout);
    }
    process.stdout.write(`harness update complete: ${packageSpec}\n`);
    return 0;
  } catch (error: unknown) {
    const typed = error as NodeJS.ErrnoException & {
      readonly stdout?: unknown;
      readonly stderr?: unknown;
      readonly status?: number | null;
    };
    const stdout = formatExecErrorOutput(typed.stdout);
    const stderr = formatExecErrorOutput(typed.stderr);
    if (stdout.length > 0) {
      process.stdout.write(stdout);
    }
    if (stderr.length > 0) {
      process.stderr.write(stderr);
    }
    const statusText =
      typeof typed.status === 'number' ? `exit=${String(typed.status)}` : 'exit=unknown';
    throw new Error(`harness update command failed (${statusText})`);
  }
}

function printUsage(): void {
  process.stdout.write(
    [
      'usage:',
      '  harness [--session <name>] [mux-args...]',
      '  harness [--session <name>] gateway start [--host <host>] [--port <port>] [--auth-token <token>] [--state-db-path <path>]',
      '  harness [--session <name>] gateway run [--host <host>] [--port <port>] [--auth-token <token>] [--state-db-path <path>]',
      '  harness [--session <name>] gateway stop [--force] [--timeout-ms <ms>] [--cleanup-orphans|--no-cleanup-orphans]',
      '  harness [--session <name>] gateway status',
      '  harness [--session <name>] gateway restart [--host <host>] [--port <port>] [--auth-token <token>] [--state-db-path <path>]',
      '  harness [--session <name>] gateway call --json \'{"type":"session.list"}\'',
      '  harness [--session <name>] profile start [--profile-dir <path>]',
      '  harness [--session <name>] profile stop [--timeout-ms <ms>]',
      '  harness [--session <name>] profile run [--profile-dir <path>] [mux-args...]',
      '  harness [--session <name>] profile [--profile-dir <path>] [mux-args...]',
      '  harness [--session <name>] status-timeline start [--output-path <path>]',
      '  harness [--session <name>] status-timeline stop',
      '  harness [--session <name>] status-timeline [--output-path <path>]',
      '  harness [--session <name>] render-trace start [--output-path <path>] [--conversation-id <id>]',
      '  harness [--session <name>] render-trace stop',
      '  harness [--session <name>] render-trace [--output-path <path>] [--conversation-id <id>]',
      '  harness update',
      '  harness upgrade',
      '  harness cursor-hooks install [--hooks-file <path>]',
      '  harness cursor-hooks uninstall [--hooks-file <path>]',
      '  harness animate [--fps <fps>] [--frames <count>] [--duration-ms <ms>] [--seed <seed>] [--no-color]',
      '',
      'session naming:',
      '  --session accepts [A-Za-z0-9][A-Za-z0-9._-]{0,63} and isolates gateway record/log/db paths.',
    ].join('\n') + '\n',
  );
}

function resolveScriptPath(
  envValue: string | undefined,
  fallback: string,
  invocationDirectory: string,
): string {
  if (typeof envValue !== 'string' || envValue.trim().length === 0) {
    return fallback;
  }
  const trimmed = envValue.trim();
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  return resolve(invocationDirectory, trimmed);
}

function readGatewayRecord(recordPath: string): GatewayRecord | null {
  if (!existsSync(recordPath)) {
    return null;
  }
  try {
    const raw = readFileSync(recordPath, 'utf8');
    return parseGatewayRecordText(raw);
  } catch {
    return null;
  }
}

function writeTextFileAtomically(filePath: string, text: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    writeFileSync(tempPath, text, 'utf8');
    renameSync(tempPath, filePath);
  } catch (error: unknown) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
}

function writeGatewayRecord(recordPath: string, record: GatewayRecord): void {
  writeTextFileAtomically(recordPath, serializeGatewayRecord(record));
}

function removeGatewayRecord(recordPath: string): void {
  try {
    unlinkSync(recordPath);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

function parseActiveProfileState(raw: unknown): ActiveProfileState | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate['version'] !== PROFILE_STATE_VERSION) {
    return null;
  }
  if (candidate['mode'] !== PROFILE_LIVE_INSPECT_MODE) {
    return null;
  }
  const pid = candidate['pid'];
  const host = candidate['host'];
  const port = candidate['port'];
  const stateDbPath = candidate['stateDbPath'];
  const profileDir = candidate['profileDir'];
  const gatewayProfilePath = candidate['gatewayProfilePath'];
  const inspectWebSocketUrl = candidate['inspectWebSocketUrl'];
  const startedAt = candidate['startedAt'];
  if (!Number.isInteger(pid) || (pid as number) <= 0) {
    return null;
  }
  if (typeof host !== 'string' || host.length === 0) {
    return null;
  }
  if (!Number.isInteger(port) || (port as number) <= 0 || (port as number) > 65535) {
    return null;
  }
  if (typeof stateDbPath !== 'string' || stateDbPath.length === 0) {
    return null;
  }
  if (typeof profileDir !== 'string' || profileDir.length === 0) {
    return null;
  }
  if (typeof gatewayProfilePath !== 'string' || gatewayProfilePath.length === 0) {
    return null;
  }
  if (typeof inspectWebSocketUrl !== 'string' || inspectWebSocketUrl.length === 0) {
    return null;
  }
  if (typeof startedAt !== 'string' || startedAt.length === 0) {
    return null;
  }
  return {
    version: PROFILE_STATE_VERSION,
    mode: PROFILE_LIVE_INSPECT_MODE,
    pid: pid as number,
    host,
    port: port as number,
    stateDbPath,
    profileDir,
    gatewayProfilePath,
    inspectWebSocketUrl,
    startedAt,
  };
}

function readActiveProfileState(profileStatePath: string): ActiveProfileState | null {
  if (!existsSync(profileStatePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(profileStatePath, 'utf8')) as unknown;
    return parseActiveProfileState(raw);
  } catch {
    return null;
  }
}

function writeActiveProfileState(profileStatePath: string, state: ActiveProfileState): void {
  writeTextFileAtomically(profileStatePath, `${JSON.stringify(state, null, 2)}\n`);
}

function removeActiveProfileState(profileStatePath: string): void {
  removeFileIfExists(profileStatePath);
}

function readActiveStatusTimelineState(statePath: string): ActiveStatusTimelineState | null {
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as unknown;
    const parsed = parseActiveStatusTimelineState(raw);
    if (parsed === null) {
      return null;
    }
    return {
      version: parsed.version,
      mode: parsed.mode,
      outputPath: parsed.outputPath,
      sessionName: parsed.sessionName,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

function writeActiveStatusTimelineState(statePath: string, state: ActiveStatusTimelineState): void {
  writeTextFileAtomically(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function removeActiveStatusTimelineState(statePath: string): void {
  removeFileIfExists(statePath);
}

function readActiveRenderTraceState(statePath: string): ActiveRenderTraceState | null {
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as unknown;
    const parsed = parseActiveRenderTraceState(raw);
    if (parsed === null) {
      return null;
    }
    return {
      version: parsed.version,
      mode: parsed.mode,
      outputPath: parsed.outputPath,
      sessionName: parsed.sessionName,
      conversationId: parsed.conversationId,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

function writeActiveRenderTraceState(statePath: string, state: ActiveRenderTraceState): void {
  writeTextFileAtomically(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function removeActiveRenderTraceState(statePath: string): void {
  removeFileIfExists(statePath);
}

function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return false;
    }
    return true;
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await delay(DEFAULT_GATEWAY_STOP_POLL_MS);
  }
  return !isPidRunning(pid);
}

async function waitForFileExists(filePath: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) {
      return true;
    }
    await delay(DEFAULT_GATEWAY_STOP_POLL_MS);
  }
  return existsSync(filePath);
}

function signalPidWithOptionalProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
  includeProcessGroup: boolean,
): boolean {
  let sent = false;
  if (includeProcessGroup && pid > 1) {
    try {
      process.kill(-pid, signal);
      sent = true;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH') {
        throw error;
      }
    }
  }

  try {
    process.kill(pid, signal);
    sent = true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') {
      throw error;
    }
  }

  return sent;
}

function readProcessTable(): readonly ProcessTableEntry[] {
  const output = execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
  });
  const lines = output.split('\n');
  const entries: ProcessTableEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const match = /^(\d+)\s+(\d+)\s+(.*)$/u.exec(trimmed);
    if (match === null) {
      continue;
    }
    const pid = Number.parseInt(match[1] ?? '', 10);
    const ppid = Number.parseInt(match[2] ?? '', 10);
    const command = match[3] ?? '';
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(ppid) || ppid < 0) {
      continue;
    }
    entries.push({
      pid,
      ppid,
      command,
    });
  }
  return entries;
}

function findOrphanSqlitePidsForDbPath(stateDbPath: string): readonly number[] {
  const normalizedDbPath = resolve(stateDbPath);
  return readProcessTable()
    .filter((entry) => entry.ppid === 1)
    .filter((entry) => entry.pid !== process.pid)
    .filter((entry) => /\bsqlite3\b/u.test(entry.command))
    .filter((entry) => entry.command.includes(normalizedDbPath))
    .map((entry) => entry.pid);
}

function dedupePids(pids: readonly number[]): readonly number[] {
  return [...new Set(pids)];
}

function resolvePtyHelperPathCandidates(invocationDirectory: string): readonly string[] {
  return [
    resolve(invocationDirectory, 'native/ptyd/target/release/ptyd'),
    resolve(invocationDirectory, 'bin/ptyd'),
  ];
}

function findOrphanGatewayDaemonPids(
  stateDbPath: string,
  daemonScriptPath: string,
): readonly number[] {
  const normalizedDbPath = resolve(stateDbPath);
  const normalizedDaemonScriptPath = resolve(daemonScriptPath);
  return dedupePids(
    readProcessTable()
      .filter((entry) => entry.ppid === 1)
      .filter((entry) => entry.pid !== process.pid)
      .filter((entry) => entry.command.includes('--state-db-path'))
      .filter((entry) => {
        if (entry.command.includes(normalizedDaemonScriptPath)) {
          return true;
        }
        return (
          /\bcontrol-plane-daemon\.(?:ts|js)\b/u.test(entry.command) &&
          entry.command.includes(normalizedDbPath)
        );
      })
      .map((entry) => entry.pid),
  );
}

function findOrphanPtyHelperPidsForWorkspace(invocationDirectory: string): readonly number[] {
  const helperPathCandidates = resolvePtyHelperPathCandidates(invocationDirectory);
  return readProcessTable()
    .filter((entry) => entry.ppid === 1)
    .filter((entry) => entry.pid !== process.pid)
    .filter((entry) => helperPathCandidates.some((candidate) => entry.command.includes(candidate)))
    .map((entry) => entry.pid);
}

function findOrphanRelayLinkedAgentPidsForWorkspace(
  invocationDirectory: string,
): readonly number[] {
  const relayScriptPath = resolve(invocationDirectory, 'scripts/codex-notify-relay.ts');
  return readProcessTable()
    .filter((entry) => entry.ppid === 1)
    .filter((entry) => entry.pid !== process.pid)
    .filter((entry) => entry.command.includes(relayScriptPath))
    .map((entry) => entry.pid);
}

function formatOrphanProcessCleanupResult(
  label: string,
  result: OrphanProcessCleanupResult,
): string {
  if (result.errorMessage !== null) {
    return `${label} cleanup error: ${result.errorMessage}`;
  }
  if (result.matchedPids.length === 0) {
    return `${label} cleanup: none found`;
  }
  if (result.failedPids.length === 0) {
    return `${label} cleanup: terminated ${String(result.terminatedPids.length)} process(es)`;
  }
  return [
    `${label} cleanup:`,
    `matched=${String(result.matchedPids.length)}`,
    `terminated=${String(result.terminatedPids.length)}`,
    `failed=${String(result.failedPids.length)}`,
  ].join(' ');
}

async function cleanupOrphanPids(
  matchedPids: readonly number[],
  options: GatewayStopOptions,
  killProcessGroup = false,
): Promise<OrphanProcessCleanupResult> {
  const terminatedPids: number[] = [];
  const failedPids: number[] = [];

  for (const pid of matchedPids) {
    if (!isPidRunning(pid)) {
      continue;
    }
    const signaledTerm = signalPidWithOptionalProcessGroup(pid, 'SIGTERM', killProcessGroup);
    if (!signaledTerm) {
      terminatedPids.push(pid);
      continue;
    }

    const exitedAfterTerm = await waitForPidExit(pid, options.timeoutMs);
    if (exitedAfterTerm) {
      terminatedPids.push(pid);
      continue;
    }

    if (!options.force) {
      failedPids.push(pid);
      continue;
    }

    const signaledKill = signalPidWithOptionalProcessGroup(pid, 'SIGKILL', killProcessGroup);
    if (!signaledKill) {
      terminatedPids.push(pid);
      continue;
    }

    if (await waitForPidExit(pid, options.timeoutMs)) {
      terminatedPids.push(pid);
    } else {
      failedPids.push(pid);
    }
  }

  return {
    matchedPids,
    terminatedPids,
    failedPids,
    errorMessage: null,
  };
}

async function cleanupOrphanSqliteProcessesForDbPath(
  stateDbPath: string,
  options: GatewayStopOptions,
): Promise<OrphanProcessCleanupResult> {
  let matchedPids: readonly number[] = [];
  try {
    matchedPids = findOrphanSqlitePidsForDbPath(stateDbPath);
  } catch (error: unknown) {
    return {
      matchedPids: [],
      terminatedPids: [],
      failedPids: [],
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
  return await cleanupOrphanPids(matchedPids, options, false);
}

async function cleanupOrphanGatewayDaemons(
  stateDbPath: string,
  daemonScriptPath: string,
  options: GatewayStopOptions,
): Promise<OrphanProcessCleanupResult> {
  let matchedPids: readonly number[] = [];
  try {
    matchedPids = findOrphanGatewayDaemonPids(stateDbPath, daemonScriptPath);
  } catch (error: unknown) {
    return {
      matchedPids: [],
      terminatedPids: [],
      failedPids: [],
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
  return await cleanupOrphanPids(matchedPids, options, true);
}

async function cleanupOrphanPtyHelpersForWorkspace(
  invocationDirectory: string,
  options: GatewayStopOptions,
): Promise<OrphanProcessCleanupResult> {
  let matchedPids: readonly number[] = [];
  try {
    matchedPids = findOrphanPtyHelperPidsForWorkspace(invocationDirectory);
  } catch (error: unknown) {
    return {
      matchedPids: [],
      terminatedPids: [],
      failedPids: [],
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
  return await cleanupOrphanPids(matchedPids, options, false);
}

async function cleanupOrphanRelayLinkedAgentsForWorkspace(
  invocationDirectory: string,
  options: GatewayStopOptions,
): Promise<OrphanProcessCleanupResult> {
  let matchedPids: readonly number[] = [];
  try {
    matchedPids = findOrphanRelayLinkedAgentPidsForWorkspace(invocationDirectory);
  } catch (error: unknown) {
    return {
      matchedPids: [],
      terminatedPids: [],
      failedPids: [],
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
  return await cleanupOrphanPids(matchedPids, options, false);
}

function resolveGatewaySettings(
  invocationDirectory: string,
  record: GatewayRecord | null,
  overrides: GatewayStartOptions,
  env: NodeJS.ProcessEnv,
  defaultStateDbPath: string,
): ResolvedGatewaySettings {
  const host = normalizeGatewayHost(
    overrides.host ?? record?.host ?? env.HARNESS_CONTROL_PLANE_HOST,
  );
  const port = normalizeGatewayPort(
    overrides.port ?? record?.port ?? env.HARNESS_CONTROL_PLANE_PORT,
  );
  const configuredStateDbPath =
    overrides.stateDbPath ?? env.HARNESS_CONTROL_PLANE_DB_PATH ?? defaultStateDbPath;
  const stateDbPathRaw = normalizeGatewayStateDbPath(configuredStateDbPath, defaultStateDbPath);
  const stateDbPath = resolveHarnessRuntimePath(invocationDirectory, stateDbPathRaw, env);

  const envToken =
    typeof env.HARNESS_CONTROL_PLANE_AUTH_TOKEN === 'string' &&
    env.HARNESS_CONTROL_PLANE_AUTH_TOKEN.trim().length > 0
      ? env.HARNESS_CONTROL_PLANE_AUTH_TOKEN.trim()
      : null;
  const explicitToken = overrides.authToken ?? record?.authToken ?? envToken;
  const authToken = explicitToken ?? (isLoopbackHost(host) ? `gateway-${randomUUID()}` : null);

  if (!isLoopbackHost(host) && authToken === null) {
    throw new Error('non-loopback hosts require --auth-token or HARNESS_CONTROL_PLANE_AUTH_TOKEN');
  }

  return {
    host,
    port,
    authToken,
    stateDbPath,
  };
}

async function probeGateway(record: GatewayRecord): Promise<GatewayProbeResult> {
  try {
    const client = await connectControlPlaneStreamClient({
      host: record.host,
      port: record.port,
      ...(record.authToken !== null
        ? {
            authToken: record.authToken,
          }
        : {}),
    });
    try {
      const result = await client.sendCommand({
        type: 'session.list',
      });
      const sessionsRaw = result['sessions'];
      if (!Array.isArray(sessionsRaw)) {
        return {
          connected: true,
          sessionCount: 0,
          liveSessionCount: 0,
          error: null,
        };
      }
      let liveCount = 0;
      for (const session of sessionsRaw) {
        if (
          typeof session === 'object' &&
          session !== null &&
          (session as Record<string, unknown>)['live'] === true
        ) {
          liveCount += 1;
        }
      }
      return {
        connected: true,
        sessionCount: sessionsRaw.length,
        liveSessionCount: liveCount,
        error: null,
      };
    } finally {
      client.close();
    }
  } catch (error: unknown) {
    return {
      connected: false,
      sessionCount: 0,
      liveSessionCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForGatewayReady(record: GatewayRecord): Promise<void> {
  const client = await connectControlPlaneStreamClient({
    host: record.host,
    port: record.port,
    ...(record.authToken !== null
      ? {
          authToken: record.authToken,
        }
      : {}),
    connectRetryWindowMs: DEFAULT_GATEWAY_START_RETRY_WINDOW_MS,
    connectRetryDelayMs: DEFAULT_GATEWAY_START_RETRY_DELAY_MS,
  });
  try {
    await client.sendCommand({
      type: 'session.list',
      limit: 1,
    });
  } finally {
    client.close();
  }
}

async function startDetachedGateway(
  invocationDirectory: string,
  recordPath: string,
  logPath: string,
  settings: ResolvedGatewaySettings,
  daemonScriptPath: string,
  runtimeArgs: readonly string[] = [],
): Promise<GatewayRecord> {
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');
  const daemonArgs = tsRuntimeArgs(
    daemonScriptPath,
    [
      '--host',
      settings.host,
      '--port',
      String(settings.port),
      '--state-db-path',
      settings.stateDbPath,
    ],
    runtimeArgs,
  );
  if (settings.authToken !== null) {
    daemonArgs.push('--auth-token', settings.authToken);
  }
  const child = spawn(process.execPath, daemonArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      HARNESS_INVOKE_CWD: invocationDirectory,
    },
  });
  closeSync(logFd);

  if (child.pid === undefined) {
    throw new Error('failed to start gateway daemon (missing pid)');
  }

  const record: GatewayRecord = {
    version: GATEWAY_RECORD_VERSION,
    pid: child.pid,
    host: settings.host,
    port: settings.port,
    authToken: settings.authToken,
    stateDbPath: settings.stateDbPath,
    startedAt: new Date().toISOString(),
    workspaceRoot: invocationDirectory,
  };

  try {
    await waitForGatewayReady(record);
  } catch (error: unknown) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }

  writeGatewayRecord(recordPath, record);
  child.unref();
  return record;
}

async function ensureGatewayRunning(
  invocationDirectory: string,
  recordPath: string,
  logPath: string,
  daemonScriptPath: string,
  defaultStateDbPath: string,
  overrides: GatewayStartOptions = {},
  daemonRuntimeArgs: readonly string[] = [],
): Promise<EnsureGatewayResult> {
  const existingRecord = readGatewayRecord(recordPath);
  if (existingRecord !== null) {
    const probe = await probeGateway(existingRecord);
    if (probe.connected) {
      return {
        record: existingRecord,
        started: false,
      };
    }
    if (isPidRunning(existingRecord.pid)) {
      throw new Error(
        `gateway record is present but unreachable (pid=${String(existingRecord.pid)} still running): ${probe.error ?? 'unknown error'}`,
      );
    }
    removeGatewayRecord(recordPath);
  }

  const settings = resolveGatewaySettings(
    invocationDirectory,
    existingRecord,
    overrides,
    process.env,
    defaultStateDbPath,
  );
  const record = await startDetachedGateway(
    invocationDirectory,
    recordPath,
    logPath,
    settings,
    daemonScriptPath,
    daemonRuntimeArgs,
  );
  return {
    record,
    started: true,
  };
}

async function stopGateway(
  invocationDirectory: string,
  daemonScriptPath: string,
  recordPath: string,
  defaultStateDbPath: string,
  options: GatewayStopOptions,
): Promise<{ stopped: boolean; message: string }> {
  const appendCleanupSummary = async (
    baseMessage: string,
    stateDbPath: string,
  ): Promise<string> => {
    if (!options.cleanupOrphans) {
      return baseMessage;
    }
    const [gatewayCleanupResult, ptyCleanupResult, relayCleanupResult, sqliteCleanupResult] =
      await Promise.all([
        cleanupOrphanGatewayDaemons(stateDbPath, daemonScriptPath, options),
        cleanupOrphanPtyHelpersForWorkspace(invocationDirectory, options),
        cleanupOrphanRelayLinkedAgentsForWorkspace(invocationDirectory, options),
        cleanupOrphanSqliteProcessesForDbPath(stateDbPath, options),
      ]);
    return [
      baseMessage,
      formatOrphanProcessCleanupResult('orphan gateway daemon', gatewayCleanupResult),
      formatOrphanProcessCleanupResult('orphan pty helper', ptyCleanupResult),
      formatOrphanProcessCleanupResult('orphan relay-linked agent', relayCleanupResult),
      formatOrphanProcessCleanupResult('orphan sqlite', sqliteCleanupResult),
    ].join('; ');
  };

  const record = readGatewayRecord(recordPath);
  if (record === null) {
    return {
      stopped: false,
      message: await appendCleanupSummary('gateway not running (no record)', defaultStateDbPath),
    };
  }

  const probe = await probeGateway(record);
  const pidRunning = isPidRunning(record.pid);

  if (!probe.connected && pidRunning && !options.force) {
    return {
      stopped: false,
      message: `gateway record points to a running but unreachable process (pid=${String(record.pid)}); re-run with --force`,
    };
  }

  if (!pidRunning) {
    removeGatewayRecord(recordPath);
    return {
      stopped: true,
      message: await appendCleanupSummary('removed stale gateway record', record.stateDbPath),
    };
  }

  const signaledTerm = signalPidWithOptionalProcessGroup(record.pid, 'SIGTERM', true);
  if (!signaledTerm) {
    removeGatewayRecord(recordPath);
    return {
      stopped: true,
      message: await appendCleanupSummary('gateway already exited', record.stateDbPath),
    };
  }

  const exitedAfterTerm = await waitForPidExit(record.pid, options.timeoutMs);
  if (!exitedAfterTerm && options.force) {
    signalPidWithOptionalProcessGroup(record.pid, 'SIGKILL', true);
    const exitedAfterKill = await waitForPidExit(record.pid, options.timeoutMs);
    if (!exitedAfterKill) {
      return {
        stopped: false,
        message: `gateway did not exit after SIGKILL (pid=${String(record.pid)})`,
      };
    }
  } else if (!exitedAfterTerm) {
    return {
      stopped: false,
      message: `gateway did not exit after ${String(options.timeoutMs)}ms; retry with --force`,
    };
  }

  removeGatewayRecord(recordPath);
  return {
    stopped: true,
    message: await appendCleanupSummary(
      `gateway stopped (pid=${String(record.pid)})`,
      record.stateDbPath,
    ),
  };
}

async function runMuxClient(
  muxScriptPath: string,
  invocationDirectory: string,
  gateway: GatewayRecord,
  passthroughArgs: readonly string[],
  sessionName: string | null,
  runtimeArgs: readonly string[] = [],
): Promise<number> {
  const args = tsRuntimeArgs(
    muxScriptPath,
    [
      '--harness-server-host',
      gateway.host,
      '--harness-server-port',
      String(gateway.port),
      ...(gateway.authToken === null ? [] : ['--harness-server-token', gateway.authToken]),
      ...passthroughArgs,
    ],
    runtimeArgs,
  );

  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      HARNESS_INVOKE_CWD: invocationDirectory,
      ...(sessionName === null ? {} : { HARNESS_SESSION_NAME: sessionName }),
    },
  });
  const exit = await once(child, 'exit');
  const code = (exit[0] as number | null) ?? null;
  const signal = (exit[1] as NodeJS.Signals | null) ?? null;
  if (code !== null) {
    return code;
  }
  return normalizeSignalExitCode(signal);
}

async function runGatewayForeground(
  daemonScriptPath: string,
  invocationDirectory: string,
  recordPath: string,
  settings: ResolvedGatewaySettings,
  runtimeArgs: readonly string[] = [],
): Promise<number> {
  const existingRecord = readGatewayRecord(recordPath);
  if (existingRecord !== null) {
    const probe = await probeGateway(existingRecord);
    if (probe.connected || isPidRunning(existingRecord.pid)) {
      throw new Error('gateway is already running; stop it first or use `harness gateway start`');
    }
    removeGatewayRecord(recordPath);
  }

  const daemonArgs = tsRuntimeArgs(
    daemonScriptPath,
    [
      '--host',
      settings.host,
      '--port',
      String(settings.port),
      '--state-db-path',
      settings.stateDbPath,
    ],
    runtimeArgs,
  );
  if (settings.authToken !== null) {
    daemonArgs.push('--auth-token', settings.authToken);
  }

  const child = spawn(process.execPath, daemonArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      HARNESS_INVOKE_CWD: invocationDirectory,
    },
  });
  if (child.pid !== undefined) {
    writeGatewayRecord(recordPath, {
      version: GATEWAY_RECORD_VERSION,
      pid: child.pid,
      host: settings.host,
      port: settings.port,
      authToken: settings.authToken,
      stateDbPath: settings.stateDbPath,
      startedAt: new Date().toISOString(),
      workspaceRoot: invocationDirectory,
    });
  }

  const exit = await once(child, 'exit');
  const code = (exit[0] as number | null) ?? null;
  const signal = (exit[1] as NodeJS.Signals | null) ?? null;
  const record = readGatewayRecord(recordPath);
  if (record !== null && child.pid !== undefined && record.pid === child.pid) {
    removeGatewayRecord(recordPath);
  }
  if (code !== null) {
    return code;
  }
  return normalizeSignalExitCode(signal);
}

function parseCallCommand(raw: string): StreamCommand {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(
      `invalid JSON command: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const command = parseStreamCommand(parsed);
  if (command === null) {
    throw new Error('invalid stream command payload');
  }
  return command;
}

async function executeGatewayCall(record: GatewayRecord, rawCommand: string): Promise<number> {
  const command = parseCallCommand(rawCommand);
  const client = await connectControlPlaneStreamClient({
    host: record.host,
    port: record.port,
    ...(record.authToken === null
      ? {}
      : {
          authToken: record.authToken,
        }),
  });
  try {
    const result = await client.sendCommand(command);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    client.close();
  }
  return 0;
}

async function runGatewayCommandEntry(
  command: ParsedGatewayCommand,
  invocationDirectory: string,
  daemonScriptPath: string,
  recordPath: string,
  logPath: string,
  defaultStateDbPath: string,
  runtimeOptions: RuntimeInspectOptions,
): Promise<number> {
  if (command.type === 'status') {
    const record = readGatewayRecord(recordPath);
    if (record === null) {
      process.stdout.write('gateway status: stopped\n');
      return 0;
    }
    const pidRunning = isPidRunning(record.pid);
    const probe = await probeGateway(record);
    process.stdout.write(`gateway status: ${probe.connected ? 'running' : 'unreachable'}\n`);
    process.stdout.write(`record: ${recordPath}\n`);
    process.stdout.write(
      `pid: ${String(record.pid)} (${pidRunning ? 'running' : 'not-running'})\n`,
    );
    process.stdout.write(`host: ${record.host}\n`);
    process.stdout.write(`port: ${String(record.port)}\n`);
    process.stdout.write(`auth: ${record.authToken === null ? 'off' : 'on'}\n`);
    process.stdout.write(`db: ${record.stateDbPath}\n`);
    process.stdout.write(`startedAt: ${record.startedAt}\n`);
    process.stdout.write(
      `sessions: total=${String(probe.sessionCount)} live=${String(probe.liveSessionCount)}\n`,
    );
    if (!probe.connected) {
      process.stdout.write(`lastError: ${probe.error ?? 'unknown'}\n`);
      return 1;
    }
    return 0;
  }

  if (command.type === 'stop') {
    const stopOptions = command.stopOptions ?? {
      force: false,
      timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
      cleanupOrphans: true,
    };
    const stopped = await stopGateway(
      invocationDirectory,
      daemonScriptPath,
      recordPath,
      defaultStateDbPath,
      stopOptions,
    );
    process.stdout.write(`${stopped.message}\n`);
    return stopped.stopped ? 0 : 1;
  }

  if (command.type === 'start') {
    const ensured = await ensureGatewayRunning(
      invocationDirectory,
      recordPath,
      logPath,
      daemonScriptPath,
      defaultStateDbPath,
      command.startOptions ?? {},
      runtimeOptions.gatewayRuntimeArgs,
    );
    if (ensured.started) {
      process.stdout.write(
        `gateway started pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`,
      );
    } else {
      process.stdout.write(
        `gateway already running pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`,
      );
    }
    process.stdout.write(`record: ${recordPath}\n`);
    process.stdout.write(`log: ${logPath}\n`);
    return 0;
  }

  if (command.type === 'restart') {
    const stopResult = await stopGateway(
      invocationDirectory,
      daemonScriptPath,
      recordPath,
      defaultStateDbPath,
      {
        force: true,
        timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
        cleanupOrphans: true,
      },
    );
    process.stdout.write(`${stopResult.message}\n`);
    const ensured = await ensureGatewayRunning(
      invocationDirectory,
      recordPath,
      logPath,
      daemonScriptPath,
      defaultStateDbPath,
      command.startOptions ?? {},
      runtimeOptions.gatewayRuntimeArgs,
    );
    process.stdout.write(
      `gateway restarted pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`,
    );
    process.stdout.write(`record: ${recordPath}\n`);
    process.stdout.write(`log: ${logPath}\n`);
    return 0;
  }

  if (command.type === 'run') {
    const existingRecord = readGatewayRecord(recordPath);
    const settings = resolveGatewaySettings(
      invocationDirectory,
      existingRecord,
      command.startOptions ?? {},
      process.env,
      defaultStateDbPath,
    );
    process.stdout.write(
      `gateway foreground run host=${settings.host} port=${String(settings.port)} db=${settings.stateDbPath}\n`,
    );
    return await runGatewayForeground(
      daemonScriptPath,
      invocationDirectory,
      recordPath,
      settings,
      runtimeOptions.gatewayRuntimeArgs,
    );
  }

  const record = readGatewayRecord(recordPath);
  if (record === null) {
    throw new Error('gateway not running; start it first');
  }
  if (command.callJson === undefined) {
    throw new Error('missing gateway call json');
  }
  return await executeGatewayCall(record, command.callJson);
}

async function runDefaultClient(
  invocationDirectory: string,
  daemonScriptPath: string,
  muxScriptPath: string,
  recordPath: string,
  logPath: string,
  defaultStateDbPath: string,
  args: readonly string[],
  sessionName: string | null,
  runtimeOptions: RuntimeInspectOptions,
): Promise<number> {
  const ensured = await ensureGatewayRunning(
    invocationDirectory,
    recordPath,
    logPath,
    daemonScriptPath,
    defaultStateDbPath,
    {},
    runtimeOptions.gatewayRuntimeArgs,
  );
  if (ensured.started) {
    process.stdout.write(
      `gateway started pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`,
    );
  }
  return await runMuxClient(
    muxScriptPath,
    invocationDirectory,
    ensured.record,
    args,
    sessionName,
    runtimeOptions.clientRuntimeArgs,
  );
}

async function runProfileRun(
  invocationDirectory: string,
  daemonScriptPath: string,
  muxScriptPath: string,
  sessionPaths: SessionPaths,
  command: ParsedProfileRunCommand,
  sessionName: string | null,
  runtimeOptions: RuntimeInspectOptions,
): Promise<number> {
  const profileDir =
    command.profileDir === null
      ? sessionPaths.profileDir
      : resolve(invocationDirectory, command.profileDir);
  mkdirSync(profileDir, { recursive: true });

  const clientProfilePath = resolve(profileDir, PROFILE_CLIENT_FILE_NAME);
  const gatewayProfilePath = resolve(profileDir, PROFILE_GATEWAY_FILE_NAME);
  removeFileIfExists(clientProfilePath);
  removeFileIfExists(gatewayProfilePath);

  const existingProfileState = readActiveProfileState(sessionPaths.profileStatePath);
  if (existingProfileState !== null) {
    if (isPidRunning(existingProfileState.pid)) {
      throw new Error(
        'profile run requires no active profile session; stop it first with `harness profile stop`',
      );
    }
    removeActiveProfileState(sessionPaths.profileStatePath);
  }

  const existingRecord = readGatewayRecord(sessionPaths.recordPath);
  if (existingRecord !== null) {
    const existingProbe = await probeGateway(existingRecord);
    if (existingProbe.connected || isPidRunning(existingRecord.pid)) {
      throw new Error('profile command requires the target session gateway to be stopped first');
    }
    removeGatewayRecord(sessionPaths.recordPath);
  }

  const host = normalizeGatewayHost(process.env.HARNESS_CONTROL_PLANE_HOST);
  const reservedPort = await reservePort(host);
  const settings = resolveGatewaySettings(
    invocationDirectory,
    null,
    {
      port: reservedPort,
      stateDbPath: sessionPaths.defaultStateDbPath,
    },
    process.env,
    sessionPaths.defaultStateDbPath,
  );

  const gateway = await startDetachedGateway(
    invocationDirectory,
    sessionPaths.recordPath,
    sessionPaths.logPath,
    settings,
    daemonScriptPath,
    [
      ...runtimeOptions.gatewayRuntimeArgs,
      ...buildCpuProfileRuntimeArgs({
        cpuProfileDir: profileDir,
        cpuProfileName: PROFILE_GATEWAY_FILE_NAME,
      }),
    ],
  );

  let clientExitCode = 1;
  let clientError: Error | null = null;
  try {
    clientExitCode = await runMuxClient(
      muxScriptPath,
      invocationDirectory,
      gateway,
      command.muxArgs,
      sessionName,
      [
        ...runtimeOptions.clientRuntimeArgs,
        ...buildCpuProfileRuntimeArgs({
          cpuProfileDir: profileDir,
          cpuProfileName: PROFILE_CLIENT_FILE_NAME,
        }),
      ],
    );
  } catch (error: unknown) {
    clientError = error instanceof Error ? error : new Error(String(error));
  }

  const stopped = await stopGateway(
    invocationDirectory,
    daemonScriptPath,
    sessionPaths.recordPath,
    sessionPaths.defaultStateDbPath,
    {
      force: true,
      timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
      cleanupOrphans: true,
    },
  );
  process.stdout.write(`${stopped.message}\n`);
  if (!stopped.stopped) {
    throw new Error(`failed to stop profile gateway: ${stopped.message}`);
  }
  if (clientError !== null) {
    throw clientError;
  }
  if (!existsSync(clientProfilePath)) {
    throw new Error(`missing client CPU profile: ${clientProfilePath}`);
  }
  if (!existsSync(gatewayProfilePath)) {
    throw new Error(`missing gateway CPU profile: ${gatewayProfilePath}`);
  }

  process.stdout.write(`profiles: client=${clientProfilePath} gateway=${gatewayProfilePath}\n`);
  return clientExitCode;
}

async function runProfileStart(
  invocationDirectory: string,
  sessionPaths: SessionPaths,
  command: ParsedProfileStartCommand,
): Promise<number> {
  const profileDir =
    command.profileDir === null
      ? sessionPaths.profileDir
      : resolve(invocationDirectory, command.profileDir);
  mkdirSync(profileDir, { recursive: true });
  const gatewayProfilePath = resolve(profileDir, PROFILE_GATEWAY_FILE_NAME);
  removeFileIfExists(gatewayProfilePath);

  const existingProfileState = readActiveProfileState(sessionPaths.profileStatePath);
  if (existingProfileState !== null) {
    if (isPidRunning(existingProfileState.pid)) {
      throw new Error('profile already running; stop it first with `harness profile stop`');
    }
    removeActiveProfileState(sessionPaths.profileStatePath);
  }

  const existingRecord = readGatewayRecord(sessionPaths.recordPath);
  if (existingRecord === null) {
    throw new Error('profile start requires the target session gateway to be running');
  }
  const existingProbe = await probeGateway(existingRecord);
  if (!existingProbe.connected || !isPidRunning(existingRecord.pid)) {
    throw new Error('profile start requires the target session gateway to be running');
  }
  const inspector = await connectGatewayInspector(
    invocationDirectory,
    sessionPaths.logPath,
    DEFAULT_PROFILE_INSPECT_TIMEOUT_MS,
  );
  try {
    const startCommandRaw = await evaluateInspectorExpression(
      inspector.client,
      buildInspectorProfileStartExpression(),
      DEFAULT_PROFILE_INSPECT_TIMEOUT_MS,
    );
    if (typeof startCommandRaw !== 'string') {
      throw new Error('failed to start gateway profiler (invalid inspector response)');
    }
    const startCommandResult = JSON.parse(startCommandRaw) as Record<string, unknown>;
    if (startCommandResult['ok'] !== true) {
      const reason = startCommandResult['reason'];
      throw new Error(
        `failed to start gateway profiler (${typeof reason === 'string' ? reason : 'unknown reason'})`,
      );
    }

    const startDeadline = Date.now() + DEFAULT_PROFILE_INSPECT_TIMEOUT_MS;
    let runningState: InspectorProfileState | null = null;
    while (Date.now() < startDeadline) {
      const state = await readInspectorProfileState(
        inspector.client,
        DEFAULT_PROFILE_INSPECT_TIMEOUT_MS,
      );
      if (state !== null && state.status === 'running') {
        runningState = state;
        break;
      }
      if (state !== null && state.status === 'failed') {
        throw new Error(`failed to start gateway profiler (${state.error ?? 'unknown error'})`);
      }
      await delay(DEFAULT_GATEWAY_STOP_POLL_MS);
    }
    if (runningState === null) {
      throw new Error('failed to start gateway profiler (inspector runtime timeout)');
    }
  } finally {
    inspector.client.close();
  }

  writeActiveProfileState(sessionPaths.profileStatePath, {
    version: PROFILE_STATE_VERSION,
    mode: PROFILE_LIVE_INSPECT_MODE,
    pid: existingRecord.pid,
    host: existingRecord.host,
    port: existingRecord.port,
    stateDbPath: existingRecord.stateDbPath,
    profileDir,
    gatewayProfilePath,
    inspectWebSocketUrl: inspector.endpoint,
    startedAt: new Date().toISOString(),
  });

  process.stdout.write(
    `profile started pid=${String(existingRecord.pid)} host=${existingRecord.host} port=${String(existingRecord.port)}\n`,
  );
  process.stdout.write(`record: ${sessionPaths.recordPath}\n`);
  process.stdout.write(`log: ${sessionPaths.logPath}\n`);
  process.stdout.write(`profile-state: ${sessionPaths.profileStatePath}\n`);
  process.stdout.write(`profile-target: ${gatewayProfilePath}\n`);
  process.stdout.write('stop with: harness profile stop\n');
  return 0;
}

async function runProfileStop(
  sessionPaths: SessionPaths,
  command: ParsedProfileStopCommand,
): Promise<number> {
  const profileState = readActiveProfileState(sessionPaths.profileStatePath);
  if (profileState === null) {
    throw new Error(
      'no active profile run for this session; start one with `harness profile start`',
    );
  }
  if (profileState.mode !== PROFILE_LIVE_INSPECT_MODE) {
    throw new Error('active profile run is incompatible with this harness version');
  }
  const inspector = await InspectorWebSocketClient.connect(
    profileState.inspectWebSocketUrl,
    command.stopOptions.timeoutMs,
  );
  try {
    await inspector.sendCommand('Runtime.enable', {}, command.stopOptions.timeoutMs);
    const stopCommandRaw = await evaluateInspectorExpression(
      inspector,
      buildInspectorProfileStopExpression(profileState.gatewayProfilePath, profileState.profileDir),
      command.stopOptions.timeoutMs,
    );
    if (typeof stopCommandRaw !== 'string') {
      throw new Error('failed to stop gateway profiler (invalid inspector response)');
    }
    const stopCommandResult = JSON.parse(stopCommandRaw) as Record<string, unknown>;
    if (stopCommandResult['ok'] !== true) {
      const reason = stopCommandResult['reason'];
      throw new Error(
        `failed to stop gateway profiler (${typeof reason === 'string' ? reason : 'unknown reason'})`,
      );
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < command.stopOptions.timeoutMs) {
      const state = await readInspectorProfileState(inspector, command.stopOptions.timeoutMs);
      if (state !== null && state.status === 'failed') {
        throw new Error(`failed to stop gateway profiler (${state.error ?? 'unknown error'})`);
      }
      if (state !== null && state.status === 'stopped' && state.written) {
        break;
      }
      await delay(DEFAULT_GATEWAY_STOP_POLL_MS);
    }
  } finally {
    inspector.close();
  }

  const profileFlushed = await waitForFileExists(
    profileState.gatewayProfilePath,
    command.stopOptions.timeoutMs,
  );
  if (!profileFlushed) {
    throw new Error(`missing gateway CPU profile: ${profileState.gatewayProfilePath}`);
  }

  removeActiveProfileState(sessionPaths.profileStatePath);
  process.stdout.write(`profile: gateway=${profileState.gatewayProfilePath}\n`);
  return 0;
}

async function runProfileCommandEntry(
  invocationDirectory: string,
  daemonScriptPath: string,
  muxScriptPath: string,
  sessionPaths: SessionPaths,
  args: readonly string[],
  sessionName: string | null,
  runtimeOptions: RuntimeInspectOptions,
): Promise<number> {
  if (args.length > 0 && (args[0] === '--help' || args[0] === '-h')) {
    printUsage();
    return 0;
  }
  const command = parseProfileCommand(args);
  if (command.type === 'start') {
    return await runProfileStart(invocationDirectory, sessionPaths, command);
  }
  if (command.type === 'stop') {
    return await runProfileStop(sessionPaths, command);
  }
  return await runProfileRun(
    invocationDirectory,
    daemonScriptPath,
    muxScriptPath,
    sessionPaths,
    command,
    sessionName,
    runtimeOptions,
  );
}

async function runStatusTimelineStart(
  invocationDirectory: string,
  sessionPaths: SessionPaths,
  sessionName: string | null,
  command: ParsedStatusTimelineStartCommand,
): Promise<number> {
  const outputPath =
    command.outputPath === null
      ? sessionPaths.defaultStatusTimelineOutputPath
      : resolve(invocationDirectory, command.outputPath);
  const existingState = readActiveStatusTimelineState(sessionPaths.statusTimelineStatePath);
  if (existingState !== null) {
    throw new Error(
      'status timeline already running; stop it first with `harness status-timeline stop`',
    );
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, '', 'utf8');
  writeActiveStatusTimelineState(sessionPaths.statusTimelineStatePath, {
    version: STATUS_TIMELINE_STATE_VERSION,
    mode: STATUS_TIMELINE_MODE,
    outputPath,
    sessionName,
    startedAt: new Date().toISOString(),
  });
  process.stdout.write('status timeline started\n');
  process.stdout.write(`status-timeline-state: ${sessionPaths.statusTimelineStatePath}\n`);
  process.stdout.write(`status-timeline-target: ${outputPath}\n`);
  process.stdout.write('stop with: harness status-timeline stop\n');
  return 0;
}

async function runStatusTimelineStop(sessionPaths: SessionPaths): Promise<number> {
  const state = readActiveStatusTimelineState(sessionPaths.statusTimelineStatePath);
  if (state === null) {
    throw new Error(
      'no active status timeline run for this session; start one with `harness status-timeline start`',
    );
  }
  removeActiveStatusTimelineState(sessionPaths.statusTimelineStatePath);
  process.stdout.write(`status timeline stopped: ${state.outputPath}\n`);
  return 0;
}

async function runStatusTimelineCommandEntry(
  invocationDirectory: string,
  sessionPaths: SessionPaths,
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  if (args.length > 0 && (args[0] === '--help' || args[0] === '-h')) {
    printUsage();
    return 0;
  }
  const command = parseStatusTimelineCommand(args);
  if (command.type === 'stop') {
    return await runStatusTimelineStop(sessionPaths);
  }
  return await runStatusTimelineStart(invocationDirectory, sessionPaths, sessionName, command);
}

async function runRenderTraceStart(
  invocationDirectory: string,
  sessionPaths: SessionPaths,
  sessionName: string | null,
  command: ParsedRenderTraceStartCommand,
): Promise<number> {
  const outputPath =
    command.outputPath === null
      ? sessionPaths.defaultRenderTraceOutputPath
      : resolve(invocationDirectory, command.outputPath);
  const existingState = readActiveRenderTraceState(sessionPaths.renderTraceStatePath);
  if (existingState !== null) {
    throw new Error('render trace already running; stop it first with `harness render-trace stop`');
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, '', 'utf8');
  writeActiveRenderTraceState(sessionPaths.renderTraceStatePath, {
    version: RENDER_TRACE_STATE_VERSION,
    mode: RENDER_TRACE_MODE,
    outputPath,
    sessionName,
    conversationId: command.conversationId,
    startedAt: new Date().toISOString(),
  });
  process.stdout.write('render trace started\n');
  process.stdout.write(`render-trace-state: ${sessionPaths.renderTraceStatePath}\n`);
  process.stdout.write(`render-trace-target: ${outputPath}\n`);
  if (command.conversationId !== null) {
    process.stdout.write(`render-trace-conversation-id: ${command.conversationId}\n`);
  }
  process.stdout.write('stop with: harness render-trace stop\n');
  return 0;
}

async function runRenderTraceStop(sessionPaths: SessionPaths): Promise<number> {
  const state = readActiveRenderTraceState(sessionPaths.renderTraceStatePath);
  if (state === null) {
    throw new Error(
      'no active render trace run for this session; start one with `harness render-trace start`',
    );
  }
  removeActiveRenderTraceState(sessionPaths.renderTraceStatePath);
  process.stdout.write(`render trace stopped: ${state.outputPath}\n`);
  return 0;
}

async function runRenderTraceCommandEntry(
  invocationDirectory: string,
  sessionPaths: SessionPaths,
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  if (args.length > 0 && (args[0] === '--help' || args[0] === '-h')) {
    printUsage();
    return 0;
  }
  const command = parseRenderTraceCommand(args);
  if (command.type === 'stop') {
    return await runRenderTraceStop(sessionPaths);
  }
  return await runRenderTraceStart(invocationDirectory, sessionPaths, sessionName, command);
}

async function runCursorHooksCommandEntry(
  invocationDirectory: string,
  command: ParsedCursorHooksCommand,
): Promise<number> {
  const hooksFilePath =
    command.hooksFilePath === null
      ? undefined
      : resolve(invocationDirectory, command.hooksFilePath);
  if (command.type === 'install') {
    const relayScriptPath = resolveScriptPath(
      process.env.HARNESS_CURSOR_HOOK_RELAY_SCRIPT_PATH,
      DEFAULT_CURSOR_HOOK_RELAY_SCRIPT_PATH,
      invocationDirectory,
    );
    const result = ensureManagedCursorHooksInstalled({
      relayCommand: buildCursorManagedHookRelayCommand(relayScriptPath),
      ...(hooksFilePath === undefined ? {} : { hooksFilePath }),
    });
    process.stdout.write(
      `cursor hooks install: ${result.changed ? 'updated' : 'already up-to-date'} file=${result.filePath} removed=${String(result.removedCount)} added=${String(result.addedCount)}\n`,
    );
    return 0;
  }
  const result = uninstallManagedCursorHooks(hooksFilePath === undefined ? {} : { hooksFilePath });
  process.stdout.write(
    `cursor hooks uninstall: ${result.changed ? 'updated' : 'no changes'} file=${result.filePath} removed=${String(result.removedCount)}\n`,
  );
  return 0;
}

async function main(): Promise<number> {
  const invocationDirectory = resolveInvocationDirectory(process.env, process.cwd());
  const migration = migrateLegacyHarnessLayout(invocationDirectory, process.env);
  if (migration.migrated) {
    process.stdout.write(
      `[migration] local .harness migrated to global runtime layout (${String(migration.migratedEntries)} entries, configCopied=${String(migration.configCopied)}, secretsCopied=${String(migration.secretsCopied)})\n`,
    );
  }
  loadHarnessSecrets({ cwd: invocationDirectory });
  const runtimeOptions = resolveInspectRuntimeOptions(invocationDirectory);
  const daemonScriptPath = resolveScriptPath(
    process.env.HARNESS_DAEMON_SCRIPT_PATH,
    DEFAULT_DAEMON_SCRIPT_PATH,
    invocationDirectory,
  );
  const muxScriptPath = resolveScriptPath(
    process.env.HARNESS_MUX_SCRIPT_PATH,
    DEFAULT_MUX_SCRIPT_PATH,
    invocationDirectory,
  );

  const parsedGlobals = parseGlobalCliOptions(process.argv.slice(2));
  const sessionPaths = resolveSessionPaths(invocationDirectory, parsedGlobals.sessionName);
  const argv = parsedGlobals.argv;
  if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
    printUsage();
    return 0;
  }

  if (argv.length > 0 && argv[0] === 'gateway') {
    if (argv.length === 1) {
      printUsage();
      return 2;
    }
    const command = parseGatewayCommand(argv.slice(1));
    return await runGatewayCommandEntry(
      command,
      invocationDirectory,
      daemonScriptPath,
      sessionPaths.recordPath,
      sessionPaths.logPath,
      sessionPaths.defaultStateDbPath,
      runtimeOptions,
    );
  }

  if (argv.length > 0 && argv[0] === 'profile') {
    return await runProfileCommandEntry(
      invocationDirectory,
      daemonScriptPath,
      muxScriptPath,
      sessionPaths,
      argv.slice(1),
      parsedGlobals.sessionName,
      runtimeOptions,
    );
  }

  if (argv.length > 0 && argv[0] === 'status-timeline') {
    return await runStatusTimelineCommandEntry(
      invocationDirectory,
      sessionPaths,
      argv.slice(1),
      parsedGlobals.sessionName,
    );
  }

  if (argv.length > 0 && argv[0] === 'render-trace') {
    return await runRenderTraceCommandEntry(
      invocationDirectory,
      sessionPaths,
      argv.slice(1),
      parsedGlobals.sessionName,
    );
  }

  if (argv.length > 0 && (argv[0] === 'update' || argv[0] === 'upgrade')) {
    if (argv.length > 1) {
      throw new Error(`unknown ${argv[0]} option: ${argv[1]}`);
    }
    return runHarnessUpdateCommand(invocationDirectory, process.env);
  }

  if (argv.length > 0 && argv[0] === 'cursor-hooks') {
    const command = parseCursorHooksCommand(argv.slice(1));
    return await runCursorHooksCommandEntry(invocationDirectory, command);
  }

  if (argv.length > 0 && argv[0] === 'animate') {
    return await runHarnessAnimate(argv.slice(1));
  }

  const passthroughArgs = argv[0] === 'client' ? argv.slice(1) : argv;
  return await runDefaultClient(
    invocationDirectory,
    daemonScriptPath,
    muxScriptPath,
    sessionPaths.recordPath,
    sessionPaths.logPath,
    sessionPaths.defaultStateDbPath,
    passthroughArgs,
    parsedGlobals.sessionName,
    runtimeOptions,
  );
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  process.stderr.write(
    `harness fatal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
