import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  buildCritiqueReviewCommand,
  parseRemoteHeadBranch,
  resolveCritiqueReviewAgent,
  resolveCritiqueReviewBaseBranch,
} from '../src/mux/live-mux/critique-review.ts';

void test('parseRemoteHeadBranch normalizes origin head output and rejects empty inputs', () => {
  assert.equal(parseRemoteHeadBranch('origin/main'), 'main');
  assert.equal(parseRemoteHeadBranch('upstream/trunk'), 'trunk');
  assert.equal(parseRemoteHeadBranch('main'), 'main');
  assert.equal(parseRemoteHeadBranch(''), null);
  assert.equal(parseRemoteHeadBranch('   '), null);
});

void test('resolveCritiqueReviewAgent prefers claude then opencode', () => {
  assert.equal(
    resolveCritiqueReviewAgent({
      claudeAvailable: true,
      opencodeAvailable: true,
    }),
    'claude',
  );
  assert.equal(
    resolveCritiqueReviewAgent({
      claudeAvailable: false,
      opencodeAvailable: true,
    }),
    'opencode',
  );
  assert.equal(
    resolveCritiqueReviewAgent({
      claudeAvailable: false,
      opencodeAvailable: false,
    }),
    null,
  );
});

void test('buildCritiqueReviewCommand renders staged and base-branch variants with optional agent', () => {
  assert.equal(
    buildCritiqueReviewCommand({
      mode: 'staged',
      agent: 'claude',
    }),
    'critique review --staged --agent claude',
  );
  assert.equal(
    buildCritiqueReviewCommand({
      mode: 'base-branch',
      baseBranch: 'main',
      agent: 'opencode',
    }),
    'critique review main HEAD --agent opencode',
  );
  assert.equal(
    buildCritiqueReviewCommand({
      mode: 'base-branch',
      baseBranch: ' ',
      agent: null,
    }),
    'critique review main HEAD',
  );
});

void test('resolveCritiqueReviewBaseBranch prefers origin head then canonical defaults', async () => {
  const remoteHeadBranch = await resolveCritiqueReviewBaseBranch('/repo', async (_cwd, args) => {
    if (args.join(' ') === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
      return 'origin/main';
    }
    return '';
  });
  assert.equal(remoteHeadBranch, 'main');

  const localMainBranch = await resolveCritiqueReviewBaseBranch('/repo', async (_cwd, args) => {
    if (args.join(' ') === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
      return '';
    }
    if (args.join(' ') === 'rev-parse --verify --quiet main') {
      return 'abc123';
    }
    return '';
  });
  assert.equal(localMainBranch, 'main');

  const remoteMasterBranch = await resolveCritiqueReviewBaseBranch('/repo', async (_cwd, args) => {
    if (args.join(' ') === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
      return '';
    }
    if (args.join(' ') === 'rev-parse --verify --quiet main') {
      return '';
    }
    if (args.join(' ') === 'rev-parse --verify --quiet origin/main') {
      return '';
    }
    if (args.join(' ') === 'rev-parse --verify --quiet master') {
      return '';
    }
    if (args.join(' ') === 'rev-parse --verify --quiet origin/master') {
      return 'def456';
    }
    return '';
  });
  assert.equal(remoteMasterBranch, 'master');
});

void test('resolveCritiqueReviewBaseBranch falls back to current branch then main', async () => {
  const currentBranchFallback = await resolveCritiqueReviewBaseBranch(
    '/repo',
    async (_cwd, args) => {
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') {
        return 'feature/xyz';
      }
      return '';
    },
  );
  assert.equal(currentBranchFallback, 'feature/xyz');

  const finalFallback = await resolveCritiqueReviewBaseBranch('/repo', async () => '');
  assert.equal(finalFallback, 'main');
});
