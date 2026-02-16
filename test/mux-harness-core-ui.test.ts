import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL,
  NEW_THREAD_MODAL_CODEX_BUTTON,
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
  type TaskPaneView
} from '../src/mux/harness-core-ui.ts';

const NOW_MS = Date.parse('2026-01-01T00:00:00.000Z');

function task(overrides: Partial<TaskPaneTaskRecord> & Pick<TaskPaneTaskRecord, 'taskId'>): TaskPaneTaskRecord {
  return {
    taskId: overrides.taskId,
    repositoryId: overrides.repositoryId ?? null,
    title: overrides.title ?? overrides.taskId,
    description: overrides.description ?? '',
    status: overrides.status ?? 'draft',
    orderIndex: overrides.orderIndex ?? 0,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z'
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
    action: taskAction
  };
  const snapshot: TaskPaneSnapshot = {
    lines: [snapshotLine]
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
  assert.equal(NEW_THREAD_MODAL_TERMINAL_BUTTON.length > 0, true);
});

void test('resolveGoldenModalSize clamps viewport-derived dimensions', () => {
  const resolved = resolveGoldenModalSize(100, 40, {
    preferredHeight: 24,
    minWidth: 24,
    maxWidth: 80
  });
  assert.equal(resolved.height, 24);
  assert.equal(resolved.width, 39);

  const tiny = resolveGoldenModalSize(8, 3, {
    preferredHeight: 50,
    minWidth: 20,
    maxWidth: 30
  });
  assert.equal(tiny.height, 1);
  assert.equal(tiny.width, 20);

  const contradictory = resolveGoldenModalSize(120, 40, {
    preferredHeight: 10,
    minWidth: 30,
    maxWidth: 10
  });
  assert.equal(contradictory.width, 30);
});

void test('sortedRepositoryList honors persisted home priority then falls back to name/id ordering', () => {
  const repositories = new Map<string, TaskPaneRepositoryRecord>([
    ['r3', { repositoryId: 'r3', name: 'alpha', archivedAt: null }],
    ['r1', { repositoryId: 'r1', name: 'alpha', archivedAt: null, metadata: { homePriority: 1 } }],
    ['r2', { repositoryId: 'r2', name: 'beta', archivedAt: null }],
    ['r0', { repositoryId: 'r0', name: 'zeta', archivedAt: null, metadata: { homePriority: 0 } }],
    ['r4', { repositoryId: 'r4', name: 'zzz', archivedAt: '2026-01-01T00:00:00.000Z' }]
  ]);

  const ordered = sortedRepositoryList(repositories);
  assert.deepEqual(
    ordered.map((entry) => entry.repositoryId),
    ['r0', 'r1', 'r3', 'r2']
  );
});

void test('sortedRepositoryList ignores invalid numeric home priority values and uses repository id as final tiebreak', () => {
  const repositories = new Map<string, TaskPaneRepositoryRecord>([
    ['r2', { repositoryId: 'r2', name: 'alpha', archivedAt: null, metadata: { homePriority: 1 } }],
    ['r1', { repositoryId: 'r1', name: 'alpha', archivedAt: null, metadata: { homePriority: 1 } }],
    ['r3', { repositoryId: 'r3', name: 'alpha', archivedAt: null, metadata: { homePriority: -1 } }],
    ['r4', { repositoryId: 'r4', name: 'beta', archivedAt: null, metadata: { homePriority: 1.5 } }]
  ]);

  const ordered = sortedRepositoryList(repositories);
  assert.deepEqual(
    ordered.map((entry) => entry.repositoryId),
    ['r1', 'r2', 'r3', 'r4']
  );
});

void test('sortTasksByOrder respects order index, then createdAt, then task id fallback', () => {
  const ordered = sortTasksByOrder([
    task({
      taskId: 'task-c',
      orderIndex: 1,
      createdAt: 'invalid-date'
    }),
    task({
      taskId: 'task-a',
      orderIndex: 1,
      createdAt: 'invalid-date'
    }),
    task({
      taskId: 'task-late',
      orderIndex: 0,
      createdAt: '2026-01-02T00:00:00.000Z'
    }),
    task({
      taskId: 'task-early',
      orderIndex: 0,
      createdAt: '2026-01-01T00:00:00.000Z'
    })
  ]);

  assert.deepEqual(
    ordered.map((entry) => entry.taskId),
    ['task-early', 'task-late', 'task-a', 'task-c']
  );
});

