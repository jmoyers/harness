import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';
import { resolveHarnessRuntimePath } from '../src/config/harness-paths.ts';
import {
  createAnthropicNimProviderDriver,
  createSqliteBackedNimRuntime,
  type InMemoryNimRuntime,
  type NimModelRef,
  type SessionHandle,
} from '../packages/nim-core/src/index.ts';
import { NimTestTuiController } from '../packages/nim-test-tui/src/index.ts';
import type { NimUiMode } from '../packages/nim-ui-core/src/projection.ts';

type ParsedArgs = {
  readonly tenantId: string;
  readonly userId: string;
  readonly model: NimModelRef;
  readonly uiMode: NimUiMode;
  readonly liveAnthropic: boolean;
  readonly sessionId?: string;
  readonly eventStorePath: string;
  readonly sessionStorePath: string;
  readonly telemetryPath?: string;
  readonly secretsFile?: string;
  readonly baseUrl?: string;
};

type Command =
  | { readonly type: 'help' }
  | { readonly type: 'exit' }
  | { readonly type: 'send'; readonly text: string }
  | { readonly type: 'steer'; readonly text: string }
  | { readonly type: 'queue'; readonly text: string; readonly priority: 'normal' | 'high' }
  | { readonly type: 'abort' }
  | { readonly type: 'state' }
  | { readonly type: 'replay'; readonly count: number }
  | { readonly type: 'mode'; readonly mode: NimUiMode }
  | { readonly type: 'switch-model'; readonly model: NimModelRef }
  | { readonly type: 'session-new' }
  | { readonly type: 'session-resume'; readonly sessionId: string };

function printUsage(): void {
  process.stdout.write(
    [
      'usage:',
      '  harness nim [options]',
      '',
      'options:',
      '  --tenant-id <id>',
      '  --user-id <id>',
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
      '',
      'notes:',
      '  - Live Anthropic is the default path.',
      '  - Use --mock for deterministic mock-echo provider output.',
      '  - Live Anthropic requires ANTHROPIC_API_KEY (optionally loaded via --secrets-file).',
    ].join('\n') + '\n',
  );
}

export function parseNimTuiArgs(
  argv: readonly string[],
  input: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): ParsedArgs {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  let tenantId = 'nim-tui-tenant';
  let userId = 'nim-tui-user';
  let model: NimModelRef = 'anthropic/claude-3-haiku-20240307';
  let uiMode: NimUiMode = 'debug';
  let liveAnthropic = true;
  let sessionId: string | undefined;
  let eventStorePath = resolveHarnessRuntimePath(cwd, '.harness/nim/events.sqlite', env);
  let sessionStorePath = resolveHarnessRuntimePath(cwd, '.harness/nim/sessions.sqlite', env);
  let telemetryPath: string | undefined = resolveHarnessRuntimePath(
    cwd,
    '.harness/nim/events.jsonl',
    env,
  );
  let secretsFile: string | undefined;
  let baseUrl: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--tenant-id') {
      tenantId = requireArg(next, '--tenant-id');
      index += 1;
      continue;
    }
    if (arg === '--user-id') {
      userId = requireArg(next, '--user-id');
      index += 1;
      continue;
    }
    if (arg === '--model') {
      model = parseModelRef(requireArg(next, '--model'));
      index += 1;
      continue;
    }
    if (arg === '--ui-mode') {
      const rawMode = requireArg(next, '--ui-mode');
      uiMode = parseCliUiMode(rawMode, '--ui-mode');
      index += 1;
      continue;
    }
    if (arg === '--live-anthropic') {
      liveAnthropic = true;
      continue;
    }
    if (arg === '--mock') {
      liveAnthropic = false;
      continue;
    }
    if (arg === '--session-id') {
      sessionId = requireArg(next, '--session-id');
      index += 1;
      continue;
    }
    if (arg === '--event-store-path') {
      eventStorePath = resolve(cwd, requireArg(next, '--event-store-path'));
      index += 1;
      continue;
    }
    if (arg === '--session-store-path') {
      sessionStorePath = resolve(cwd, requireArg(next, '--session-store-path'));
      index += 1;
      continue;
    }
    if (arg === '--telemetry-path') {
      telemetryPath = resolve(cwd, requireArg(next, '--telemetry-path'));
      index += 1;
      continue;
    }
    if (arg === '--no-telemetry') {
      telemetryPath = undefined;
      continue;
    }
    if (arg === '--secrets-file') {
      secretsFile = requireArg(next, '--secrets-file');
      index += 1;
      continue;
    }
    if (arg === '--base-url') {
      baseUrl = requireArg(next, '--base-url');
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    tenantId,
    userId,
    model,
    uiMode,
    liveAnthropic,
    ...(sessionId !== undefined ? { sessionId } : {}),
    eventStorePath,
    sessionStorePath,
    ...(telemetryPath !== undefined ? { telemetryPath } : {}),
    ...(secretsFile !== undefined ? { secretsFile } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  };
}

