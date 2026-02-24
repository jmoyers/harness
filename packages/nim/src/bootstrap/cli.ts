import { runNimStandalone } from './run-standalone.ts';
import type { NimModelRef } from '../../../nim-core/src/contracts.ts';

const SUPPORTED_FLAGS = new Set([
  '--tenant-id',
  '--user-id',
  '--workspace-id',
  '--model',
  '--ui-mode',
  '--live-anthropic',
  '--mock',
  '--session-id',
  '--event-store-path',
  '--session-store-path',
  '--telemetry-path',
  '--no-telemetry',
  '--secrets-file',
  '--base-url',
]);

const VALUE_FLAGS = new Set([
  '--tenant-id',
  '--user-id',
  '--workspace-id',
  '--model',
  '--ui-mode',
  '--session-id',
  '--event-store-path',
  '--session-store-path',
  '--telemetry-path',
  '--secrets-file',
  '--base-url',
]);

interface ParsedNimCliArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly model?: NimModelRef;
  readonly sessionName: string | null;
  readonly liveAnthropic: boolean;
  readonly eventStorePath?: string;
  readonly sessionStorePath?: string;
  readonly telemetryPath?: string | null;
  readonly secretsFile?: string;
  readonly baseUrl?: string;
}

function printUsage(): void {
  process.stdout.write(
    [
      'usage:',
      '  harness nim [options]',
      '',
      'options:',
      '  --tenant-id <id>',
      '  --user-id <id>',
      '  --workspace-id <id>',
      '  --model <provider/model>',
      '  --ui-mode <debug|user>',
      '  --live-anthropic',
      '  --mock',
      '  --session-id <id>',
      '  --event-store-path <path>',
      '  --session-store-path <path>',
      '  --telemetry-path <path>',
      '  --no-telemetry',
      '  --secrets-file <path>',
      '  --base-url <url>',
    ].join('\n') + '\n',
  );
}

function requireValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parseModelRef(value: string): NimModelRef {
  const normalized = value.trim();
  if (!/^[^/]+\/[^/]+$/u.test(normalized)) {
    throw new Error(`invalid model ref: ${value}`);
  }
  return normalized as NimModelRef;
}

function parseArgs(args: readonly string[]): ParsedNimCliArgs {
  let tenantId = 'nim-standalone';
  let userId = 'user';
  let workspaceId = 'workspace-local';
  let model: NimModelRef | undefined;
  let sessionName: string | null = null;
  let liveAnthropic = true;
  let eventStorePath: string | undefined;
  let sessionStorePath: string | undefined;
  let telemetryPath: string | null | undefined;
  let secretsFile: string | undefined;
  let baseUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith('--') || !SUPPORTED_FLAGS.has(arg)) {
      throw new Error(`unknown argument: ${arg}`);
    }
    if (VALUE_FLAGS.has(arg) && args[index + 1] === undefined) {
      throw new Error(`missing value for ${arg}`);
    }
    if (arg === '--tenant-id') {
      tenantId = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--user-id') {
      userId = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--workspace-id') {
      workspaceId = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--model') {
      model = parseModelRef(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--ui-mode') {
      const value = requireValue(args, index, arg).trim();
      if (value !== 'debug' && value !== 'user' && value !== 'seamless') {
        throw new Error(`invalid --ui-mode: ${value}`);
      }
      index += 1;
      continue;
    }
    if (arg === '--session-id') {
      sessionName = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--event-store-path') {
      eventStorePath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--session-store-path') {
      sessionStorePath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--telemetry-path') {
      telemetryPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--secrets-file') {
      secretsFile = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--base-url') {
      baseUrl = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--mock') {
      liveAnthropic = false;
      continue;
    }
    if (arg === '--live-anthropic') {
      liveAnthropic = true;
      continue;
    }
    if (arg === '--no-telemetry') {
      telemetryPath = null;
      continue;
    }
  }

  return {
    tenantId,
    userId,
    workspaceId,
    ...(model === undefined ? {} : { model }),
    sessionName,
    liveAnthropic,
    ...(eventStorePath === undefined ? {} : { eventStorePath }),
    ...(sessionStorePath === undefined ? {} : { sessionStorePath }),
    ...(telemetryPath === undefined ? {} : { telemetryPath }),
    ...(secretsFile === undefined ? {} : { secretsFile }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
}

export async function runNimCli(args: readonly string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return 0;
  }

  let parsed: ParsedNimCliArgs;
  try {
    parsed = parseArgs(args);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  return runNimStandalone({
    ...(parsed.secretsFile === undefined ? {} : { secretsFile: parsed.secretsFile }),
    runtimeInput: {
      env: process.env,
      cwd: process.cwd(),
      sessionName: parsed.sessionName,
      liveAnthropic: parsed.liveAnthropic,
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      ...(parsed.model === undefined ? {} : { model: parsed.model }),
      ...(parsed.eventStorePath === undefined ? {} : { eventStorePath: parsed.eventStorePath }),
      ...(parsed.sessionStorePath === undefined
        ? {}
        : { sessionStorePath: parsed.sessionStorePath }),
      ...(parsed.telemetryPath === undefined ? {} : { telemetryPath: parsed.telemetryPath }),
      ...(parsed.baseUrl === undefined ? {} : { baseUrl: parsed.baseUrl }),
    },
  });
}
