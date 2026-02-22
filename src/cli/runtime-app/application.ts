import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffUiUsage, runDiffUiCli } from '../../diff-ui/index.ts';
import {
  buildCursorManagedHookRelayCommand,
  ensureManagedCursorHooksInstalled,
  uninstallManagedCursorHooks,
} from '../../cursor/managed-hooks.ts';
import { AuthRuntimeService } from '../auth/runtime.ts';
import { GatewayRuntimeService } from '../gateway/runtime.ts';
import { readCliValue } from '../parsing/flags.ts';
import { HarnessRuntimeContextFactory, type HarnessRuntimeContext } from '../runtime/context.ts';
import { WorkflowRuntimeService } from '../workflows/runtime.ts';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(MODULE_DIR, '../../..');
const DEFAULT_CURSOR_HOOK_RELAY_SCRIPT_PATH = resolve(PROJECT_ROOT, 'scripts/cursor-hook-relay.ts');
const DEFAULT_HARNESS_UPDATE_PACKAGE = '@jmoyers/harness@latest';

type ExecFileSyncFn = (
  file: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: 'utf8';
    stdio: ['ignore', 'pipe', 'pipe'];
  },
) => string;
type BuildCursorManagedHookRelayCommandFn = typeof buildCursorManagedHookRelayCommand;
type EnsureManagedCursorHooksInstalledFn = typeof ensureManagedCursorHooksInstalled;
type UninstallManagedCursorHooksFn = typeof uninstallManagedCursorHooks;
type DiffUiUsageFn = typeof diffUiUsage;
type RunDiffUiCliFn = (deps: {
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => Promise<{ exitCode: number }>;

interface ParsedCursorHooksCommand {
  readonly type: 'install' | 'uninstall';
  readonly hooksFilePath: string | null;
}

interface RuntimeServices {
  readonly runtime: HarnessRuntimeContext;
  readonly authRuntime: AuthRuntimeService;
  readonly gatewayRuntime: GatewayRuntimeService;
  readonly workflowRuntime: WorkflowRuntimeService;
}

export interface HarnessRuntimeContextProvider {
  create(sessionName: string | null): HarnessRuntimeContext;
}

function resolveScriptPath(envValue: string | undefined, fallback: string, cwd: string): string {
  if (typeof envValue !== 'string' || envValue.trim().length === 0) {
    return fallback;
  }
  const trimmed = envValue.trim();
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
}

function harnessRuntimeUsageText(): string {
  return [
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
  ].join('\n');
}

class CursorHooksCommandParser {
  public constructor() {}

  private parseOptions(argv: readonly string[]): { hooksFilePath: string | null } {
    let hooksFilePath: string | null = null;
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index]!;
      if (arg === '--hooks-file') {
        hooksFilePath = readCliValue(argv, index, '--hooks-file');
        index += 1;
        continue;
      }
      throw new Error(`unknown cursor-hooks option: ${arg}`);
    }
    return { hooksFilePath };
  }

  public parse(argv: readonly string[]): ParsedCursorHooksCommand {
    if (argv.length === 0) {
      throw new Error('missing cursor-hooks subcommand');
    }
    const subcommand = argv[0]!;
    const options = this.parseOptions(argv.slice(1));
    if (subcommand === 'install') {
      return { type: 'install', hooksFilePath: options.hooksFilePath };
    }
    if (subcommand === 'uninstall') {
      return { type: 'uninstall', hooksFilePath: options.hooksFilePath };
    }
    throw new Error(`unknown cursor-hooks subcommand: ${subcommand}`);
  }
}

