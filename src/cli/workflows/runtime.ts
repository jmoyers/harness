import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { GatewayRecord } from '../gateway-record.ts';
import {
  DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
  type EnsureGatewayResult,
  type GatewayProbeResult,
  type GatewayStartOptions,
  type GatewayStopOptions,
  type GatewayStopResult,
  type ResolvedGatewaySettings,
} from '../gateway/runtime.ts';
import { parsePositiveIntFlag, readCliValue } from '../parsing/flags.ts';
import { GatewayControlInfra } from '../runtime-infra/gateway-control.ts';
import type { HarnessRuntimeContext } from '../runtime/context.ts';
import {
  parseActiveStatusTimelineState,
  STATUS_TIMELINE_MODE,
  STATUS_TIMELINE_STATE_VERSION,
} from '../../mux/live-mux/status-timeline-state.ts';
import {
  parseActiveRenderTraceState,
  RENDER_TRACE_MODE,
  RENDER_TRACE_STATE_VERSION,
} from '../../mux/live-mux/render-trace-state.ts';
import {
  buildInspectorProfileStartExpression,
  buildInspectorProfileStopExpression,
  connectGatewayInspector,
  DEFAULT_PROFILE_INSPECT_TIMEOUT_MS,
  evaluateInspectorExpression,
  InspectorWebSocketClient,
  readInspectorProfileState,
  type InspectorProfileState,
} from './inspector.ts';

const DEFAULT_GATEWAY_STOP_POLL_MS = 50;
const PROFILE_STATE_VERSION = 2;
const PROFILE_LIVE_INSPECT_MODE = 'live-inspector';
const PROFILE_CLIENT_FILE_NAME = 'client.cpuprofile';
const PROFILE_GATEWAY_FILE_NAME = 'gateway.cpuprofile';

interface ProfileStopOptions {
  readonly timeoutMs: number;
}

interface ParsedProfileRunCommand {
  readonly type: 'run';
  readonly profileDir: string | null;
  readonly muxArgs: readonly string[];
}

interface ParsedProfileStartCommand {
  readonly type: 'start';
  readonly profileDir: string | null;
}

interface ParsedProfileStopCommand {
  readonly type: 'stop';
  readonly stopOptions: ProfileStopOptions;
}

type ParsedProfileCommand =
  | ParsedProfileRunCommand
  | ParsedProfileStartCommand
  | ParsedProfileStopCommand;

interface ParsedStatusTimelineStartCommand {
  readonly type: 'start';
  readonly outputPath: string | null;
}

interface ParsedStatusTimelineStopCommand {
  readonly type: 'stop';
}

type ParsedStatusTimelineCommand =
  | ParsedStatusTimelineStartCommand
  | ParsedStatusTimelineStopCommand;

interface ParsedRenderTraceStartCommand {
  readonly type: 'start';
  readonly outputPath: string | null;
  readonly conversationId: string | null;
}

interface ParsedRenderTraceStopCommand {
  readonly type: 'stop';
}

type ParsedRenderTraceCommand = ParsedRenderTraceStartCommand | ParsedRenderTraceStopCommand;

interface RuntimeCpuProfileOptions {
  readonly cpuProfileDir: string;
  readonly cpuProfileName: string;
}

interface ActiveProfileState {
  readonly version: number;
  readonly mode: typeof PROFILE_LIVE_INSPECT_MODE;
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  readonly stateDbPath: string;
  readonly profileDir: string;
  readonly gatewayProfilePath: string;
  readonly inspectWebSocketUrl: string;
  readonly startedAt: string;
}

interface ActiveStatusTimelineState {
  readonly version: number;
  readonly mode: typeof STATUS_TIMELINE_MODE;
  readonly outputPath: string;
  readonly sessionName: string | null;
  readonly startedAt: string;
}

interface ActiveRenderTraceState {
  readonly version: number;
  readonly mode: typeof RENDER_TRACE_MODE;
  readonly outputPath: string;
  readonly sessionName: string | null;
  readonly conversationId: string | null;
  readonly startedAt: string;
}

