import { once } from 'node:events';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import { parseStreamCommand } from '../src/control-plane/stream-command-parser.ts';
import type { StreamCommand } from '../src/control-plane/stream-protocol.ts';
import { diffUiUsage, runDiffUiCli } from '../src/diff-ui/index.ts';
import { runHarnessAnimate } from './harness-animate.ts';
import {
  clearDefaultGatewayPointerForRecordPath,
  writeDefaultGatewayPointerFromGatewayRecord,
} from '../src/cli/default-gateway-pointer.ts';
import {
  GATEWAY_RECORD_VERSION,
  DEFAULT_GATEWAY_DB_PATH,
  isLoopbackHost,
  normalizeGatewayHost,
  normalizeGatewayPort,
  normalizeGatewayStateDbPath,
  resolveGatewayLockPath,
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
import {
  loadHarnessSecrets,
  resolveHarnessSecretsPath,
  upsertHarnessSecret,
} from '../src/config/secrets-core.ts';
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
const DEFAULT_GATEWAY_LOCK_TIMEOUT_MS = 7000;
const DEFAULT_GATEWAY_LOCK_POLL_MS = 40;
const DEFAULT_GATEWAY_GC_OLDER_THAN_DAYS = 7;
const GATEWAY_LOCK_VERSION = 1;
const DEFAULT_PROFILE_ROOT_PATH = 'profiles';
const DEFAULT_SESSION_ROOT_PATH = 'sessions';
const PROFILE_STATE_FILE_NAME = 'active-profile.json';
const PROFILE_CLIENT_FILE_NAME = 'client.cpuprofile';
const PROFILE_GATEWAY_FILE_NAME = 'gateway.cpuprofile';
const DEFAULT_HARNESS_UPDATE_PACKAGE = '@jmoyers/harness@latest';
const DEFAULT_AUTH_TIMEOUT_MS = 120_000;
const DEFAULT_GITHUB_DEVICE_BASE_URL = 'https://github.com';
const DEFAULT_LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
const DEFAULT_LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
const DEFAULT_GITHUB_OAUTH_SCOPE = 'repo read:user';
const DEFAULT_LINEAR_OAUTH_SCOPE = 'read';
const GITHUB_OAUTH_ACCESS_TOKEN_KEY = 'HARNESS_GITHUB_OAUTH_ACCESS_TOKEN';
const GITHUB_OAUTH_REFRESH_TOKEN_KEY = 'HARNESS_GITHUB_OAUTH_REFRESH_TOKEN';
const GITHUB_OAUTH_EXPIRES_AT_KEY = 'HARNESS_GITHUB_OAUTH_ACCESS_EXPIRES_AT';
const LINEAR_OAUTH_ACCESS_TOKEN_KEY = 'HARNESS_LINEAR_OAUTH_ACCESS_TOKEN';
const LINEAR_OAUTH_REFRESH_TOKEN_KEY = 'HARNESS_LINEAR_OAUTH_REFRESH_TOKEN';
const LINEAR_OAUTH_EXPIRES_AT_KEY = 'HARNESS_LINEAR_OAUTH_ACCESS_EXPIRES_AT';
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

interface GatewayGcOptions {
  olderThanDays: number;
}

interface ParsedGatewayCommand {
  type: 'start' | 'stop' | 'status' | 'restart' | 'run' | 'call' | 'gc';
  startOptions?: GatewayStartOptions;
  stopOptions?: GatewayStopOptions;
  callJson?: string;
  gcOptions?: GatewayGcOptions;
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

type AuthProvider = 'github' | 'linear';
type AuthProviderOrAll = AuthProvider | 'all';

interface ParsedAuthStatusCommand {
  type: 'status';
}

interface ParsedAuthLoginCommand {
  type: 'login';
  provider: AuthProvider;
  noBrowser: boolean;
  timeoutMs: number;
  scopes: string | null;
}

interface ParsedAuthRefreshCommand {
  type: 'refresh';
  provider: AuthProviderOrAll;
}

interface ParsedAuthLogoutCommand {
  type: 'logout';
  provider: AuthProviderOrAll;
}

type ParsedAuthCommand =
  | ParsedAuthStatusCommand
  | ParsedAuthLoginCommand
  | ParsedAuthRefreshCommand
  | ParsedAuthLogoutCommand;

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
  lockPath: string;
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

interface GatewayProcessIdentity {
  pid: number;
  startedAt: string;
}

interface GatewayControlLockRecord {
  version: number;
  owner: GatewayProcessIdentity;
  acquiredAt: string;
  workspaceRoot: string;
  token: string;
}

interface GatewayControlLockHandle {
  lockPath: string;
  record: GatewayControlLockRecord;
  release: () => void;
}

interface ParsedGatewayDaemonEntry {
  pid: number;
  host: string;
  port: number;
  authToken: string | null;
  stateDbPath: string;
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

export function parseSessionName(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!SESSION_NAME_PATTERN.test(trimmed)) {
    throw new Error(`invalid --session value: ${rawValue}`);
  }
  return trimmed;
}

export function parseGlobalCliOptions(argv: readonly string[]): ParsedGlobalCliOptions {
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
      lockPath: resolveGatewayLockPath(invocationDirectory, process.env),
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
    lockPath: resolve(sessionRoot, 'gateway.lock'),
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

function parseAuthProvider(value: string, allowAll: boolean): AuthProviderOrAll {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'github' || normalized === 'linear') {
    return normalized;
  }
  if (allowAll && normalized === 'all') {
    return 'all';
  }
  throw new Error(`unsupported auth provider: ${value}`);
}

function parseAuthLoginCommand(argv: readonly string[]): ParsedAuthLoginCommand {
  if (argv.length === 0) {
    throw new Error('missing auth login provider (expected: github|linear)');
  }
  const provider = parseAuthProvider(argv[0]!, false);
  if (provider === 'all') {
    throw new Error('auth login requires a single provider (github|linear)');
  }
  let noBrowser = false;
  let timeoutMs = DEFAULT_AUTH_TIMEOUT_MS;
  let scopes: string | null = null;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--no-browser') {
      noBrowser = true;
      continue;
    }
    if (arg === '--timeout-ms') {
      timeoutMs = parsePositiveIntFlag(readCliValue(argv, index, '--timeout-ms'), '--timeout-ms');
      index += 1;
      continue;
    }
    if (arg === '--scopes') {
      scopes = readCliValue(argv, index, '--scopes');
      index += 1;
      continue;
    }
    throw new Error(`unknown auth login option: ${arg}`);
  }
  return {
    type: 'login',
    provider,
    noBrowser,
    timeoutMs,
    scopes,
  };
}

function parseAuthProviderSelectorCommand(
  type: 'refresh' | 'logout',
  argv: readonly string[],
): ParsedAuthRefreshCommand | ParsedAuthLogoutCommand {
  if (argv.length > 1) {
    throw new Error(`unknown auth ${type} option: ${argv[1]}`);
  }
  const provider = argv.length === 0 ? 'all' : parseAuthProvider(argv[0]!, true);
  if (type === 'refresh') {
    return {
      type,
      provider,
    };
  }
  return {
    type,
    provider,
  };
}

function parseAuthCommand(argv: readonly string[]): ParsedAuthCommand {
  if (argv.length === 0) {
    return {
      type: 'status',
    };
  }
  const subcommand = argv[0]!;
  if (subcommand === 'status') {
    if (argv.length > 1) {
      throw new Error(`unknown auth status option: ${argv[1]}`);
    }
    return {
      type: 'status',
    };
  }
  if (subcommand === 'login') {
    return parseAuthLoginCommand(argv.slice(1));
  }
  if (subcommand === 'refresh') {
    return parseAuthProviderSelectorCommand('refresh', argv.slice(1));
  }
  if (subcommand === 'logout') {
    return parseAuthProviderSelectorCommand('logout', argv.slice(1));
  }
  throw new Error(`unknown auth subcommand: ${subcommand}`);
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

function resolveGatewayHostFromConfigOrEnv(
  invocationDirectory: string,
  env: NodeJS.ProcessEnv,
): string {
  const loadedConfig = loadHarnessConfig({ cwd: invocationDirectory, env });
  return normalizeGatewayHost(env.HARNESS_CONTROL_PLANE_HOST ?? loadedConfig.config.gateway.host);
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

async function canBindPort(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolveCanBind, rejectCanBind) => {
    const server = createNetServer();
    server.unref();
    server.once('error', (error: unknown) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        resolveCanBind(false);
        return;
      }
      rejectCanBind(error);
    });
    server.listen(port, host, () => {
      server.close((error) => {
        if (error !== undefined) {
          rejectCanBind(error);
          return;
        }
        resolveCanBind(true);
      });
    });
  });
}

