import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  normalizeGitHubRemoteUrl,
  parseCommitCount,
  parseGitBranchFromStatusHeader,
  parseGitShortstatCounts,
  parseLastCommitLine,
  repositoryNameFromGitHubRemoteUrl
} from './git-parsing.ts';

const execFileAsync = promisify(execFile);

interface GitSummary {
  readonly branch: string;
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
}

interface GitRepositorySnapshot {
  readonly normalizedRemoteUrl: string | null;
  readonly commitCount: number | null;
  readonly lastCommitAt: string | null;
  readonly shortCommitHash: string | null;
  readonly inferredName: string | null;
  readonly defaultBranch: string | null;
}

interface GitDirectorySnapshot {
  readonly summary: GitSummary;
  readonly repository: GitRepositorySnapshot;
}

interface ProcessUsageSample {
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
}

export const GIT_SUMMARY_NOT_REPOSITORY: GitSummary = {
  branch: '(not git)',
  changedFiles: 0,
  additions: 0,
  deletions: 0
};

export const GIT_REPOSITORY_NONE: GitRepositorySnapshot = {
  normalizedRemoteUrl: null,
  commitCount: null,
  lastCommitAt: null,
  shortCommitHash: null,
  inferredName: null,
  defaultBranch: null
};

interface ExecFileResult {
  readonly stdout: string;
}

interface GitProcessRunnerOptions {
  readonly cwd: string;
  readonly encoding: 'utf8';
  readonly timeout: number;
  readonly maxBuffer: number;
}

interface PsProcessRunnerOptions {
  readonly encoding: 'utf8';
  readonly timeout: number;
  readonly maxBuffer: number;
}

export type GitProcessRunner = (
  command: string,
  args: readonly string[],
  options: GitProcessRunnerOptions
) => Promise<ExecFileResult>;

export type PsProcessRunner = (
  command: string,
  args: readonly string[],
  options: PsProcessRunnerOptions
) => Promise<ExecFileResult>;

export type GitCommandRunner = (cwd: string, args: readonly string[]) => Promise<string>;

const defaultGitProcessRunner: GitProcessRunner = async (command, args, options) => {
  const result = await execFileAsync(command, [...args], options);
  return {
    stdout: result.stdout
  };
};

const defaultPsProcessRunner: PsProcessRunner = async (command, args, options) => {
  const result = await execFileAsync(command, [...args], options);
  return {
    stdout: result.stdout
  };
};

export async function runGitCommand(
  cwd: string,
  args: readonly string[],
  processRunner: GitProcessRunner = defaultGitProcessRunner
): Promise<string> {
  try {
    const result = await processRunner('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 1500,
      maxBuffer: 1024 * 1024
    });
    return result.stdout.trim();
  } catch {
    return '';
  }
}

export async function readGitDirectorySnapshot(
  cwd: string,
  runCommand: GitCommandRunner = runGitCommand
): Promise<GitDirectorySnapshot> {
  const insideWorkTree = await runCommand(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree !== 'true') {
    return {
      summary: GIT_SUMMARY_NOT_REPOSITORY,
      repository: GIT_REPOSITORY_NONE
    };
  }

  const statusOutputPromise = runCommand(cwd, ['status', '--porcelain=1', '--branch']);
  const unstagedShortstatPromise = runCommand(cwd, ['diff', '--shortstat']);
  const stagedShortstatPromise = runCommand(cwd, ['diff', '--cached', '--shortstat']);
  const remoteUrlPromise = runCommand(cwd, ['remote', 'get-url', 'origin']);
  const commitCountPromise = runCommand(cwd, ['rev-list', '--count', 'HEAD']);
  const lastCommitPromise = runCommand(cwd, ['log', '-1', '--format=%ct %h']);

  const statusOutput = await statusOutputPromise;
  const statusLines = statusOutput.split('\n').filter((line) => line.trim().length > 0);
  const firstStatusLine = statusLines[0];
  const headerLine =
    firstStatusLine !== undefined && firstStatusLine.startsWith('## ')
      ? statusLines.shift()!.slice(3)
      : null;
  const branch = parseGitBranchFromStatusHeader(headerLine);
  const changedFiles = statusLines.length;

  const [unstagedShortstat, stagedShortstat, remoteUrlRaw, commitCountRaw, lastCommitRaw] = await Promise.all([
    unstagedShortstatPromise,
    stagedShortstatPromise,
    remoteUrlPromise,
    commitCountPromise,
    lastCommitPromise
  ]);

  const unstaged = parseGitShortstatCounts(unstagedShortstat);
  const staged = parseGitShortstatCounts(stagedShortstat);
  const normalizedRemoteUrl = normalizeGitHubRemoteUrl(remoteUrlRaw);
  const commitCount = parseCommitCount(commitCountRaw);
  const lastCommit = parseLastCommitLine(lastCommitRaw);

  return {
    summary: {
      branch,
      changedFiles,
      additions: unstaged.additions + staged.additions,
      deletions: unstaged.deletions + staged.deletions
    },
    repository: {
      normalizedRemoteUrl,
      commitCount,
      lastCommitAt: lastCommit.lastCommitAt,
      shortCommitHash: lastCommit.shortCommitHash,
      inferredName: normalizedRemoteUrl === null ? null : repositoryNameFromGitHubRemoteUrl(normalizedRemoteUrl),
      defaultBranch: branch === '(detached)' ? null : branch
    }
  };
}

export async function readProcessUsageSample(
  processId: number | null,
  processRunner: PsProcessRunner = defaultPsProcessRunner
): Promise<ProcessUsageSample> {
  if (processId === null) {
    return {
      cpuPercent: null,
      memoryMb: null
    };
  }

  let stdout = '';
  try {
    const result = await processRunner('ps', ['-p', String(processId), '-o', '%cpu=,rss='], {
      encoding: 'utf8',
      timeout: 1000,
      maxBuffer: 8 * 1024
    });
    stdout = result.stdout;
  } catch {
    return {
      cpuPercent: null,
      memoryMb: null
    };
  }

  const line = stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .at(-1);
  if (line === undefined) {
    return {
      cpuPercent: null,
      memoryMb: null
    };
  }

  const parts = line.split(/\s+/);
  const cpuPercentRaw = Number.parseFloat(String(parts[0]));
  const memoryKbRaw = Number.parseInt(String(parts[1]), 10);
  return {
    cpuPercent: Number.isFinite(cpuPercentRaw) ? cpuPercentRaw : null,
    memoryMb: Number.isFinite(memoryKbRaw) ? memoryKbRaw / 1024 : null
  };
}