interface GatewayRuntimeFacade {
  withLock<T>(operation: () => Promise<T>): Promise<T>;
  ensureGatewayRunning(overrides?: GatewayStartOptions): Promise<EnsureGatewayResult>;
  runMuxClient(
    record: GatewayRecord,
    muxArgs: readonly string[],
    runtimeArgs?: readonly string[],
  ): Promise<number>;
  isPidRunning(pid: number): boolean;
  readGatewayRecord(): GatewayRecord | null;
  probeGateway(record: GatewayRecord): Promise<GatewayProbeResult>;
  removeGatewayRecord(): void;
  resolveGatewayHostFromConfigOrEnv(): string;
  reservePort(host: string): Promise<number>;
  resolveGatewaySettings(
    record: GatewayRecord | null,
    overrides: GatewayStartOptions,
  ): ResolvedGatewaySettings;
  startDetachedGateway(
    settings: ResolvedGatewaySettings,
    runtimeArgs?: readonly string[],
  ): Promise<GatewayRecord>;
  stopGateway(options: GatewayStopOptions): Promise<GatewayStopResult>;
  waitForFileExists(filePath: string, timeoutMs: number): Promise<boolean>;
}

class ProfileCommandParser {
  public constructor() {}

  private parseRunCommand(argv: readonly string[]): ParsedProfileRunCommand {
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

  private parseStartCommand(argv: readonly string[]): ParsedProfileStartCommand {
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

  private parseStopOptions(argv: readonly string[]): ProfileStopOptions {
    let timeoutMs = DEFAULT_GATEWAY_STOP_TIMEOUT_MS;
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index]!;
      if (arg === '--timeout-ms') {
        timeoutMs = parsePositiveIntFlag(readCliValue(argv, index, '--timeout-ms'), '--timeout-ms');
        index += 1;
        continue;
      }
      throw new Error(`unknown profile option: ${arg}`);
    }
    return { timeoutMs };
  }

  public parse(argv: readonly string[]): ParsedProfileCommand {
    if (argv.length === 0) {
      return this.parseRunCommand(argv);
    }
    const subcommand = argv[0]!;
    const rest = argv.slice(1);
    if (subcommand === 'start') {
      return this.parseStartCommand(rest);
    }
    if (subcommand === 'stop') {
      return {
        type: 'stop',
        stopOptions: this.parseStopOptions(rest),
      };
    }
    if (subcommand === 'run') {
      return this.parseRunCommand(rest);
    }
    if (subcommand.startsWith('-')) {
      return this.parseRunCommand(argv);
    }
    return this.parseRunCommand(argv);
  }
}

class StatusTimelineCommandParser {
  public constructor() {}

  private parseStartCommand(argv: readonly string[]): ParsedStatusTimelineStartCommand {
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

  private parseStopCommand(argv: readonly string[]): ParsedStatusTimelineStopCommand {
    if (argv.length > 0) {
      throw new Error(`unknown status-timeline option: ${argv[0]}`);
    }
    return { type: 'stop' };
  }

  public parse(argv: readonly string[]): ParsedStatusTimelineCommand {
    if (argv.length === 0) {
      return this.parseStartCommand(argv);
    }
    const subcommand = argv[0]!;
    const rest = argv.slice(1);
    if (subcommand === 'start') {
      return this.parseStartCommand(rest);
    }
    if (subcommand === 'stop') {
      return this.parseStopCommand(rest);
    }
    if (subcommand.startsWith('-')) {
      return this.parseStartCommand(argv);
    }
    throw new Error(`unknown status-timeline subcommand: ${subcommand}`);
  }
}

class RenderTraceCommandParser {
  public constructor() {}

