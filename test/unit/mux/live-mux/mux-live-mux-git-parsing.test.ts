import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeGitHubRemoteUrl,
  parseCommitCount,
  parseGitBranchFromStatusHeader,
  parseGitShortstatCounts,
  parseLastCommitLine,
  resolveGitHubDefaultBranchForActions,
  repositoryNameFromGitHubRemoteUrl,
  resolveGitHubTrackedBranchForActions,
  shouldShowGitHubPrActions,
} from '../../../../src/mux/live-mux/git-parsing.ts';

void test('parseGitBranchFromStatusHeader handles detached and branch states', () => {
  assert.equal(parseGitBranchFromStatusHeader(null), '(detached)');
  assert.equal(parseGitBranchFromStatusHeader('   '), '(detached)');
  assert.equal(parseGitBranchFromStatusHeader('No commits yet on main'), 'main');
  assert.equal(parseGitBranchFromStatusHeader('No commits yet on   '), '(detached)');
  assert.equal(parseGitBranchFromStatusHeader('HEAD'), '(detached)');
  assert.equal(parseGitBranchFromStatusHeader('HEAD detached at abc123'), '(detached)');
  assert.equal(parseGitBranchFromStatusHeader('...origin/main'), '(detached)');
  assert.equal(
    parseGitBranchFromStatusHeader('feature/test...origin/feature/test'),
    'feature/test',
  );
});

void test('parseGitShortstatCounts extracts additions and deletions', () => {
  assert.deepEqual(parseGitShortstatCounts(' 2 files changed, 7 insertions(+), 5 deletions(-)'), {
    additions: 7,
    deletions: 5,
  });
  assert.deepEqual(parseGitShortstatCounts('1 insertion(+), 0 deletions(-)'), {
    additions: 1,
    deletions: 0,
  });
  assert.deepEqual(parseGitShortstatCounts('nothing useful'), {
    additions: 0,
    deletions: 0,
  });
});

void test('normalizeGitHubRemoteUrl canonicalizes supported github remote forms', () => {
  assert.equal(normalizeGitHubRemoteUrl(''), null);
  assert.equal(normalizeGitHubRemoteUrl('https://example.com/acme/repo'), null);
  assert.equal(normalizeGitHubRemoteUrl('https://github.com/acme'), null);
  assert.equal(normalizeGitHubRemoteUrl('https://github.com/'), null);
  assert.equal(
    normalizeGitHubRemoteUrl('https://github.com/acme/repo'),
    'https://github.com/acme/repo',
  );
  assert.equal(
    normalizeGitHubRemoteUrl('https://github.com/Acme/Repo.git'),
    'https://github.com/acme/repo',
  );
  assert.equal(
    normalizeGitHubRemoteUrl('https://github.com/Acme/Repo.git/'),
    'https://github.com/acme/repo',
  );
  assert.equal(normalizeGitHubRemoteUrl('git@github.com:   '), null);
  assert.equal(
    normalizeGitHubRemoteUrl('git@github.com:Acme/Repo.git'),
    'https://github.com/acme/repo',
  );
  assert.equal(
    normalizeGitHubRemoteUrl('ssh://git@github.com/acme/repo.git'),
    'https://github.com/acme/repo',
  );
  assert.equal(
    normalizeGitHubRemoteUrl('ssh://github.com/acme/repo.git'),
    'https://github.com/acme/repo',
  );
  assert.equal(
    normalizeGitHubRemoteUrl('git://github.com/acme/repo.git'),
    'https://github.com/acme/repo',
  );
});

void test('repositoryNameFromGitHubRemoteUrl returns parsed repository when available', () => {
  assert.equal(repositoryNameFromGitHubRemoteUrl('https://github.com/acme/harness.git'), 'harness');
  assert.equal(repositoryNameFromGitHubRemoteUrl('https://github.com/acme/harness/'), 'harness');
  assert.equal(repositoryNameFromGitHubRemoteUrl('not-a-github-remote'), 'not-a-github-remote');
});

