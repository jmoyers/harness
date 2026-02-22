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
  type PsProcessRunner,
} from '../../../../src/mux/live-mux/git-snapshot.ts';

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
  const snapshot = await readGitDirectorySnapshot(
    '/tmp',
    runnerFromMap({
      'rev-parse --is-inside-work-tree': 'false',
    }),
  );

  assert.deepEqual(snapshot, {
    summary: GIT_SUMMARY_NOT_REPOSITORY,
    repository: GIT_REPOSITORY_NONE,
  });
});

void test('readGitDirectorySnapshot parses branch status, counts, and repository metadata', async () => {
  const snapshot = await readGitDirectorySnapshot(
    '/tmp',
    runnerFromMap({
      'rev-parse --is-inside-work-tree': 'true',
      'status --porcelain=1 --branch':
        '## feature/test...origin/feature/test\n M app.ts\n?? new.ts',
      'diff --shortstat': ' 1 file changed, 3 insertions(+), 1 deletion(-)',
      'diff --cached --shortstat': ' 1 file changed, 2 insertions(+), 4 deletions(-)',
      'remote get-url origin': 'git@github.com:Acme/Repo.git',
      'rev-list --count HEAD': '12',
      'log -1 --format=%ct %h': 'abc123\t2026-01-01T00:00:00.000Z',
    }),
  );

  assert.deepEqual(snapshot, {
    summary: {
      branch: 'feature/test',
      changedFiles: 2,
      additions: 5,
      deletions: 5,
    },
    repository: {
      normalizedRemoteUrl: 'https://github.com/acme/repo',
      commitCount: 12,
      lastCommitAt: '2026-01-01T00:00:00.000Z',
      shortCommitHash: 'abc123',
      inferredName: 'repo',
      defaultBranch: 'feature/test',
    },
  });
});

void test('readGitDirectorySnapshot handles detached/unknown metadata branches', async () => {
  const snapshot = await readGitDirectorySnapshot(
    '/tmp',
    runnerFromMap({
      'rev-parse --is-inside-work-tree': 'true',
      'status --porcelain=1 --branch': 'M app.ts\n',
      'diff --shortstat': 'no changes',
      'diff --cached --shortstat': 'no changes',
      'remote get-url origin': 'https://example.com/not-github',
      remote: 'origin\n',
      'rev-parse --show-toplevel': '/tmp/local-repo',
      'rev-list --count HEAD': 'not-a-number',
      'log -1 --format=%ct %h': '',
    }),
  );

  assert.deepEqual(snapshot, {
    summary: {
      branch: '(detached)',
      changedFiles: 1,
      additions: 0,
      deletions: 0,
    },
    repository: {
      normalizedRemoteUrl: 'file:///tmp/local-repo',
      commitCount: null,
      lastCommitAt: null,
      shortCommitHash: null,
      inferredName: 'local-repo',
      defaultBranch: null,
    },
  });
});

void test('readGitDirectorySnapshot falls back to local repository locator when github remotes are unavailable', async () => {
  const snapshot = await readGitDirectorySnapshot(
    '/tmp',
    runnerFromMap({
      'rev-parse --is-inside-work-tree': 'true',
      'status --porcelain=1 --branch': '## main\n',
      'diff --shortstat': '',
      'diff --cached --shortstat': '',
      'remote get-url origin': 'https://example.com/not-github',
      remote: 'origin\n',
      'rev-parse --show-toplevel': '/tmp/local-only-repo',
      'rev-list --count HEAD': '3',
      'log -1 --format=%ct %h': 'abc123\t2026-01-01T00:00:00.000Z',
    }),
  );

  assert.deepEqual(snapshot.repository, {
    normalizedRemoteUrl: 'file:///tmp/local-only-repo',
    commitCount: 3,
    lastCommitAt: '2026-01-01T00:00:00.000Z',
    shortCommitHash: 'abc123',
    inferredName: 'local-only-repo',
    defaultBranch: 'main',
  });
});

void test('readGitDirectorySnapshot falls back to non-origin github remotes when origin is unavailable', async () => {
  const snapshot = await readGitDirectorySnapshot(
    '/tmp',
    runnerFromMap({
      'rev-parse --is-inside-work-tree': 'true',
      'status --porcelain=1 --branch': '## main...upstream/main\n',
      'diff --shortstat': '',
      'diff --cached --shortstat': '',
      'remote get-url origin': '',
      remote: 'upstream\n',
      'remote get-url upstream': 'ssh://git@github.com/Acme/Harness.git',
      'rev-list --count HEAD': '7',
      'log -1 --format=%ct %h': 'abc123\t2026-01-01T00:00:00.000Z',
    }),
  );

  assert.deepEqual(snapshot, {
    summary: {
      branch: 'main',
      changedFiles: 0,
      additions: 0,
      deletions: 0,
    },
    repository: {
      normalizedRemoteUrl: 'https://github.com/acme/harness',
      commitCount: 7,
      lastCommitAt: '2026-01-01T00:00:00.000Z',
      shortCommitHash: 'abc123',
      inferredName: 'harness',
      defaultBranch: 'main',
    },
  });
});

