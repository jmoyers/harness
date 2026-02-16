import { once } from 'node:events';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
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
  isLoopbackHost,
  normalizeGatewayHost,
  normalizeGatewayPort,
  normalizeGatewayStateDbPath,
  parseGatewayRecordText,
  resolveGatewayLogPath,
  resolveGatewayRecordPath,
  resolveInvocationDirectory,
  serializeGatewayRecord,
  type GatewayRecord
} from '../src/cli/gateway-record.ts';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DAEMON_SCRIPT_PATH = resolve(SCRIPT_DIR, 'control-plane-daemon.ts');
const DEFAULT_MUX_SCRIPT_PATH = resolve(SCRIPT_DIR, 'harness-core.ts');
const DEFAULT_GATEWAY_START_RETRY_WINDOW_MS = 6000;
const DEFAULT_GATEWAY_START_RETRY_DELAY_MS = 40;
const DEFAULT_GATEWAY_STOP_TIMEOUT_MS = 5000;
const DEFAULT_GATEWAY_STOP_POLL_MS = 50;

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

interface OrphanSqliteCleanupResult {
  matchedPids: readonly number[];
  terminatedPids: readonly number[];
  failedPids: readonly number[];
  errorMessage: string | null;
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

function tsRuntimeArgs(scriptPath: string, args: readonly string[] = []): string[] {
  return [scriptPath, ...args];
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
    cleanupOrphans: true
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
      options.timeoutMs = parsePositiveIntFlag(readCliValue(argv, index, '--timeout-ms'), '--timeout-ms');
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
    throw new Error('missing command json; use `harness gateway call --json \'{"type":"session.list"}\'`');
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
      startOptions: parseGatewayStartOptions(rest)
    };
  }
  if (subcommand === 'run') {
    return {
      type: 'run',
      startOptions: parseGatewayStartOptions(rest)
    };
  }
  if (subcommand === 'restart') {
    return {
      type: 'restart',
      startOptions: parseGatewayStartOptions(rest)
    };
  }
  if (subcommand === 'stop') {
    return {
      type: 'stop',
      stopOptions: parseGatewayStopOptions(rest)
    };
  }
  if (subcommand === 'status') {
    if (rest.length > 0) {
      throw new Error(`unknown gateway option: ${rest[0]}`);
    }
    return {
      type: 'status'
    };
  }
  if (subcommand === 'call') {
    const parsed = parseGatewayCallOptions(rest);
    return {
      type: 'call',
      callJson: parsed.json
    };
  }
  throw new Error(`unknown gateway subcommand: ${subcommand}`);
}

function printUsage(): void {
  process.stdout.write(
    [
      'usage:',
      '  harness [mux-args...]',
      '  harness gateway start [--host <host>] [--port <port>] [--auth-token <token>] [--state-db-path <path>]',
      '  harness gateway run [--host <host>] [--port <port>] [--auth-token <token>] [--state-db-path <path>]',
      '  harness gateway stop [--force] [--timeout-ms <ms>] [--cleanup-orphans|--no-cleanup-orphans]',
      '  harness gateway status',
      '  harness gateway restart [--host <host>] [--port <port>] [--auth-token <token>] [--state-db-path <path>]',
      '  harness gateway call --json \'{"type":"session.list"}\'',
      '  harness animate [--fps <fps>] [--frames <count>] [--duration-ms <ms>] [--seed <seed>] [--no-color]'
    ].join('\n') + '\n'
  );
}

