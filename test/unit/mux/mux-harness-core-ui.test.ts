import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL,
  NEW_THREAD_MODAL_CLAUDE_BUTTON,
  NEW_THREAD_MODAL_CODEX_BUTTON,
  NEW_THREAD_MODAL_CRITIQUE_BUTTON,
  NEW_THREAD_MODAL_CURSOR_BUTTON,
  NEW_THREAD_MODAL_TERMINAL_BUTTON,
  PROJECT_PANE_CLOSE_PROJECT_BUTTON_LABEL,
  PROJECT_PANE_NEW_CONVERSATION_BUTTON_LABEL,
  TASKS_PANE_ADD_REPOSITORY_BUTTON_LABEL,
  TASKS_PANE_ADD_TASK_BUTTON_LABEL,
  TASKS_PANE_ARCHIVE_REPOSITORY_BUTTON_LABEL,
  TASKS_PANE_COMPLETE_TASK_BUTTON_LABEL,
  TASKS_PANE_DELETE_TASK_BUTTON_LABEL,
  TASKS_PANE_EDIT_REPOSITORY_BUTTON_LABEL,
  TASKS_PANE_DRAFT_TASK_BUTTON_LABEL,
  TASKS_PANE_EDIT_TASK_BUTTON_LABEL,
  TASKS_PANE_FOOTER_COMPLETE_BUTTON_LABEL,
  TASKS_PANE_FOOTER_DELETE_BUTTON_LABEL,
  TASKS_PANE_FOOTER_DRAFT_BUTTON_LABEL,
  TASKS_PANE_FOOTER_EDIT_BUTTON_LABEL,
  TASKS_PANE_FOOTER_REPOSITORY_ARCHIVE_BUTTON_LABEL,
  TASKS_PANE_FOOTER_REPOSITORY_EDIT_BUTTON_LABEL,
  TASKS_PANE_READY_TASK_BUTTON_LABEL,
  TASKS_PANE_REORDER_DOWN_BUTTON_LABEL,
  TASKS_PANE_REORDER_UP_BUTTON_LABEL,
  buildProjectPaneRows,
  buildProjectPaneSnapshot,
  buildProjectPaneSnapshotWithOptions,
  buildGitHubReviewPaneSnapshot,
  buildTaskPaneRows,
  buildTaskPaneSnapshot,
  projectPaneActionAtRow,
  resolveGoldenModalSize,
  sortedRepositoryList,
  sortTasksForHomePane,
  sortTasksByOrder,
  taskPaneActionAtCell,
  taskPaneActionAtRow,
  taskPaneRepositoryIdAtRow,
  taskPaneTaskIdAtRow,
  type ProjectPaneSnapshot,
  type ProjectPaneAction,
  type TaskStatus,
  type TaskPaneAction,
  type TaskPaneRepositoryRecord,
  type TaskPaneSnapshot,
  type TaskPaneSnapshotLine,
  type TaskPaneTaskRecord,
  type TaskPaneView,
} from '../../../src/mux/harness-core-ui.ts';

const NOW_MS = Date.parse('2026-01-01T00:00:00.000Z');

function task(
  overrides: Partial<TaskPaneTaskRecord> & Pick<TaskPaneTaskRecord, 'taskId'>,
): TaskPaneTaskRecord {
  return {
    taskId: overrides.taskId,
    repositoryId: overrides.repositoryId ?? null,
    title: overrides.title ?? overrides.taskId,
    body: overrides.body ?? '',
    status: overrides.status ?? 'draft',
    orderIndex: overrides.orderIndex ?? 0,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
  };
}

void test('harness-core ui exports remain reachable from test/src import graph', () => {
  const projectAction: ProjectPaneAction = 'conversation.new';
  const taskStatus: TaskStatus = 'ready';
  const taskAction: TaskPaneAction = 'task.create';
  const snapshotLine: TaskPaneSnapshotLine = {
    text: 'line',
    taskId: 'task-1',
    repositoryId: null,
    action: taskAction,
  };
  const snapshot: TaskPaneSnapshot = {
    lines: [snapshotLine],
  };

  assert.equal(projectAction, 'conversation.new');
  assert.equal(taskStatus, 'ready');
  assert.equal(snapshot.lines.length, 1);
  assert.equal(PROJECT_PANE_NEW_CONVERSATION_BUTTON_LABEL.length > 0, true);
  assert.equal(PROJECT_PANE_CLOSE_PROJECT_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_ADD_TASK_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_ADD_REPOSITORY_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_EDIT_REPOSITORY_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_ARCHIVE_REPOSITORY_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_EDIT_TASK_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_DELETE_TASK_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_READY_TASK_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_DRAFT_TASK_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_COMPLETE_TASK_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_REORDER_UP_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_REORDER_DOWN_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_FOOTER_EDIT_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_FOOTER_DELETE_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_FOOTER_COMPLETE_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_FOOTER_DRAFT_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_FOOTER_REPOSITORY_EDIT_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_FOOTER_REPOSITORY_ARCHIVE_BUTTON_LABEL.length > 0, true);
  assert.equal(CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL.length > 0, true);
  assert.equal(NEW_THREAD_MODAL_CODEX_BUTTON.length > 0, true);
  assert.equal(NEW_THREAD_MODAL_CLAUDE_BUTTON.length > 0, true);
  assert.equal(NEW_THREAD_MODAL_CURSOR_BUTTON.length > 0, true);
  assert.equal(NEW_THREAD_MODAL_TERMINAL_BUTTON.length > 0, true);
  assert.equal(NEW_THREAD_MODAL_CRITIQUE_BUTTON.length > 0, true);
});