void test('sortTasksByOrder tolerates nullish createdAt values from malformed records', () => {
  const malformed = {
    ...task({
      taskId: 'malformed',
      orderIndex: 0
    }),
    createdAt: undefined
  } as unknown as TaskPaneTaskRecord;
  const ordered = sortTasksByOrder([
    task({
      taskId: 'good',
      orderIndex: 0,
      createdAt: 'invalid-date'
    }),
    {
      ...task({
        taskId: 'null-created-at',
        orderIndex: 0
      }),
      createdAt: null
    } as unknown as TaskPaneTaskRecord,
    malformed
  ]);
  assert.equal(ordered.length, 3);
});

void test('sortTasksByOrder falls back to task id when finite createdAt timestamps are equal', () => {
  const ordered = sortTasksByOrder([
    task({
      taskId: 'task-z',
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00.000Z'
    }),
    task({
      taskId: 'task-a',
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00.000Z'
    })
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.taskId),
    ['task-a', 'task-z']
  );
});

void test('sortTasksByOrder handles mixed finite and invalid createdAt timestamps', () => {
  const ordered = sortTasksByOrder([
    task({
      taskId: 'valid-created-at',
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00.000Z'
    }),
    task({
      taskId: 'invalid-created-at',
      orderIndex: 1,
      createdAt: 'not-a-timestamp'
    })
  ]);
  assert.equal(ordered.length, 2);
});

void test('sortTasksForHomePane orders tasks by status priority before order index', () => {
  const ordered = sortTasksForHomePane([
    task({
      taskId: 'in-progress-late',
      status: 'in-progress',
      orderIndex: 0,
      createdAt: '2026-01-01T00:00:01.000Z'
    }),
    task({
      taskId: 'draft-a',
      status: 'draft',
      orderIndex: 0
    }),
    task({
      taskId: 'in-progress-early',
      status: 'in-progress',
      orderIndex: 0,
      createdAt: '2026-01-01T00:00:00.000Z'
    }),
    task({
      taskId: 'ready-a',
      status: 'ready',
      orderIndex: 0
    }),
    task({
      taskId: 'completed-a',
      status: 'completed',
      orderIndex: 0
    })
  ]);

  assert.deepEqual(
    ordered.map((entry) => entry.taskId),
    ['in-progress-early', 'in-progress-late', 'ready-a', 'draft-a', 'completed-a']
  );
});

void test('sortTasksForHomePane falls back to task id when status order and createdAt are identical', () => {
  const ordered = sortTasksForHomePane([
    task({
      taskId: 'ready-z',
      status: 'ready',
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00.000Z'
    }),
    task({
      taskId: 'ready-a',
      status: 'ready',
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00.000Z'
    })
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.taskId),
    ['ready-a', 'ready-z']
  );
});

void test('sortTasksForHomePane uses order index as status-local priority', () => {
  const ordered = sortTasksForHomePane([
    task({
      taskId: 'ready-priority-low',
      status: 'ready',
      orderIndex: 3,
      createdAt: '2026-01-01T00:00:00.000Z'
    }),
    task({
      taskId: 'ready-priority-high',
      status: 'ready',
      orderIndex: 0,
      createdAt: '2026-01-01T00:01:00.000Z'
    })
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.taskId),
    ['ready-priority-high', 'ready-priority-low']
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
    assert.equal(createAction, 'conversation.new');
    assert.equal(closeAction, 'project.close');

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
    actionLineIndexByKind: {
      conversationNew: 3,
      projectClose: 4
    }
  };
  const rows = buildProjectPaneRows(emptySnapshot, 10, 2, 0);
  assert.equal(rows.rows.length, 2);
  assert.equal(projectPaneActionAtRow(emptySnapshot, 10, 2, 0, 0), null);
});

