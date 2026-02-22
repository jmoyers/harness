import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { buildRailModel, buildRailRows } from '../../../../src/mux/live-mux/rail-layout.ts';
import type { ProjectPaneGitHubReviewSummary } from '../../../../src/mux/project-pane-github-review.ts';
import { statusModelFor } from '../../../support/status-model.ts';

const ESC = String.fromCharCode(27);
const ANSI_CSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'gu');

function stripAnsi(value: string): string {
  return value.replace(ANSI_CSI_PATTERN, '');
}

const LAYOUT = {
  leftCols: 160,
  paneRows: 24,
};

const LOADING_GIT_SUMMARY = {
  branch: '(loading)',
  changedFiles: 0,
  additions: 0,
  deletions: 0,
} as const;

void test('live-mux rail layout infers untracked directories from conversation-only rows', () => {
  const rows = buildRailRows({
    layout: LAYOUT,
    repositories: new Map([
      [
        'repo-1',
        {
          repositoryId: 'repo-1',
          name: 'repo-one',
          remoteUrl: 'https://github.com/example/repo-one',
        },
      ],
    ]),
    repositoryAssociationByDirectoryId: new Map([['dir-1', 'repo-1']]),
    directoryRepositorySnapshotByDirectoryId: new Map(),
    directories: new Map([
      [
        'dir-1',
        {
          directoryId: 'dir-1',
          path: '/tmp/dir-1',
        },
      ],
    ]),
    conversations: new Map([
      [
        'session-1',
        {
          sessionId: 'session-1',
          directoryId: 'dir-1',
          title: 'thread-1',
          agentType: 'codex',
          status: 'running',
          statusModel: statusModelFor('running', {
            detailText: 'active',
            phase: 'working',
            phaseHint: 'working',
            lastKnownWork: 'active',
            lastKnownWorkAt: '2026-02-17T00:00:01.000Z',
            observedAt: '2026-02-17T00:00:01.000Z',
          }),
          attentionReason: null,
          live: true,
          startedAt: '2026-02-17T00:00:00.000Z',
          lastEventAt: '2026-02-17T00:00:01.000Z',
          lastKnownWork: 'active',
          lastKnownWorkAt: '2026-02-17T00:00:01.000Z',
          controller: null,
        },
      ],
      [
        'session-untracked',
        {
          sessionId: 'session-untracked',
          directoryId: 'dir-untracked',
          title: 'thread-untracked',
          agentType: 'terminal',
          status: 'completed',
          statusModel: statusModelFor('completed', {
            detailText: 'inactive',
            phaseHint: 'idle',
            lastKnownWork: 'inactive',
            lastKnownWorkAt: '2026-02-17T00:00:02.000Z',
            observedAt: '2026-02-17T00:00:02.000Z',
          }),
          attentionReason: null,
          live: false,
          startedAt: '2026-02-17T00:00:00.000Z',
          lastEventAt: '2026-02-17T00:00:02.000Z',
          lastKnownWork: 'inactive',
          lastKnownWorkAt: '2026-02-17T00:00:02.000Z',
          controller: null,
        },
      ],
    ]),
    orderedIds: ['session-1', 'session-untracked'],
    activeProjectId: 'dir-1',
    activeRepositoryId: 'repo-1',
    activeConversationId: 'session-1',
    projectSelectionEnabled: true,
    repositorySelectionEnabled: false,
    homeSelectionEnabled: false,
    repositoriesCollapsed: false,
    collapsedRepositoryGroupIds: new Set<string>(),
    gitSummaryByDirectoryId: new Map(),
    processUsageBySessionId: new Map(),
    loadingGitSummary: LOADING_GIT_SUMMARY,
  });

  const visible = rows.ansiRows.map(stripAnsi).join('\n');
  assert.equal(rows.ansiRows.length, LAYOUT.paneRows);
  assert.equal(visible.includes('(untracked)'), true);
  assert.equal(visible.includes('thread-untracked'), true);
});

void test('live-mux rail model uses loading git summary fallback when project summary is missing', () => {
  const model = buildRailModel({
    repositories: new Map(),
    repositoryAssociationByDirectoryId: new Map(),
    directoryRepositorySnapshotByDirectoryId: new Map(),
    directories: new Map([
      [
        'dir-loading',
        {
          directoryId: 'dir-loading',
          path: '/tmp/dir-loading',
        },
      ],
    ]),
    conversations: new Map(),
    orderedIds: [],
    activeProjectId: 'dir-loading',
    activeRepositoryId: null,
    activeConversationId: null,
    projectSelectionEnabled: true,
    repositorySelectionEnabled: false,
    homeSelectionEnabled: false,
    repositoriesCollapsed: false,
    collapsedRepositoryGroupIds: new Set<string>(),
    gitSummaryByDirectoryId: new Map(),
    processUsageBySessionId: new Map(),
    loadingGitSummary: LOADING_GIT_SUMMARY,
  });

  const loadingDirectory = model.directories.find((directory) => directory.key === 'dir-loading');
  assert.equal(loadingDirectory?.git.branch, '(loading)');
});