void test('resolveGoldenModalSize clamps viewport-derived dimensions', () => {
  const resolved = resolveGoldenModalSize(100, 40, {
    preferredHeight: 24,
    minWidth: 24,
    maxWidth: 80,
  });
  assert.equal(resolved.height, 24);
  assert.equal(resolved.width, 39);

  const tiny = resolveGoldenModalSize(8, 3, {
    preferredHeight: 50,
    minWidth: 20,
    maxWidth: 30,
  });
  assert.equal(tiny.height, 1);
  assert.equal(tiny.width, 20);

  const contradictory = resolveGoldenModalSize(120, 40, {
    preferredHeight: 10,
    minWidth: 30,
    maxWidth: 10,
  });
  assert.equal(contradictory.width, 30);
});

void test('sortedRepositoryList honors persisted home priority then falls back to name/id ordering', () => {
  const repositories = new Map<string, TaskPaneRepositoryRecord>([
    ['r3', { repositoryId: 'r3', name: 'alpha', archivedAt: null }],
    ['r1', { repositoryId: 'r1', name: 'alpha', archivedAt: null, metadata: { homePriority: 1 } }],
    ['r2', { repositoryId: 'r2', name: 'beta', archivedAt: null }],
    ['r0', { repositoryId: 'r0', name: 'zeta', archivedAt: null, metadata: { homePriority: 0 } }],
    ['r4', { repositoryId: 'r4', name: 'zzz', archivedAt: '2026-01-01T00:00:00.000Z' }],
  ]);

  const ordered = sortedRepositoryList(repositories);
  assert.deepEqual(
    ordered.map((entry) => entry.repositoryId),
    ['r0', 'r1', 'r3', 'r2'],
  );
});

void test('sortedRepositoryList ignores invalid numeric home priority values and uses repository id as final tiebreak', () => {
  const repositories = new Map<string, TaskPaneRepositoryRecord>([
    ['r2', { repositoryId: 'r2', name: 'alpha', archivedAt: null, metadata: { homePriority: 1 } }],
    ['r1', { repositoryId: 'r1', name: 'alpha', archivedAt: null, metadata: { homePriority: 1 } }],
    ['r3', { repositoryId: 'r3', name: 'alpha', archivedAt: null, metadata: { homePriority: -1 } }],
    ['r4', { repositoryId: 'r4', name: 'beta', archivedAt: null, metadata: { homePriority: 1.5 } }],
  ]);

  const ordered = sortedRepositoryList(repositories);
  assert.deepEqual(
    ordered.map((entry) => entry.repositoryId),
    ['r1', 'r2', 'r3', 'r4'],
  );
});

