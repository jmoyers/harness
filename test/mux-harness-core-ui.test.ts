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
  TASKS_PANE_COMPLETE_TASK_BUTTON_LABEL,
  TASKS_PANE_DELETE_TASK_BUTTON_LABEL,
  TASKS_PANE_DRAFT_TASK_BUTTON_LABEL,
  TASKS_PANE_EDIT_TASK_BUTTON_LABEL,
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
  sortTasksByOrder,
  taskPaneActionAtRow,
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
  assert.equal(TASKS_PANE_EDIT_TASK_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_DELETE_TASK_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_READY_TASK_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_DRAFT_TASK_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_COMPLETE_TASK_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_REORDER_UP_BUTTON_LABEL.length > 0, true);
  assert.equal(TASKS_PANE_REORDER_DOWN_BUTTON_LABEL.length > 0, true);
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

void test('sortedRepositoryList filters archived rows and sorts by name then id', () => {
  const repositories = new Map<string, TaskPaneRepositoryRecord>([
    ['r3', { repositoryId: 'r3', name: 'alpha', archivedAt: null }],
    ['r1', { repositoryId: 'r1', name: 'alpha', archivedAt: null }],
    ['r2', { repositoryId: 'r2', name: 'beta', archivedAt: null }],
    ['r4', { repositoryId: 'r4', name: 'zzz', archivedAt: '2026-01-01T00:00:00.000Z' }]
  ]);

  const ordered = sortedRepositoryList(repositories);
  assert.deepEqual(
    ordered.map((entry) => entry.repositoryId),
    ['r1', 'r3', 'r2']
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

void test('buildTaskPaneSnapshot renders active/completed sections with relative timestamps', () => {
  const repositories = new Map<string, TaskPaneRepositoryRecord>([
    ['repo-1', { repositoryId: 'repo-1', name: 'api', archivedAt: null }]
  ]);
  const tasks = new Map<string, TaskPaneTaskRecord>([
    [
      'task-active',
      task({
        taskId: 'task-active',
        repositoryId: 'repo-1',
        title: 'Active Task',
        description: '  implement endpoint  ',
        status: 'ready',
        orderIndex: 0,
        updatedAt: '2025-12-31T23:59:30.000Z',
        createdAt: '2025-12-31T10:00:00.000Z'
      })
    ],
    [
      'task-missing-repo',
      task({
        taskId: 'task-missing-repo',
        repositoryId: 'repo-missing',
        title: 'Unknown Repo',
        description: '',
        status: 'draft',
        orderIndex: 1,
        updatedAt: 'invalid',
        createdAt: '2025-12-31T11:00:00.000Z'
      })
    ],
    [
      'task-complete-new',
      task({
        taskId: 'task-complete-new',
        repositoryId: 'repo-1',
        title: 'Newest Complete',
        status: 'completed',
        orderIndex: 2,
        completedAt: '2025-12-31T22:00:00.000Z',
        updatedAt: '2025-12-31T22:00:00.000Z',
        createdAt: '2025-12-30T00:00:00.000Z'
      })
    ],
    [
      'task-complete-old',
      task({
        taskId: 'task-complete-old',
        repositoryId: 'repo-1',
        title: 'Older Complete',
        status: 'completed',
        orderIndex: 3,
        completedAt: '2025-12-30T00:00:00.000Z',
        updatedAt: '2025-12-30T00:00:00.000Z',
        createdAt: '2025-12-29T00:00:00.000Z'
      })
    ]
  ]);

  const snapshot = buildTaskPaneSnapshot(repositories, tasks, 'missing-selection', NOW_MS, 'hello');
  const lines = snapshot.lines.map((entry) => entry.text);

  assert.equal(lines.includes('notice: hello'), true);
  assert.equal(lines.some((line) => line.includes('▸ 1. [ready] Active Task')), true);
  assert.equal(lines.some((line) => line.includes('implement endpoint')), true);
  assert.equal(lines.some((line) => line.includes('(missing repository) · updated unknown')), true);
  assert.equal(lines.some((line) => line.includes('Newest Complete')), true);
  assert.equal(lines.some((line) => line.includes('Older Complete')), true);
});

void test('buildTaskPaneSnapshot handles empty active/completed groups and updatedAt fallback sorting', () => {
  const repositories = new Map<string, TaskPaneRepositoryRecord>();
  const tasks = new Map<string, TaskPaneTaskRecord>([
    [
      'task-a',
      task({
        taskId: 'task-a',
        title: 'A',
        status: 'completed',
        completedAt: 'invalid',
        updatedAt: '2025-12-31T00:00:00.000Z',
        createdAt: '2025-12-31T00:00:00.000Z'
      })
    ],
    [
      'task-b',
      task({
        taskId: 'task-b',
        title: 'B',
        status: 'completed',
        completedAt: 'invalid',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2025-12-31T01:00:00.000Z'
      })
    ]
  ]);

  const completedSnapshot = buildTaskPaneSnapshot(repositories, tasks, null, NOW_MS, null);
  const completedLines = completedSnapshot.lines.map((entry) => entry.text);
  assert.equal(completedLines.includes('active tasks'), true);
  assert.equal(completedLines.includes('  no active tasks'), true);
  assert.equal(completedLines.some((line) => line.includes('✓ B')), true);
  assert.equal(completedLines.some((line) => line.includes('✓ A')), true);

  const emptySnapshot = buildTaskPaneSnapshot(new Map(), new Map(), null, NOW_MS, null);
  const emptyLines = emptySnapshot.lines.map((entry) => entry.text);
  assert.equal(emptyLines.includes('  no active tasks'), true);
  assert.equal(emptyLines.includes('  nothing completed yet'), true);
});

void test('buildTaskPaneSnapshot covers relative-time buckets and future timestamp clamping', () => {
  const tasks = new Map<string, TaskPaneTaskRecord>([
    [
      'seconds',
      task({
        taskId: 'seconds',
        title: 'seconds',
        status: 'ready',
        orderIndex: 0,
        updatedAt: '2025-12-31T23:59:45.000Z'
      })
    ],
    [
      'minutes',
      task({
        taskId: 'minutes',
        title: 'minutes',
        status: 'draft',
        orderIndex: 1,
        updatedAt: '2025-12-31T23:50:00.000Z'
      })
    ],
    [
      'hours',
      task({
        taskId: 'hours',
        title: 'hours',
        status: 'completed',
        orderIndex: 2,
        completedAt: '2025-12-31T22:00:00.000Z',
        updatedAt: '2025-12-31T22:00:00.000Z'
      })
    ],
    [
      'days',
      task({
        taskId: 'days',
        title: 'days',
        status: 'completed',
        orderIndex: 3,
        completedAt: '2025-12-29T00:00:00.000Z',
        updatedAt: '2025-12-29T00:00:00.000Z'
      })
    ],
    [
      'future',
      task({
        taskId: 'future',
        title: 'future',
        status: 'completed',
        orderIndex: 4,
        completedAt: null,
        updatedAt: '2026-01-01T00:10:00.000Z'
      })
    ]
  ]);

  const snapshot = buildTaskPaneSnapshot(new Map(), tasks, null, NOW_MS, null);
  const lines = snapshot.lines.map((entry) => entry.text);
  assert.equal(lines.some((line) => line.includes('updated 15s ago')), true);
  assert.equal(lines.some((line) => line.includes('updated 10m ago')), true);
  assert.equal(lines.some((line) => line.includes('2h ago')), true);
  assert.equal(lines.some((line) => line.includes('3d ago')), true);
  assert.equal(lines.some((line) => line.includes('0s ago')), true);
});

void test('buildTaskPaneSnapshot handles mixed finite and invalid completedAt timestamps', () => {
  const tasks = new Map<string, TaskPaneTaskRecord>([
    [
      'valid-complete',
      task({
        taskId: 'valid-complete',
        title: 'valid',
        status: 'completed',
        completedAt: '2025-12-31T23:00:00.000Z',
        updatedAt: '2025-12-31T23:00:00.000Z'
      })
    ],
    [
      'invalid-complete',
      task({
        taskId: 'invalid-complete',
        title: 'invalid',
        status: 'completed',
        completedAt: 'nope',
        updatedAt: '2025-12-31T21:00:00.000Z'
      })
    ]
  ]);
  const snapshot = buildTaskPaneSnapshot(new Map(), tasks, null, NOW_MS, null);
  assert.equal(snapshot.lines.some((line) => line.text.includes('valid')), true);
  assert.equal(snapshot.lines.some((line) => line.text.includes('invalid')), true);
});

void test('buildTaskPaneRows wraps and pads rows while preserving task/action metadata', () => {
  const repositories = new Map<string, TaskPaneRepositoryRecord>([
    ['repo-1', { repositoryId: 'repo-1', name: 'api', archivedAt: null }]
  ]);
  const tasks = new Map<string, TaskPaneTaskRecord>([
    [
      'task-1',
      task({
        taskId: 'task-1',
        repositoryId: 'repo-1',
        title: 'Very long title that wraps',
        description: 'details',
        status: 'ready',
        orderIndex: 0,
        updatedAt: '2025-12-31T23:59:00.000Z',
        createdAt: '2025-12-31T00:00:00.000Z'
      })
    ]
  ]);

  const snapshot = buildTaskPaneSnapshot(repositories, tasks, 'task-1', NOW_MS, null);
  const view = buildTaskPaneRows(snapshot, 16, 6, 0);
  assert.equal(view.rows.length, 6);
  assert.equal(view.top >= 0, true);
  assert.equal(view.actions.includes('task.create'), true);
  const actionIndex = view.actions.findIndex((entry) => entry !== null);
  assert.notEqual(actionIndex, -1);
  assert.notEqual(taskPaneActionAtRow(view, actionIndex), null);

  const clamped = buildTaskPaneRows(snapshot, 16, 6, 100);
  assert.equal(clamped.top >= 0, true);
  assert.equal(clamped.top > 0, true);
  const taskWindow = buildTaskPaneRows(snapshot, 16, 30, 0);
  const taskIndex = taskWindow.taskIds.findIndex((entry) => entry !== null);
  assert.notEqual(taskIndex, -1);
  assert.notEqual(taskPaneTaskIdAtRow(taskWindow, taskIndex), null);
});

void test('buildTaskPaneRows and row accessors handle empty snapshots and out-of-range rows', () => {
  const view = buildTaskPaneRows({ lines: [] }, 10, 2, 0);
  assert.deepEqual(view.rows, ['          ', '          ']);
  assert.equal(taskPaneActionAtRow(view, -99), null);
  assert.equal(taskPaneTaskIdAtRow(view, 99), null);

  const emptyView: TaskPaneView = {
    rows: [],
    taskIds: [],
    actions: [],
    top: 0
  };
  assert.equal(taskPaneActionAtRow(emptyView, 0), null);
  assert.equal(taskPaneTaskIdAtRow(emptyView, 0), null);
});