void test('readGitDirectorySnapshot skips non-github remotes while scanning fallback remote list', async () => {
  const snapshot = await readGitDirectorySnapshot(
    '/tmp',
    runnerFromMap({
      'rev-parse --is-inside-work-tree': 'true',
      'status --porcelain=1 --branch': '## main\n',
      'diff --shortstat': '',
      'diff --cached --shortstat': '',
      'remote get-url origin': '',
      remote: 'mirror\nupstream\n',
      'remote get-url mirror': 'https://gitlab.com/acme/harness.git',
      'remote get-url upstream': 'git@github.com:Acme/Harness.git',
      'rev-list --count HEAD': '1',
      'log -1 --format=%ct %h': 'abc123\t2026-01-01T00:00:00.000Z',
    }),
  );

  assert.equal(snapshot.repository.normalizedRemoteUrl, 'https://github.com/acme/harness');
  assert.equal(snapshot.repository.inferredName, 'harness');
});

void test('readGitDirectorySnapshot handles empty status output without header line', async () => {
  const snapshot = await readGitDirectorySnapshot(
    '/tmp',
    runnerFromMap({
      'rev-parse --is-inside-work-tree': 'true',
      'status --porcelain=1 --branch': '',
      'diff --shortstat': '',
      'diff --cached --shortstat': '',
      'remote get-url origin': '',
      'rev-list --count HEAD': '',
      'log -1 --format=%ct %h': '',
    }),
  );

  assert.deepEqual(snapshot, {
    summary: {
      branch: '(detached)',
      changedFiles: 0,
      additions: 0,
      deletions: 0,
    },
    repository: {
      normalizedRemoteUrl: null,
      commitCount: null,
      lastCommitAt: null,
      shortCommitHash: null,
      inferredName: null,
      defaultBranch: null,
    },
  });
});

void test('readGitDirectorySnapshot can skip commit-count command for cheaper polling', async () => {
  const executedCommands: string[] = [];
  const runner: GitCommandRunner = (_cwd, args) => {
    const key = args.join(' ');
    executedCommands.push(key);
    if (key === 'rev-parse --is-inside-work-tree') {
      return Promise.resolve('true');
    }
    if (key === 'status --porcelain=1 --branch') {
      return Promise.resolve('## main');
    }
    if (key === 'diff --shortstat' || key === 'diff --cached --shortstat') {
      return Promise.resolve('');
    }
    if (key === 'remote get-url origin') {
      return Promise.resolve('https://github.com/acme/repo');
    }
    if (key === 'log -1 --format=%ct %h') {
      return Promise.resolve('abc123\t2026-01-01T00:00:00.000Z');
    }
    return Promise.resolve('');
  };

  const snapshot = await readGitDirectorySnapshot('/tmp', runner, {
    includeCommitCount: false,
  });

  assert.equal(executedCommands.includes('rev-list --count HEAD'), false);
  assert.equal(snapshot.repository.commitCount, null);
});

void test('readProcessUsageSample handles null ids, parsing, and process failures', async () => {
  assert.deepEqual(await readProcessUsageSample(null), {
    cpuPercent: null,
    memoryMb: null,
  });

  const throwingRunner: PsProcessRunner = () => Promise.reject(new Error('failed ps'));
  assert.deepEqual(await readProcessUsageSample(42, throwingRunner), {
    cpuPercent: null,
    memoryMb: null,
  });

  const emptyRunner: PsProcessRunner = () => Promise.resolve({ stdout: '  \n\n' });
  assert.deepEqual(await readProcessUsageSample(42, emptyRunner), {
    cpuPercent: null,
    memoryMb: null,
  });

  const validRunner: PsProcessRunner = () => Promise.resolve({ stdout: ' 12.5 2048\n' });
  assert.deepEqual(await readProcessUsageSample(42, validRunner), {
    cpuPercent: 12.5,
    memoryMb: 2,
  });

  const malformedRunner: PsProcessRunner = () => Promise.resolve({ stdout: 'nope nope\n' });
  assert.deepEqual(await readProcessUsageSample(42, malformedRunner), {
    cpuPercent: null,
    memoryMb: null,
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