void test('sortTasksByOrder respects order index, then createdAt, then task id fallback', () => {
  const ordered = sortTasksByOrder([
    task({
      taskId: 'task-c',
      orderIndex: 1,
      createdAt: 'invalid-date',
    }),
    task({
      taskId: 'task-a',
      orderIndex: 1,
      createdAt: 'invalid-date',
    }),
    task({
      taskId: 'task-late',
      orderIndex: 0,
      createdAt: '2026-01-02T00:00:00.000Z',
    }),
    task({
      taskId: 'task-early',
      orderIndex: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  ]);

  assert.deepEqual(
    ordered.map((entry) => entry.taskId),
    ['task-early', 'task-late', 'task-a', 'task-c'],
  );
});

void test('sortTasksByOrder tolerates nullish createdAt values from malformed records', () => {
  const malformed = {
    ...task({
      taskId: 'malformed',
      orderIndex: 0,
    }),
    createdAt: undefined,
  } as unknown as TaskPaneTaskRecord;
  const ordered = sortTasksByOrder([
    task({
      taskId: 'good',
      orderIndex: 0,
      createdAt: 'invalid-date',
    }),
    {
      ...task({
        taskId: 'null-created-at',
        orderIndex: 0,
      }),
      createdAt: null,
    } as unknown as TaskPaneTaskRecord,
    malformed,
  ]);
  assert.equal(ordered.length, 3);
});

void test('sortTasksByOrder falls back to task id when finite createdAt timestamps are equal', () => {
  const ordered = sortTasksByOrder([
    task({
      taskId: 'task-z',
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    task({
      taskId: 'task-a',
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.taskId),
    ['task-a', 'task-z'],
  );
});

void test('sortTasksByOrder handles mixed finite and invalid createdAt timestamps', () => {
  const ordered = sortTasksByOrder([
    task({
      taskId: 'valid-created-at',
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    task({
      taskId: 'invalid-created-at',
      orderIndex: 1,
      createdAt: 'not-a-timestamp',
    }),
  ]);
  assert.equal(ordered.length, 2);
});

void test('sortTasksForHomePane orders tasks by status priority before order index', () => {
  const ordered = sortTasksForHomePane([
    task({
      taskId: 'in-progress-late',
      status: 'in-progress',
      orderIndex: 0,
      createdAt: '2026-01-01T00:00:01.000Z',
    }),
    task({
      taskId: 'draft-a',
      status: 'draft',
      orderIndex: 0,
    }),
    task({
      taskId: 'in-progress-early',
      status: 'in-progress',
      orderIndex: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    task({
      taskId: 'ready-a',
      status: 'ready',
      orderIndex: 0,
    }),
    task({
      taskId: 'completed-a',
      status: 'completed',
      orderIndex: 0,
    }),
  ]);

  assert.deepEqual(
    ordered.map((entry) => entry.taskId),
    ['in-progress-early', 'in-progress-late', 'ready-a', 'draft-a', 'completed-a'],
  );
});

void test('sortTasksForHomePane falls back to task id when status order and createdAt are identical', () => {
  const ordered = sortTasksForHomePane([
    task({
      taskId: 'ready-z',
      status: 'ready',
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    task({
      taskId: 'ready-a',
      status: 'ready',
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.taskId),
    ['ready-a', 'ready-z'],
  );
});

void test('sortTasksForHomePane uses order index as status-local priority', () => {
  const ordered = sortTasksForHomePane([
    task({
      taskId: 'ready-priority-low',
      status: 'ready',
      orderIndex: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    task({
      taskId: 'ready-priority-high',
      status: 'ready',
      orderIndex: 0,
      createdAt: '2026-01-01T00:01:00.000Z',
    }),
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.taskId),
    ['ready-priority-high', 'ready-priority-low'],
  );
});

void test('buildProjectPaneSnapshot and row helpers expose action rows and clamp viewport state', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-core-ui-project-'));
  try {
    mkdirSync(join(workspace, 'src'));
    writeFileSync(join(workspace, 'README.md'), '# readme\n', 'utf8');

    const snapshot = buildProjectPaneSnapshot('dir-1', workspace);
    assert.equal(snapshot.directoryId, 'dir-1');
    assert.equal(snapshot.path, workspace);
    assert.equal(snapshot.lines[0]?.startsWith('project '), true);

    const rows = buildProjectPaneRows(snapshot, 24, 4, 999);
    assert.equal(rows.rows.length, 4);
    assert.equal(rows.top >= 0, true);

    const createAction = projectPaneActionAtRow(snapshot, 120, 8, 0, 3);
    const closeAction = projectPaneActionAtRow(snapshot, 120, 8, 0, 4);
    const refreshAction = projectPaneActionAtRow(snapshot, 120, 8, 0, 5);
    assert.equal(createAction, 'conversation.new');
    assert.equal(closeAction, 'project.close');
    assert.equal(refreshAction, 'project.github.refresh');

    const noneAction = projectPaneActionAtRow(snapshot, 120, 8, 0, 1);
    assert.equal(noneAction, null);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('project pane row helpers handle empty snapshots', () => {
  const emptySnapshot: ProjectPaneSnapshot = {
    directoryId: 'dir-empty',
    path: '/tmp/empty',
    lines: [],
    actionBySourceLineIndex: {},
    actionLineIndexByKind: {
      conversationNew: 3,
      projectClose: 4,
    },
  };
  const rows = buildProjectPaneRows(emptySnapshot, 10, 2, 0);
  assert.equal(rows.rows.length, 2);
  assert.equal(projectPaneActionAtRow(emptySnapshot, 10, 2, 0, 0), null);
});

void test('buildProjectPaneSnapshot falls back to full path when basename is empty', () => {
  const snapshot = buildProjectPaneSnapshot('root', '/');
  assert.equal(snapshot.lines[0], 'project /');
});

void test('buildProjectPaneSnapshotWithOptions returns base snapshot when github review is absent', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-core-ui-project-base-'));
  try {
    writeFileSync(join(workspace, 'README.md'), '# readme\n', 'utf8');
    const base = buildProjectPaneSnapshot('dir-base', workspace);
    const withUndefined = buildProjectPaneSnapshotWithOptions('dir-base', workspace);
    const withNull = buildProjectPaneSnapshotWithOptions('dir-base', workspace, {
      githubReview: null,
    });
    assert.deepEqual(withUndefined, base);
    assert.deepEqual(withNull, base);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('projectPaneActionAtRow falls back to legacy action line indexes when no action map exists', () => {
  const fallbackSnapshot: ProjectPaneSnapshot = {
    directoryId: 'dir-fallback',
    path: '/tmp/fallback',
    lines: ['new line', 'close line', 'other line'],
    actionBySourceLineIndex: {},
    actionLineIndexByKind: {
      conversationNew: 0,
      projectClose: 1,
    },
  };
  assert.equal(projectPaneActionAtRow(fallbackSnapshot, 80, 5, 0, 0), 'conversation.new');
  assert.equal(projectPaneActionAtRow(fallbackSnapshot, 80, 5, 0, 1), 'project.close');
  assert.equal(projectPaneActionAtRow(fallbackSnapshot, 80, 5, 0, 2), null);
});

void test('buildProjectPaneSnapshotWithOptions injects github review block and maps toggle actions', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-core-ui-project-review-'));
  try {
    mkdirSync(join(workspace, 'src'));
    writeFileSync(join(workspace, 'README.md'), '# readme\n', 'utf8');

    const snapshot = buildProjectPaneSnapshotWithOptions('dir-1', workspace, {
      githubReview: {
        status: 'ready',
        branchName: 'feature/review-tree',
        branchSource: 'current',
        pr: {
          number: 42,
          title: 'Review tree',
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
        },
        openThreads: [
          {
            threadId: 'thread-open',
            isResolved: false,
            isOutdated: false,
            resolvedByLogin: null,
            comments: [
              {
                commentId: 'comment-open-1',
                authorLogin: 'alice',
                body: 'looks good',
                url: null,
                createdAt: '2026-02-20T00:00:00.000Z',
                updatedAt: '2026-02-20T00:00:00.000Z',
              },
            ],
          },
        ],
        resolvedThreads: [],
        errorMessage: null,
      },
      expandedNodeIds: new Set<string>(['github/open-threads']),
    });

    const openGroupRow = snapshot.lines.indexOf('▼ open comments (1 threads, 1 comments)');
    assert.equal(openGroupRow >= 0, true);
    assert.equal(
      projectPaneActionAtRow(snapshot, 200, 200, 0, openGroupRow),
      'project.github.toggle:github/open-threads',
    );

    const openThreadRow = snapshot.lines.indexOf('  ▶ @alice (1 comments)');
    assert.equal(openThreadRow >= 0, true);
    assert.equal(
      projectPaneActionAtRow(snapshot, 200, 200, 0, openThreadRow),
      'project.github.toggle:github/thread:thread-open',
    );

    assert.equal(projectPaneActionAtRow(snapshot, 200, 200, 0, 3), 'conversation.new');
    assert.equal(projectPaneActionAtRow(snapshot, 200, 200, 0, 4), 'project.close');
    assert.equal(projectPaneActionAtRow(snapshot, 200, 200, 0, 5), 'project.github.refresh');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('buildGitHubReviewPaneSnapshot renders full pull request and thread details', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-core-ui-project-github-pane-'));
  try {
    const snapshot = buildGitHubReviewPaneSnapshot('dir-gh', workspace, {
      status: 'ready',
      branchName: 'feature/github-rail',
      branchSource: 'current',
      pr: {
        number: 77,
        title: 'Move GitHub integration into rail',
        url: 'https://github.com/acme/harness/pull/77',
        authorLogin: 'jmoyers',
        headBranch: 'feature/github-rail',
        baseBranch: 'main',
        state: 'open',
        isDraft: false,
        mergedAt: null,
        closedAt: null,
        updatedAt: '2026-02-21T11:00:00.000Z',
        createdAt: '2026-02-21T10:00:00.000Z',
      },
      openThreads: [
        {
          threadId: 'thread-open-1',
          isResolved: false,
          isOutdated: false,
          resolvedByLogin: null,
          comments: [
            {
              commentId: 'comment-1',
              authorLogin: 'alice',
              body: 'First line\nSecond line',
              url: 'https://github.com/acme/harness/pull/77#discussion_r1',
              createdAt: '2026-02-21T11:10:00.000Z',
              updatedAt: '2026-02-21T11:12:00.000Z',
            },
          ],
        },
      ],
      resolvedThreads: [
        {
          threadId: 'thread-resolved-1',
          isResolved: true,
          isOutdated: false,
          resolvedByLogin: 'bob',
          comments: [
            {
              commentId: 'comment-2',
              authorLogin: 'bob',
              body: 'Resolved.',
              url: null,
              createdAt: '2026-02-21T11:15:00.000Z',
              updatedAt: '2026-02-21T11:15:00.000Z',
            },
          ],
        },
      ],
      errorMessage: null,
    });

    assert.equal(
      snapshot.lines.some((line) => line.includes('github pull request')),
      true,
    );
    assert.equal(
      snapshot.lines.some((line) => line.includes('pr #77 open Move GitHub integration into rail')),
      true,
    );
    assert.equal(
      snapshot.lines.some((line) => line.includes('branches feature/github-rail -> main')),
      true,
    );
    assert.equal(
      snapshot.lines.some((line) => line.includes('[thread thread-open-1] open')),
      true,
    );
    assert.equal(
      snapshot.lines.some((line) => line.includes('comment 1 (comment-1) by @alice')),
      true,
    );
    assert.equal(
      snapshot.lines.some((line) => line.includes('Second line')),
      true,
    );
    const refreshRow = snapshot.lines.findIndex((line) => line.includes('refresh review'));
    assert.equal(refreshRow >= 0, true);
    assert.equal(
      projectPaneActionAtRow(snapshot, 220, 120, 0, refreshRow),
      'project.github.refresh',
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('buildGitHubReviewPaneSnapshot covers status and lifecycle edge branches', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-core-ui-project-github-pane-edges-'));
  try {
    const notLoaded = buildGitHubReviewPaneSnapshot('dir-gh', workspace, null);
    assert.equal(notLoaded.lines.some((line) => line.includes('status not loaded')), true);
    assert.equal(
      notLoaded.lines.some((line) => line.includes('select refresh review to load latest state')),
      true,
    );

    const loading = buildGitHubReviewPaneSnapshot('dir-gh', workspace, {
      status: 'loading',
      branchName: 'feature/loading',
      branchSource: 'current',
      pr: null,
      openThreads: [],
      resolvedThreads: [],
      errorMessage: null,
    });
    assert.equal(
      loading.lines.some((line) => line.includes('status loading GitHub review data…')),
      true,
    );

    const errored = buildGitHubReviewPaneSnapshot('dir-gh', workspace, {
      status: 'error',
      branchName: null,
      branchSource: null,
      pr: null,
      openThreads: [],
      resolvedThreads: [],
      errorMessage: '  bad   gateway  ',
    });
    assert.equal(errored.lines.some((line) => line.includes('status error bad gateway')), true);

    const noPr = buildGitHubReviewPaneSnapshot('dir-gh', workspace, {
      status: 'ready',
      branchName: 'feature/no-pr',
      branchSource: 'pinned',
      pr: null,
      openThreads: [],
      resolvedThreads: [],
      errorMessage: null,
    });
    assert.equal(noPr.lines.some((line) => line.includes('pr none for tracked branch')), true);

    const merged = buildGitHubReviewPaneSnapshot('dir-gh', workspace, {
      status: 'ready',
      branchName: 'feature/merged',
      branchSource: 'current',
      pr: {
        number: 10,
        title: 'Merged PR',
        url: 'https://github.com/acme/harness/pull/10',
        authorLogin: null,
        headBranch: 'feature/merged',
        baseBranch: 'main',
        state: 'merged',
        isDraft: false,
        mergedAt: '2026-02-21T10:30:00.000Z',
        closedAt: '2026-02-21T10:31:00.000Z',
        updatedAt: '2026-02-21T10:31:00.000Z',
        createdAt: '2026-02-21T09:00:00.000Z',
      },
      openThreads: [],
      resolvedThreads: [],
      errorMessage: null,
    });
    assert.equal(merged.lines.some((line) => line.includes('pr #10 merged Merged PR')), true);
    assert.equal(merged.lines.some((line) => line.includes('merged 2026-02-21T10:30:00.000Z')), true);
    assert.equal(merged.lines.some((line) => line.includes('closed 2026-02-21T10:31:00.000Z')), true);
    assert.equal(merged.lines.some((line) => line.includes('open threads (0)')), true);
    assert.equal(merged.lines.some((line) => line.includes('  (none)')), true);

    const closedWithEmptyComment = buildGitHubReviewPaneSnapshot('dir-gh', workspace, {
      status: 'ready',
      branchName: 'feature/closed',
      branchSource: 'current',
      pr: {
        number: 11,
        title: 'Closed PR',
        url: 'https://github.com/acme/harness/pull/11',
        authorLogin: 'zoe',
        headBranch: 'feature/closed',
        baseBranch: 'main',
        state: 'closed',
        isDraft: false,
        mergedAt: null,
        closedAt: '2026-02-21T11:00:00.000Z',
        updatedAt: '2026-02-21T11:00:00.000Z',
        createdAt: '2026-02-21T09:00:00.000Z',
      },
      openThreads: [
        {
          threadId: 'open-no-comments',
          isResolved: false,
          isOutdated: true,
          resolvedByLogin: null,
          comments: [],
        },
      ],
      resolvedThreads: [
        {
          threadId: 'resolved-empty-comment',
          isResolved: true,
          isOutdated: false,
          resolvedByLogin: 'reviewer',
          comments: [
            {
              commentId: 'comment-empty',
              authorLogin: null,
              body: '\n   \n',
              url: null,
              createdAt: '2026-02-21T11:05:00.000Z',
              updatedAt: '2026-02-21T11:05:00.000Z',
            },
          ],
        },
      ],
      errorMessage: null,
    });
    assert.equal(
      closedWithEmptyComment.lines.some((line) => line.includes('pr #11 closed Closed PR')),
      true,
    );
    assert.equal(
      closedWithEmptyComment.lines.some((line) => line.includes('[thread open-no-comments] open, outdated')),
      true,
    );
    assert.equal(closedWithEmptyComment.lines.some((line) => line.includes('  (no comments)')), true);
    assert.equal(
      closedWithEmptyComment.lines.some((line) => line.includes('resolved by @reviewer')),
      true,
    );
    assert.equal(closedWithEmptyComment.lines.some((line) => line.includes('(empty)')), true);

    const draft = buildGitHubReviewPaneSnapshot('dir-gh', workspace, {
      status: 'ready',
      branchName: 'feature/draft',
      branchSource: 'current',
      pr: {
        number: 12,
        title: 'Draft PR',
        url: 'https://github.com/acme/harness/pull/12',
        authorLogin: 'sam',
        headBranch: 'feature/draft',
        baseBranch: 'main',
        state: 'open',
        isDraft: true,
        mergedAt: null,
        closedAt: null,
        updatedAt: '2026-02-21T12:00:00.000Z',
        createdAt: '2026-02-21T11:30:00.000Z',
      },
      openThreads: [],
      resolvedThreads: [],
      errorMessage: null,
    });
    assert.equal(draft.lines.some((line) => line.includes('pr #12 draft Draft PR')), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('buildTaskPaneSnapshot renders sectioned repositories/tasks with status-priority ordering', () => {
  const repositories = new Map<string, TaskPaneRepositoryRecord>([
    [
      'repo-1',
      {
        repositoryId: 'repo-1',
        name: 'harness',
        remoteUrl: 'https://github.com/jmoyers/harness.git',
        defaultBranch: 'main',
        archivedAt: null,
        metadata: {
          commitCount: 12,
          lastCommitAt: '2025-12-29T00:00:00.000Z',
        },
      } as TaskPaneRepositoryRecord,
    ],
    [
      'repo-2',
      {
        repositoryId: 'repo-2',
        name: 'fernwatch',
        remoteUrl: 'https://github.com/jmoyers/fernwatch.git',
        defaultBranch: 'main',
        archivedAt: null,
      },
    ],
  ]);
  const tasks = new Map<string, TaskPaneTaskRecord>([
    [
      'task-ready',
      task({
        taskId: 'task-ready',
        repositoryId: 'repo-1',
        title: 'Ready Task',
        status: 'ready',
        orderIndex: 2,
      }),
    ],
    [
      'task-progress',
      task({
        taskId: 'task-progress',
        repositoryId: 'repo-1',
        title: 'In Progress',
        status: 'in-progress',
        orderIndex: 9,
      }),
    ],
    [
      'task-draft',
      task({
        taskId: 'task-draft',
        repositoryId: 'repo-2',
        title: 'Draft Task',
        status: 'draft',
        orderIndex: 0,
      }),
    ],
    [
      'task-complete',
      task({
        taskId: 'task-complete',
        repositoryId: 'repo-missing',
        title: 'Complete Task',
        status: 'completed',
        orderIndex: 3,
      }),
    ],
  ]);

  const snapshot = buildTaskPaneSnapshot(
    repositories,
    tasks,
    'missing-selection',
    null,
    NOW_MS,
    'hello',
  );
  const lines = snapshot.lines.map((entry) => entry.text);
  assert.equal(
    lines.some((line) => line.includes('NOTICE: hello')),
    true,
  );
  assert.equal(
    lines.some((line) => line.includes('REPOSITORIES') && line.includes('drag prioritize')),
    true,
  );
  assert.equal(
    lines.some((line) => line.includes('TASKS') && line.includes('A add')),
    true,
  );
  assert.equal(
    lines.some((line) => line.includes('github.com/jmoyers/harness')),
    true,
  );
  assert.equal(
    lines.some((line) => line.includes('12c')),
    true,
  );

  const inProgressIndex = lines.findIndex((line) => line.includes('▶ In Progress'));
  const readyIndex = lines.findIndex((line) => line.includes('◆ Ready Task'));
  const draftIndex = lines.findIndex((line) => line.includes('◇ Draft Task'));
  const completedIndex = lines.findIndex((line) => line.includes('✓ Complete Task'));
  assert.equal(inProgressIndex >= 0, true);
  assert.equal(readyIndex > inProgressIndex, true);
  assert.equal(draftIndex > readyIndex, true);
  assert.equal(completedIndex > draftIndex, true);
  assert.equal(
    lines.some((line) => line.includes('COMPLETED: 1')),
    true,
  );
});

void test('buildTaskPaneSnapshot handles empty groups and repository fallback formatting', () => {
  const emptySnapshot = buildTaskPaneSnapshot(new Map(), new Map(), null, null, NOW_MS, null);
  const emptyLines = emptySnapshot.lines.map((entry) => entry.text);
  assert.equal(
    emptyLines.some((line) => line.includes('no repositories')),
    true,
  );
  assert.equal(
    emptyLines.some((line) => line.includes('no tasks')),
    true,
  );

  const fallbackSnapshot = buildTaskPaneSnapshot(
    new Map([
      [
        'repo-empty',
        {
          repositoryId: 'repo-empty',
          name: '   ',
          remoteUrl: '',
          defaultBranch: '',
          archivedAt: null,
        },
      ],
    ]),
    new Map(),
    null,
    null,
    NOW_MS,
    null,
  );
  const fallbackLines = fallbackSnapshot.lines.map((entry) => entry.text);
  assert.equal(
    fallbackLines.some((line) => line.includes('(unnamed repo')),
    true,
  );
  assert.equal(
    fallbackLines.some((line) => line.includes('(no remote)')),
    true,
  );
  assert.equal(
    fallbackLines.some((line) => line.includes('main')),
    true,
  );
});

void test('buildTaskPaneSnapshot covers relative-time summary branches and metadata fallbacks', () => {
  const invalidCompletedSummary = buildTaskPaneSnapshot(
    new Map(),
    new Map([
      [
        'task-invalid',
        task({ taskId: 'task-invalid', status: 'completed', updatedAt: 'not-a-timestamp' }),
      ],
    ]),
    null,
    null,
    NOW_MS,
    null,
  );
  assert.equal(
    invalidCompletedSummary.lines.some((line) => line.text.includes('UPDATED unknown')),
    true,
  );

  const minuteSummary = buildTaskPaneSnapshot(
    new Map(),
    new Map([
      [
        'task-minute',
        task({ taskId: 'task-minute', status: 'completed', updatedAt: '2025-12-31T23:50:00.000Z' }),
      ],
    ]),
    null,
    null,
    NOW_MS,
    null,
  );
  assert.equal(
    minuteSummary.lines.some((line) => line.text.includes('UPDATED 10m ago')),
    true,
  );

  const hourSummary = buildTaskPaneSnapshot(
    new Map(),
    new Map([
      [
        'task-hour',
        task({ taskId: 'task-hour', status: 'completed', updatedAt: '2025-12-31T22:00:00.000Z' }),
      ],
    ]),
    null,
    null,
    NOW_MS,
    null,
  );
  assert.equal(
    hourSummary.lines.some((line) => line.text.includes('UPDATED 2h ago')),
    true,
  );

  const daySummary = buildTaskPaneSnapshot(
    new Map(),
    new Map([
      [
        'task-day',
        task({ taskId: 'task-day', status: 'completed', updatedAt: '2025-12-29T00:00:00.000Z' }),
      ],
    ]),
    null,
    null,
    NOW_MS,
    null,
  );
  assert.equal(
    daySummary.lines.some((line) => line.text.includes('UPDATED 3d ago')),
    true,
  );

  const repositorySnapshot = buildTaskPaneSnapshot(
    new Map([
      [
        'repo-metadata',
        {
          repositoryId: 'repo-metadata',
          name: 'external',
          remoteUrl: 'https://example.com/acme/tooling.git',
          defaultBranch: 'trunk',
          archivedAt: null,
          metadata: {
            commitCount: Number.NaN,
            lastCommitAt: 'invalid',
          },
        } as TaskPaneRepositoryRecord,
      ],
      [
        'repo-empty-ts',
        {
          repositoryId: 'repo-empty-ts',
          name: 'empty-ts',
          remoteUrl: 'https://example.com/acme/empty-ts.git',
          defaultBranch: 'main',
          archivedAt: null,
          metadata: {
            commitCount: 1,
            lastCommitAt: '',
          },
        } as TaskPaneRepositoryRecord,
      ],
      [
        'repo-seconds',
        {
          repositoryId: 'repo-seconds',
          name: 'seconds',
          remoteUrl: 'https://github.com/acme/seconds.git',
          defaultBranch: 'main',
          archivedAt: null,
          metadata: {
            commitCount: 2,
            lastCommitAt: '2025-12-31T23:59:30.000Z',
          },
        } as TaskPaneRepositoryRecord,
      ],
      [
        'repo-minutes',
        {
          repositoryId: 'repo-minutes',
          name: 'minutes',
          remoteUrl: 'https://github.com/acme/minutes.git',
          defaultBranch: 'main',
          archivedAt: null,
          metadata: {
            commitCount: 3,
            lastCommitAt: '2025-12-31T23:50:00.000Z',
          },
        } as TaskPaneRepositoryRecord,
      ],
      [
        'repo-hours',
        {
          repositoryId: 'repo-hours',
          name: 'hours',
          remoteUrl: 'https://github.com/acme/hours.git',
          defaultBranch: 'main',
          archivedAt: null,
          metadata: {
            commitCount: 4,
            lastCommitAt: '2025-12-31T22:00:00.000Z',
          },
        } as TaskPaneRepositoryRecord,
      ],
    ]),
    new Map(),
    null,
    null,
    NOW_MS,
    null,
  );
  const repositoryLines = repositorySnapshot.lines.map((entry) => entry.text);
  assert.equal(
    repositoryLines.some((line) => line.includes('example.com/acme/tooling')),
    true,
  );
  assert.equal(
    repositoryLines.some((line) => line.includes('?c')),
    true,
  );
  assert.equal(
    repositoryLines.some((line) => line.includes('30s')),
    true,
  );
  assert.equal(
    repositoryLines.some((line) => line.includes('10m')),
    true,
  );
  assert.equal(
    repositoryLines.some((line) => line.includes('2h')),
    true,
  );
});

void test('buildTaskPaneRows renders framed home view with footer button hitboxes', () => {
  const repositories = new Map<string, TaskPaneRepositoryRecord>([
    ['repo-1', { repositoryId: 'repo-1', name: 'api', archivedAt: null }],
  ]);
  const tasks = new Map<string, TaskPaneTaskRecord>([
    [
      'task-1',
      task({
        taskId: 'task-1',
        repositoryId: 'repo-1',
        title: 'Wire up task footer actions',
        status: 'ready',
        orderIndex: 0,
      }),
    ],
  ]);
  const snapshot = buildTaskPaneSnapshot(repositories, tasks, 'task-1', 'repo-1', NOW_MS, null);
  const view = buildTaskPaneRows(snapshot, 84, 14, 0);
  assert.equal(view.rows.length, 14);
  assert.equal(view.rows[0]?.startsWith('┌─ Home '), true);
  assert.equal(view.rows[view.rows.length - 1]?.startsWith('└'), true);
  assert.equal(
    view.rows.some((row) => row.includes('REPOSITORIES')),
    true,
  );
  assert.equal(
    view.rows.some((row) => row.includes('TASKS')),
    true,
  );

  const repoHeaderIndex = view.rows.findIndex((row) => row.includes('REPOSITORIES'));
  const taskHeaderIndex = view.rows.findIndex((row) => row.includes('TASKS'));
  assert.equal(taskPaneActionAtRow(view, repoHeaderIndex), 'repository.create');
  assert.equal(taskPaneActionAtRow(view, taskHeaderIndex), 'task.create');
  assert.equal(taskPaneActionAtCell(view, repoHeaderIndex, 0), 'repository.create');

  const taskRowIndex = view.taskIds.findIndex((value) => value === 'task-1');
  const repositoryRowIndex = view.repositoryIds.findIndex((value) => value === 'repo-1');
  assert.equal(taskPaneTaskIdAtRow(view, taskRowIndex), 'task-1');
  assert.equal(taskPaneRepositoryIdAtRow(view, repositoryRowIndex), 'repo-1');

  const repositoryFooterRowIndex = view.rows.findIndex((row) =>
    row.includes(TASKS_PANE_FOOTER_REPOSITORY_EDIT_BUTTON_LABEL),
  );
  assert.equal(repositoryFooterRowIndex >= 0, true);
  const repositoryFooterRow = view.rows[repositoryFooterRowIndex] ?? '';
  const repositoryEditCol = repositoryFooterRow.indexOf(
    TASKS_PANE_FOOTER_REPOSITORY_EDIT_BUTTON_LABEL,
  );
  const repositoryArchiveCol = repositoryFooterRow.indexOf(
    TASKS_PANE_FOOTER_REPOSITORY_ARCHIVE_BUTTON_LABEL,
  );
  assert.equal(
    taskPaneActionAtCell(view, repositoryFooterRowIndex, repositoryEditCol),
    'repository.edit',
  );
  assert.equal(
    taskPaneActionAtCell(view, repositoryFooterRowIndex, repositoryArchiveCol),
    'repository.archive',
  );

  const taskFooterRowIndex = view.rows.findIndex((row) =>
    row.includes(TASKS_PANE_FOOTER_EDIT_BUTTON_LABEL),
  );
  assert.equal(taskFooterRowIndex >= 0, true);
  const taskFooterRow = view.rows[taskFooterRowIndex] ?? '';
  const editCol = taskFooterRow.indexOf(TASKS_PANE_FOOTER_EDIT_BUTTON_LABEL);
  const deleteCol = taskFooterRow.indexOf(TASKS_PANE_FOOTER_DELETE_BUTTON_LABEL);
  const completeCol = taskFooterRow.indexOf(TASKS_PANE_FOOTER_COMPLETE_BUTTON_LABEL);
  const draftCol = taskFooterRow.indexOf(TASKS_PANE_FOOTER_DRAFT_BUTTON_LABEL);
  assert.equal(taskPaneActionAtCell(view, taskFooterRowIndex, editCol), 'task.edit');
  assert.equal(taskPaneActionAtCell(view, taskFooterRowIndex, deleteCol), 'task.delete');
  assert.equal(taskPaneActionAtCell(view, taskFooterRowIndex, completeCol), 'task.complete');
  assert.equal(taskPaneActionAtCell(view, taskFooterRowIndex, draftCol), 'task.draft');
  assert.equal(taskPaneActionAtCell(view, taskFooterRowIndex, 0), null);
});

void test('buildTaskPaneRows clamps scroll and falls back to flat rows in tiny panes', () => {
  const snapshot: TaskPaneSnapshot = {
    lines: [
      { text: 'a', taskId: null, repositoryId: null, action: null },
      { text: 'b', taskId: null, repositoryId: null, action: null },
      { text: 'c', taskId: null, repositoryId: null, action: null },
    ],
  };
  const clamped = buildTaskPaneRows(snapshot, 40, 6, 10_000);
  assert.equal(clamped.top > 0, true);

  const framedNarrow = buildTaskPaneRows(snapshot, 4, 4, 0);
  assert.equal(framedNarrow.rows[0]?.startsWith('┌'), true);

  const tiny = buildTaskPaneRows(snapshot, 3, 2, 0);
  assert.deepEqual(tiny.rows, ['a  ', 'b  ']);
  assert.equal(taskPaneActionAtRow(tiny, -99), null);
  assert.equal(taskPaneActionAtCell(tiny, 0, 0), null);
  assert.equal(taskPaneTaskIdAtRow(tiny, 99), null);
  assert.equal(taskPaneRepositoryIdAtRow(tiny, 99), null);

  const emptyTiny = buildTaskPaneRows({ lines: [] }, 3, 2, 0);
  assert.deepEqual(emptyTiny.rows, ['   ', '   ']);
});

void test('task pane accessors safely handle empty views', () => {
  const emptyView: TaskPaneView = {
    rows: [],
    taskIds: [],
    repositoryIds: [],
    actions: [],
    actionCells: [],
    top: 0,
  };
  assert.equal(taskPaneActionAtRow(emptyView, 0), null);
  assert.equal(taskPaneActionAtCell(emptyView, 0, 0), null);
  assert.equal(taskPaneTaskIdAtRow(emptyView, 0), null);
  assert.equal(taskPaneRepositoryIdAtRow(emptyView, 0), null);
});