function requireArg(value: string | undefined, flag: string): string {
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

function parseCliUiMode(value: string, origin: '--ui-mode' | '/mode'): NimUiMode {
  const normalized = value.trim();
  if (normalized === 'debug') {
    return 'debug';
  }
  if (normalized === 'user' || normalized === 'seamless') {
    return 'seamless';
  }
  const prefix = origin === '--ui-mode' ? 'invalid --ui-mode' : 'invalid mode';
  throw new Error(`${prefix}: ${value}`);
}

function uiModeLabel(mode: NimUiMode): 'debug' | 'user' {
  return mode === 'debug' ? 'debug' : 'user';
}

export function parseNimTuiCommand(input: string): Command {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('empty command');
  }
  if (!trimmed.startsWith('/')) {
    return {
      type: 'send',
      text: trimmed,
    };
  }
  if (trimmed === '/help') {
    return { type: 'help' };
  }
  if (trimmed === '/exit' || trimmed === '/quit') {
    return { type: 'exit' };
  }
  if (trimmed === '/abort') {
    return { type: 'abort' };
  }
  if (trimmed === '/state') {
    return { type: 'state' };
  }
  if (trimmed === '/session new') {
    return { type: 'session-new' };
  }
  if (trimmed.startsWith('/session resume ')) {
    const sessionId = trimmed.slice('/session resume '.length).trim();
    if (sessionId.length === 0) {
      throw new Error('missing session id for /session resume');
    }
    return {
      type: 'session-resume',
      sessionId,
    };
  }
  if (trimmed.startsWith('/send ')) {
    const text = trimmed.slice('/send '.length).trim();
    if (text.length === 0) {
      throw new Error('missing text for /send');
    }
    return {
      type: 'send',
      text,
    };
  }
  if (trimmed.startsWith('/steer ')) {
    const text = trimmed.slice('/steer '.length).trim();
    if (text.length === 0) {
      throw new Error('missing text for /steer');
    }
    return {
      type: 'steer',
      text,
    };
  }
  if (trimmed.startsWith('/queue ')) {
    const body = trimmed.slice('/queue '.length).trim();
    if (body.length === 0) {
      throw new Error('missing text for /queue');
    }
    if (body.startsWith('high ')) {
      const text = body.slice('high '.length).trim();
      if (text.length === 0) {
        throw new Error('missing text for /queue high');
      }
      return { type: 'queue', text, priority: 'high' };
    }
    if (body.startsWith('normal ')) {
      const text = body.slice('normal '.length).trim();
      if (text.length === 0) {
        throw new Error('missing text for /queue normal');
      }
      return { type: 'queue', text, priority: 'normal' };
    }
    return { type: 'queue', text: body, priority: 'normal' };
  }
  if (trimmed.startsWith('/replay')) {
    const countRaw = trimmed.slice('/replay'.length).trim();
    if (countRaw.length === 0) {
      return { type: 'replay', count: 30 };
    }
    const parsed = Number.parseInt(countRaw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`invalid replay count: ${countRaw}`);
    }
    return { type: 'replay', count: parsed };
  }
  if (trimmed.startsWith('/mode ')) {
    const raw = trimmed.slice('/mode '.length).trim();
    return {
      type: 'mode',
      mode: parseCliUiMode(raw, '/mode'),
    };
  }
  if (trimmed.startsWith('/model ')) {
    const model = parseModelRef(trimmed.slice('/model '.length));
    return {
      type: 'switch-model',
      model,
    };
  }
  throw new Error(`unknown command: ${trimmed}`);
}

function printHelp(): void {
  process.stdout.write(
    [
      'nim tui commands',
      '  /help',
      '  /exit',
      '  /send <text>            (plain text without slash also sends)',
      '  /steer <text>           (append input to active run)',
      '  /abort                   (abort active run)',
      '  /queue [high|normal] <text>',
      '  /replay [count]',
      '  /state',
      '  /mode <debug|user>',
      '  /model <provider/model>',
      '  /session new',
      '  /session resume <session-id>',
      '',
    ].join('\n'),
  );
}

