import { spawn } from 'node:child_process';
import type { DiffMode } from './types.ts';

type GitDiffCommandKind = 'patch' | 'name-status' | 'numstat';

export interface GitDiffInvocationOptions {
  readonly cwd: string;
  readonly mode: DiffMode;
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly noRenames: boolean;
  readonly renameLimit: number | null;
}

interface GitDiffPreflight {
  readonly filesChanged: number;
  readonly additions: number;
  readonly deletions: number;
  readonly binaryFiles: number;
}

interface ResolveRangeBaseRefOptions {
  readonly cwd: string;
  readonly headRef: string;
  readonly timeoutMs: number;
  readonly runCommand?: ResolveRangeBaseRefCommandRunner;
}

interface StreamGitLinesInput {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly onLine?: (line: string) => boolean | void;
  readonly onBytes?: (bytes: number) => boolean | void;
}

interface StreamGitLinesResult {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly aborted: boolean;
  readonly timedOut: boolean;
  readonly bytesRead: number;
  readonly peakLineBufferBytes: number;
  readonly stderr: string;
}

interface GitCommandOutput {
  readonly exitCode: number;
  readonly aborted: boolean;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

type ResolveRangeBaseRefCommandRunner = (
  cwd: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<GitCommandOutput>;

function trimLineEnding(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function parseFiniteInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

export function buildGitDiffArgs(
  options: GitDiffInvocationOptions,
  kind: GitDiffCommandKind,
): readonly string[] {
  const args: string[] = ['diff', '--no-ext-diff', '--no-color'];
  if (options.noRenames) {
    args.push('--no-renames');
  } else if (options.renameLimit !== null) {
    args.push(`-l${String(options.renameLimit)}`);
  }
  if (kind === 'patch') {
    args.push('--patch', '--binary');
  } else if (kind === 'name-status') {
    args.push('--name-status');
  } else {
    args.push('--numstat');
  }
  if (options.mode === 'staged') {
    args.push('--cached');
  } else if (options.mode === 'range') {
    if (options.baseRef === null || options.headRef === null) {
      throw new Error('range diff requires baseRef and headRef');
    }
    args.push(options.baseRef, options.headRef);
  }
  return args;
}

export async function streamGitLines(input: StreamGitLinesInput): Promise<StreamGitLinesResult> {
  return await new Promise<StreamGitLinesResult>((resolve, reject) => {
    const child = spawn('git', [...input.args], {
      cwd: input.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_PAGER: 'cat',
      },
    });
    let timedOut = false;
    let aborted = false;
    let bytesRead = 0;
    let peakLineBufferBytes = 0;
    let pending = '';
    let stderr = '';

    const abort = (markTimedOut = false): void => {
      aborted = true;
      if (markTimedOut) {
        timedOut = true;
      }
      child.kill('SIGTERM');
    };

    const timeout = setTimeout(() => abort(true), Math.max(1, Math.floor(input.timeoutMs)));

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.stdout.on('data', (chunk: Buffer) => {
      bytesRead += chunk.length;
      if (input.onBytes !== undefined) {
        const keepReading = input.onBytes(chunk.length);
        if (keepReading === false) {
          abort();
        }
      }
      pending += chunk.toString('utf8');
      const pendingBytes = Buffer.byteLength(pending);
      if (pendingBytes > peakLineBufferBytes) {
        peakLineBufferBytes = pendingBytes;
      }
      while (true) {
        const newlineIndex = pending.indexOf('\n');
        if (newlineIndex < 0) {
          break;
        }
        const line = trimLineEnding(pending.slice(0, newlineIndex));
        pending = pending.slice(newlineIndex + 1);
        if (input.onLine !== undefined) {
          const keepReading = input.onLine(line);
          if (keepReading === false) {
            abort();
            break;
          }
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.once('close', (code, signal) => {
      if (pending.length > 0 && input.onLine !== undefined) {
        const keepReading = input.onLine(trimLineEnding(pending));
        if (keepReading === false) {
          aborted = true;
        }
      }
      clearTimeout(timeout);
      resolve({
        exitCode: code ?? 1,
        signal,
        aborted,
        timedOut,
        bytesRead,
        peakLineBufferBytes,
        stderr: stderr.trim(),
      });
    });
  });
}

async function runGitCommandCapture(
  cwd: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<GitCommandOutput> {
  const lines: string[] = [];
  const result = await streamGitLines({
    cwd,
    args,
    timeoutMs,
    onLine: (line) => {
      lines.push(line);
    },
  });
  return {
    exitCode: result.exitCode,
    aborted: result.aborted,
    timedOut: result.timedOut,
    stdout: lines.join('\n').trim(),
    stderr: result.stderr,
  };
}

async function resolveRangeBaseTargetRef(
  cwd: string,
  timeoutMs: number,
  runCommand: ResolveRangeBaseRefCommandRunner,
): Promise<string> {
  const remoteHead = await runCommand(
    cwd,
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    timeoutMs,
  );
  if (remoteHead.exitCode === 0 && !remoteHead.aborted) {
    const remoteHeadRef = firstNonEmptyLine(remoteHead.stdout);
    if (remoteHeadRef !== null) {
      return remoteHeadRef;
    }
  }

  for (const candidate of ['origin/main', 'main', 'origin/master', 'master']) {
    const exists = await runCommand(
      cwd,
      ['rev-parse', '--verify', '--quiet', candidate],
      timeoutMs,
    );
    if (exists.exitCode === 0 && !exists.aborted && firstNonEmptyLine(exists.stdout) !== null) {
      return candidate;
    }
  }

  return 'HEAD';
}

export async function resolveRangeBaseRef(options: ResolveRangeBaseRefOptions): Promise<string> {
  const runCommand = options.runCommand ?? runGitCommandCapture;
  const targetRef = await resolveRangeBaseTargetRef(options.cwd, options.timeoutMs, runCommand);
  const mergeBase = await runCommand(
    options.cwd,
    ['merge-base', targetRef, options.headRef],
    options.timeoutMs,
  );
  if (mergeBase.exitCode !== 0 || mergeBase.aborted) {
    const reason = mergeBase.timedOut
      ? 'timed out'
      : mergeBase.stderr.length > 0
        ? mergeBase.stderr
        : 'unknown error';
    throw new Error(`git merge-base ${targetRef} ${options.headRef} failed: ${reason}`);
  }
  const resolved = firstNonEmptyLine(mergeBase.stdout);
  if (resolved === null) {
    throw new Error(`git merge-base ${targetRef} ${options.headRef} returned no output`);
  }
  return resolved;
}

export async function readGitDiffPreflight(
  options: GitDiffInvocationOptions,
  timeoutMs: number,
): Promise<GitDiffPreflight> {
  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;
  let binaryFiles = 0;

  const nameStatus = await streamGitLines({
    cwd: options.cwd,
    args: buildGitDiffArgs(options, 'name-status'),
    timeoutMs,
    onLine: (_line) => {
      filesChanged += 1;
    },
  });
  if (nameStatus.exitCode !== 0 && !nameStatus.aborted) {
    throw new Error(`git diff --name-status failed: ${nameStatus.stderr || 'unknown error'}`);
  }

  await streamGitLines({
    cwd: options.cwd,
    args: buildGitDiffArgs(options, 'numstat'),
    timeoutMs,
    onLine: (line) => {
      const [addRaw = '', delRaw = ''] = line.split('\t');
      if (addRaw === '-' || delRaw === '-') {
        binaryFiles += 1;
        return;
      }
      const add = parseFiniteInteger(addRaw);
      const del = parseFiniteInteger(delRaw);
      additions += add;
      deletions += del;
    },
  });
  return {
    filesChanged,
    additions,
    deletions,
    binaryFiles,
  };
}