async function reservePort(host: string): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createNetServer();
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

function parseGatewayGcOptions(argv: readonly string[]): GatewayGcOptions {
  let olderThanDays = DEFAULT_GATEWAY_GC_OLDER_THAN_DAYS;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--older-than-days') {
      olderThanDays = parsePositiveIntFlag(
        readCliValue(argv, index, '--older-than-days'),
        '--older-than-days',
      );
      index += 1;
      continue;
    }
    throw new Error(`unknown gateway option: ${arg}`);
  }
  return {
    olderThanDays,
  };
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
  if (subcommand === 'gc') {
    return {
      type: 'gc',
      gcOptions: parseGatewayGcOptions(rest),
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

function normalizeScopeList(rawValue: string | null | undefined, fallback: string): string {
  const candidate = typeof rawValue === 'string' ? rawValue : fallback;
  const tokens = candidate
    .split(/[\s,]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return fallback;
  }
  return [...new Set(tokens)].join(' ');
}

function readRequiredEnvValue(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`missing required ${key}`);
  }
  return value.trim();
}

function parseOptionalIsoTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTokenNearExpiry(expiresAtMs: number | null, skewMs = 60_000): boolean {
  if (expiresAtMs === null) {
    return false;
  }
  return Date.now() + skewMs >= expiresAtMs;
}

function expiresAtFromExpiresIn(rawExpiresIn: unknown): string | null {
  if (typeof rawExpiresIn !== 'number' || !Number.isFinite(rawExpiresIn) || rawExpiresIn <= 0) {
    return null;
  }
  const expiresMs = Math.floor(rawExpiresIn * 1000);
  return new Date(Date.now() + expiresMs).toISOString();
}

function parseSecretLineKeyForDeletion(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return null;
  }
  const withoutExport = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trimStart()
    : trimmed;
  const equalIndex = withoutExport.indexOf('=');
  if (equalIndex <= 0) {
    return null;
  }
  return withoutExport.slice(0, equalIndex).trim();
}

function removeHarnessSecrets(
  invocationDirectory: string,
  keys: readonly string[],
  env: NodeJS.ProcessEnv,
): { filePath: string; removedCount: number } {
  const uniqueKeys = [...new Set(keys)].filter((key) => key.length > 0);
  const filePath = resolveHarnessSecretsPath(invocationDirectory, undefined, env);
  if (uniqueKeys.length === 0) {
    return {
      filePath,
      removedCount: 0,
    };
  }
  let removedCount = 0;
  if (existsSync(filePath)) {
    const sourceText = readFileSync(filePath, 'utf8');
    const sourceLines = sourceText.split(/\r?\n/u);
    const nextLines: string[] = [];
    for (const line of sourceLines) {
      const key = parseSecretLineKeyForDeletion(line);
      if (key !== null && uniqueKeys.includes(key)) {
        removedCount += 1;
        continue;
      }
      nextLines.push(line);
    }
    while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
      nextLines.pop();
    }
    writeTextFileAtomically(filePath, `${nextLines.join('\n')}\n`);
  }
  for (const key of uniqueKeys) {
    delete env[key];
    delete process.env[key];
  }
  return {
    filePath,
    removedCount,
  };
}

function upsertHarnessSecretValue(
  invocationDirectory: string,
  env: NodeJS.ProcessEnv,
  key: string,
  value: string,
): void {
  upsertHarnessSecret({
    cwd: invocationDirectory,
    env,
    key,
    value,
  });
  env[key] = value;
  process.env[key] = value;
}

function tryOpenBrowserUrl(url: string, env: NodeJS.ProcessEnv): void {
  const commandOverride =
    typeof env.HARNESS_AUTH_BROWSER_COMMAND === 'string' &&
    env.HARNESS_AUTH_BROWSER_COMMAND.trim().length > 0
      ? env.HARNESS_AUTH_BROWSER_COMMAND.trim()
      : null;
  const child =
    commandOverride !== null
      ? spawn(commandOverride, [url], {
          detached: true,
          stdio: 'ignore',
          env,
        })
      : process.platform === 'darwin'
        ? spawn('open', [url], {
            detached: true,
            stdio: 'ignore',
            env,
          })
        : process.platform === 'win32'
          ? spawn('cmd', ['/c', 'start', '', url], {
              detached: true,
              stdio: 'ignore',
              env,
            })
          : spawn('xdg-open', [url], {
              detached: true,
              stdio: 'ignore',
              env,
            });
  child.once('error', () => undefined);
  child.unref();
}

