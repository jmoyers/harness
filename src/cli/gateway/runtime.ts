import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { basename, dirname, resolve } from 'node:path';
import { connectControlPlaneStreamClient } from '../../control-plane/stream-client.ts';
import { parseStreamCommand } from '../../control-plane/stream-command-parser.ts';
import type { StreamCommand } from '../../control-plane/stream-protocol.ts';
import {
  GATEWAY_RECORD_VERSION,
  isLoopbackHost,
  normalizeGatewayHost,
  normalizeGatewayPort,
  normalizeGatewayStateDbPath,
  parseGatewayRecordText,
  type GatewayRecord,
} from '../gateway-record.ts';
import { loadHarnessConfig } from '../../config/config-core.ts';
import {
  resolveHarnessRuntimePath,
  resolveHarnessWorkspaceDirectory,
} from '../../config/harness-paths.ts';
import { parsePortFlag, parsePositiveIntFlag, readCliValue } from '../parsing/flags.ts';
import {
  GatewayControlInfra,
  type ParsedGatewayDaemonEntry,
} from '../runtime-infra/gateway-control.ts';

const DEFAULT_GATEWAY_START_RETRY_WINDOW_MS = 6000;
const DEFAULT_GATEWAY_START_RETRY_DELAY_MS = 40;
export const DEFAULT_GATEWAY_STOP_TIMEOUT_MS = 5000;
const DEFAULT_GATEWAY_GC_OLDER_THAN_DAYS = 7;
const DEFAULT_SESSION_ROOT_PATH = 'sessions';

export interface GatewayStartOptions {
  host?: string;
  port?: number;
  authToken?: string;
  stateDbPath?: string;
}

export interface GatewayStopOptions {
  force: boolean;
  timeoutMs: number;
  cleanupOrphans: boolean;
}

export interface GatewayGcOptions {
  olderThanDays: number;
}

interface ParsedGatewayCommand {
  type: 'start' | 'stop' | 'status' | 'restart' | 'run' | 'call' | 'gc';
  startOptions?: GatewayStartOptions;
  stopOptions?: GatewayStopOptions;
  callJson?: string;
  gcOptions?: GatewayGcOptions;
}

interface RuntimeInspectOptions {
  readonly gatewayRuntimeArgs: readonly string[];
  readonly clientRuntimeArgs: readonly string[];
}

interface GatewayAuthCoordinator {
  refreshLinearOauthTokenBeforeGatewayStart(): Promise<void>;
}

interface GatewayRuntimeContext {
  readonly invocationDirectory: string;
  readonly sessionName: string | null;
  readonly daemonScriptPath: string;
  readonly muxScriptPath: string;
  readonly gatewayRecordPath: string;
  readonly gatewayLogPath: string;
  readonly gatewayLockPath: string;
  readonly gatewayDefaultStateDbPath: string;
  readonly runtimeOptions: RuntimeInspectOptions;
  readonly authRuntime: GatewayAuthCoordinator;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly writeStdout?: (text: string) => void;
  readonly writeStderr?: (text: string) => void;
}

export interface ResolvedGatewaySettings {
  host: string;
  port: number;
  authToken: string | null;
  stateDbPath: string;
}

export interface GatewayProbeResult {
  connected: boolean;
  sessionCount: number;
  liveSessionCount: number;
  error: string | null;
}

export interface EnsureGatewayResult {
  record: GatewayRecord;
  started: boolean;
}