void test('buildProjectPaneSnapshot falls back to full path when basename is empty', () => {
  const snapshot = buildProjectPaneSnapshot('root', '/');
  assert.equal(snapshot.lines[0], 'project /');
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
          lastCommitAt: '2025-12-29T00:00:00.000Z'
        }
      } as TaskPaneRepositoryRecord
    ],
    [
      'repo-2',
      {
        repositoryId: 'repo-2',
        name: 'fernwatch',
        remoteUrl: 'https://github.com/jmoyers/fernwatch.git',
        defaultBranch: 'main',
        archivedAt: null
      }
    ]
  ]);
  const tasks = new Map<string, TaskPaneTaskRecord>([
    ['task-ready', task({ taskId: 'task-ready', repositoryId: 'repo-1', title: 'Ready Task', status: 'ready', orderIndex: 2 })],
    ['task-progress', task({ taskId: 'task-progress', repositoryId: 'repo-1', title: 'In Progress', status: 'in-progress', orderIndex: 9 })],
    ['task-draft', task({ taskId: 'task-draft', repositoryId: 'repo-2', title: 'Draft Task', status: 'draft', orderIndex: 0 })],
    ['task-complete', task({ taskId: 'task-complete', repositoryId: 'repo-missing', title: 'Complete Task', status: 'completed', orderIndex: 3 })]
  ]);

  const snapshot = buildTaskPaneSnapshot(repositories, tasks, 'missing-selection', null, NOW_MS, 'hello');
  const lines = snapshot.lines.map((entry) => entry.text);
  assert.equal(lines.some((line) => line.includes('NOTICE: hello')), true);
  assert.equal(lines.some((line) => line.includes('REPOSITORIES') && line.includes('drag prioritize')), true);
  assert.equal(lines.some((line) => line.includes('TASKS') && line.includes('A add')), true);
  assert.equal(lines.some((line) => line.includes('github.com/jmoyers/harness')), true);
  assert.equal(lines.some((line) => line.includes('12c')), true);

  const inProgressIndex = lines.findIndex((line) => line.includes('▶ In Progress'));
  const readyIndex = lines.findIndex((line) => line.includes('◆ Ready Task'));
  const draftIndex = lines.findIndex((line) => line.includes('◇ Draft Task'));
  const completedIndex = lines.findIndex((line) => line.includes('✓ Complete Task'));
  assert.equal(inProgressIndex >= 0, true);
  assert.equal(readyIndex > inProgressIndex, true);
  assert.equal(draftIndex > readyIndex, true);
  assert.equal(completedIndex > draftIndex, true);
  assert.equal(lines.some((line) => line.includes('COMPLETED: 1')), true);
});

void test('buildTaskPaneSnapshot handles empty groups and repository fallback formatting', () => {
  const emptySnapshot = buildTaskPaneSnapshot(new Map(), new Map(), null, null, NOW_MS, null);
  const emptyLines = emptySnapshot.lines.map((entry) => entry.text);
  assert.equal(emptyLines.some((line) => line.includes('no repositories')), true);
  assert.equal(emptyLines.some((line) => line.includes('no tasks')), true);

  const fallbackSnapshot = buildTaskPaneSnapshot(
    new Map([
      [
        'repo-empty',
        {
          repositoryId: 'repo-empty',
          name: '   ',
          remoteUrl: '',
          defaultBranch: '',
          archivedAt: null
        }
      ]
    ]),
    new Map(),
    null,
    null,
    NOW_MS,
    null
  );
  const fallbackLines = fallbackSnapshot.lines.map((entry) => entry.text);
  assert.equal(fallbackLines.some((line) => line.includes('(unnamed repo')), true);
  assert.equal(fallbackLines.some((line) => line.includes('(no remote)')), true);
  assert.equal(fallbackLines.some((line) => line.includes('main')), true);
});