function resolveScriptPath(envValue: string | undefined, fallback: string, invocationDirectory: string): string {
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

function writeGatewayRecord(recordPath: string, record: GatewayRecord): void {
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, serializeGatewayRecord(record), 'utf8');
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

function readProcessTable(): readonly ProcessTableEntry[] {
  const output = execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8'
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
      command
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

function formatOrphanSqliteCleanupResult(result: OrphanSqliteCleanupResult): string {
  if (result.errorMessage !== null) {
    return `orphan sqlite cleanup error: ${result.errorMessage}`;
  }
  if (result.matchedPids.length === 0) {
    return 'orphan sqlite cleanup: none found';
  }
  if (result.failedPids.length === 0) {
    return `orphan sqlite cleanup: terminated ${String(result.terminatedPids.length)} process(es)`;
  }
  return [
    'orphan sqlite cleanup:',
    `matched=${String(result.matchedPids.length)}`,
    `terminated=${String(result.terminatedPids.length)}`,
    `failed=${String(result.failedPids.length)}`
  ].join(' ');
}

async function cleanupOrphanSqliteProcessesForDbPath(
  stateDbPath: string,
  options: GatewayStopOptions
): Promise<OrphanSqliteCleanupResult> {
  let matchedPids: readonly number[] = [];
  try {
    matchedPids = findOrphanSqlitePidsForDbPath(stateDbPath);
  } catch (error: unknown) {
    return {
      matchedPids: [],
      terminatedPids: [],
      failedPids: [],
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }

  const terminatedPids: number[] = [];
  const failedPids: number[] = [];

  for (const pid of matchedPids) {
    if (!isPidRunning(pid)) {
      continue;
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH') {
        failedPids.push(pid);
      }
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

    try {
      process.kill(pid, 'SIGKILL');
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH') {
        failedPids.push(pid);
      } else {
        terminatedPids.push(pid);
      }
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
    errorMessage: null
  };
}

function resolveGatewaySettings(
  invocationDirectory: string,
  record: GatewayRecord | null,
  overrides: GatewayStartOptions,
  env: NodeJS.ProcessEnv
): ResolvedGatewaySettings {
  const host = normalizeGatewayHost(overrides.host ?? record?.host ?? env.HARNESS_CONTROL_PLANE_HOST);
  const port = normalizeGatewayPort(overrides.port ?? record?.port ?? env.HARNESS_CONTROL_PLANE_PORT);
  const stateDbPathRaw = normalizeGatewayStateDbPath(
    overrides.stateDbPath ?? record?.stateDbPath ?? env.HARNESS_CONTROL_PLANE_DB_PATH
  );
  const stateDbPath = resolve(invocationDirectory, stateDbPathRaw);

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
    stateDbPath
  };
}

async function probeGateway(record: GatewayRecord): Promise<GatewayProbeResult> {
  try {
    const client = await connectControlPlaneStreamClient({
      host: record.host,
      port: record.port,
      ...(record.authToken !== null
        ? {
            authToken: record.authToken
          }
        : {})
    });
    try {
      const result = await client.sendCommand({
        type: 'session.list'
      });
      const sessionsRaw = result['sessions'];
      if (!Array.isArray(sessionsRaw)) {
        return {
          connected: true,
          sessionCount: 0,
          liveSessionCount: 0,
          error: null
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
        error: null
      };
    } finally {
      client.close();
    }
  } catch (error: unknown) {
    return {
      connected: false,
      sessionCount: 0,
      liveSessionCount: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function waitForGatewayReady(record: GatewayRecord): Promise<void> {
  const client = await connectControlPlaneStreamClient({
    host: record.host,
    port: record.port,
    ...(record.authToken !== null
      ? {
          authToken: record.authToken
        }
      : {}),
    connectRetryWindowMs: DEFAULT_GATEWAY_START_RETRY_WINDOW_MS,
    connectRetryDelayMs: DEFAULT_GATEWAY_START_RETRY_DELAY_MS
  });
  try {
    await client.sendCommand({
      type: 'session.list',
      limit: 1
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
  daemonScriptPath: string
): Promise<GatewayRecord> {
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');
  const daemonArgs = tsRuntimeArgs(daemonScriptPath, [
    '--host',
    settings.host,
    '--port',
    String(settings.port),
    '--state-db-path',
    settings.stateDbPath
  ]);
  if (settings.authToken !== null) {
    daemonArgs.push('--auth-token', settings.authToken);
  }
  const child = spawn(process.execPath, daemonArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      HARNESS_INVOKE_CWD: invocationDirectory
    }
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
    workspaceRoot: invocationDirectory
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
  overrides: GatewayStartOptions = {}
): Promise<EnsureGatewayResult> {
  const existingRecord = readGatewayRecord(recordPath);
  if (existingRecord !== null) {
    const probe = await probeGateway(existingRecord);
    if (probe.connected) {
      return {
        record: existingRecord,
        started: false
      };
    }
    if (isPidRunning(existingRecord.pid)) {
      throw new Error(
        `gateway record is present but unreachable (pid=${String(existingRecord.pid)} still running): ${probe.error ?? 'unknown error'}`
      );
    }
    removeGatewayRecord(recordPath);
  }

  const settings = resolveGatewaySettings(invocationDirectory, existingRecord, overrides, process.env);
  const record = await startDetachedGateway(
    invocationDirectory,
    recordPath,
    logPath,
    settings,
    daemonScriptPath
  );
  return {
    record,
    started: true
  };
}

async function stopGateway(
  recordPath: string,
  options: GatewayStopOptions
): Promise<{ stopped: boolean; message: string }> {
  const record = readGatewayRecord(recordPath);
  if (record === null) {
    return {
      stopped: false,
      message: 'gateway not running (no record)'
    };
  }

  const probe = await probeGateway(record);
  const pidRunning = isPidRunning(record.pid);

  const appendCleanupSummary = async (baseMessage: string): Promise<string> => {
    if (!options.cleanupOrphans) {
      return baseMessage;
    }
    const cleanupResult = await cleanupOrphanSqliteProcessesForDbPath(record.stateDbPath, options);
    return `${baseMessage}; ${formatOrphanSqliteCleanupResult(cleanupResult)}`;
  };

  if (!probe.connected && pidRunning && !options.force) {
    return {
      stopped: false,
      message: `gateway record points to a running but unreachable process (pid=${String(record.pid)}); re-run with --force`
    };
  }

  if (!pidRunning) {
    removeGatewayRecord(recordPath);
    return {
      stopped: true,
      message: await appendCleanupSummary('removed stale gateway record')
    };
  }

  try {
    process.kill(record.pid, 'SIGTERM');
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      removeGatewayRecord(recordPath);
      return {
        stopped: true,
        message: 'gateway already exited'
      };
    }
    throw error;
  }

  const exitedAfterTerm = await waitForPidExit(record.pid, options.timeoutMs);
  if (!exitedAfterTerm && options.force) {
    try {
      process.kill(record.pid, 'SIGKILL');
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH') {
        throw error;
      }
    }
    const exitedAfterKill = await waitForPidExit(record.pid, options.timeoutMs);
    if (!exitedAfterKill) {
      return {
        stopped: false,
        message: `gateway did not exit after SIGKILL (pid=${String(record.pid)})`
      };
    }
  } else if (!exitedAfterTerm) {
    return {
      stopped: false,
      message: `gateway did not exit after ${String(options.timeoutMs)}ms; retry with --force`
    };
  }

  removeGatewayRecord(recordPath);
  return {
    stopped: true,
    message: await appendCleanupSummary(`gateway stopped (pid=${String(record.pid)})`)
  };
}

async function runMuxClient(
  muxScriptPath: string,
  invocationDirectory: string,
  gateway: GatewayRecord,
  passthroughArgs: readonly string[]
): Promise<number> {
  const args = tsRuntimeArgs(muxScriptPath, [
    '--harness-server-host',
    gateway.host,
    '--harness-server-port',
    String(gateway.port),
    ...(gateway.authToken === null ? [] : ['--harness-server-token', gateway.authToken]),
    ...passthroughArgs
  ]);

  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      HARNESS_INVOKE_CWD: invocationDirectory
    }
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
  settings: ResolvedGatewaySettings
): Promise<number> {
  const existingRecord = readGatewayRecord(recordPath);
  if (existingRecord !== null) {
    const probe = await probeGateway(existingRecord);
    if (probe.connected || isPidRunning(existingRecord.pid)) {
      throw new Error('gateway is already running; stop it first or use `harness gateway start`');
    }
    removeGatewayRecord(recordPath);
  }

  const daemonArgs = tsRuntimeArgs(daemonScriptPath, [
    '--host',
    settings.host,
    '--port',
    String(settings.port),
    '--state-db-path',
    settings.stateDbPath
  ]);
  if (settings.authToken !== null) {
    daemonArgs.push('--auth-token', settings.authToken);
  }

  const child = spawn(process.execPath, daemonArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      HARNESS_INVOKE_CWD: invocationDirectory
    }
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
      workspaceRoot: invocationDirectory
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
    throw new Error(`invalid JSON command: ${error instanceof Error ? error.message : String(error)}`);
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
          authToken: record.authToken
        })
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
  logPath: string
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
    process.stdout.write(`pid: ${String(record.pid)} (${pidRunning ? 'running' : 'not-running'})\n`);
    process.stdout.write(`host: ${record.host}\n`);
    process.stdout.write(`port: ${String(record.port)}\n`);
    process.stdout.write(`auth: ${record.authToken === null ? 'off' : 'on'}\n`);
    process.stdout.write(`db: ${record.stateDbPath}\n`);
    process.stdout.write(`startedAt: ${record.startedAt}\n`);
    process.stdout.write(`sessions: total=${String(probe.sessionCount)} live=${String(probe.liveSessionCount)}\n`);
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
      cleanupOrphans: true
    };
    const stopped = await stopGateway(recordPath, stopOptions);
    process.stdout.write(`${stopped.message}\n`);
    return stopped.stopped ? 0 : 1;
  }

  if (command.type === 'start') {
    const ensured = await ensureGatewayRunning(
      invocationDirectory,
      recordPath,
      logPath,
      daemonScriptPath,
      command.startOptions ?? {}
    );
    if (ensured.started) {
      process.stdout.write(
        `gateway started pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`
      );
    } else {
      process.stdout.write(
        `gateway already running pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`
      );
    }
    process.stdout.write(`record: ${recordPath}\n`);
    process.stdout.write(`log: ${logPath}\n`);
    return 0;
  }

  if (command.type === 'restart') {
    const stopResult = await stopGateway(recordPath, {
      force: true,
      timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
      cleanupOrphans: true
    });
    process.stdout.write(`${stopResult.message}\n`);
    const ensured = await ensureGatewayRunning(
      invocationDirectory,
      recordPath,
      logPath,
      daemonScriptPath,
      command.startOptions ?? {}
    );
    process.stdout.write(
      `gateway restarted pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`
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
      process.env
    );
    process.stdout.write(
      `gateway foreground run host=${settings.host} port=${String(settings.port)} db=${settings.stateDbPath}\n`
    );
    return await runGatewayForeground(daemonScriptPath, invocationDirectory, recordPath, settings);
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
  args: readonly string[]
): Promise<number> {
  const ensured = await ensureGatewayRunning(
    invocationDirectory,
    recordPath,
    logPath,
    daemonScriptPath
  );
  if (ensured.started) {
    process.stdout.write(
      `gateway started pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`
    );
  }
  return await runMuxClient(muxScriptPath, invocationDirectory, ensured.record, args);
}

async function main(): Promise<number> {
  const invocationDirectory = resolveInvocationDirectory(process.env, process.cwd());
  loadHarnessSecrets({ cwd: invocationDirectory });
  const recordPath = resolveGatewayRecordPath(invocationDirectory);
  const logPath = resolveGatewayLogPath(invocationDirectory);
  const daemonScriptPath = resolveScriptPath(
    process.env.HARNESS_DAEMON_SCRIPT_PATH,
    DEFAULT_DAEMON_SCRIPT_PATH,
    invocationDirectory
  );
  const muxScriptPath = resolveScriptPath(
    process.env.HARNESS_MUX_SCRIPT_PATH,
    DEFAULT_MUX_SCRIPT_PATH,
    invocationDirectory
  );

  const argv = process.argv.slice(2);
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
      recordPath,
      logPath
    );
  }

  if (argv.length > 0 && argv[0] === 'animate') {
    return await runHarnessAnimate(argv.slice(1));
  }

  const passthroughArgs = argv[0] === 'client' ? argv.slice(1) : argv;
  return await runDefaultClient(
    invocationDirectory,
    daemonScriptPath,
    muxScriptPath,
    recordPath,
    logPath,
    passthroughArgs
  );
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  process.stderr.write(`harness fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
