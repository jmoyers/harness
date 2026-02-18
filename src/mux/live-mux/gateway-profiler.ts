import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type GatewayProfilerAction = 'start' | 'stop';

interface RunHarnessProfileCommandInput {
  readonly invocationDirectory: string;
  readonly harnessScriptPath: string;
  readonly sessionName: string | null;
  readonly action: GatewayProfilerAction;
}

interface RunHarnessProfileCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface ToggleGatewayProfilerOptions {
  readonly invocationDirectory: string;
  readonly sessionName: string | null;
  readonly profileStateExists?: (profileStatePath: string) => boolean;
  readonly runHarnessProfileCommand?: (
    input: RunHarnessProfileCommandInput
  ) => Promise<RunHarnessProfileCommandResult>;
  readonly harnessScriptPath?: string;
}

interface ToggleGatewayProfilerResult {
  readonly action: GatewayProfilerAction;
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

export function resolveProfileStatePath(invocationDirectory: string, sessionName: string | null): string {
  if (sessionName === null) {
    return resolve(invocationDirectory, '.harness', 'active-profile.json');
  }
  return resolve(invocationDirectory, '.harness', 'sessions', sessionName, 'active-profile.json');
}

export function resolveHarnessProfileCommandArgs(
  action: GatewayProfilerAction,
  sessionName: string | null
): readonly string[] {
  if (sessionName === null) {
    return ['profile', action];
  }
  return ['--session', sessionName, 'profile', action];
}

function summarizeProfileSuccess(action: GatewayProfilerAction, stdout: string): string {
  const firstLine = firstNonEmptyLine(stdout);
  if (firstLine !== null) {
    return firstLine;
  }
  if (action === 'start') {
    return 'profile started';
  }
  return 'profile stopped';
}

function summarizeProfileFailure(action: GatewayProfilerAction, stderr: string, stdout: string): string {
  const detail = firstNonEmptyLine(stderr) ?? firstNonEmptyLine(stdout) ?? 'unknown error';
  return `profile ${action} failed: ${detail}`;
}

async function runHarnessProfileCommand(
  input: RunHarnessProfileCommandInput
): Promise<RunHarnessProfileCommandResult> {
  const commandArgs = resolveHarnessProfileCommandArgs(input.action, input.sessionName);
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
    }
  );

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  const exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  if (exitCode !== 0) {
    throw new Error(summarizeProfileFailure(input.action, stderr, stdout));
  }

  return {
    stdout,
    stderr,
  };
}

export async function toggleGatewayProfiler(
  options: ToggleGatewayProfilerOptions
): Promise<ToggleGatewayProfilerResult> {
  const profileStatePath = resolveProfileStatePath(options.invocationDirectory, options.sessionName);
  const isProfileRunning = (options.profileStateExists ?? existsSync)(profileStatePath);
  const action: GatewayProfilerAction = isProfileRunning ? 'stop' : 'start';
  const harnessScriptPath = options.harnessScriptPath ?? DEFAULT_HARNESS_SCRIPT_PATH;
  const runCommand = options.runHarnessProfileCommand ?? runHarnessProfileCommand;
  const result = await runCommand({
    invocationDirectory: options.invocationDirectory,
    harnessScriptPath,
    sessionName: options.sessionName,
    action,
  });
  return {
    action,
    message: summarizeProfileSuccess(action, result.stdout),
    stdout: result.stdout,
  };
}