async function nextWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timed out waiting for nim run events'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function collectTurnTrace(input: {
  runtime: InMemoryNimRuntime;
  tenantId: string;
  sessionId: string;
  runId: string;
  fromEventIdExclusive?: string;
  uiMode: NimUiMode;
}): Promise<{ readonly lastEventId?: string; readonly frameLines: readonly string[] }> {
  const stream = input.runtime.streamEvents({
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    ...(input.fromEventIdExclusive !== undefined
      ? { fromEventIdExclusive: input.fromEventIdExclusive }
      : {}),
    includeThoughtDeltas: true,
    includeToolArgumentDeltas: true,
  });
  const iterator = stream[Symbol.asyncIterator]();
  const controller = new NimTestTuiController({
    mode: input.uiMode,
    runId: input.runId,
  });
  const deadline = Date.now() + 30000;
  let lastEventId: string | undefined;
  try {
    while (Date.now() < deadline) {
      const next = await nextWithTimeout(iterator, deadline - Date.now());
      if (next.done) {
        break;
      }
      const event = next.value;
      lastEventId = event.event_id;
      const stateLabel = event.state !== undefined ? ` state=${event.state}` : '';
      process.stdout.write(
        `[event ${String(event.event_seq)}] ${event.type} source=${event.source}${stateLabel}\n`,
      );
      const projected = controller.consume(event);
      for (const item of projected) {
        if (item.type === 'assistant.text.message') {
          process.stdout.write(`assistant> ${item.text}\n`);
        }
      }
      if (event.type === 'turn.completed' && event.run_id === input.runId) {
        break;
      }
    }
    return {
      ...(lastEventId !== undefined ? { lastEventId } : {}),
      frameLines: controller.snapshot().lines,
    };
  } finally {
    await iterator.return?.();
  }
}