export interface GatewayStopResult {
  stopped: boolean;
  message: string;
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

function tsRuntimeArgs(
  scriptPath: string,
  args: readonly string[] = [],
  runtimeArgs: readonly string[] = [],
): string[] {
  return [...runtimeArgs, scriptPath, ...args];
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

class GatewayCommandParser {
  public constructor() {}

  public parse(argv: readonly string[]): ParsedGatewayCommand {
    if (argv.length === 0) {
      throw new Error('missing gateway subcommand');
    }
    const subcommand = argv[0]!;
    const rest = argv.slice(1);
    if (subcommand === 'start') {
      return {
        type: 'start',
        startOptions: this.parseGatewayStartOptions(rest),
      };
    }
    if (subcommand === 'run') {
      return {
        type: 'run',
        startOptions: this.parseGatewayStartOptions(rest),
      };
    }
    if (subcommand === 'restart') {
      return {
        type: 'restart',
        startOptions: this.parseGatewayStartOptions(rest),
      };
    }
    if (subcommand === 'stop') {
      return {
        type: 'stop',
        stopOptions: this.parseGatewayStopOptions(rest),
      };
    }
    if (subcommand === 'status') {
      if (rest.length > 0) {
        throw new Error(`unknown gateway option: ${rest[0]}`);
      }
      return { type: 'status' };
    }
    if (subcommand === 'call') {
      return {
        type: 'call',
        callJson: this.parseGatewayCallJson(rest),
      };
    }
    if (subcommand === 'gc') {
      return {
        type: 'gc',
        gcOptions: this.parseGatewayGcOptions(rest),
      };
    }
    throw new Error(`unknown gateway subcommand: ${subcommand}`);
  }

  private parseGatewayStartOptions(argv: readonly string[]): GatewayStartOptions {
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

  private parseGatewayStopOptions(argv: readonly string[]): GatewayStopOptions {
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

  private parseGatewayCallJson(argv: readonly string[]): string {
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
    return json;
  }

  private parseGatewayGcOptions(argv: readonly string[]): GatewayGcOptions {
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
}

export class GatewayRuntimeService {
  public readonly parser: GatewayCommandParser;
  private readonly infra: GatewayControlInfra;

  constructor(
    private readonly runtime: GatewayRuntimeContext,
    options: { parser?: GatewayCommandParser; infra?: GatewayControlInfra } = {},
  ) {
    this.parser = options.parser ?? new GatewayCommandParser();
    const infraOverrides = {
      ...(this.runtime.env === undefined ? {} : { env: this.runtime.env }),
      ...(this.runtime.cwd === undefined ? {} : { cwd: this.runtime.cwd }),
    };
    this.infra = options.infra ?? new GatewayControlInfra(infraOverrides);
  }

  private env(): NodeJS.ProcessEnv {
    return this.runtime.env ?? process.env;
  }

  private writeStdout(text: string): void {
    if (this.runtime.writeStdout !== undefined) {
      this.runtime.writeStdout(text);
      return;
    }
    process.stdout.write(text);
  }

  private writeStderr(text: string): void {
    if (this.runtime.writeStderr !== undefined) {
      this.runtime.writeStderr(text);
      return;
    }
    process.stderr.write(text);
  }

  public parseCommand(argv: readonly string[]): ParsedGatewayCommand {
    return this.parser.parse(argv);
  }

  public withLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.infra.withGatewayControlLock(
      this.runtime.gatewayLockPath,
      this.runtime.invocationDirectory,
      operation,
    );
  }

  public readGatewayRecord(): GatewayRecord | null {
    return this.infra.readGatewayRecord(this.runtime.gatewayRecordPath);
  }

  public removeGatewayRecord(): void {
    this.infra.removeGatewayRecord(this.runtime.gatewayRecordPath);
  }

  public isPidRunning(pid: number): boolean {
    return this.infra.isPidRunning(pid);
  }

  public async waitForFileExists(filePath: string, timeoutMs: number): Promise<boolean> {
    return await this.infra.waitForFileExists(filePath, timeoutMs);
  }

  public resolveGatewayHostFromConfigOrEnv(): string {
    const loadedConfig = loadHarnessConfig({
      cwd: this.runtime.invocationDirectory,
      env: this.env(),
    });
    return normalizeGatewayHost(
      this.env().HARNESS_CONTROL_PLANE_HOST ?? loadedConfig.config.gateway.host,
    );
  }

  public async reservePort(host: string): Promise<number> {
    return await new Promise<number>((resolvePort, reject) => {
      const server = createNetServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, host, () => {
        const address = server.address();
        if (address === null) {
          server.close();
          reject(new Error('failed to reserve local port'));
          return;
        }
        const port = (address as AddressInfo).port;
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

  public resolveGatewaySettings(
    record: GatewayRecord | null,
    overrides: GatewayStartOptions,
  ): ResolvedGatewaySettings {
    const host = normalizeGatewayHost(
      overrides.host ?? record?.host ?? this.resolveGatewayHostFromConfigOrEnv(),
    );
    const port = normalizeGatewayPort(
      overrides.port ?? record?.port ?? this.env().HARNESS_CONTROL_PLANE_PORT,
    );
    const configuredStateDbPath = overrides.stateDbPath ?? this.runtime.gatewayDefaultStateDbPath;
    const stateDbPathRaw = normalizeGatewayStateDbPath(
      configuredStateDbPath,
      this.runtime.gatewayDefaultStateDbPath,
    );
    const stateDbPath = resolveHarnessRuntimePath(
      this.runtime.invocationDirectory,
      stateDbPathRaw,
      this.env(),
    );
    if (
      !this.infra.isPathWithinWorkspaceRuntimeScope(stateDbPath, this.runtime.invocationDirectory)
    ) {
      const runtimeRoot = resolveHarnessWorkspaceDirectory(
        this.runtime.invocationDirectory,
        this.env(),
      );
      throw new Error(
        `invalid --state-db-path: ${stateDbPath}. state db path must be under workspace runtime root ${runtimeRoot}`,
      );
    }

    const envAuthToken = this.env().HARNESS_CONTROL_PLANE_AUTH_TOKEN;
    const envToken =
      typeof envAuthToken === 'string' && envAuthToken.trim().length > 0
        ? envAuthToken.trim()
        : null;
    const explicitToken = overrides.authToken ?? record?.authToken ?? envToken;
    const authToken = explicitToken ?? (isLoopbackHost(host) ? `gateway-${randomUUID()}` : null);
    if (!isLoopbackHost(host) && authToken === null) {
      throw new Error(
        'non-loopback hosts require --auth-token or HARNESS_CONTROL_PLANE_AUTH_TOKEN',
      );
    }

    return {
      host,
      port,
      authToken,
      stateDbPath,
    };
  }

  public async probeGatewayEndpoint(
    host: string,
    port: number,
    authToken: string | null,
  ): Promise<GatewayProbeResult> {
    try {
      const client = await connectControlPlaneStreamClient({
        host,
        port,
        ...(authToken === null ? {} : { authToken }),
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

  public async probeGateway(record: GatewayRecord): Promise<GatewayProbeResult> {
    return await this.probeGatewayEndpoint(record.host, record.port, record.authToken);
  }

  private async waitForGatewayReady(record: GatewayRecord): Promise<void> {
    const client = await connectControlPlaneStreamClient({
      host: record.host,
      port: record.port,
      ...(record.authToken === null ? {} : { authToken: record.authToken }),
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

  public async startDetachedGateway(
    settings: ResolvedGatewaySettings,
    runtimeArgs: readonly string[] = this.runtime.runtimeOptions.gatewayRuntimeArgs,
  ): Promise<GatewayRecord> {
    await this.runtime.authRuntime.refreshLinearOauthTokenBeforeGatewayStart();
    mkdirSync(dirname(this.runtime.gatewayLogPath), { recursive: true });
    const logFd = openSync(this.runtime.gatewayLogPath, 'a');
    const gatewayRunId = randomUUID();
    const daemonArgs = tsRuntimeArgs(
      this.runtime.daemonScriptPath,
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
        ...this.env(),
        HARNESS_INVOKE_CWD: this.runtime.invocationDirectory,
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
      workspaceRoot: this.runtime.invocationDirectory,
      gatewayRunId,
    };

    try {
      await this.waitForGatewayReady(record);
      if (!this.infra.isPidRunning(child.pid)) {
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

    this.infra.writeGatewayRecord(this.runtime.gatewayRecordPath, record);
    child.unref();
    return record;
  }

  private authTokenMatches(
    candidate: ParsedGatewayDaemonEntry,
    expectedAuthToken: string | null,
  ): boolean {
    if (expectedAuthToken === null) {
      return candidate.authToken === null;
    }
    return candidate.authToken === expectedAuthToken;
  }

  private findReachableGatewayDaemonCandidates(
    settings: ResolvedGatewaySettings,
  ): readonly ParsedGatewayDaemonEntry[] {
    return this.infra.listGatewayDaemonProcesses().filter((candidate) => {
      if (candidate.host !== settings.host || candidate.port !== settings.port) {
        return false;
      }
      if (!this.authTokenMatches(candidate, settings.authToken)) {
        return false;
      }
      return this.infra.isPathWithinWorkspaceRuntimeScope(
        candidate.stateDbPath,
        this.runtime.invocationDirectory,
      );
    });
  }

  private findGatewayDaemonCandidatesByStateDbPath(
    stateDbPath: string,
  ): readonly ParsedGatewayDaemonEntry[] {
    const normalizedStateDbPath = resolve(stateDbPath);
    return this.infra.listGatewayDaemonProcesses().filter((candidate) => {
      if (candidate.stateDbPath !== normalizedStateDbPath) {
        return false;
      }
      return this.infra.isPathWithinWorkspaceRuntimeScope(
        candidate.stateDbPath,
        this.runtime.invocationDirectory,
      );
    });
  }

  private createAdoptedGatewayRecord(daemon: ParsedGatewayDaemonEntry): GatewayRecord {
    return {
      version: GATEWAY_RECORD_VERSION,
      pid: daemon.pid,
      host: daemon.host,
      port: daemon.port,
      authToken: daemon.authToken,
      stateDbPath: daemon.stateDbPath,
      startedAt: new Date().toISOString(),
      workspaceRoot: this.runtime.invocationDirectory,
    };
  }

  private shouldAutoResolveNamedSessionPort(overrides: GatewayStartOptions): boolean {
    if (this.runtime.sessionName === null) {
      return false;
    }
    return overrides.port === undefined;
  }

  private async resolveAdoptableGatewayByStateDbPath(
    stateDbPath: string,
  ): Promise<ParsedGatewayDaemonEntry | null> {
    const candidates = this.findGatewayDaemonCandidatesByStateDbPath(stateDbPath);
    const reachable: ParsedGatewayDaemonEntry[] = [];
    for (const candidate of candidates) {
      const probe = await this.probeGatewayEndpoint(
        candidate.host,
        candidate.port,
        candidate.authToken,
      );
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
    return reachable[0]!;
  }

  private async canBindPort(host: string, port: number): Promise<boolean> {
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

  public async ensureGatewayRunning(
    overrides: GatewayStartOptions = {},
    daemonRuntimeArgs: readonly string[] = this.runtime.runtimeOptions.gatewayRuntimeArgs,
  ): Promise<EnsureGatewayResult> {
    const existingRecord = this.readGatewayRecord();
    if (existingRecord !== null) {
      const probe = await this.probeGateway(existingRecord);
      if (probe.connected) {
        return { record: existingRecord, started: false };
      }
      if (this.infra.isPidRunning(existingRecord.pid)) {
        throw new Error(
          `gateway record is present but unreachable (pid=${String(existingRecord.pid)} still running): ${probe.error ?? 'unknown error'}`,
        );
      }
      this.removeGatewayRecord();
    }

    const settings = this.resolveGatewaySettings(existingRecord, overrides);
    if (existingRecord === null) {
      const adoptedByDbPath = await this.resolveAdoptableGatewayByStateDbPath(settings.stateDbPath);
      if (adoptedByDbPath !== null) {
        const adoptedRecord = this.createAdoptedGatewayRecord(adoptedByDbPath);
        this.infra.writeGatewayRecord(this.runtime.gatewayRecordPath, adoptedRecord);
        return { record: adoptedRecord, started: false };
      }
    }

    let resolvedSettings = settings;
    if (existingRecord === null) {
      const endpointProbe = await this.probeGatewayEndpoint(
        resolvedSettings.host,
        resolvedSettings.port,
        resolvedSettings.authToken,
      );
      if (endpointProbe.connected) {
        const candidates = this.findReachableGatewayDaemonCandidates(resolvedSettings);
        if (candidates.length === 1) {
          const adopted = this.createAdoptedGatewayRecord(candidates[0]!);
          this.infra.writeGatewayRecord(this.runtime.gatewayRecordPath, adopted);
          return { record: adopted, started: false };
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

      if (this.shouldAutoResolveNamedSessionPort(overrides)) {
        const currentPortAvailable = await this.canBindPort(
          resolvedSettings.host,
          resolvedSettings.port,
        );
        if (!currentPortAvailable) {
          const fallbackPort = await this.reservePort(resolvedSettings.host);
          resolvedSettings = {
            ...resolvedSettings,
            port: fallbackPort,
          };
        }
      }
    }

    return {
      record: await this.startDetachedGateway(resolvedSettings, daemonRuntimeArgs),
      started: true,
    };
  }

  private cleanupNamedSessionGatewayArtifacts(): void {
    const recordPath = resolve(this.runtime.gatewayRecordPath);
    if (!/[\\/]sessions[\\/][^\\/]+[\\/]gateway\.json$/u.test(recordPath)) {
      return;
    }
    try {
      rmSync(this.runtime.gatewayLogPath, { force: true });
    } catch {
      // best-effort cleanup only
    }
  }

  public async stopGateway(options: GatewayStopOptions): Promise<GatewayStopResult> {
    const appendCleanupSummary = async (
      baseMessage: string,
      stateDbPath: string,
    ): Promise<string> => {
      if (!options.cleanupOrphans) {
        return baseMessage;
      }
      const [gatewayCleanupResult, ptyCleanupResult, relayCleanupResult, sqliteCleanupResult] =
        await Promise.all([
          this.infra.cleanupOrphanGatewayDaemons(
            stateDbPath,
            this.runtime.daemonScriptPath,
            options,
          ),
          this.infra.cleanupOrphanPtyHelpersForWorkspace(this.runtime.invocationDirectory, options),
          this.infra.cleanupOrphanRelayLinkedAgentsForWorkspace(
            this.runtime.invocationDirectory,
            options,
          ),
          this.infra.cleanupOrphanSqliteProcessesForDbPath(stateDbPath, options),
        ]);
      return [
        baseMessage,
        this.infra.formatOrphanProcessCleanupResult('orphan gateway daemon', gatewayCleanupResult),
        this.infra.formatOrphanProcessCleanupResult('orphan pty helper', ptyCleanupResult),
        this.infra.formatOrphanProcessCleanupResult(
          'orphan relay-linked agent',
          relayCleanupResult,
        ),
        this.infra.formatOrphanProcessCleanupResult('orphan sqlite', sqliteCleanupResult),
      ].join('; ');
    };

    const record = this.readGatewayRecord();
    if (record === null) {
      this.cleanupNamedSessionGatewayArtifacts();
      return {
        stopped: false,
        message: await appendCleanupSummary(
          'gateway not running (no record)',
          this.runtime.gatewayDefaultStateDbPath,
        ),
      };
    }

    const probe = await this.probeGateway(record);
    const pidRunning = this.infra.isPidRunning(record.pid);
    if (!probe.connected && pidRunning && !options.force) {
      return {
        stopped: false,
        message: `gateway record points to a running but unreachable process (pid=${String(record.pid)}); re-run with --force`,
      };
    }

    if (!pidRunning) {
      this.removeGatewayRecord();
      this.cleanupNamedSessionGatewayArtifacts();
      return {
        stopped: true,
        message: await appendCleanupSummary('removed stale gateway record', record.stateDbPath),
      };
    }

    const signaledTerm = this.infra.signalPidWithOptionalProcessGroup(record.pid, 'SIGTERM', true);
    if (!signaledTerm) {
      this.removeGatewayRecord();
      this.cleanupNamedSessionGatewayArtifacts();
      return {
        stopped: true,
        message: await appendCleanupSummary('gateway already exited', record.stateDbPath),
      };
    }

    const exitedAfterTerm = await this.infra.waitForPidExit(record.pid, options.timeoutMs);
    if (!exitedAfterTerm && options.force) {
      this.infra.signalPidWithOptionalProcessGroup(record.pid, 'SIGKILL', true);
      const exitedAfterKill = await this.infra.waitForPidExit(record.pid, options.timeoutMs);
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

    this.removeGatewayRecord();
    this.cleanupNamedSessionGatewayArtifacts();
    return {
      stopped: true,
      message: await appendCleanupSummary(
        `gateway stopped (pid=${String(record.pid)})`,
        record.stateDbPath,
      ),
    };
  }

  private resolveNamedSessionsRoot(): string {
    const workspaceDirectory = resolveHarnessWorkspaceDirectory(
      this.runtime.invocationDirectory,
      this.env(),
    );
    return resolve(workspaceDirectory, DEFAULT_SESSION_ROOT_PATH);
  }

  private listNamedSessionNames(): readonly string[] {
    const sessionsRoot = this.resolveNamedSessionsRoot();
    if (!existsSync(sessionsRoot)) {
      return [];
    }
    return readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  }

  private readGatewayRecordForSessionRoot(sessionRoot: string): GatewayRecord | null {
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

  private resolveNewestSessionArtifactMtimeMs(sessionRoot: string): number {
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

  private async isSessionGatewayLive(sessionRoot: string): Promise<boolean> {
    const expectedStateDbPath = resolve(sessionRoot, 'control-plane.sqlite');
    const daemonCandidates = this.infra
      .listGatewayDaemonProcesses()
      .filter((candidate) => candidate.stateDbPath === expectedStateDbPath);
    if (daemonCandidates.length > 0) {
      return true;
    }
    const record = this.readGatewayRecordForSessionRoot(sessionRoot);
    if (record === null) {
      return false;
    }
    const probe = await this.probeGateway(record);
    if (probe.connected) {
      return true;
    }
    return this.infra.isPidRunning(record.pid);
  }

  public async runGatewaySessionGc(options: GatewayGcOptions): Promise<GatewayGcResult> {
    const maxAgeMs = options.olderThanDays * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const deletedSessions: string[] = [];
    const errors: string[] = [];
    let scanned = 0;
    let deleted = 0;
    let skippedRecent = 0;
    let skippedLive = 0;
    let skippedCurrent = 0;

    for (const candidateSessionName of this.listNamedSessionNames()) {
      if (this.runtime.sessionName !== null && candidateSessionName === this.runtime.sessionName) {
        skippedCurrent += 1;
        continue;
      }
      scanned += 1;
      const sessionRoot = resolve(this.resolveNamedSessionsRoot(), candidateSessionName);
      const sessionLockPath = resolve(sessionRoot, 'gateway.lock');
      let handle: Awaited<ReturnType<GatewayControlInfra['acquireGatewayControlLock']>> | null =
        null;
      try {
        handle = await this.infra.acquireGatewayControlLock(
          sessionLockPath,
          this.runtime.invocationDirectory,
        );
        if (!existsSync(sessionRoot)) {
          continue;
        }
        if (await this.isSessionGatewayLive(sessionRoot)) {
          skippedLive += 1;
          continue;
        }
        const newestMtimeMs = this.resolveNewestSessionArtifactMtimeMs(sessionRoot);
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

  public async runMuxClient(
    gateway: GatewayRecord,
    passthroughArgs: readonly string[],
    runtimeArgs: readonly string[] = this.runtime.runtimeOptions.clientRuntimeArgs,
  ): Promise<number> {
    const args = tsRuntimeArgs(
      this.runtime.muxScriptPath,
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
        ...this.env(),
        HARNESS_INVOKE_CWD: this.runtime.invocationDirectory,
        ...(this.runtime.sessionName === null
          ? {}
          : { HARNESS_SESSION_NAME: this.runtime.sessionName }),
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

  public async runGatewayForeground(
    settings: ResolvedGatewaySettings,
    runtimeArgs: readonly string[] = this.runtime.runtimeOptions.gatewayRuntimeArgs,
  ): Promise<number> {
    await this.runtime.authRuntime.refreshLinearOauthTokenBeforeGatewayStart();
    const gatewayRunId = randomUUID();
    const existingRecord = this.readGatewayRecord();
    if (existingRecord !== null) {
      const probe = await this.probeGateway(existingRecord);
      if (probe.connected || this.infra.isPidRunning(existingRecord.pid)) {
        throw new Error('gateway is already running; stop it first or use `harness gateway start`');
      }
      this.removeGatewayRecord();
    }

    const daemonArgs = tsRuntimeArgs(
      this.runtime.daemonScriptPath,
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
        ...this.env(),
        HARNESS_INVOKE_CWD: this.runtime.invocationDirectory,
        HARNESS_GATEWAY_RUN_ID: gatewayRunId,
      },
    });
    if (child.pid !== undefined) {
      this.infra.writeGatewayRecord(this.runtime.gatewayRecordPath, {
        version: GATEWAY_RECORD_VERSION,
        pid: child.pid,
        host: settings.host,
        port: settings.port,
        authToken: settings.authToken,
        stateDbPath: settings.stateDbPath,
        startedAt: new Date().toISOString(),
        workspaceRoot: this.runtime.invocationDirectory,
        gatewayRunId,
      });
    }

    const exit = await once(child, 'exit');
    const code = (exit[0] as number | null) ?? null;
    const signal = (exit[1] as NodeJS.Signals | null) ?? null;
    const record = this.readGatewayRecord();
    if (record !== null && child.pid !== undefined && record.pid === child.pid) {
      this.removeGatewayRecord();
    }
    if (code !== null) {
      return code;
    }
    return normalizeSignalExitCode(signal);
  }

  private parseCallCommand(raw: string): StreamCommand {
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

  private async executeGatewayCall(record: GatewayRecord, rawCommand: string): Promise<number> {
    const command = this.parseCallCommand(rawCommand);
    const client = await connectControlPlaneStreamClient({
      host: record.host,
      port: record.port,
      ...(record.authToken === null ? {} : { authToken: record.authToken }),
    });
    try {
      const result = await client.sendCommand(command);
      this.writeStdout(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
      client.close();
    }
    return 0;
  }

  public async run(command: ParsedGatewayCommand): Promise<number> {
    if (command.type === 'status') {
      return await this.withLock(async () => {
        const record = this.readGatewayRecord();
        if (record === null) {
          this.writeStdout('gateway status: stopped\n');
          return 0;
        }
        const pidRunning = this.infra.isPidRunning(record.pid);
        const probe = await this.probeGateway(record);
        this.writeStdout(`gateway status: ${probe.connected ? 'running' : 'unreachable'}\n`);
        this.writeStdout(`record: ${this.runtime.gatewayRecordPath}\n`);
        this.writeStdout(`lock: ${this.runtime.gatewayLockPath}\n`);
        this.writeStdout(
          `pid: ${String(record.pid)} (${pidRunning ? 'running' : 'not-running'})\n`,
        );
        this.writeStdout(`host: ${record.host}\n`);
        this.writeStdout(`port: ${String(record.port)}\n`);
        this.writeStdout(`auth: ${record.authToken === null ? 'off' : 'on'}\n`);
        this.writeStdout(`db: ${record.stateDbPath}\n`);
        this.writeStdout(`startedAt: ${record.startedAt}\n`);
        if (typeof record.gatewayRunId === 'string' && record.gatewayRunId.length > 0) {
          this.writeStdout(`runId: ${record.gatewayRunId}\n`);
        }
        this.writeStdout(
          `sessions: total=${String(probe.sessionCount)} live=${String(probe.liveSessionCount)}\n`,
        );
        if (!probe.connected) {
          this.writeStdout(`lastError: ${probe.error ?? 'unknown'}\n`);
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
      const stopped = await this.withLock(async () => await this.stopGateway(stopOptions));
      this.writeStdout(`${stopped.message}\n`);
      return stopped.stopped ? 0 : 1;
    }

    if (command.type === 'start') {
      const ensured = await this.withLock(
        async () => await this.ensureGatewayRunning(command.startOptions ?? {}),
      );
      if (ensured.started) {
        this.writeStdout(
          `gateway started pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`,
        );
      } else {
        this.writeStdout(
          `gateway already running pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`,
        );
      }
      this.writeStdout(`record: ${this.runtime.gatewayRecordPath}\n`);
      this.writeStdout(`log: ${this.runtime.gatewayLogPath}\n`);
      this.writeStdout(`lock: ${this.runtime.gatewayLockPath}\n`);
      return 0;
    }

    if (command.type === 'gc') {
      const gcOptions = command.gcOptions ?? {
        olderThanDays: DEFAULT_GATEWAY_GC_OLDER_THAN_DAYS,
      };
      const gcResult = await this.withLock(async () => await this.runGatewaySessionGc(gcOptions));
      this.writeStdout(
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
        this.writeStdout(`deleted sessions: ${gcResult.deletedSessions.join(', ')}\n`);
      }
      for (const error of gcResult.errors) {
        this.writeStderr(`gateway gc error: ${error}\n`);
      }
      return gcResult.errors.length === 0 ? 0 : 1;
    }

    if (command.type === 'restart') {
      const stopResult = await this.withLock(
        async () =>
          await this.stopGateway({
            force: true,
            timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
            cleanupOrphans: true,
          }),
      );
      this.writeStdout(`${stopResult.message}\n`);
      const ensured = await this.withLock(
        async () => await this.ensureGatewayRunning(command.startOptions ?? {}),
      );
      this.writeStdout(
        `gateway restarted pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`,
      );
      this.writeStdout(`record: ${this.runtime.gatewayRecordPath}\n`);
      this.writeStdout(`log: ${this.runtime.gatewayLogPath}\n`);
      this.writeStdout(`lock: ${this.runtime.gatewayLockPath}\n`);
      return 0;
    }

    if (command.type === 'run') {
      return await this.withLock(async () => {
        const settings = this.resolveGatewaySettings(
          this.readGatewayRecord(),
          command.startOptions ?? {},
        );
        this.writeStdout(
          `gateway foreground run host=${settings.host} port=${String(settings.port)} db=${settings.stateDbPath}\n`,
        );
        this.writeStdout(`lock: ${this.runtime.gatewayLockPath}\n`);
        return await this.runGatewayForeground(settings);
      });
    }

    const record = await this.withLock(async () => this.readGatewayRecord());
    if (record === null) {
      throw new Error('gateway not running; start it first');
    }
    if (command.callJson === undefined) {
      throw new Error('missing gateway call json');
    }
    return await this.executeGatewayCall(record, command.callJson);
  }
}