export class HarnessRuntimeScopeFactory {
  constructor(
    private readonly contextFactory: HarnessRuntimeContextProvider = new HarnessRuntimeContextFactory(),
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  public create(sessionName: string | null): RuntimeServices {
    const runtime = this.contextFactory.create(sessionName);
    const authRuntime = new AuthRuntimeService(runtime.invocationDirectory, this.env);
    const gatewayRuntime = new GatewayRuntimeService({
      invocationDirectory: runtime.invocationDirectory,
      sessionName: runtime.sessionName,
      daemonScriptPath: runtime.daemonScriptPath,
      muxScriptPath: runtime.muxScriptPath,
      gatewayRecordPath: runtime.gatewayRecordPath,
      gatewayLogPath: runtime.gatewayLogPath,
      gatewayLockPath: runtime.gatewayLockPath,
      gatewayDefaultStateDbPath: runtime.gatewayDefaultStateDbPath,
      runtimeOptions: runtime.runtimeOptions,
      authRuntime,
    });
    return {
      runtime,
      authRuntime,
      gatewayRuntime,
      workflowRuntime: new WorkflowRuntimeService(runtime, gatewayRuntime),
    };
  }
}

export class HarnessUpdateInstaller {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly writeStdout: (text: string) => void = (text) => {
      process.stdout.write(text);
    },
    private readonly writeStderr: (text: string) => void = (text) => {
      process.stderr.write(text);
    },
    private readonly execFile: ExecFileSyncFn = (file, args, options) =>
      execFileSync(file, args, options) as string,
  ) {}

  private resolvePackageSpec(): string {
    const configured = this.env.HARNESS_UPDATE_PACKAGE;
    if (typeof configured !== 'string') {
      return DEFAULT_HARNESS_UPDATE_PACKAGE;
    }
    const trimmed = configured.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_HARNESS_UPDATE_PACKAGE;
  }

  private formatExecErrorOutput(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Buffer) {
      return value.toString('utf8');
    }
    return '';
  }

  public run(invocationDirectory: string, argv: readonly string[]): number {
    if (argv.length > 0) {
      throw new Error(`unknown update option: ${argv[0]}`);
    }
    const packageSpec = this.resolvePackageSpec();
    this.writeStdout(`updating Harness package: ${packageSpec}\n`);
    try {
      const stdout = this.execFile('bun', ['add', '-g', '--trust', packageSpec], {
        cwd: invocationDirectory,
        env: this.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (stdout.length > 0) {
        this.writeStdout(stdout);
      }
      this.writeStdout(`harness update complete: ${packageSpec}\n`);
      return 0;
    } catch (error: unknown) {
      const typed = error as NodeJS.ErrnoException & {
        readonly stdout?: unknown;
        readonly stderr?: unknown;
        readonly status?: number | null;
      };
      const stdout = this.formatExecErrorOutput(typed.stdout);
      const stderr = this.formatExecErrorOutput(typed.stderr);
      if (stdout.length > 0) {
        this.writeStdout(stdout);
      }
      if (stderr.length > 0) {
        this.writeStderr(stderr);
      }
      const statusText =
        typeof typed.status === 'number' ? `exit=${String(typed.status)}` : 'exit=unknown';
      throw new Error(`harness update command failed (${statusText})`);
    }
  }
}

export class CursorHooksCliRunner {
  private readonly parser = new CursorHooksCommandParser();

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly writeStdout: (text: string) => void = (text) => {
      process.stdout.write(text);
    },
    private readonly buildRelayCommand: BuildCursorManagedHookRelayCommandFn = buildCursorManagedHookRelayCommand,
    private readonly installManagedHooks: EnsureManagedCursorHooksInstalledFn = ensureManagedCursorHooksInstalled,
    private readonly uninstallManagedHooks: UninstallManagedCursorHooksFn = uninstallManagedCursorHooks,
  ) {}

  public run(invocationDirectory: string, argv: readonly string[]): number {
    const command = this.parser.parse(argv);
    const hooksFilePath =
      command.hooksFilePath === null
        ? undefined
        : resolve(invocationDirectory, command.hooksFilePath);
    if (command.type === 'install') {
      const relayScriptPath = resolveScriptPath(
        this.env.HARNESS_CURSOR_HOOK_RELAY_SCRIPT_PATH,
        DEFAULT_CURSOR_HOOK_RELAY_SCRIPT_PATH,
        invocationDirectory,
      );
      const result = this.installManagedHooks({
        relayCommand: this.buildRelayCommand(relayScriptPath),
        ...(hooksFilePath === undefined ? {} : { hooksFilePath }),
      });
      this.writeStdout(
        `cursor hooks install: ${result.changed ? 'updated' : 'already up-to-date'} file=${result.filePath} removed=${String(result.removedCount)} added=${String(result.addedCount)}\n`,
      );
      return 0;
    }
    const result = this.uninstallManagedHooks(hooksFilePath === undefined ? {} : { hooksFilePath });
    this.writeStdout(
      `cursor hooks uninstall: ${result.changed ? 'updated' : 'no changes'} file=${result.filePath} removed=${String(result.removedCount)}\n`,
    );
    return 0;
  }
}