async function fetchJsonRecord(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const timeoutMs = init.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch (error: unknown) {
      throw new Error(
        `oauth endpoint returned non-json payload (${response.status}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!response.ok) {
    const message =
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['error_description'] === 'string'
        ? ((parsed as Record<string, unknown>)['error_description'] as string)
        : text || response.statusText;
    throw new Error(`oauth request failed (${response.status}): ${message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('oauth endpoint returned malformed payload');
  }
  return parsed as Record<string, unknown>;
}

function asStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function resolveGitHubDeviceCodeUrl(env: NodeJS.ProcessEnv): string {
  if (
    typeof env.HARNESS_GITHUB_OAUTH_DEVICE_CODE_URL === 'string' &&
    env.HARNESS_GITHUB_OAUTH_DEVICE_CODE_URL.trim().length > 0
  ) {
    return env.HARNESS_GITHUB_OAUTH_DEVICE_CODE_URL.trim();
  }
  const base =
    typeof env.HARNESS_GITHUB_OAUTH_BASE_URL === 'string' &&
    env.HARNESS_GITHUB_OAUTH_BASE_URL.trim().length > 0
      ? env.HARNESS_GITHUB_OAUTH_BASE_URL.trim().replace(/\/+$/u, '')
      : DEFAULT_GITHUB_DEVICE_BASE_URL;
  return `${base}/login/device/code`;
}

function resolveGitHubOauthTokenUrl(env: NodeJS.ProcessEnv): string {
  if (
    typeof env.HARNESS_GITHUB_OAUTH_TOKEN_URL === 'string' &&
    env.HARNESS_GITHUB_OAUTH_TOKEN_URL.trim().length > 0
  ) {
    return env.HARNESS_GITHUB_OAUTH_TOKEN_URL.trim();
  }
  const base =
    typeof env.HARNESS_GITHUB_OAUTH_BASE_URL === 'string' &&
    env.HARNESS_GITHUB_OAUTH_BASE_URL.trim().length > 0
      ? env.HARNESS_GITHUB_OAUTH_BASE_URL.trim().replace(/\/+$/u, '')
      : DEFAULT_GITHUB_DEVICE_BASE_URL;
  return `${base}/login/oauth/access_token`;
}

function resolveLinearAuthorizeUrl(env: NodeJS.ProcessEnv): string {
  if (
    typeof env.HARNESS_LINEAR_OAUTH_AUTHORIZE_URL === 'string' &&
    env.HARNESS_LINEAR_OAUTH_AUTHORIZE_URL.trim().length > 0
  ) {
    return env.HARNESS_LINEAR_OAUTH_AUTHORIZE_URL.trim();
  }
  return DEFAULT_LINEAR_AUTHORIZE_URL;
}

function resolveLinearTokenUrl(env: NodeJS.ProcessEnv): string {
  if (
    typeof env.HARNESS_LINEAR_OAUTH_TOKEN_URL === 'string' &&
    env.HARNESS_LINEAR_OAUTH_TOKEN_URL.trim().length > 0
  ) {
    return env.HARNESS_LINEAR_OAUTH_TOKEN_URL.trim();
  }
  return DEFAULT_LINEAR_TOKEN_URL;
}

function createPkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function createPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function resolveIntegrationTokenEnvVars(invocationDirectory: string): {
  githubTokenEnvVar: string;
  linearTokenEnvVar: string;
} {
  const loaded = loadHarnessConfig({
    cwd: invocationDirectory,
    env: process.env,
  });
  return {
    githubTokenEnvVar: loaded.config.github.tokenEnvVar,
    linearTokenEnvVar: loaded.config.linear.tokenEnvVar,
  };
}

async function loginGitHubWithOAuthDeviceFlow(
  invocationDirectory: string,
  command: ParsedAuthLoginCommand,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const clientId = readRequiredEnvValue(env, 'HARNESS_GITHUB_OAUTH_CLIENT_ID');
  const clientSecret =
    typeof env.HARNESS_GITHUB_OAUTH_CLIENT_SECRET === 'string' &&
    env.HARNESS_GITHUB_OAUTH_CLIENT_SECRET.trim().length > 0
      ? env.HARNESS_GITHUB_OAUTH_CLIENT_SECRET.trim()
      : null;
  const scopes = normalizeScopeList(
    command.scopes ?? env.HARNESS_GITHUB_OAUTH_SCOPES,
    DEFAULT_GITHUB_OAUTH_SCOPE,
  );
  const deviceCodePayload = await fetchJsonRecord(resolveGitHubDeviceCodeUrl(env), {
    method: 'POST',
    timeoutMs: command.timeoutMs,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: scopes,
    }).toString(),
  });
  const deviceCode = asStringField(deviceCodePayload, 'device_code');
  const userCode = asStringField(deviceCodePayload, 'user_code');
  const verificationUri = asStringField(deviceCodePayload, 'verification_uri');
  const verificationUriComplete =
    asStringField(deviceCodePayload, 'verification_uri_complete') ?? verificationUri;
  const expiresInRaw = deviceCodePayload['expires_in'];
  const expiresIn =
    typeof expiresInRaw === 'number' && Number.isFinite(expiresInRaw) && expiresInRaw > 0
      ? expiresInRaw
      : 900;
  const intervalRaw = deviceCodePayload['interval'];
  let intervalMs =
    typeof intervalRaw === 'number' && Number.isFinite(intervalRaw) && intervalRaw > 0
      ? Math.floor(intervalRaw * 1000)
      : 5000;
  if (deviceCode === null || userCode === null || verificationUri === null) {
    throw new Error('github oauth device-code response malformed');
  }

  process.stdout.write(`github oauth user code: ${userCode}\n`);
  process.stdout.write(`github oauth verify url: ${verificationUri}\n`);
  if (verificationUriComplete !== null) {
    process.stdout.write(`github oauth direct url: ${verificationUriComplete}\n`);
    if (!command.noBrowser) {
      tryOpenBrowserUrl(verificationUriComplete, env);
    }
  }

  const pollDeadlineMs = Date.now() + Math.min(command.timeoutMs, Math.floor(expiresIn * 1000));
  let tokenPayload: Record<string, unknown> | null = null;
  while (Date.now() <= pollDeadlineMs) {
    await delay(intervalMs);
    const candidatePayload = await fetchJsonRecord(resolveGitHubOauthTokenUrl(env), {
      method: 'POST',
      timeoutMs: command.timeoutMs,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        ...(clientSecret === null ? {} : { client_secret: clientSecret }),
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
    });
    const accessToken = asStringField(candidatePayload, 'access_token');
    if (accessToken !== null) {
      tokenPayload = candidatePayload;
      break;
    }
    const errorCode = asStringField(candidatePayload, 'error');
    if (errorCode === 'authorization_pending') {
      continue;
    }
    if (errorCode === 'slow_down') {
      intervalMs = Math.min(30_000, intervalMs + 5000);
      continue;
    }
    if (errorCode !== null) {
      const description =
        asStringField(candidatePayload, 'error_description') ??
        asStringField(candidatePayload, 'error_uri') ??
        'oauth device login failed';
      throw new Error(`github oauth login failed (${errorCode}): ${description}`);
    }
  }
  if (tokenPayload === null) {
    throw new Error('timed out waiting for github oauth authorization');
  }

  const accessToken = asStringField(tokenPayload, 'access_token');
  if (accessToken === null) {
    throw new Error('github oauth token response missing access_token');
  }
  const refreshToken = asStringField(tokenPayload, 'refresh_token');
  const expiresAt = expiresAtFromExpiresIn(tokenPayload['expires_in']);
  upsertHarnessSecretValue(invocationDirectory, env, 'HARNESS_GITHUB_OAUTH_CLIENT_ID', clientId);
  upsertHarnessSecretValue(invocationDirectory, env, GITHUB_OAUTH_ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken !== null) {
    upsertHarnessSecretValue(
      invocationDirectory,
      env,
      GITHUB_OAUTH_REFRESH_TOKEN_KEY,
      refreshToken,
    );
  } else {
    removeHarnessSecrets(invocationDirectory, [GITHUB_OAUTH_REFRESH_TOKEN_KEY], env);
  }
  if (expiresAt !== null) {
    upsertHarnessSecretValue(invocationDirectory, env, GITHUB_OAUTH_EXPIRES_AT_KEY, expiresAt);
  } else {
    removeHarnessSecrets(invocationDirectory, [GITHUB_OAUTH_EXPIRES_AT_KEY], env);
  }
  process.stdout.write(
    `github oauth login complete: token saved to ${GITHUB_OAUTH_ACCESS_TOKEN_KEY}\n`,
  );
}

async function waitForLinearOauthCodeViaCallback(
  clientId: string,
  scopes: string,
  timeoutMs: number,
  noBrowser: boolean,
  env: NodeJS.ProcessEnv,
): Promise<{ code: string; redirectUri: string; verifier: string }> {
  const verifier = createPkceVerifier();
  const challenge = createPkceChallenge(verifier);
  const state = randomUUID();
  const authorizeBaseUrl = resolveLinearAuthorizeUrl(env);
  return await new Promise<{ code: string; redirectUri: string; verifier: string }>(
    (resolveCode, rejectCode) => {
      let settled = false;
      const server = createHttpServer((request, response) => {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== '/oauth/callback') {
          response.statusCode = 404;
          response.end('Not found');
          return;
        }
        const code = requestUrl.searchParams.get('code');
        const receivedState = requestUrl.searchParams.get('state');
        if (receivedState !== state) {
          response.statusCode = 400;
          response.end('State mismatch');
          finish(new Error('linear oauth callback state mismatch'));
          return;
        }
        if (code === null || code.trim().length === 0) {
          response.statusCode = 400;
          response.end('Missing code');
          finish(new Error('linear oauth callback missing code'));
          return;
        }
        response.statusCode = 200;
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(
          '<html><body><h3>Harness Linear OAuth complete</h3><p>You can close this tab.</p></body></html>',
        );
        finish(null, {
          code: code.trim(),
          redirectUri,
          verifier,
        });
      });
      const finish = (
        error: Error | null,
        result?: { code: string; redirectUri: string; verifier: string },
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        server.close(() => {
          if (error !== null) {
            rejectCode(error);
            return;
          }
          if (result === undefined) {
            rejectCode(new Error('linear oauth callback failed without result'));
            return;
          }
          resolveCode(result);
        });
      };
      server.once('error', (error) => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });
      const timeoutHandle = setTimeout(() => {
        finish(new Error('timed out waiting for linear oauth callback'));
      }, timeoutMs);
      timeoutHandle.unref();
      let redirectUri = '';
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          finish(new Error('unable to determine linear oauth callback address'));
          return;
        }
        redirectUri = `http://127.0.0.1:${String(address.port)}/oauth/callback`;
        const authorizeUrl = new URL(authorizeBaseUrl);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', clientId);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('scope', scopes);
        authorizeUrl.searchParams.set('state', state);
        authorizeUrl.searchParams.set('code_challenge', challenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        const authorizeUrlText = authorizeUrl.toString();
        process.stdout.write(`linear oauth authorize url: ${authorizeUrlText}\n`);
        if (!noBrowser) {
          tryOpenBrowserUrl(authorizeUrlText, env);
        }
      });
    },
  );
}

