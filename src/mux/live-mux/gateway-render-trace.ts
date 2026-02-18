import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRenderTraceStatePath } from './render-trace-state.ts';

type GatewayRenderTraceAction = 'start' | 'stop';

interface RunHarnessRenderTraceCommandInput {
  readonly invocationDirectory: string;
  readonly harnessScriptPath: string;
  readonly sessionName: string | null;
  readonly conversationId: string | null;
  readonly action: GatewayRenderTraceAction;
}

interface RunHarnessRenderTraceCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface ToggleGatewayRenderTraceOptions {
  readonly invocationDirectory: string;
  readonly sessionName: string | null;
  readonly conversationId: string | null;
  readonly renderTraceStateExists?: (renderTraceStatePath: string) => boolean;
  readonly runHarnessRenderTraceCommand?: (
    input: RunHarnessRenderTraceCommandInput,
  ) => Promise<RunHarnessRenderTraceCommandResult>;
  readonly harnessScriptPath?: string;
}

interface ToggleGatewayRenderTraceResult {
  readonly action: GatewayRenderTraceAction;
  readonly message: string;
  readonly stdout: string;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HARNESS_SCRIPT_PATH = resolve(SCRIPT_DIR, '../../../scripts/harness.ts');

function firstNonEmptyLine(text: string): string | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[0] ?? null;
}

function lineValueForPrefix(text: string, prefix: string): string | null {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith(prefix)) {
      continue;
    }
    const value = line.slice(prefix.length).trim();
    if (value.length === 0) {
      continue;
    }
    return value;
  }
  return null;
}

export function resolveHarnessRenderTraceCommandArgs(
  action: GatewayRenderTraceAction,
  sessionName: string | null,
  conversationId: string | null,
): readonly string[] {
  const base =
    sessionName === null ? ['render-trace', action] : ['--session', sessionName, 'render-trace', action];
  if (action === 'start' && conversationId !== null) {
    return [...base, '--conversation-id', conversationId];
  }
  return base;
}

function summarizeRenderTraceSuccess(action: GatewayRenderTraceAction, stdout: string): string {
  if (action === 'start') {
    const outputPath = lineValueForPrefix(stdout, 'render-trace-target:');
    const conversationId = lineValueForPrefix(stdout, 'render-trace-conversation-id:');
    if (outputPath !== null && conversationId !== null) {
      return `render: trace=${outputPath} conversation=${conversationId}`;
    }
    if (outputPath !== null) {
      return `render: trace=${outputPath}`;
    }
  }
  const firstLine = firstNonEmptyLine(stdout);
  if (firstLine !== null) {
    return firstLine;
  }
  if (action === 'start') {
    return 'render trace started';
  }
  return 'render trace stopped';
}

function summarizeRenderTraceFailure(
  action: GatewayRenderTraceAction,
  stderr: string,
  stdout: string,
): string {
  const detail = firstNonEmptyLine(stderr) ?? firstNonEmptyLine(stdout) ?? 'unknown error';
  return `render trace ${action} failed: ${detail}`;
}

async function runHarnessRenderTraceCommand(
  input: RunHarnessRenderTraceCommandInput,
): Promise<RunHarnessRenderTraceCommandResult> {
  const commandArgs = resolveHarnessRenderTraceCommandArgs(
    input.action,
    input.sessionName,
    input.conversationId,
  );
  const child = spawn(process.execPath, [input.harnessScriptPath, ...commandArgs], {
    cwd: input.invocationDirectory,
    env: {
      ...process.env,
      HARNESS_INVOKE_CWD: input.invocationDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(
    (resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('exit', (exitCode, exitSignal) => {
        resolveExit([exitCode, exitSignal]);
      });
    },
  );

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  const exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  if (exitCode !== 0) {
    throw new Error(summarizeRenderTraceFailure(input.action, stderr, stdout));
  }

  return {
    stdout,
    stderr,
  };
}

export async function toggleGatewayRenderTrace(
  options: ToggleGatewayRenderTraceOptions,
): Promise<ToggleGatewayRenderTraceResult> {
  const statePath = resolveRenderTraceStatePath(options.invocationDirectory, options.sessionName);
  const isRunning = (options.renderTraceStateExists ?? existsSync)(statePath);
  const action: GatewayRenderTraceAction = isRunning ? 'stop' : 'start';
  const harnessScriptPath = options.harnessScriptPath ?? DEFAULT_HARNESS_SCRIPT_PATH;
  const runCommand = options.runHarnessRenderTraceCommand ?? runHarnessRenderTraceCommand;
  const result = await runCommand({
    invocationDirectory: options.invocationDirectory,
    harnessScriptPath,
    sessionName: options.sessionName,
    conversationId: options.conversationId,
    action,
  });
  return {
    action,
    message: summarizeRenderTraceSuccess(action, result.stdout),
    stdout: result.stdout,
  };
}