async function runNimTuiInteractive(args: ParsedArgs): Promise<void> {
  const runtimeHandle = createSqliteBackedNimRuntime({
    eventStorePath: args.eventStorePath,
    sessionStorePath: args.sessionStorePath,
    ...(args.telemetryPath !== undefined
      ? {
          telemetry: {
            filePath: args.telemetryPath,
            mode: 'append',
          } as const,
        }
      : {}),
  });
  const runtime = runtimeHandle.runtime;
  const providerId = args.model.split('/')[0] ?? 'anthropic';
  runtime.registerProvider({
    id: providerId,
    displayName: providerId,
    models: [args.model],
  });
  runtime.registerTools([
    { name: 'ping', description: 'Echo input' },
    { name: 'note', description: 'Record note' },
    { name: 'clock', description: 'Return current time' },
  ]);
  runtime.setToolPolicy({
    hash: 'policy-cli-open',
    allow: ['ping', 'note', 'clock'],
    deny: [],
  });
  if (args.liveAnthropic) {
    if (providerId !== 'anthropic') {
      throw new Error(
        `live provider mode requires anthropic model ref until additional drivers are implemented; got ${args.model}. Pass --mock to run without a live provider driver.`,
      );
    }
    loadHarnessSecrets({
      cwd: process.cwd(),
      ...(args.secretsFile !== undefined ? { filePath: args.secretsFile } : {}),
      overrideExisting: false,
    });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error(
        'ANTHROPIC_API_KEY was not found after loading secrets. Set the key or pass --mock.',
      );
    }
    runtime.registerProviderDriver(
      createAnthropicNimProviderDriver({
        apiKey,
        ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
      }),
    );
  }
  const providerMode =
    args.liveAnthropic && providerId === 'anthropic'
      ? 'live-anthropic'
      : 'mock-echo (no provider driver registered)';

  let currentModel: NimModelRef = args.model;
  let uiMode: NimUiMode = args.uiMode;
  let currentSession: SessionHandle;
  if (args.sessionId !== undefined) {
    currentSession = await runtime.resumeSession({
      tenantId: args.tenantId,
      userId: args.userId,
      sessionId: args.sessionId,
    });
  } else {
    currentSession = await runtime.startSession({
      tenantId: args.tenantId,
      userId: args.userId,
      model: args.model,
    });
  }

  let activeRunId: string | undefined;
  let lastEventId: string | undefined;
  process.stdout.write(
    `nim tui ready session=${currentSession.sessionId} model=${currentModel} provider=${providerMode}\n`,
  );
  if (!args.liveAnthropic) {
    process.stdout.write('nim tui note: running deterministic mock mode via --mock.\n');
  }
  printHelp();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    while (true) {
      const line = await rl.question('nim> ');
      if (line.trim().length === 0) {
        continue;
      }
      let command: Command;
      try {
        command = parseNimTuiCommand(line);
      } catch (error) {
        process.stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
        continue;
      }

      if (command.type === 'help') {
        printHelp();
        continue;
      }
      if (command.type === 'exit') {
        break;
      }
      if (command.type === 'state') {
        process.stdout.write(
          JSON.stringify(
            {
              tenantId: currentSession.tenantId,
              userId: currentSession.userId,
              sessionId: currentSession.sessionId,
              model: currentModel,
              uiMode: uiModeLabel(uiMode),
              activeRunId: activeRunId ?? null,
              lastEventId: lastEventId ?? null,
            },
            null,
            2,
          ) + '\n',
        );
        continue;
      }
      if (command.type === 'mode') {
        uiMode = command.mode;
        process.stdout.write(`ui mode set to ${uiModeLabel(uiMode)}\n`);
        continue;
      }
      if (command.type === 'switch-model') {
        await runtime.switchModel({
          sessionId: currentSession.sessionId,
          model: command.model,
          reason: 'manual',
        });
        currentModel = command.model;
        process.stdout.write(`switched model to ${currentModel}\n`);
        continue;
      }
      if (command.type === 'session-new') {
        currentSession = await runtime.startSession({
          tenantId: args.tenantId,
          userId: args.userId,
          model: currentModel,
        });
        activeRunId = undefined;
        lastEventId = undefined;
        process.stdout.write(`new session ${currentSession.sessionId}\n`);
        continue;
      }
      if (command.type === 'session-resume') {
        currentSession = await runtime.resumeSession({
          tenantId: args.tenantId,
          userId: args.userId,
          sessionId: command.sessionId,
        });
        activeRunId = undefined;
        const replay = await runtime.replayEvents({
          tenantId: args.tenantId,
          sessionId: currentSession.sessionId,
        });
        const last = replay.events[replay.events.length - 1];
        lastEventId = last?.event_id;
        process.stdout.write(`resumed session ${currentSession.sessionId}\n`);
        continue;
      }
      if (command.type === 'abort') {
        if (activeRunId === undefined) {
          process.stdout.write('no active run\n');
          continue;
        }
        await runtime.abortTurn({
          runId: activeRunId,
          reason: 'manual',
        });
        process.stdout.write(`abort requested for ${activeRunId}\n`);
        continue;
      }
      if (command.type === 'queue') {
        const queued = await runtime.queueTurn({
          sessionId: currentSession.sessionId,
          text: command.text,
          priority: command.priority,
        });
        process.stdout.write(`${JSON.stringify(queued)}\n`);
        continue;
      }
      if (command.type === 'steer') {
        const steered = await runtime.steerTurn({
          sessionId: currentSession.sessionId,
          ...(activeRunId !== undefined ? { runId: activeRunId } : {}),
          text: command.text,
        });
        process.stdout.write(`${JSON.stringify(steered)}\n`);
        continue;
      }
      if (command.type === 'replay') {
        const replay = await runtime.replayEvents({
          tenantId: args.tenantId,
          sessionId: currentSession.sessionId,
          includeThoughtDeltas: true,
          includeToolArgumentDeltas: true,
        });
        const tail = replay.events.slice(-command.count);
        for (const event of tail) {
          process.stdout.write(
            `[replay ${String(event.event_seq)}] ${event.type} run=${event.run_id} source=${event.source}\n`,
          );
        }
        const last = tail[tail.length - 1];
        if (last !== undefined) {
          lastEventId = last.event_id;
        }
        continue;
      }
      if (command.type === 'send') {
        const turn = await runtime.sendTurn({
          sessionId: currentSession.sessionId,
          input: command.text,
          idempotencyKey: `nim-cli:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
        });
        activeRunId = turn.runId;
        process.stdout.write(`run started ${turn.runId}\n`);
        const [trace, turnResult] = await Promise.all([
          collectTurnTrace({
            runtime,
            tenantId: args.tenantId,
            sessionId: currentSession.sessionId,
            runId: turn.runId,
            ...(lastEventId !== undefined ? { fromEventIdExclusive: lastEventId } : {}),
            uiMode,
          }),
          turn.done,
        ]);
        lastEventId = trace.lastEventId ?? lastEventId;
        activeRunId = undefined;
        process.stdout.write(`run completed ${turnResult.terminalState}\n`);
        if (trace.frameLines.length > 0) {
          process.stdout.write('frame:\n');
          for (const lineItem of trace.frameLines) {
            process.stdout.write(`  ${lineItem}\n`);
          }
        }
      }
    }
  } finally {
    rl.close();
    runtimeHandle.close();
  }
}

export async function runNimTuiSmoke(argv: readonly string[]): Promise<number> {
  if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
    printUsage();
    return 0;
  }
  const args = parseNimTuiArgs(argv);
  await runNimTuiInteractive(args);
  return 0;
}

if (import.meta.main) {
  process.exitCode = await runNimTuiSmoke(process.argv.slice(2));
}
