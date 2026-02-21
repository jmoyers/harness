import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  buildProjectPaneGitHubReviewLines,
  type ProjectPaneGitHubPullRequestSummary,
  type ProjectPaneGitHubReviewSummary,
} from '../src/mux/project-pane-github-review.ts';

function pullRequest(
  overrides: Partial<ProjectPaneGitHubPullRequestSummary> = {},
): ProjectPaneGitHubPullRequestSummary {
  return {
    number: 42,
    title: 'Refine final review flow',
    url: 'https://github.com/acme/harness/pull/42',
    authorLogin: 'jmoyers',
    headBranch: 'feature/review-tree',
    baseBranch: 'main',
    state: 'open',
    isDraft: false,
    mergedAt: null,
    closedAt: null,
    updatedAt: '2026-02-20T00:00:00.000Z',
    createdAt: '2026-02-19T00:00:00.000Z',
    ...overrides,
  };
}

function review(
  overrides: Partial<ProjectPaneGitHubReviewSummary> = {},
): ProjectPaneGitHubReviewSummary {
  return {
    status: 'ready',
    branchName: 'feature/review-tree',
    branchSource: 'current',
    pr: pullRequest(),
    openThreads: [],
    resolvedThreads: [],
    errorMessage: null,
    ...overrides,
  };
}

void test('project pane github review lines render loading, error, and no-pr states', () => {
  const loading = buildProjectPaneGitHubReviewLines({
    review: review({
      status: 'loading',
      branchName: null,
      branchSource: null,
      pr: null,
    }),
    expandedNodeIds: new Set<string>(),
  });
  assert.deepEqual(loading.lines, [
    'github review',
    'branch (none)',
    'status loading GitHub review data…',
  ]);
  assert.deepEqual(loading.actionByRelativeLineIndex, {});

  const error = buildProjectPaneGitHubReviewLines({
    review: review({
      status: 'error',
      branchName: ' feature/review-tree ',
      branchSource: 'pinned',
      pr: null,
      errorMessage: '  network\n  timeout  ',
    }),
    expandedNodeIds: new Set<string>(),
  });
  assert.deepEqual(error.lines, [
    'github review',
    'branch feature/review-tree (pinned)',
    'status error network timeout',
  ]);
  assert.deepEqual(error.actionByRelativeLineIndex, {});

  const noPr = buildProjectPaneGitHubReviewLines({
    review: review({
      pr: null,
    }),
    expandedNodeIds: new Set<string>(),
  });
  assert.deepEqual(noPr.lines, [
    'github review',
    'branch feature/review-tree (current)',
    'pr none for tracked branch',
  ]);
  assert.deepEqual(noPr.actionByRelativeLineIndex, {});
});

void test('project pane github review lines render pull request lifecycle labels', () => {
  const cases: Array<{
    input: ProjectPaneGitHubPullRequestSummary;
    expectedState: string;
  }> = [
    {
      input: pullRequest({
        state: 'open',
        isDraft: true,
      }),
      expectedState: 'draft',
    },
    {
      input: pullRequest({
        state: 'open',
        isDraft: false,
      }),
      expectedState: 'open',
    },
    {
      input: pullRequest({
        state: 'merged',
        mergedAt: '2026-02-20T00:00:00.000Z',
      }),
      expectedState: 'merged',
    },
    {
      input: pullRequest({
        state: 'closed',
      }),
      expectedState: 'closed',
    },
  ];

  for (const item of cases) {
    const rendered = buildProjectPaneGitHubReviewLines({
      review: review({
        pr: item.input,
      }),
      expandedNodeIds: new Set<string>(),
    });
    assert.equal(rendered.lines[2]?.startsWith(`pr #42 ${item.expectedState} `), true);
  }
});

void test('project pane github review lines support expanded groups, thread metadata, and comment previews', () => {
  const rendered = buildProjectPaneGitHubReviewLines({
    review: review({
      pr: pullRequest({
        title: '  Refine\n  final review flow  ',
      }),
      openThreads: [
        {
          threadId: 'open-thread',
          isResolved: false,
          isOutdated: true,
          resolvedByLogin: null,
          comments: [
            {
              commentId: 'open-1',
              authorLogin: null,
              body: '  first\n\ncomment  body ',
              url: null,
              createdAt: '2026-02-20T00:00:00.000Z',
              updatedAt: '2026-02-20T00:00:00.000Z',
            },
            {
              commentId: 'open-2',
              authorLogin: 'alice',
              body: 'x'.repeat(200),
              url: null,
              createdAt: '2026-02-20T00:00:00.000Z',
              updatedAt: '2026-02-20T00:00:00.000Z',
            },
          ],
        },
      ],
      resolvedThreads: [
        {
          threadId: 'resolved-thread',
          isResolved: true,
          isOutdated: false,
          resolvedByLogin: 'reviewer',
          comments: [],
        },
      ],
    }),
    expandedNodeIds: new Set<string>([
      'github/open-threads',
      'github/resolved-threads',
      'github/thread:open-thread',
      'github/thread:resolved-thread',
    ]),
  });

  assert.equal(rendered.lines[2], 'pr #42 open Refine final review flow');
  assert.equal(rendered.lines[4], '▼ open comments (1 threads, 2 comments)');
  assert.equal(rendered.lines[5], '  ▼ @unknown (2 comments, outdated)');
  assert.equal(rendered.lines[6], '    - @unknown: first comment body');
  assert.equal(rendered.lines[7]?.startsWith('    - @alice: '), true);
  assert.equal(rendered.lines[7]?.endsWith('…'), true);
  assert.equal(rendered.lines[8], '▼ resolved comments (1 threads, 0 comments)');
  assert.equal(rendered.lines[9], '  ▼ @unknown (0 comments, resolved by @reviewer)');
  assert.equal(rendered.lines[10], '    - (no comments)');

  assert.deepEqual(rendered.actionByRelativeLineIndex, {
    4: 'project.github.toggle:github/open-threads',
    5: 'project.github.toggle:github/thread:open-thread',
    8: 'project.github.toggle:github/resolved-threads',
    9: 'project.github.toggle:github/thread:resolved-thread',
  });
});

void test('project pane github review lines render explicit empty-state rows for expanded groups', () => {
  const rendered = buildProjectPaneGitHubReviewLines({
    review: review({
      openThreads: [],
      resolvedThreads: [],
    }),
    expandedNodeIds: new Set<string>(['github/open-threads', 'github/resolved-threads']),
  });

  assert.deepEqual(rendered.lines.slice(4), [
    '▼ open comments (0 threads, 0 comments)',
    '  (none)',
    '▼ resolved comments (0 threads, 0 comments)',
    '  (none)',
  ]);
  assert.deepEqual(rendered.actionByRelativeLineIndex, {
    4: 'project.github.toggle:github/open-threads',
    6: 'project.github.toggle:github/resolved-threads',
  });
});