void test('live-mux rail model selects latest repository snapshot metadata and skips missing sessions', () => {
  const model = buildRailModel({
    repositories: new Map([
      [
        'repo-1',
        {
          repositoryId: 'repo-1',
          name: 'repo-one',
          remoteUrl: 'https://github.com/example/repo-one',
        },
      ],
    ]),
    repositoryAssociationByDirectoryId: new Map([
      ['dir-no-snapshot', 'repo-1'],
      ['dir-older', 'repo-1'],
      ['dir-newer', 'repo-1'],
    ]),
    directoryRepositorySnapshotByDirectoryId: new Map([
      [
        'dir-older',
        {
          normalizedRemoteUrl: 'https://github.com/example/repo-one',
          commitCount: 11,
          lastCommitAt: '2026-02-17T00:00:01.000Z',
          shortCommitHash: 'oldhash',
          inferredName: 'repo-one',
          defaultBranch: 'main',
        },
      ],
      [
        'dir-newer',
        {
          normalizedRemoteUrl: 'https://github.com/example/repo-one',
          commitCount: 12,
          lastCommitAt: '2026-02-17T00:00:05.000Z',
          shortCommitHash: 'newhash',
          inferredName: 'repo-one',
          defaultBranch: 'main',
        },
      ],
    ]),
    directories: new Map([
      ['dir-no-snapshot', { directoryId: 'dir-no-snapshot', path: '/tmp/no-snapshot' }],
      ['dir-older', { directoryId: 'dir-older', path: '/tmp/older' }],
      ['dir-newer', { directoryId: 'dir-newer', path: '/tmp/newer' }],
    ]),
    conversations: new Map([
      [
        'session-1',
        {
          sessionId: 'session-1',
          directoryId: 'dir-older',
          title: 'thread-1',
          agentType: 'codex',
          status: 'running',
          statusModel: statusModelFor('running'),
          attentionReason: null,
          live: true,
          startedAt: '2026-02-17T00:00:00.000Z',
          lastEventAt: '2026-02-17T00:00:01.000Z',
          lastKnownWork: null,
          lastKnownWorkAt: null,
          controller: null,
        },
      ],
    ]),
    orderedIds: ['session-1', 'session-missing'],
    activeProjectId: 'dir-older',
    activeRepositoryId: 'repo-1',
    activeConversationId: 'session-1',
    projectSelectionEnabled: true,
    repositorySelectionEnabled: false,
    homeSelectionEnabled: false,
    repositoriesCollapsed: false,
    collapsedRepositoryGroupIds: new Set<string>(),
    gitSummaryByDirectoryId: new Map(),
    processUsageBySessionId: new Map(),
    loadingGitSummary: LOADING_GIT_SUMMARY,
  });

  const repository = (model.repositories ?? []).find((entry) => entry.repositoryId === 'repo-1');
  assert.equal(repository?.associatedProjectCount, 3);
  assert.equal(repository?.commitCount, 12);
  assert.equal(repository?.shortCommitHash, 'newhash');
  assert.equal(model.conversations.length, 1);
});

void test('live-mux rail model forwards github review map only when provided', () => {
  const reviewByDirectory = new Map<string, ProjectPaneGitHubReviewSummary>([
    [
      'dir-1',
      {
        status: 'ready',
        branchName: 'feature/rail',
        branchSource: 'current',
        pr: null,
        openThreads: [],
        resolvedThreads: [],
        errorMessage: null,
      },
    ],
  ]);

  const withReview = buildRailModel({
    repositories: new Map(),
    repositoryAssociationByDirectoryId: new Map(),
    directoryRepositorySnapshotByDirectoryId: new Map(),
    directories: new Map([
      [
        'dir-1',
        {
          directoryId: 'dir-1',
          path: '/tmp/dir-1',
        },
      ],
    ]),
    conversations: new Map(),
    orderedIds: [],
    activeProjectId: 'dir-1',
    activeRepositoryId: null,
    activeConversationId: null,
    projectSelectionEnabled: true,
    repositorySelectionEnabled: false,
    homeSelectionEnabled: false,
    showGitHubIntegration: true,
    visibleGitHubDirectoryIds: new Set<string>(['dir-1']),
    githubReviewByDirectoryId: reviewByDirectory,
    githubSelectionEnabled: true,
    activeGitHubProjectId: 'dir-1',
    repositoriesCollapsed: false,
    collapsedRepositoryGroupIds: new Set<string>(),
    gitSummaryByDirectoryId: new Map(),
    processUsageBySessionId: new Map(),
    loadingGitSummary: LOADING_GIT_SUMMARY,
  });
  assert.equal(withReview.showGitHubIntegration, true);
  assert.equal(withReview.visibleGitHubDirectoryKeys?.includes('dir-1'), true);
  assert.equal(withReview.githubReviewByDirectoryKey?.get('dir-1')?.branchName, 'feature/rail');
  assert.equal(withReview.githubSelectionEnabled, true);
  assert.equal(withReview.activeGitHubProjectId, 'dir-1');

  const withoutReview = buildRailModel({
    repositories: new Map(),
    repositoryAssociationByDirectoryId: new Map(),
    directoryRepositorySnapshotByDirectoryId: new Map(),
    directories: new Map(),
    conversations: new Map(),
    orderedIds: [],
    activeProjectId: null,
    activeRepositoryId: null,
    activeConversationId: null,
    projectSelectionEnabled: true,
    repositorySelectionEnabled: false,
    homeSelectionEnabled: false,
    repositoriesCollapsed: false,
    collapsedRepositoryGroupIds: new Set<string>(),
    gitSummaryByDirectoryId: new Map(),
    processUsageBySessionId: new Map(),
    loadingGitSummary: LOADING_GIT_SUMMARY,
  });
  assert.equal('githubReviewByDirectoryKey' in withoutReview, false);
});