export class DiffCliRunner {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly cwd: string = process.cwd(),
    private readonly writeStdout: (text: string) => void = (text) => {
      process.stdout.write(text);
    },
    private readonly usage: DiffUiUsageFn = diffUiUsage,
    private readonly runDiffCli: RunDiffUiCliFn = runDiffUiCli,
  ) {}

  public async run(argv: readonly string[]): Promise<number> {
    if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
      this.writeStdout(`${this.usage()}\n`);
      return 0;
    }
    const result = await this.runDiffCli({
      argv,
      cwd: this.cwd,
      env: this.env,
    });
    return result.exitCode;
  }
}

export class HarnessRuntimeApplication {
  constructor(
    private readonly scopeFactory: HarnessRuntimeScopeFactory = new HarnessRuntimeScopeFactory(),
    private readonly updateInstaller: HarnessUpdateInstaller = new HarnessUpdateInstaller(),
    private readonly cursorHooksRunner: CursorHooksCliRunner = new CursorHooksCliRunner(),
    private readonly diffCliRunner: DiffCliRunner = new DiffCliRunner(),
    private readonly writeStdout: (text: string) => void = (text) => {
      process.stdout.write(text);
    },
  ) {}

  private printUsage(): void {
    this.writeStdout(`${harnessRuntimeUsageText()}\n`);
  }

  private shouldPrintUsage(argv: readonly string[]): boolean {
    return argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h');
  }

  public async runGatewayCli(args: readonly string[], sessionName: string | null): Promise<number> {
    const services = this.scopeFactory.create(sessionName);
    const command = services.gatewayRuntime.parseCommand(args);
    return await services.gatewayRuntime.run(command);
  }

  public async runProfileCli(args: readonly string[], sessionName: string | null): Promise<number> {
    if (this.shouldPrintUsage(args)) {
      this.printUsage();
      return 0;
    }
    const services = this.scopeFactory.create(sessionName);
    return await services.workflowRuntime.runProfileCli(args);
  }

  public async runStatusTimelineCli(
    args: readonly string[],
    sessionName: string | null,
  ): Promise<number> {
    if (this.shouldPrintUsage(args)) {
      this.printUsage();
      return 0;
    }
    const services = this.scopeFactory.create(sessionName);
    return await services.workflowRuntime.runStatusTimelineCli(args);
  }

  public async runRenderTraceCli(
    args: readonly string[],
    sessionName: string | null,
  ): Promise<number> {
    if (this.shouldPrintUsage(args)) {
      this.printUsage();
      return 0;
    }
    const services = this.scopeFactory.create(sessionName);
    return await services.workflowRuntime.runRenderTraceCli(args);
  }

  public async runAuthCli(args: readonly string[], sessionName: string | null): Promise<number> {
    const services = this.scopeFactory.create(sessionName);
    return await services.authRuntime.run(args);
  }

  public runUpdateCli(args: readonly string[], sessionName: string | null): number {
    const services = this.scopeFactory.create(sessionName);
    return this.updateInstaller.run(services.runtime.invocationDirectory, args);
  }

  public async runCursorHooksCli(
    args: readonly string[],
    sessionName: string | null,
  ): Promise<number> {
    const services = this.scopeFactory.create(sessionName);
    return this.cursorHooksRunner.run(services.runtime.invocationDirectory, args);
  }

  public async runClientCli(args: readonly string[], sessionName: string | null): Promise<number> {
    const services = this.scopeFactory.create(sessionName);
    return await services.workflowRuntime.runDefaultClient(args);
  }

  public async runDiffCli(args: readonly string[], _sessionName: string | null): Promise<number> {
    void _sessionName;
    return await this.diffCliRunner.run(args);
  }
}

export function createDefaultHarnessRuntimeApplication(): HarnessRuntimeApplication {
  return new HarnessRuntimeApplication();
}