async function loginLinearWithOAuthPkce(
  invocationDirectory: string,
  command: ParsedAuthLoginCommand,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const clientId = readRequiredEnvValue(env, 'HARNESS_LINEAR_OAUTH_CLIENT_ID');
  const clientSecret =
    typeof env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET === 'string' &&
    env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET.trim().length > 0
      ? env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET.trim()
      : null;
  const scopes = normalizeScopeList(
    command.scopes ?? env.HARNESS_LINEAR_OAUTH_SCOPES,
    DEFAULT_LINEAR_OAUTH_SCOPE,
  );
  const callback = await waitForLinearOauthCodeViaCallback(
    clientId,
    scopes,
    command.timeoutMs,
    command.noBrowser,
    env,
  );
  const tokenPayload = await fetchJsonRecord(resolveLinearTokenUrl(env), {
    method: 'POST',
    timeoutMs: command.timeoutMs,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      ...(clientSecret === null ? {} : { client_secret: clientSecret }),
      code: callback.code,
      redirect_uri: callback.redirectUri,
      code_verifier: callback.verifier,
    }),
  });
  const accessToken = asStringField(tokenPayload, 'access_token');
  if (accessToken === null) {
    throw new Error('linear oauth token response missing access_token');
  }
  const refreshToken = asStringField(tokenPayload, 'refresh_token');
  const expiresAt = expiresAtFromExpiresIn(tokenPayload['expires_in']);
  upsertHarnessSecretValue(invocationDirectory, env, 'HARNESS_LINEAR_OAUTH_CLIENT_ID', clientId);
  upsertHarnessSecretValue(invocationDirectory, env, LINEAR_OAUTH_ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken !== null) {
    upsertHarnessSecretValue(
      invocationDirectory,
      env,
      LINEAR_OAUTH_REFRESH_TOKEN_KEY,
      refreshToken,
    );
  } else {
    removeHarnessSecrets(invocationDirectory, [LINEAR_OAUTH_REFRESH_TOKEN_KEY], env);
  }
  if (expiresAt !== null) {
    upsertHarnessSecretValue(invocationDirectory, env, LINEAR_OAUTH_EXPIRES_AT_KEY, expiresAt);
  } else {
    removeHarnessSecrets(invocationDirectory, [LINEAR_OAUTH_EXPIRES_AT_KEY], env);
  }
  process.stdout.write(
    `linear oauth login complete: token saved to ${LINEAR_OAUTH_ACCESS_TOKEN_KEY}\n`,
  );
}

interface RefreshLinearOauthTokenOptions {
  invocationDirectory: string;
  env: NodeJS.ProcessEnv;
  force: boolean;
  timeoutMs: number;
}

async function refreshLinearOauthToken(
  options: RefreshLinearOauthTokenOptions,
): Promise<{ refreshed: boolean; skippedReason: string | null }> {
  const refreshToken = options.env[LINEAR_OAUTH_REFRESH_TOKEN_KEY];
  if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
    return {
      refreshed: false,
      skippedReason: 'missing linear oauth refresh token',
    };
  }
  const expiresAt = parseOptionalIsoTimestamp(options.env[LINEAR_OAUTH_EXPIRES_AT_KEY]);
  if (!options.force && !isTokenNearExpiry(expiresAt)) {
    return {
      refreshed: false,
      skippedReason: 'linear oauth token still valid',
    };
  }
  const clientId = readRequiredEnvValue(options.env, 'HARNESS_LINEAR_OAUTH_CLIENT_ID');
  const clientSecret =
    typeof options.env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET === 'string' &&
    options.env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET.trim().length > 0
      ? options.env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET.trim()
      : null;
  const tokenPayload = await fetchJsonRecord(resolveLinearTokenUrl(options.env), {
    method: 'POST',
    timeoutMs: options.timeoutMs,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      ...(clientSecret === null ? {} : { client_secret: clientSecret }),
      refresh_token: refreshToken.trim(),
    }),
  });
  const accessToken = asStringField(tokenPayload, 'access_token');
  if (accessToken === null) {
    throw new Error('linear oauth refresh response missing access_token');
  }
  const nextRefreshToken = asStringField(tokenPayload, 'refresh_token') ?? refreshToken.trim();
  const nextExpiresAt = expiresAtFromExpiresIn(tokenPayload['expires_in']);
  upsertHarnessSecretValue(
    options.invocationDirectory,
    options.env,
    LINEAR_OAUTH_ACCESS_TOKEN_KEY,
    accessToken,
  );
  upsertHarnessSecretValue(
    options.invocationDirectory,
    options.env,
    LINEAR_OAUTH_REFRESH_TOKEN_KEY,
    nextRefreshToken,
  );
  if (nextExpiresAt !== null) {
    upsertHarnessSecretValue(
      options.invocationDirectory,
      options.env,
      LINEAR_OAUTH_EXPIRES_AT_KEY,
      nextExpiresAt,
    );
  }
  return {
    refreshed: true,
    skippedReason: null,
  };
}

async function maybeRefreshLinearOauthTokenForGatewayStart(
  invocationDirectory: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    const tokenEnvVars = resolveIntegrationTokenEnvVars(invocationDirectory);
    const manualToken = env[tokenEnvVars.linearTokenEnvVar];
    if (typeof manualToken === 'string' && manualToken.trim().length > 0) {
      return;
    }
    const result = await refreshLinearOauthToken({
      invocationDirectory,
      env,
      force: false,
      timeoutMs: 10_000,
    });
    if (result.refreshed) {
      process.stdout.write('[auth] linear oauth token refreshed before gateway start\n');
    }
  } catch (error: unknown) {
    process.stderr.write(
      `[auth] linear oauth refresh skipped: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

function formatAuthProviderStatusLine(
  provider: AuthProvider,
  manualTokenEnvVar: string,
  oauthAccessTokenEnvVar: string,
  env: NodeJS.ProcessEnv,
): string {
  const manualToken = env[manualTokenEnvVar];
  const oauthAccessToken = env[oauthAccessTokenEnvVar];
  const manualPresent = typeof manualToken === 'string' && manualToken.trim().length > 0;
  const oauthPresent = typeof oauthAccessToken === 'string' && oauthAccessToken.trim().length > 0;
  const activeSource = manualPresent ? 'manual' : oauthPresent ? 'oauth' : 'none';
  const refreshKey =
    provider === 'github' ? GITHUB_OAUTH_REFRESH_TOKEN_KEY : LINEAR_OAUTH_REFRESH_TOKEN_KEY;
  const expiresKey =
    provider === 'github' ? GITHUB_OAUTH_EXPIRES_AT_KEY : LINEAR_OAUTH_EXPIRES_AT_KEY;
  const refreshPresent =
    typeof env[refreshKey] === 'string' && (env[refreshKey] as string).trim().length > 0;
  const expiresAt = env[expiresKey];
  const expiresText =
    typeof expiresAt === 'string' && expiresAt.trim().length > 0 ? expiresAt.trim() : 'n/a';
  return `${provider}: ${activeSource === 'none' ? 'disconnected' : 'connected'} active=${activeSource} manualEnvVar=${manualTokenEnvVar} oauthEnvVar=${oauthAccessTokenEnvVar} refresh=${refreshPresent ? 'yes' : 'no'} expiresAt=${expiresText}`;
}

async function runAuthCommandEntry(
  invocationDirectory: string,
  args: readonly string[],
): Promise<number> {
  const command = parseAuthCommand(args);
  const tokenEnvVars = resolveIntegrationTokenEnvVars(invocationDirectory);
  if (command.type === 'status') {
    process.stdout.write(
      `${formatAuthProviderStatusLine(
        'github',
        tokenEnvVars.githubTokenEnvVar,
        GITHUB_OAUTH_ACCESS_TOKEN_KEY,
        process.env,
      )}\n`,
    );
    process.stdout.write(
      `${formatAuthProviderStatusLine(
        'linear',
        tokenEnvVars.linearTokenEnvVar,
        LINEAR_OAUTH_ACCESS_TOKEN_KEY,
        process.env,
      )}\n`,
    );
    return 0;
  }
  if (command.type === 'login') {
    if (command.provider === 'github') {
      await loginGitHubWithOAuthDeviceFlow(invocationDirectory, command, process.env);
      return 0;
    }
    await loginLinearWithOAuthPkce(invocationDirectory, command, process.env);
    return 0;
  }
  if (command.type === 'refresh') {
    const providers: readonly AuthProvider[] =
      command.provider === 'all' ? ['github', 'linear'] : [command.provider];
    let hadFailure = false;
    for (const provider of providers) {
      if (provider === 'github') {
        process.stdout.write(
          'github oauth refresh: skipped (device-flow tokens do not guarantee refresh support)\n',
        );
        continue;
      }
      try {
        const result = await refreshLinearOauthToken({
          invocationDirectory,
          env: process.env,
          force: true,
          timeoutMs: DEFAULT_AUTH_TIMEOUT_MS,
        });
        if (result.refreshed) {
          process.stdout.write('linear oauth refresh: refreshed\n');
          continue;
        }
        process.stdout.write(
          `linear oauth refresh: skipped (${result.skippedReason ?? 'unknown'})\n`,
        );
      } catch (error: unknown) {
        hadFailure = true;
        process.stderr.write(
          `linear oauth refresh failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
    return hadFailure ? 1 : 0;
  }
  const providers: readonly AuthProvider[] =
    command.provider === 'all' ? ['github', 'linear'] : [command.provider];
  const keysToRemove: string[] = [];
  for (const provider of providers) {
    if (provider === 'github') {
      keysToRemove.push(
        GITHUB_OAUTH_ACCESS_TOKEN_KEY,
        GITHUB_OAUTH_REFRESH_TOKEN_KEY,
        GITHUB_OAUTH_EXPIRES_AT_KEY,
      );
      continue;
    }
    keysToRemove.push(
      LINEAR_OAUTH_ACCESS_TOKEN_KEY,
      LINEAR_OAUTH_REFRESH_TOKEN_KEY,
      LINEAR_OAUTH_EXPIRES_AT_KEY,
    );
  }
  const removed = removeHarnessSecrets(invocationDirectory, keysToRemove, process.env);
  process.stdout.write(
    `auth logout complete: providers=${providers.join(',')} removed=${String(removed.removedCount)} file=${removed.filePath}\n`,
  );
  return 0;
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
      '  harness [--session <name>] gateway gc [--older-than-days <days>]',
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
      '  harness auth status',
      '  harness auth login <github|linear> [--no-browser] [--timeout-ms <ms>] [--scopes <list>]',
      '  harness auth refresh [github|linear|all]',
      '  harness auth logout [github|linear|all]',
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
  writeDefaultGatewayPointerFromGatewayRecord(recordPath, record, process.env);
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
  clearDefaultGatewayPointerForRecordPath(recordPath, process.cwd(), process.env);
}