  private parseStartCommand(argv: readonly string[]): ParsedRenderTraceStartCommand {
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

  private parseStopCommand(argv: readonly string[]): ParsedRenderTraceStopCommand {
    if (argv.length > 0) {
      throw new Error(`unknown render-trace option: ${argv[0]}`);
    }
    return { type: 'stop' };
  }

  public parse(argv: readonly string[]): ParsedRenderTraceCommand {
    if (argv.length === 0) {
      return this.parseStartCommand(argv);
    }
    const subcommand = argv[0]!;
    const rest = argv.slice(1);
    if (subcommand === 'start') {
      return this.parseStartCommand(rest);
    }
    if (subcommand === 'stop') {
      return this.parseStopCommand(rest);
    }
    if (subcommand.startsWith('-')) {
      return this.parseStartCommand(argv);
    }
    throw new Error(`unknown render-trace subcommand: ${subcommand}`);
  }
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

export class WorkflowRuntimeService {
  private readonly profileParser = new ProfileCommandParser();
  private readonly statusTimelineParser = new StatusTimelineCommandParser();
  private readonly renderTraceParser = new RenderTraceCommandParser();

  constructor(
    private readonly runtime: HarnessRuntimeContext,
    private readonly gatewayService: GatewayRuntimeFacade,
    private readonly infra: GatewayControlInfra = new GatewayControlInfra(),
    private readonly writeStdout: (text: string) => void = (text) => {
      process.stdout.write(text);
    },
  ) {}

  public async runDefaultClient(args: readonly string[]): Promise<number> {
    const ensured = await this.gatewayService.withLock(
      async () => await this.gatewayService.ensureGatewayRunning({}),
    );
    if (ensured.started) {
      this.writeStdout(
        `gateway started pid=${String(ensured.record.pid)} host=${ensured.record.host} port=${String(ensured.record.port)}\n`,
      );
    }
    return await this.gatewayService.runMuxClient(ensured.record, args);
  }

  public async runProfileCli(args: readonly string[]): Promise<number> {
    const command = this.profileParser.parse(args);
    if (command.type === 'start') {
      return await this.runProfileStart(command);
    }
    if (command.type === 'stop') {
      return await this.runProfileStop(command);
    }
    return await this.runProfileRun(command);
  }

  public async runStatusTimelineCli(args: readonly string[]): Promise<number> {
    const command = this.statusTimelineParser.parse(args);
    if (command.type === 'stop') {
      return await this.runStatusTimelineStop();
    }
    return await this.runStatusTimelineStart(command);
  }

  public async runRenderTraceCli(args: readonly string[]): Promise<number> {
    const command = this.renderTraceParser.parse(args);
    if (command.type === 'stop') {
      return await this.runRenderTraceStop();
    }
    return await this.runRenderTraceStart(command);
  }

  private removeFileIfExists(filePath: string): void {
    try {
      unlinkSync(filePath);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private parseActiveProfileState(raw: unknown): ActiveProfileState | null {
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

  private readActiveProfileState(profileStatePath: string): ActiveProfileState | null {
    if (!existsSync(profileStatePath)) {
      return null;
    }
    try {
      const raw = JSON.parse(readFileSync(profileStatePath, 'utf8')) as unknown;
      return this.parseActiveProfileState(raw);
    } catch {
      return null;
    }
  }

  private writeActiveProfileState(profileStatePath: string, state: ActiveProfileState): void {
    this.infra.writeTextFileAtomically(profileStatePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  private removeActiveProfileState(profileStatePath: string): void {
    this.removeFileIfExists(profileStatePath);
  }

  private readActiveStatusTimelineState(statePath: string): ActiveStatusTimelineState | null {
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

  private writeActiveStatusTimelineState(
    statePath: string,
    state: ActiveStatusTimelineState,
  ): void {
    this.infra.writeTextFileAtomically(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  private removeActiveStatusTimelineState(statePath: string): void {
    this.removeFileIfExists(statePath);
  }

  private readActiveRenderTraceState(statePath: string): ActiveRenderTraceState | null {
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

  private writeActiveRenderTraceState(statePath: string, state: ActiveRenderTraceState): void {
    this.infra.writeTextFileAtomically(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  private removeActiveRenderTraceState(statePath: string): void {
    this.removeFileIfExists(statePath);
  }

  private async runProfileRun(command: ParsedProfileRunCommand): Promise<number> {
    const { invocationDirectory } = this.runtime;
    const profileDir =
      command.profileDir === null
        ? this.runtime.profileDir
        : resolve(invocationDirectory, command.profileDir);
    mkdirSync(profileDir, { recursive: true });

    const clientProfilePath = resolve(profileDir, PROFILE_CLIENT_FILE_NAME);
    const gatewayProfilePath = resolve(profileDir, PROFILE_GATEWAY_FILE_NAME);
    this.removeFileIfExists(clientProfilePath);
    this.removeFileIfExists(gatewayProfilePath);

    const existingProfileState = this.readActiveProfileState(this.runtime.profileStatePath);
    if (existingProfileState !== null) {
      if (this.gatewayService.isPidRunning(existingProfileState.pid)) {
        throw new Error(
          'profile run requires no active profile session; stop it first with `harness profile stop`',
        );
      }
      this.removeActiveProfileState(this.runtime.profileStatePath);
    }

    const gateway = await this.gatewayService.withLock(async () => {
      const existingRecord = this.gatewayService.readGatewayRecord();
      if (existingRecord !== null) {
        const existingProbe = await this.gatewayService.probeGateway(existingRecord);
        if (existingProbe.connected || this.gatewayService.isPidRunning(existingRecord.pid)) {
          throw new Error(
            'profile command requires the target session gateway to be stopped first',
          );
        }
        this.gatewayService.removeGatewayRecord();
      }

      const host = this.gatewayService.resolveGatewayHostFromConfigOrEnv();
      const reservedPort = await this.gatewayService.reservePort(host);
      const settings = this.gatewayService.resolveGatewaySettings(null, {
        port: reservedPort,
        stateDbPath: this.runtime.gatewayDefaultStateDbPath,
      });

      return await this.gatewayService.startDetachedGateway(settings, [
        ...this.runtime.runtimeOptions.gatewayRuntimeArgs,
        ...buildCpuProfileRuntimeArgs({
          cpuProfileDir: profileDir,
          cpuProfileName: PROFILE_GATEWAY_FILE_NAME,
        }),
      ]);
    });

    let clientExitCode = 1;
    let clientError: Error | null = null;
    try {
      clientExitCode = await this.gatewayService.runMuxClient(gateway, command.muxArgs, [
        ...this.runtime.runtimeOptions.clientRuntimeArgs,
        ...buildCpuProfileRuntimeArgs({
          cpuProfileDir: profileDir,
          cpuProfileName: PROFILE_CLIENT_FILE_NAME,
        }),
      ]);
    } catch (error: unknown) {
      clientError = error instanceof Error ? error : new Error(String(error));
    }

    const stopped = await this.gatewayService.withLock(
      async () =>
        await this.gatewayService.stopGateway({
          force: true,
          timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS,
          cleanupOrphans: true,
        }),
    );
    this.writeStdout(`${stopped.message}\n`);
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

    this.writeStdout(`profiles: client=${clientProfilePath} gateway=${gatewayProfilePath}\n`);
    return clientExitCode;
  }

  private async runProfileStart(command: ParsedProfileStartCommand): Promise<number> {
    const { invocationDirectory } = this.runtime;
    const profileDir =
      command.profileDir === null
        ? this.runtime.profileDir
        : resolve(invocationDirectory, command.profileDir);
    mkdirSync(profileDir, { recursive: true });
    const gatewayProfilePath = resolve(profileDir, PROFILE_GATEWAY_FILE_NAME);
    this.removeFileIfExists(gatewayProfilePath);

    const existingProfileState = this.readActiveProfileState(this.runtime.profileStatePath);
    if (existingProfileState !== null) {
      if (this.gatewayService.isPidRunning(existingProfileState.pid)) {
        throw new Error('profile already running; stop it first with `harness profile stop`');
      }
      this.removeActiveProfileState(this.runtime.profileStatePath);
    }

    const existingRecord = this.gatewayService.readGatewayRecord();
    if (existingRecord === null) {
      throw new Error('profile start requires the target session gateway to be running');
    }
    const existingProbe = await this.gatewayService.probeGateway(existingRecord);
    if (!existingProbe.connected || !this.gatewayService.isPidRunning(existingRecord.pid)) {
      throw new Error('profile start requires the target session gateway to be running');
    }
    const inspector = await connectGatewayInspector(
      invocationDirectory,
      this.runtime.gatewayLogPath,
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

    this.writeActiveProfileState(this.runtime.profileStatePath, {
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

    this.writeStdout(
      `profile started pid=${String(existingRecord.pid)} host=${existingRecord.host} port=${String(existingRecord.port)}\n`,
    );
    this.writeStdout(`record: ${this.runtime.gatewayRecordPath}\n`);
    this.writeStdout(`log: ${this.runtime.gatewayLogPath}\n`);
    this.writeStdout(`profile-state: ${this.runtime.profileStatePath}\n`);
    this.writeStdout(`profile-target: ${gatewayProfilePath}\n`);
    this.writeStdout('stop with: harness profile stop\n');
    return 0;
  }

  private async runProfileStop(command: ParsedProfileStopCommand): Promise<number> {
    const profileState = this.readActiveProfileState(this.runtime.profileStatePath);
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
        buildInspectorProfileStopExpression(
          profileState.gatewayProfilePath,
          profileState.profileDir,
        ),
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

    const profileFlushed = await this.gatewayService.waitForFileExists(
      profileState.gatewayProfilePath,
      command.stopOptions.timeoutMs,
    );
    if (!profileFlushed) {
      throw new Error(`missing gateway CPU profile: ${profileState.gatewayProfilePath}`);
    }

    this.removeActiveProfileState(this.runtime.profileStatePath);
    this.writeStdout(`profile: gateway=${profileState.gatewayProfilePath}\n`);
    return 0;
  }

  private async runStatusTimelineStart(command: ParsedStatusTimelineStartCommand): Promise<number> {
    const { invocationDirectory, sessionName } = this.runtime;
    const outputPath =
      command.outputPath === null
        ? this.runtime.defaultStatusTimelineOutputPath
        : resolve(invocationDirectory, command.outputPath);
    const existingState = this.readActiveStatusTimelineState(this.runtime.statusTimelineStatePath);
    if (existingState !== null) {
      throw new Error(
        'status timeline already running; stop it first with `harness status-timeline stop`',
      );
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, '', 'utf8');
    this.writeActiveStatusTimelineState(this.runtime.statusTimelineStatePath, {
      version: STATUS_TIMELINE_STATE_VERSION,
      mode: STATUS_TIMELINE_MODE,
      outputPath,
      sessionName,
      startedAt: new Date().toISOString(),
    });
    this.writeStdout('status timeline started\n');
    this.writeStdout(`status-timeline-state: ${this.runtime.statusTimelineStatePath}\n`);
    this.writeStdout(`status-timeline-target: ${outputPath}\n`);
    this.writeStdout('stop with: harness status-timeline stop\n');
    return 0;
  }

  private async runStatusTimelineStop(): Promise<number> {
    const state = this.readActiveStatusTimelineState(this.runtime.statusTimelineStatePath);
    if (state === null) {
      throw new Error(
        'no active status timeline run for this session; start one with `harness status-timeline start`',
      );
    }
    this.removeActiveStatusTimelineState(this.runtime.statusTimelineStatePath);
    this.writeStdout(`status timeline stopped: ${state.outputPath}\n`);
    return 0;
  }

  private async runRenderTraceStart(command: ParsedRenderTraceStartCommand): Promise<number> {
    const { invocationDirectory, sessionName } = this.runtime;
    const outputPath =
      command.outputPath === null
        ? this.runtime.defaultRenderTraceOutputPath
        : resolve(invocationDirectory, command.outputPath);
    const existingState = this.readActiveRenderTraceState(this.runtime.renderTraceStatePath);
    if (existingState !== null) {
      throw new Error(
        'render trace already running; stop it first with `harness render-trace stop`',
      );
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, '', 'utf8');
    this.writeActiveRenderTraceState(this.runtime.renderTraceStatePath, {
      version: RENDER_TRACE_STATE_VERSION,
      mode: RENDER_TRACE_MODE,
      outputPath,
      sessionName,
      conversationId: command.conversationId,
      startedAt: new Date().toISOString(),
    });
    this.writeStdout('render trace started\n');
    this.writeStdout(`render-trace-state: ${this.runtime.renderTraceStatePath}\n`);
    this.writeStdout(`render-trace-target: ${outputPath}\n`);
    if (command.conversationId !== null) {
      this.writeStdout(`render-trace-conversation-id: ${command.conversationId}\n`);
    }
    this.writeStdout('stop with: harness render-trace stop\n');
    return 0;
  }

  private async runRenderTraceStop(): Promise<number> {
    const state = this.readActiveRenderTraceState(this.runtime.renderTraceStatePath);
    if (state === null) {
      throw new Error(
        'no active render trace run for this session; start one with `harness render-trace start`',
      );
    }
    this.removeActiveRenderTraceState(this.runtime.renderTraceStatePath);
    this.writeStdout(`render trace stopped: ${state.outputPath}\n`);
    return 0;
  }
}