void test('buildTaskPaneSnapshot covers relative-time summary branches and metadata fallbacks', () => {
  const invalidCompletedSummary = buildTaskPaneSnapshot(
    new Map(),
    new Map([
      ['task-invalid', task({ taskId: 'task-invalid', status: 'completed', updatedAt: 'not-a-timestamp' })]
    ]),
    null,
    null,
    NOW_MS,
    null
  );
  assert.equal(invalidCompletedSummary.lines.some((line) => line.text.includes('UPDATED unknown')), true);

  const minuteSummary = buildTaskPaneSnapshot(
    new Map(),
    new Map([
      ['task-minute', task({ taskId: 'task-minute', status: 'completed', updatedAt: '2025-12-31T23:50:00.000Z' })]
    ]),
    null,
    null,
    NOW_MS,
    null
  );
  assert.equal(minuteSummary.lines.some((line) => line.text.includes('UPDATED 10m ago')), true);

  const hourSummary = buildTaskPaneSnapshot(
    new Map(),
    new Map([
      ['task-hour', task({ taskId: 'task-hour', status: 'completed', updatedAt: '2025-12-31T22:00:00.000Z' })]
    ]),
    null,
    null,
    NOW_MS,
    null
  );
  assert.equal(hourSummary.lines.some((line) => line.text.includes('UPDATED 2h ago')), true);

  const daySummary = buildTaskPaneSnapshot(
    new Map(),
    new Map([
      ['task-day', task({ taskId: 'task-day', status: 'completed', updatedAt: '2025-12-29T00:00:00.000Z' })]
    ]),
    null,
    null,
    NOW_MS,
    null
  );
  assert.equal(daySummary.lines.some((line) => line.text.includes('UPDATED 3d ago')), true);

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
            lastCommitAt: 'invalid'
          }
        } as TaskPaneRepositoryRecord
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
            lastCommitAt: ''
          }
        } as TaskPaneRepositoryRecord
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
            lastCommitAt: '2025-12-31T23:59:30.000Z'
          }
        } as TaskPaneRepositoryRecord
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
            lastCommitAt: '2025-12-31T23:50:00.000Z'
          }
        } as TaskPaneRepositoryRecord
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
            lastCommitAt: '2025-12-31T22:00:00.000Z'
          }
        } as TaskPaneRepositoryRecord
      ]
    ]),
    new Map(),
    null,
    null,
    NOW_MS,
    null
  );
  const repositoryLines = repositorySnapshot.lines.map((entry) => entry.text);
  assert.equal(repositoryLines.some((line) => line.includes('example.com/acme/tooling')), true);
  assert.equal(repositoryLines.some((line) => line.includes('?c')), true);
  assert.equal(repositoryLines.some((line) => line.includes('30s')), true);
  assert.equal(repositoryLines.some((line) => line.includes('10m')), true);
  assert.equal(repositoryLines.some((line) => line.includes('2h')), true);
});

void test('buildTaskPaneRows renders framed home view with footer button hitboxes', () => {
  const repositories = new Map<string, TaskPaneRepositoryRecord>([
    ['repo-1', { repositoryId: 'repo-1', name: 'api', archivedAt: null }]
  ]);
  const tasks = new Map<string, TaskPaneTaskRecord>([
    ['task-1', task({ taskId: 'task-1', repositoryId: 'repo-1', title: 'Wire up task footer actions', status: 'ready', orderIndex: 0 })]
  ]);
  const snapshot = buildTaskPaneSnapshot(repositories, tasks, 'task-1', 'repo-1', NOW_MS, null);
  const view = buildTaskPaneRows(snapshot, 84, 14, 0);
  assert.equal(view.rows.length, 14);
  assert.equal(view.rows[0]?.startsWith('┌─ Home '), true);
  assert.equal(view.rows[view.rows.length - 1]?.startsWith('└'), true);
  assert.equal(view.rows.some((row) => row.includes('REPOSITORIES')), true);
  assert.equal(view.rows.some((row) => row.includes('TASKS')), true);

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
    row.includes(TASKS_PANE_FOOTER_REPOSITORY_EDIT_BUTTON_LABEL)
  );
  assert.equal(repositoryFooterRowIndex >= 0, true);
  const repositoryFooterRow = view.rows[repositoryFooterRowIndex] ?? '';
  const repositoryEditCol = repositoryFooterRow.indexOf(TASKS_PANE_FOOTER_REPOSITORY_EDIT_BUTTON_LABEL);
  const repositoryArchiveCol = repositoryFooterRow.indexOf(TASKS_PANE_FOOTER_REPOSITORY_ARCHIVE_BUTTON_LABEL);
  assert.equal(taskPaneActionAtCell(view, repositoryFooterRowIndex, repositoryEditCol), 'repository.edit');
  assert.equal(taskPaneActionAtCell(view, repositoryFooterRowIndex, repositoryArchiveCol), 'repository.archive');

  const taskFooterRowIndex = view.rows.findIndex((row) => row.includes(TASKS_PANE_FOOTER_EDIT_BUTTON_LABEL));
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
      { text: 'c', taskId: null, repositoryId: null, action: null }
    ]
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
    top: 0
  };
  assert.equal(taskPaneActionAtRow(emptyView, 0), null);
  assert.equal(taskPaneActionAtCell(emptyView, 0, 0), null);
  assert.equal(taskPaneTaskIdAtRow(emptyView, 0), null);
  assert.equal(taskPaneRepositoryIdAtRow(emptyView, 0), null);
});