function readProcessStartedAt(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  try {
    const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function resolveCurrentProcessIdentity(): GatewayProcessIdentity {
  const startedAt = readProcessStartedAt(process.pid);
  if (startedAt === null) {
    throw new Error(
      `failed to resolve current process start timestamp for pid=${String(process.pid)}`,
    );
  }
  return {
    pid: process.pid,
    startedAt,
  };
}

function parseGatewayControlLockText(text: string): GatewayControlLockRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate['version'] !== GATEWAY_LOCK_VERSION) {
    return null;
  }
  if (typeof candidate['acquiredAt'] !== 'string' || candidate['acquiredAt'].trim().length === 0) {
    return null;
  }
  if (
    typeof candidate['workspaceRoot'] !== 'string' ||
    candidate['workspaceRoot'].trim().length === 0
  ) {
    return null;
  }
  if (typeof candidate['token'] !== 'string' || candidate['token'].trim().length === 0) {
    return null;
  }
  const owner = candidate['owner'];
  if (typeof owner !== 'object' || owner === null || Array.isArray(owner)) {
    return null;
  }
  const ownerRecord = owner as Record<string, unknown>;
  const pid = ownerRecord['pid'];
  const startedAt = ownerRecord['startedAt'];
  if (!Number.isInteger(pid) || (pid as number) <= 0) {
    return null;
  }
  if (typeof startedAt !== 'string' || startedAt.trim().length === 0) {
    return null;
  }
  return {
    version: GATEWAY_LOCK_VERSION,
    owner: {
      pid: pid as number,
      startedAt,
    },
    acquiredAt: candidate['acquiredAt'] as string,
    workspaceRoot: candidate['workspaceRoot'] as string,
    token: candidate['token'] as string,
  };
}

function readGatewayControlLock(lockPath: string): GatewayControlLockRecord | null {
  if (!existsSync(lockPath)) {
    return null;
  }
  try {
    return parseGatewayControlLockText(readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

function removeGatewayControlLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

function isGatewayControlLockOwnerAlive(record: GatewayControlLockRecord): boolean {
  if (!isPidRunning(record.owner.pid)) {
    return false;
  }
  const startedAt = readProcessStartedAt(record.owner.pid);
  if (startedAt === null) {
    return false;
  }
  return startedAt === record.owner.startedAt;
}

function createGatewayControlLockHandle(
  lockPath: string,
  record: GatewayControlLockRecord,
): GatewayControlLockHandle {
  return {
    lockPath,
    record,
    release: () => {
      const current = readGatewayControlLock(lockPath);
      if (current === null) {
        return;
      }
      if (
        current.token !== record.token ||
        current.owner.pid !== record.owner.pid ||
        current.owner.startedAt !== record.owner.startedAt
      ) {
        return;
      }
      removeGatewayControlLock(lockPath);
    },
  };
}

async function acquireGatewayControlLock(
  lockPath: string,
  workspaceRoot: string,
  timeoutMs = DEFAULT_GATEWAY_LOCK_TIMEOUT_MS,
): Promise<GatewayControlLockHandle> {
  const owner = resolveCurrentProcessIdentity();
  const deadlineMs = Date.now() + timeoutMs;
  const candidate: GatewayControlLockRecord = {
    version: GATEWAY_LOCK_VERSION,
    owner,
    acquiredAt: new Date().toISOString(),
    workspaceRoot,
    token: randomUUID(),
  };

  while (true) {
    mkdirSync(dirname(lockPath), { recursive: true });
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        writeFileSync(fd, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
      } finally {
        closeSync(fd);
      }
      return createGatewayControlLockHandle(lockPath, candidate);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
    }

    const existing = readGatewayControlLock(lockPath);
    if (existing === null) {
      removeGatewayControlLock(lockPath);
      continue;
    }

    if (existing.owner.pid === owner.pid && existing.owner.startedAt === owner.startedAt) {
      return createGatewayControlLockHandle(lockPath, existing);
    }

    if (!isGatewayControlLockOwnerAlive(existing)) {
      removeGatewayControlLock(lockPath);
      continue;
    }

    if (Date.now() >= deadlineMs) {
      throw new Error(
        `timed out waiting for gateway control lock: lockPath=${lockPath} ownerPid=${String(existing.owner.pid)} acquiredAt=${existing.acquiredAt}`,
      );
    }
    await delay(DEFAULT_GATEWAY_LOCK_POLL_MS);
  }
}

async function withGatewayControlLock<T>(
  lockPath: string,
  workspaceRoot: string,
  operation: () => Promise<T>,
): Promise<T> {
  const handle = await acquireGatewayControlLock(lockPath, workspaceRoot);
  try {
    return await operation();
  } finally {
    handle.release();
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

function tokenizeProcessCommand(command: string): readonly string[] {
  const trimmed = command.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/u);
}

function readCommandFlagValue(tokens: readonly string[], flag: string): string | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === flag) {
      const value = tokens[index + 1];
      return value === undefined ? null : value;
    }
    if (token.startsWith(`${flag}=`)) {
      const value = token.slice(flag.length + 1);
      return value.length === 0 ? null : value;
    }
  }
  return null;
}

function parseGatewayDaemonProcessEntry(entry: ProcessTableEntry): ParsedGatewayDaemonEntry | null {
  if (!/\bcontrol-plane-daemon\.(?:ts|js)\b/u.test(entry.command)) {
    return null;
  }
  const tokens = tokenizeProcessCommand(entry.command);
  const host = readCommandFlagValue(tokens, '--host');
  const portRaw = readCommandFlagValue(tokens, '--port');
  const stateDbPath = readCommandFlagValue(tokens, '--state-db-path');
  const authToken = readCommandFlagValue(tokens, '--auth-token');
  if (host === null || portRaw === null || stateDbPath === null) {
    return null;
  }
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  return {
    pid: entry.pid,
    host,
    port,
    authToken,
    stateDbPath: resolve(stateDbPath),
  };
}