void test('shouldShowGitHubPrActions requires a non-default branch', () => {
  assert.equal(
    shouldShowGitHubPrActions({
      trackedBranch: null,
      defaultBranch: 'main',
    }),
    false,
  );
  assert.equal(
    shouldShowGitHubPrActions({
      trackedBranch: '(detached)',
      defaultBranch: 'main',
    }),
    false,
  );
  assert.equal(
    shouldShowGitHubPrActions({
      trackedBranch: 'main',
      defaultBranch: 'main',
    }),
    false,
  );
  assert.equal(
    shouldShowGitHubPrActions({
      trackedBranch: 'release',
      defaultBranch: 'release',
    }),
    false,
  );
  assert.equal(
    shouldShowGitHubPrActions({
      trackedBranch: 'feature/menu',
      defaultBranch: 'main',
    }),
    true,
  );
  assert.equal(
    shouldShowGitHubPrActions({
      trackedBranch: 'main',
      defaultBranch: null,
    }),
    false,
  );
  assert.equal(
    shouldShowGitHubPrActions({
      trackedBranch: 'feature/main-fix',
      defaultBranch: null,
    }),
    true,
  );
});

void test('resolveGitHubTrackedBranchForActions falls back to current branch when tracked state is missing', () => {
  assert.equal(
    resolveGitHubTrackedBranchForActions({
      projectTrackedBranch: null,
      currentBranch: 'feature/menu',
    }),
    'feature/menu',
  );
  assert.equal(
    resolveGitHubTrackedBranchForActions({
      projectTrackedBranch: '(loading)',
      currentBranch: 'feature/current',
    }),
    'feature/current',
  );
  assert.equal(
    resolveGitHubTrackedBranchForActions({
      projectTrackedBranch: 'release/1',
      currentBranch: 'feature/current',
    }),
    'release/1',
  );
  assert.equal(
    resolveGitHubTrackedBranchForActions({
      projectTrackedBranch: '(detached)',
      currentBranch: 'HEAD',
    }),
    null,
  );
});

void test('resolveGitHubDefaultBranchForActions prefers canonical repository default branch over per-directory snapshot branch', () => {
  assert.equal(
    resolveGitHubDefaultBranchForActions({
      repositoryDefaultBranch: 'dev',
      snapshotDefaultBranch: 'jm/encamp-scout',
    }),
    'dev',
  );
  assert.equal(
    resolveGitHubDefaultBranchForActions({
      repositoryDefaultBranch: null,
      snapshotDefaultBranch: 'main',
    }),
    'main',
  );
  assert.equal(
    resolveGitHubDefaultBranchForActions({
      repositoryDefaultBranch: '  ',
      snapshotDefaultBranch: ' ',
    }),
    null,
  );
});

void test('Open PR gating remains visible when canonical default branch differs from per-directory snapshot branch', () => {
  const defaultBranch = resolveGitHubDefaultBranchForActions({
    repositoryDefaultBranch: 'dev',
    snapshotDefaultBranch: 'jm/encamp-scout',
  });
  assert.equal(
    shouldShowGitHubPrActions({
      trackedBranch: 'jm/encamp-scout',
      defaultBranch,
    }),
    true,
  );
  assert.equal(
    shouldShowGitHubPrActions({
      trackedBranch: 'jm/encamp-scout',
      defaultBranch: resolveGitHubDefaultBranchForActions({
        repositoryDefaultBranch: null,
        snapshotDefaultBranch: 'jm/encamp-scout',
      }),
    }),
    false,
  );
});

void test('parseCommitCount validates output', () => {
  assert.equal(parseCommitCount('17'), 17);
  assert.equal(parseCommitCount('0'), 0);
  assert.equal(parseCommitCount('  '), null);
  assert.equal(parseCommitCount('-1'), null);
  assert.equal(parseCommitCount('nope'), null);
  assert.equal(parseCommitCount('9'.repeat(400)), null);
});

void test('parseLastCommitLine decodes hash + timestamp pair', () => {
  assert.deepEqual(parseLastCommitLine(''), {
    lastCommitAt: null,
    shortCommitHash: null,
  });
  assert.deepEqual(parseLastCommitLine('abc123\t2026-01-01T00:00:00.000Z'), {
    lastCommitAt: '2026-01-01T00:00:00.000Z',
    shortCommitHash: 'abc123',
  });
  assert.deepEqual(parseLastCommitLine('\tabc'), {
    lastCommitAt: null,
    shortCommitHash: 'abc',
  });
  assert.deepEqual(parseLastCommitLine('abc123\t'), {
    lastCommitAt: null,
    shortCommitHash: 'abc123',
  });
});
