import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHarnessWorkspaceDirectory } from '../../config/harness-paths.ts';

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
    input: RunHarnessProfileCommandInput,
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
const SUPPORTED_PROFILE_STATE_VERSIONS = new Set([1, 2]);
const SUPPORTED_PROFILE_STATE_MODES = new Set(['live-inspect', 'live-inspector']);

function firstNonEmptyLine(text: string): string | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[0] ?? null;
}

export function resolveProfileStatePath(
  invocationDirectory: string,
  sessionName: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const workspaceDirectory = resolveHarnessWorkspaceDirectory(invocationDirectory, env);
  if (sessionName === null) {
    return resolve(workspaceDirectory, 'active-profile.json');
  }
  return resolve(workspaceDirectory, 'sessions', sessionName, 'active-profile.json');
}

export function resolveHarnessProfileCommandArgs(
  action: GatewayProfilerAction,
  sessionName: string | null,
): readonly string[] {
  if (sessionName === null) {
    return ['profile', action];
  }
  return ['--session', sessionName, 'profile', action];
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasValidActiveProfilePayload(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  if (!SUPPORTED_PROFILE_STATE_VERSIONS.has(candidate['version'] as number)) {
    return false;
  }
  if (!SUPPORTED_PROFILE_STATE_MODES.has(candidate['mode'] as string)) {
    return false;
  }
  if (!isIntegerInRange(candidate['pid'], 1, Number.MAX_SAFE_INTEGER)) {
    return false;
  }
  if (!isNonEmptyString(candidate['host'])) {
    return false;
  }
  if (!isIntegerInRange(candidate['port'], 1, 65535)) {
    return false;
  }
  if (!isNonEmptyString(candidate['stateDbPath'])) {
    return false;
  }
  if (!isNonEmptyString(candidate['profileDir'])) {
    return false;
  }
  if (!isNonEmptyString(candidate['gatewayProfilePath'])) {
    return false;
  }
  if (!isNonEmptyString(candidate['inspectWebSocketUrl'])) {
    return false;
  }
  if (!isNonEmptyString(candidate['startedAt'])) {
    return false;
  }
  return true;
}

export function hasActiveProfileState(profileStatePath: string): boolean {
  if (!existsSync(profileStatePath)) {
    return false;
  }
  try {
    const raw = JSON.parse(readFileSync(profileStatePath, 'utf8')) as unknown;
    return hasValidActiveProfilePayload(raw);
  } catch {
    return false;
  }
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

function summarizeProfileFailure(
  action: GatewayProfilerAction,
  stderr: string,
  stdout: string,
): string {
  const detail = firstNonEmptyLine(stderr) ?? firstNonEmptyLine(stdout) ?? 'unknown error';
  return `profile ${action} failed: ${detail}`;
}

async function runHarnessProfileCommand(
  input: RunHarnessProfileCommandInput,
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
    },
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
  options: ToggleGatewayProfilerOptions,
): Promise<ToggleGatewayProfilerResult> {
  const profileStatePath = resolveProfileStatePath(
    options.invocationDirectory,
    options.sessionName,
  );
  const isProfileRunning = (options.profileStateExists ?? hasActiveProfileState)(profileStatePath);
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