function listGatewayDaemonProcesses(): readonly ParsedGatewayDaemonEntry[] {
  const parsed: ParsedGatewayDaemonEntry[] = [];
  for (const entry of readProcessTable()) {
    const daemon = parseGatewayDaemonProcessEntry(entry);
    if (daemon !== null) {
      parsed.push(daemon);
    }
  }
  return parsed;
}

function isPathWithinWorkspaceRuntimeScope(
  pathValue: string,
  invocationDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const runtimeRoot = resolveHarnessWorkspaceDirectory(invocationDirectory, env);
  const normalizedRoot = resolve(runtimeRoot);
  const normalizedPath = resolve(pathValue);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
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
    overrides.host ?? record?.host ?? resolveGatewayHostFromConfigOrEnv(invocationDirectory, env),
  );
  const port = normalizeGatewayPort(
    overrides.port ?? record?.port ?? env.HARNESS_CONTROL_PLANE_PORT,
  );
  const configuredStateDbPath = overrides.stateDbPath ?? defaultStateDbPath;
  const stateDbPathRaw = normalizeGatewayStateDbPath(configuredStateDbPath, defaultStateDbPath);
  const stateDbPath = resolveHarnessRuntimePath(invocationDirectory, stateDbPathRaw, env);
  if (!isPathWithinWorkspaceRuntimeScope(stateDbPath, invocationDirectory, env)) {
    const runtimeRoot = resolveHarnessWorkspaceDirectory(invocationDirectory, env);
    throw new Error(
      `invalid --state-db-path: ${stateDbPath}. state db path must be under workspace runtime root ${runtimeRoot}`,
    );
  }

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

