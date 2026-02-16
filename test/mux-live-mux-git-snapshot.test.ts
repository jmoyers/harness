import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GIT_REPOSITORY_NONE,
  GIT_SUMMARY_NOT_REPOSITORY,
  readGitDirectorySnapshot,
  readProcessUsageSample,
  runGitCommand,
  type GitCommandRunner,
  type GitProcessRunner,
  type PsProcessRunner
} from '../src/mux/live-mux/git-snapshot.ts';

void test('runGitCommand trims stdout and returns empty string on process failures', async () => {
  const successRunner: GitProcessRunner = () => Promise.resolve({ stdout: '  value  \n' });
  assert.equal(await runGitCommand('/tmp', ['status'], successRunner), 'value');

  const failureRunner: GitProcessRunner = () => Promise.reject(new Error('boom'));
  assert.equal(await runGitCommand('/tmp', ['status'], failureRunner), '');
});

function runnerFromMap(values: Record<string, string>): GitCommandRunner {
  return (_cwd, args): Promise<string> => Promise.resolve(values[args.join(' ')] ?? '');
}

void test('readGitDirectorySnapshot returns not-repository defaults outside a git work tree', async () => {
  const snapshot = await readGitDirectorySnapshot('/tmp', runnerFromMap({
    'rev-parse --is-inside-work-tree': 'false'
  }));

  assert.deepEqual(snapshot, {
    summary: GIT_SUMMARY_NOT_REPOSITORY,
    repository: GIT_REPOSITORY_NONE
  });
});

void test('readGitDirectorySnapshot parses branch status, counts, and repository metadata', async () => {
  const snapshot = await readGitDirectorySnapshot('/tmp', runnerFromMap({
    'rev-parse --is-inside-work-tree': 'true',
    'status --porcelain=1 --branch': '## feature/test...origin/feature/test\n M app.ts\n?? new.ts',
    'diff --shortstat': ' 1 file changed, 3 insertions(+), 1 deletion(-)',
    'diff --cached --shortstat': ' 1 file changed, 2 insertions(+), 4 deletions(-)',
    'remote get-url origin': 'git@github.com:Acme/Repo.git',
    'rev-list --count HEAD': '12',
    'log -1 --format=%ct %h': 'abc123\t2026-01-01T00:00:00.000Z'
  }));

  assert.deepEqual(snapshot, {
    summary: {
      branch: 'feature/test',
      changedFiles: 2,
      additions: 5,
      deletions: 5
    },
    repository: {
      normalizedRemoteUrl: 'https://github.com/acme/repo',
      commitCount: 12,
      lastCommitAt: '2026-01-01T00:00:00.000Z',
      shortCommitHash: 'abc123',
      inferredName: 'repo',
      defaultBranch: 'feature/test'
    }
  });
});

void test('readGitDirectorySnapshot handles detached/unknown metadata branches', async () => {
  const snapshot = await readGitDirectorySnapshot('/tmp', runnerFromMap({
    'rev-parse --is-inside-work-tree': 'true',
    'status --porcelain=1 --branch': 'M app.ts\n',
    'diff --shortstat': 'no changes',
    'diff --cached --shortstat': 'no changes',
    'remote get-url origin': 'https://example.com/not-github',
    'rev-list --count HEAD': 'not-a-number',
    'log -1 --format=%ct %h': ''
  }));

  assert.deepEqual(snapshot, {
    summary: {
      branch: '(detached)',
      changedFiles: 1,
      additions: 0,
      deletions: 0
    },
    repository: {
      normalizedRemoteUrl: null,
      commitCount: null,
      lastCommitAt: null,
      shortCommitHash: null,
      inferredName: null,
      defaultBranch: null
    }
  });
});

void test('readGitDirectorySnapshot handles empty status output without header line', async () => {
  const snapshot = await readGitDirectorySnapshot('/tmp', runnerFromMap({
    'rev-parse --is-inside-work-tree': 'true',
    'status --porcelain=1 --branch': '',
    'diff --shortstat': '',
    'diff --cached --shortstat': '',
    'remote get-url origin': '',
    'rev-list --count HEAD': '',
    'log -1 --format=%ct %h': ''
  }));

  assert.deepEqual(snapshot, {
    summary: {
      branch: '(detached)',
      changedFiles: 0,
      additions: 0,
      deletions: 0
    },
    repository: {
      normalizedRemoteUrl: null,
      commitCount: null,
      lastCommitAt: null,
      shortCommitHash: null,
      inferredName: null,
      defaultBranch: null
    }
  });
});

void test('readProcessUsageSample handles null ids, parsing, and process failures', async () => {
  assert.deepEqual(await readProcessUsageSample(null), {
    cpuPercent: null,
    memoryMb: null
  });

  const throwingRunner: PsProcessRunner = () => Promise.reject(new Error('failed ps'));
  assert.deepEqual(await readProcessUsageSample(42, throwingRunner), {
    cpuPercent: null,
    memoryMb: null
  });

  const emptyRunner: PsProcessRunner = () => Promise.resolve({ stdout: '  \n\n' });
  assert.deepEqual(await readProcessUsageSample(42, emptyRunner), {
    cpuPercent: null,
    memoryMb: null
  });

  const validRunner: PsProcessRunner = () => Promise.resolve({ stdout: ' 12.5 2048\n' });
  assert.deepEqual(await readProcessUsageSample(42, validRunner), {
    cpuPercent: 12.5,
    memoryMb: 2
  });

  const malformedRunner: PsProcessRunner = () => Promise.resolve({ stdout: 'nope nope\n' });
  assert.deepEqual(await readProcessUsageSample(42, malformedRunner), {
    cpuPercent: null,
    memoryMb: null
  });
});

void test('default git and ps runners execute through node child_process wrappers', async () => {
  const version = await runGitCommand(process.cwd(), ['--version']);
  assert.equal(version.startsWith('git version'), true);

  const snapshot = await readGitDirectorySnapshot(process.cwd());
  assert.equal(typeof snapshot.summary.branch, 'string');
  assert.equal(Number.isInteger(snapshot.summary.changedFiles), true);

  const sample = await readProcessUsageSample(process.pid);
  assert.equal(sample.cpuPercent === null || Number.isFinite(sample.cpuPercent), true);
  assert.equal(sample.memoryMb === null || Number.isFinite(sample.memoryMb), true);
});