async function probeGatewayEndpoint(
  host: string,
  port: number,
  authToken: string | null,
): Promise<GatewayProbeResult> {
  try {
    const client = await connectControlPlaneStreamClient({
      host,
      port,
      ...(authToken !== null
        ? {
            authToken,
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

async function probeGateway(record: GatewayRecord): Promise<GatewayProbeResult> {
  return await probeGatewayEndpoint(record.host, record.port, record.authToken);
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
  await maybeRefreshLinearOauthTokenForGatewayStart(invocationDirectory, process.env);
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');
  const gatewayRunId = randomUUID();
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
      HARNESS_GATEWAY_RUN_ID: gatewayRunId,
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
    gatewayRunId,
  };

  try {
    await waitForGatewayReady(record);
    if (!isPidRunning(child.pid)) {
      throw new Error(
        `gateway daemon exited during startup (pid=${String(child.pid)}); possible duplicate start or port collision`,
      );
    }
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

function authTokenMatches(
  candidate: ParsedGatewayDaemonEntry,
  expectedAuthToken: string | null,
): boolean {
  if (expectedAuthToken === null) {
    return candidate.authToken === null;
  }
  return candidate.authToken === expectedAuthToken;
}

function findReachableGatewayDaemonCandidates(
  invocationDirectory: string,
  settings: ResolvedGatewaySettings,
): readonly ParsedGatewayDaemonEntry[] {
  return listGatewayDaemonProcesses().filter((candidate) => {
    if (candidate.host !== settings.host || candidate.port !== settings.port) {
      return false;
    }
    if (!authTokenMatches(candidate, settings.authToken)) {
      return false;
    }
    return isPathWithinWorkspaceRuntimeScope(candidate.stateDbPath, invocationDirectory);
  });
}

function findGatewayDaemonCandidatesByStateDbPath(
  invocationDirectory: string,
  stateDbPath: string,
): readonly ParsedGatewayDaemonEntry[] {
  const normalizedStateDbPath = resolve(stateDbPath);
  return listGatewayDaemonProcesses().filter((candidate) => {
    if (candidate.stateDbPath !== normalizedStateDbPath) {
      return false;
    }
    return isPathWithinWorkspaceRuntimeScope(candidate.stateDbPath, invocationDirectory);
  });
}

function createAdoptedGatewayRecord(
  invocationDirectory: string,
  daemon: ParsedGatewayDaemonEntry,
): GatewayRecord {
  return {
    version: GATEWAY_RECORD_VERSION,
    pid: daemon.pid,
    host: daemon.host,
    port: daemon.port,
    authToken: daemon.authToken,
    stateDbPath: daemon.stateDbPath,
    startedAt: new Date().toISOString(),
    workspaceRoot: invocationDirectory,
  };
}

function shouldAutoResolveNamedSessionPort(
  sessionName: string | null,
  overrides: GatewayStartOptions,
): boolean {
  if (sessionName === null) {
    return false;
  }
  if (overrides.port !== undefined) {
    return false;
  }
  return true;
}

async function resolveAdoptableGatewayByStateDbPath(
  invocationDirectory: string,
  stateDbPath: string,
): Promise<ParsedGatewayDaemonEntry | null> {
  const candidates = findGatewayDaemonCandidatesByStateDbPath(invocationDirectory, stateDbPath);
  const reachable: ParsedGatewayDaemonEntry[] = [];
  for (const candidate of candidates) {
    const probe = await probeGatewayEndpoint(candidate.host, candidate.port, candidate.authToken);
    if (probe.connected) {
      reachable.push(candidate);
    }
  }
  if (reachable.length === 0) {
    return null;
  }
  if (reachable.length > 1) {
    const pidList = reachable.map((candidate) => String(candidate.pid)).join(', ');
    throw new Error(
      `gateway db path is served by multiple reachable daemon candidates (${pidList}); stop with \`harness gateway stop --force\` and retry`,
    );
  }
  return reachable[0] ?? null;
}

async function ensureGatewayRunning(
  invocationDirectory: string,
  sessionName: string | null,
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
  if (existingRecord === null) {
    const adoptedByDbPath = await resolveAdoptableGatewayByStateDbPath(
      invocationDirectory,
      settings.stateDbPath,
    );
    if (adoptedByDbPath !== null) {
      const adoptedRecord = createAdoptedGatewayRecord(invocationDirectory, adoptedByDbPath);
      writeGatewayRecord(recordPath, adoptedRecord);
      return {
        record: adoptedRecord,
        started: false,
      };
    }
  }
  let resolvedSettings = settings;
  if (existingRecord === null) {
    const endpointProbe = await probeGatewayEndpoint(
      resolvedSettings.host,
      resolvedSettings.port,
      resolvedSettings.authToken,
    );
    if (endpointProbe.connected) {
      const candidates = findReachableGatewayDaemonCandidates(
        invocationDirectory,
        resolvedSettings,
      );
      if (candidates.length === 1) {
        const adopted = createAdoptedGatewayRecord(invocationDirectory, candidates[0]!);
        writeGatewayRecord(recordPath, adopted);
        return {
          record: adopted,
          started: false,
        };
      }
      if (candidates.length > 1) {
        const pidList = candidates.map((candidate) => String(candidate.pid)).join(', ');
        throw new Error(
          `gateway endpoint reachable with multiple daemon candidates (${pidList}); stop with \`harness gateway stop --force\` and retry`,
        );
      }
      throw new Error(
        'gateway endpoint is reachable but no matching daemon could be adopted; stop with `harness gateway stop --force` and retry',
      );
    }

    if (shouldAutoResolveNamedSessionPort(sessionName, overrides)) {
      const currentPortAvailable = await canBindPort(resolvedSettings.host, resolvedSettings.port);
      if (!currentPortAvailable) {
        const fallbackPort = await reservePort(resolvedSettings.host);
        resolvedSettings = {
          ...resolvedSettings,
          port: fallbackPort,
        };
      }
    }
  }
  const record = await startDetachedGateway(
    invocationDirectory,
    recordPath,
    logPath,
    resolvedSettings,
    daemonScriptPath,
    daemonRuntimeArgs,
  );
  return {
    record,
    started: true,
  };
}

function isNamedSessionGatewayRecordPath(recordPath: string): boolean {
  return /[\\/]sessions[\\/][^\\/]+[\\/]gateway\.json$/u.test(resolve(recordPath));
}

function cleanupNamedSessionGatewayArtifacts(recordPath: string, logPath: string): void {
  if (!isNamedSessionGatewayRecordPath(recordPath)) {
    return;
  }
  removeFileIfExists(logPath);
}

async function stopGateway(
  invocationDirectory: string,
  daemonScriptPath: string,
  recordPath: string,
  logPath: string,
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
    cleanupNamedSessionGatewayArtifacts(recordPath, logPath);
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
    cleanupNamedSessionGatewayArtifacts(recordPath, logPath);
    return {
      stopped: true,
      message: await appendCleanupSummary('removed stale gateway record', record.stateDbPath),
    };
  }

  const signaledTerm = signalPidWithOptionalProcessGroup(record.pid, 'SIGTERM', true);
  if (!signaledTerm) {
    removeGatewayRecord(recordPath);
    cleanupNamedSessionGatewayArtifacts(recordPath, logPath);
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
  cleanupNamedSessionGatewayArtifacts(recordPath, logPath);
  return {
    stopped: true,
    message: await appendCleanupSummary(
      `gateway stopped (pid=${String(record.pid)})`,
      record.stateDbPath,
    ),
  };
}

interface GatewayGcResult {
  scanned: number;
  deleted: number;
  skippedRecent: number;
  skippedLive: number;
  skippedCurrent: number;
  deletedSessions: readonly string[];
  errors: readonly string[];
}

function resolveNamedSessionsRoot(invocationDirectory: string): string {
  const workspaceDirectory = resolveHarnessWorkspaceDirectory(invocationDirectory, process.env);
  return resolve(workspaceDirectory, DEFAULT_SESSION_ROOT_PATH);
}

function listNamedSessionNames(invocationDirectory: string): readonly string[] {
  const sessionsRoot = resolveNamedSessionsRoot(invocationDirectory);
  if (!existsSync(sessionsRoot)) {
    return [];
  }
  return readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function readGatewayRecordForSessionRoot(sessionRoot: string): GatewayRecord | null {
  const recordPath = resolve(sessionRoot, 'gateway.json');
  if (!existsSync(recordPath)) {
    return null;
  }
  try {
    const parsed = parseGatewayRecordText(readFileSync(recordPath, 'utf8'));
    return parsed;
  } catch {
    return null;
  }
}

function resolveNewestSessionArtifactMtimeMs(sessionRoot: string): number {
  let newestMtimeMs = 0;
  const stack: string[] = [sessionRoot];
  while (stack.length > 0) {
    const currentPath = stack.pop()!;
    if (basename(currentPath) === 'gateway.lock') {
      continue;
    }
    let currentStats: ReturnType<typeof statSync>;
    try {
      currentStats = statSync(currentPath);
    } catch {
      continue;
    }
    if (!currentStats.isDirectory()) {
      if (currentStats.mtimeMs > newestMtimeMs) {
        newestMtimeMs = currentStats.mtimeMs;
      }
      continue;
    }
    let childNames: readonly string[] = [];
    try {
      childNames = readdirSync(currentPath, { withFileTypes: true, encoding: 'utf8' }).map(
        (child) => child.name,
      );
    } catch {
      continue;
    }
    for (const childName of childNames) {
      stack.push(resolve(currentPath, childName));
    }
  }
  return newestMtimeMs;
}

async function isSessionGatewayLive(sessionRoot: string): Promise<boolean> {
  const expectedStateDbPath = resolve(sessionRoot, 'control-plane.sqlite');
  const daemonCandidates = listGatewayDaemonProcesses().filter(
    (candidate) => candidate.stateDbPath === expectedStateDbPath,
  );
  if (daemonCandidates.length > 0) {
    return true;
  }
  const record = readGatewayRecordForSessionRoot(sessionRoot);
  if (record === null) {
    return false;
  }
  const probe = await probeGateway(record);
  if (probe.connected) {
    return true;
  }
  return isPidRunning(record.pid);
}

async function runGatewaySessionGc(
  invocationDirectory: string,
  sessionName: string | null,
  options: GatewayGcOptions,
): Promise<GatewayGcResult> {
  const maxAgeMs = options.olderThanDays * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const deletedSessions: string[] = [];
  const errors: string[] = [];
  let scanned = 0;
  let deleted = 0;
  let skippedRecent = 0;
  let skippedLive = 0;
  let skippedCurrent = 0;

  for (const candidateSessionName of listNamedSessionNames(invocationDirectory)) {
    if (sessionName !== null && candidateSessionName === sessionName) {
      skippedCurrent += 1;
      continue;
    }
    scanned += 1;
    const sessionRoot = resolve(
      resolveNamedSessionsRoot(invocationDirectory),
      candidateSessionName,
    );
    const sessionLockPath = resolve(sessionRoot, 'gateway.lock');
    let handle: GatewayControlLockHandle | null = null;
    try {
      handle = await acquireGatewayControlLock(sessionLockPath, invocationDirectory);
      if (!existsSync(sessionRoot)) {
        continue;
      }
      if (await isSessionGatewayLive(sessionRoot)) {
        skippedLive += 1;
        continue;
      }
      const newestMtimeMs = resolveNewestSessionArtifactMtimeMs(sessionRoot);
      if (newestMtimeMs > 0 && nowMs - newestMtimeMs < maxAgeMs) {
        skippedRecent += 1;
        continue;
      }
      rmSync(sessionRoot, { recursive: true, force: true });
      deleted += 1;
      deletedSessions.push(candidateSessionName);
    } catch (error: unknown) {
      errors.push(
        `${candidateSessionName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      handle?.release();
    }
  }

  return {
    scanned,
    deleted,
    skippedRecent,
    skippedLive,
    skippedCurrent,
    deletedSessions,
    errors,
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
  await maybeRefreshLinearOauthTokenForGatewayStart(invocationDirectory, process.env);
  const gatewayRunId = randomUUID();
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
      HARNESS_GATEWAY_RUN_ID: gatewayRunId,
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
      gatewayRunId,
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
  sessionName: string | null,
  daemonScriptPath: string,
  lockPath: string,
  recordPath: string,
  logPath: string,
  defaultStateDbPath: string,
  runtimeOptions: RuntimeInspectOptions,
): Promise<number> {
  const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    return await withGatewayControlLock(lockPath, invocationDirectory, operation);
  };

  if (command.type === 'status') {
    return await withLock(async () => {
      const record = readGatewayRecord(recordPath);
      if (record === null) {
        process.stdout.write('gateway status: stopped\n');
        return 0;
      }
      const pidRunning = isPidRunning(record.pid);
      const probe = await probeGateway(record);
      process.stdout.write(`gateway status: ${probe.connected ? 'running' : 'unreachable'}\n`);
      process.stdout.write(`record: ${recordPath}\n`);
      process.stdout.write(`lock: ${lockPath}\n`);
      process.stdout.write(
        `pid: ${String(record.pid)} (${pidRunning ? 'running' : 'not-running'})\n`,
      );
      process.stdout.write(`host: ${record.host}\n`);
      process.stdout.write(`port: ${String(record.port)}\n`);
      process.stdout.write(`auth: ${record.authToken === null ? 'off' : 'on'}\n`);
      process.stdout.write(`db: ${record.stateDbPath}\n`);
      process.stdout.write(`startedAt: ${record.startedAt}\n`);
      if (typeof record.gatewayRunId === 'string' && record.gatewayRunId.length > 0) {
        process.stdout.write(`runId: ${record.gatewayRunId}\n`);
      }
      process.stdout.write(
        `sessions: total=${String(probe.sessionCount)} live=${String(probe.liveSessionCount)}\n`,
      );
      if (!probe.connected) {
        process.stdout.write(`lastError: ${probe.error ?? 'unknown'}\n`);
        return 1;
      }
      return 0;
    });
  }

  if (command.type === 'stop') {
    const stopOptions = command.stopOptions ?? {
      force: false,
      timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
      cleanupOrphans: true,
    };
    const stopped = await withLock(
      async () =>
        await stopGateway(
          invocationDirectory,
          daemonScriptPath,
          recordPath,
          logPath,
          defaultStateDbPath,
          stopOptions,
        ),
    );
    process.stdout.write(`${stopped.message}\n`);
    return stopped.stopped ? 0 : 1;
  }

  if (command.type === 'start') {
    const ensured = await withLock(
      async () =>
        await ensureGatewayRunning(
          invocationDirectory,
          sessionName,
          recordPath,
          logPath,
          daemonScriptPath,
          defaultStateDbPath,
          command.startOptions ?? {},
          runtimeOptions.gatewayRuntimeArgs,
        ),
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
    process.stdout.write(`lock: ${lockPath}\n`);
    return 0;
  }

  if (command.type === 'gc') {
    const gcOptions = command.gcOptions ?? {
      olderThanDays: DEFAULT_GATEWAY_GC_OLDER_THAN_DAYS,
    };
    const gcResult = await withLock(
      async () => await runGatewaySessionGc(invocationDirectory, sessionName, gcOptions),
    );
    process.stdout.write(
      [
        'gateway gc:',
        `olderThanDays=${String(gcOptions.olderThanDays)}`,
        `scanned=${String(gcResult.scanned)}`,
        `deleted=${String(gcResult.deleted)}`,
        `skippedRecent=${String(gcResult.skippedRecent)}`,
        `skippedLive=${String(gcResult.skippedLive)}`,
        `skippedCurrent=${String(gcResult.skippedCurrent)}`,
      ].join(' ') + '\n',
    );
    if (gcResult.deletedSessions.length > 0) {
      process.stdout.write(`deleted sessions: ${gcResult.deletedSessions.join(', ')}\n`);
    }
    for (const error of gcResult.errors) {
      process.stderr.write(`gateway gc error: ${error}\n`);
    }
    return gcResult.errors.length === 0 ? 0 : 1;
  }

  if (command.type === 'restart') {
    const stopResult = await withLock(
      async () =>
        await stopGateway(
          invocationDirectory,
          daemonScriptPath,
          recordPath,
          logPath,
          defaultStateDbPath,
          {
            force: true,
            timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
            cleanupOrphans: true,
          },
        ),
    );
    process.stdout.write(`${stopResult.message}\n`);
    const ensured = await withLock(
      async () =>
        await ensureGatewayRunning(
          invocationDirectory,
          sessionName,
          recordPath,
          logPath,
          daemonScriptPath,
          defaultStateDbPath,
          command.startOptions ?? {},
          runtimeOptions.gatewayRuntimeArgs,
        ),
    );
    process.stdout.write(
      `gateway restarted pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`,
    );
    process.stdout.write(`record: ${recordPath}\n`);
    process.stdout.write(`log: ${logPath}\n`);
    process.stdout.write(`lock: ${lockPath}\n`);
    return 0;
  }

  if (command.type === 'run') {
    return await withLock(async () => {
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
      process.stdout.write(`lock: ${lockPath}\n`);
      return await runGatewayForeground(
        daemonScriptPath,
        invocationDirectory,
        recordPath,
        settings,
        runtimeOptions.gatewayRuntimeArgs,
      );
    });
  }

  const record = await withLock(async () => readGatewayRecord(recordPath));
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
  lockPath: string,
  recordPath: string,
  logPath: string,
  defaultStateDbPath: string,
  args: readonly string[],
  sessionName: string | null,
  runtimeOptions: RuntimeInspectOptions,
): Promise<number> {
  const ensured = await withGatewayControlLock(
    lockPath,
    invocationDirectory,
    async () =>
      await ensureGatewayRunning(
        invocationDirectory,
        sessionName,
        recordPath,
        logPath,
        daemonScriptPath,
        defaultStateDbPath,
        {},
        runtimeOptions.gatewayRuntimeArgs,
      ),
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

  const gateway = await withGatewayControlLock(
    sessionPaths.lockPath,
    invocationDirectory,
    async () => {
      const existingRecord = readGatewayRecord(sessionPaths.recordPath);
      if (existingRecord !== null) {
        const existingProbe = await probeGateway(existingRecord);
        if (existingProbe.connected || isPidRunning(existingRecord.pid)) {
          throw new Error(
            'profile command requires the target session gateway to be stopped first',
          );
        }
        removeGatewayRecord(sessionPaths.recordPath);
      }

      const host = resolveGatewayHostFromConfigOrEnv(invocationDirectory, process.env);
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

      return await startDetachedGateway(
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
    },
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

  const stopped = await withGatewayControlLock(
    sessionPaths.lockPath,
    invocationDirectory,
    async () =>
      await stopGateway(
        invocationDirectory,
        daemonScriptPath,
        sessionPaths.recordPath,
        sessionPaths.logPath,
        sessionPaths.defaultStateDbPath,
        {
          force: true,
          timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
          cleanupOrphans: true,
        },
      ),
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

interface HarnessCommandRuntime {
  invocationDirectory: string;
  daemonScriptPath: string;
  muxScriptPath: string;
  runtimeOptions: RuntimeInspectOptions;
  sessionName: string | null;
  sessionPaths: SessionPaths;
}

function initializeHarnessRuntime(sessionName: string | null): HarnessCommandRuntime {
  const invocationDirectory = resolveInvocationDirectory(process.env, process.cwd());
  const migration = migrateLegacyHarnessLayout(invocationDirectory, process.env);
  if (migration.migrated) {
    process.stdout.write(
      `[migration] local .harness migrated to global runtime layout (${String(migration.migratedEntries)} entries, configCopied=${String(migration.configCopied)}, secretsCopied=${String(migration.secretsCopied)}, legacyRootRemoved=${String(migration.legacyRootRemoved)})\n`,
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
  const sessionPaths = resolveSessionPaths(invocationDirectory, sessionName);
  return {
    invocationDirectory,
    daemonScriptPath,
    muxScriptPath,
    runtimeOptions,
    sessionName,
    sessionPaths,
  };
}

export async function runGatewayCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  const runtime = initializeHarnessRuntime(sessionName);
  if (args.length === 0) {
    throw new Error('missing gateway subcommand');
  }
  const command = parseGatewayCommand(args);
  return await runGatewayCommandEntry(
    command,
    runtime.invocationDirectory,
    runtime.sessionName,
    runtime.daemonScriptPath,
    runtime.sessionPaths.lockPath,
    runtime.sessionPaths.recordPath,
    runtime.sessionPaths.logPath,
    runtime.sessionPaths.defaultStateDbPath,
    runtime.runtimeOptions,
  );
}

export async function runProfileCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  const runtime = initializeHarnessRuntime(sessionName);
  return await runProfileCommandEntry(
    runtime.invocationDirectory,
    runtime.daemonScriptPath,
    runtime.muxScriptPath,
    runtime.sessionPaths,
    args,
    runtime.sessionName,
    runtime.runtimeOptions,
  );
}

export async function runStatusTimelineCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  const runtime = initializeHarnessRuntime(sessionName);
  return await runStatusTimelineCommandEntry(
    runtime.invocationDirectory,
    runtime.sessionPaths,
    args,
    runtime.sessionName,
  );
}

export async function runRenderTraceCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  const runtime = initializeHarnessRuntime(sessionName);
  return await runRenderTraceCommandEntry(
    runtime.invocationDirectory,
    runtime.sessionPaths,
    args,
    runtime.sessionName,
  );
}

export async function runAuthCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  const runtime = initializeHarnessRuntime(sessionName);
  return await runAuthCommandEntry(runtime.invocationDirectory, args);
}

export function runUpdateCli(args: readonly string[], sessionName: string | null): number {
  const runtime = initializeHarnessRuntime(sessionName);
  if (args.length > 0) {
    throw new Error(`unknown update option: ${args[0]}`);
  }
  return runHarnessUpdateCommand(runtime.invocationDirectory, process.env);
}

export async function runCursorHooksCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  const runtime = initializeHarnessRuntime(sessionName);
  const command = parseCursorHooksCommand(args);
  return await runCursorHooksCommandEntry(runtime.invocationDirectory, command);
}

export async function runDiffCli(
  args: readonly string[],
  _sessionName: string | null,
): Promise<number> {
  void _sessionName;
  if (args.length > 0 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(`${diffUiUsage()}\n`);
    return 0;
  }
  const result = await runDiffUiCli({
    argv: args,
    cwd: process.cwd(),
    env: process.env,
  });
  return result.exitCode;
}

export async function runClientCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  const runtime = initializeHarnessRuntime(sessionName);
  return await runDefaultClient(
    runtime.invocationDirectory,
    runtime.daemonScriptPath,
    runtime.muxScriptPath,
    runtime.sessionPaths.lockPath,
    runtime.sessionPaths.recordPath,
    runtime.sessionPaths.logPath,
    runtime.sessionPaths.defaultStateDbPath,
    args,
    runtime.sessionName,
    runtime.runtimeOptions,
  );
}

export async function runAnimateCli(args: readonly string[]): Promise<number> {
  return await runHarnessAnimate(args);
}
