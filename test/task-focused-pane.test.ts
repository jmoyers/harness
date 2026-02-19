import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  buildTaskFocusedPaneView,
  taskFocusedPaneActionAtCell,
  taskFocusedPaneActionAtRow,
  taskFocusedPaneRepositoryIdAtRow,
  taskFocusedPaneTaskIdAtRow,
  type TaskFocusedPaneAction,
  type TaskFocusedPaneEditorTarget,
  type TaskFocusedPaneRepositoryRecord,
  type TaskFocusedPaneTaskRecord,
  type TaskFocusedPaneView,
} from '../src/mux/task-focused-pane.ts';
import { createTaskComposerBuffer } from '../src/mux/task-composer.ts';

function repository(
  repositoryId: string,
  name: string,
  archivedAt: string | null = null,
): TaskFocusedPaneRepositoryRecord {
  return {
    repositoryId,
    name,
    archivedAt,
  };
}

function task(
  taskId: string,
  repositoryId: string | null,
  status: TaskFocusedPaneTaskRecord['status'],
  orderIndex: number,
  title = taskId,
  body = '',
): TaskFocusedPaneTaskRecord {
  return {
    taskId,
    repositoryId,
    title,
    body,
    status,
    orderIndex,
    createdAt: `2026-01-0${String(Math.max(1, orderIndex + 1))}T00:00:00.000Z`,
  };
}

void test('focused pane renders selected repository tasks with editable task buffer', () => {
  const repositories = new Map<string, TaskFocusedPaneRepositoryRecord>([
    ['r-b', repository('r-b', 'beta')],
    ['r-a', repository('r-a', 'alpha')],
  ]);
  const tasks = new Map<string, TaskFocusedPaneTaskRecord>([
    ['t-2', task('t-2', 'r-a', 'ready', 1, 'ready task', 'line 2')],
    ['t-1', task('t-1', 'r-a', 'draft', 0, 'draft task', 'line 1')],
    ['t-3', task('t-3', 'r-b', 'draft', 0, 'other repo', 'line 3')],
  ]);
  const view = buildTaskFocusedPaneView({
    repositories,
    tasks,
    selectedRepositoryId: 'r-a',
    repositoryDropdownOpen: false,
    editorTarget: {
      kind: 'task',
      taskId: 't-1',
    },
    draftBuffer: createTaskComposerBuffer('draft prompt'),
    taskBufferById: new Map([
      [
        't-1',
        {
          text: 'draft task\nedited body',
          cursor: 6,
        },
      ],
    ]),
    notice: null,
    cols: 80,
    rows: 20,
    scrollTop: 0,
  });

  assert.equal(view.selectedRepositoryId, 'r-a');
  assert.equal(
    view.rows.some((row) => row.includes('tasks (2)')),
    true,
  );
  assert.equal(
    view.rows.some((row) => row.includes('edited body')),
    true,
  );
  assert.equal(
    view.rows.some((row) => row.includes('other repo')),
    false,
  );
  assert.equal(
    view.rows.some((row) => row.includes('[ d queued ]')),
    true,
  );
  assert.equal(
    view.rows.some((row) => row.includes('tab queue')),
    true,
  );
});

void test('focused pane exported types remain reachable from src/test graph', () => {
  const action: TaskFocusedPaneAction = 'task.focus';
  const target: TaskFocusedPaneEditorTarget = {
    kind: 'draft',
  };
  const view = {
    rows: [],
    taskIds: [],
    repositoryIds: [],
    actions: [],
    actionCells: [],
    top: 0,
    selectedRepositoryId: null,
  } as TaskFocusedPaneView;
  assert.equal(action, 'task.focus');
  assert.equal(target.kind, 'draft');
  assert.equal(view.top, 0);
});

void test('focused pane handles empty/archived repository states and dropdown selection rows', () => {
  const repositories = new Map<string, TaskFocusedPaneRepositoryRecord>([
    ['archived', repository('archived', 'zzz', '2026-01-01T00:00:00.000Z')],
    ['live', repository('live', 'live-repo')],
  ]);
  const tasks = new Map<string, TaskFocusedPaneTaskRecord>();
  const view = buildTaskFocusedPaneView({
    repositories,
    tasks,
    selectedRepositoryId: null,
    repositoryDropdownOpen: true,
    editorTarget: {
      kind: 'draft',
    },
    draftBuffer: {
      text: '',
      cursor: 0,
    },
    taskBufferById: new Map(),
    notice: 'pick one',
    cols: 60,
    rows: 12,
    scrollTop: 0,
  });

  assert.equal(view.selectedRepositoryId, 'live');
  assert.equal(
    view.rows.some((row) => row.includes('● live-repo')),
    true,
  );
  assert.equal(
    view.rows.some((row) => row.includes('zzz')),
    false,
  );
  assert.equal(
    view.rows.some((row) => row.includes('notice: pick one')),
    true,
  );
  assert.equal(
    view.rows.some((row) => row.includes('no tasks yet')),
    true,
  );
});

void test('focused pane supports row/cell hit testing and row clamping', () => {
  const repositories = new Map<string, TaskFocusedPaneRepositoryRecord>([
    ['r-a', repository('r-a', 'alpha')],
  ]);
  const tasks = new Map<string, TaskFocusedPaneTaskRecord>([
    ['t-1', task('t-1', 'r-a', 'draft', 0, 'task one', 'body')],
  ]);
  const view = buildTaskFocusedPaneView({
    repositories,
    tasks,
    selectedRepositoryId: 'r-a',
    repositoryDropdownOpen: false,
    editorTarget: {
      kind: 'task',
      taskId: 't-1',
    },
    draftBuffer: createTaskComposerBuffer('line'),
    taskBufferById: new Map(),
    notice: null,
    cols: 90,
    rows: 18,
    scrollTop: 0,
  });

  const taskRowIndex = view.taskIds.findIndex((taskId) => taskId === 't-1');
  assert.equal(taskRowIndex >= 0, true);
  assert.equal(taskFocusedPaneTaskIdAtRow(view, taskRowIndex), 't-1');
  assert.equal(taskFocusedPaneRepositoryIdAtRow(view, taskRowIndex), 'r-a');
  assert.equal(taskFocusedPaneActionAtRow(view, taskRowIndex), 'task.focus');

  const row = view.rows[taskRowIndex]!;
  const readyChipCol = row.indexOf('[ r ready ]');
  assert.equal(readyChipCol >= 0, true);
  assert.equal(
    taskFocusedPaneActionAtCell(view, taskRowIndex, readyChipCol + 1),
    'task.status.ready',
  );
  assert.equal(taskFocusedPaneActionAtCell(view, taskRowIndex, row.length + 50), 'task.focus');
  assert.equal(taskFocusedPaneActionAtCell(view, -200, -100), taskFocusedPaneActionAtRow(view, 0));
});

void test('focused pane handles tight viewport and scroll clamping', () => {
  const repositories = new Map<string, TaskFocusedPaneRepositoryRecord>([
    ['r-a', repository('r-a', 'alpha')],
  ]);
  const tasks = new Map<string, TaskFocusedPaneTaskRecord>([
    ['t-1', task('t-1', 'r-a', 'draft', 0)],
    ['t-2', task('t-2', 'r-a', 'ready', 1)],
    ['t-3', task('t-3', 'r-a', 'completed', 2)],
  ]);
  const view = buildTaskFocusedPaneView({
    repositories,
    tasks,
    selectedRepositoryId: 'r-a',
    repositoryDropdownOpen: false,
    editorTarget: {
      kind: 'draft',
    },
    draftBuffer: createTaskComposerBuffer('x'),
    taskBufferById: new Map(),
    notice: null,
    cols: 18,
    rows: 5,
    scrollTop: 999,
  });
  assert.equal(view.rows.length, 5);
  assert.equal(view.top >= 0, true);
  assert.equal(
    taskFocusedPaneTaskIdAtRow(view, 999),
    view.taskIds[view.taskIds.length - 1] ?? null,
  );
  assert.equal(taskFocusedPaneRepositoryIdAtRow(view, -1), view.repositoryIds[0] ?? null);
});

void test('focused pane task ordering handles timestamp fallbacks and no-repository branch', () => {
  const view = buildTaskFocusedPaneView({
    repositories: new Map(),
    tasks: new Map<string, TaskFocusedPaneTaskRecord>([
      [
        'task-z',
        {
          ...task('task-z', null, 'draft', 1),
          createdAt: 'invalid',
        },
      ],
      [
        'task-a',
        {
          ...task('task-a', null, 'draft', 1),
          createdAt: 'invalid',
        },
      ],
      [
        'task-finite',
        {
          ...task('task-finite', null, 'draft', 1),
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    ]),
    selectedRepositoryId: null,
    repositoryDropdownOpen: false,
    editorTarget: {
      kind: 'draft',
    },
    draftBuffer: createTaskComposerBuffer('x'),
    taskBufferById: new Map(),
    notice: null,
    cols: 40,
    rows: 10,
    scrollTop: 0,
  });
  assert.equal(view.selectedRepositoryId, null);
  assert.equal(
    view.rows.some((row) => row.includes('no repository selected')),
    true,
  );
});

void test('focused pane ordering handles finite-vs-invalid createdAt branches', () => {
  const repositories = new Map<string, TaskFocusedPaneRepositoryRecord>([
    ['r-a', repository('r-a', 'alpha')],
  ]);
  const tasks = new Map<string, TaskFocusedPaneTaskRecord>([
    [
      'invalid',
      {
        ...task('invalid', 'r-a', 'draft', 1),
        createdAt: 'invalid',
      },
    ],
    [
      'finite',
      {
        ...task('finite', 'r-a', 'draft', 1),
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  ]);
  const view = buildTaskFocusedPaneView({
    repositories,
    tasks,
    selectedRepositoryId: 'r-a',
    repositoryDropdownOpen: false,
    editorTarget: {
      kind: 'draft',
    },
    draftBuffer: createTaskComposerBuffer('x'),
    taskBufferById: new Map(),
    notice: null,
    cols: 50,
    rows: 20,
    scrollTop: 0,
  });
  const orderedTaskRows = view.taskIds.filter((taskId): taskId is string => taskId !== null);
  assert.deepEqual(orderedTaskRows, ['finite', 'invalid']);
});

void test('focused pane orders finite timestamps and renders in-progress glyph', () => {
  const repositories = new Map<string, TaskFocusedPaneRepositoryRecord>([
    ['r-a', repository('r-a', 'alpha')],
  ]);
  const tasks = new Map<string, TaskFocusedPaneTaskRecord>([
    [
      'late',
      {
        ...task('late', 'r-a', 'in-progress', 1),
        createdAt: '2026-01-03T00:00:00.000Z',
      },
    ],
    [
      'early',
      {
        ...task('early', 'r-a', 'draft', 1),
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  ]);
  const view = buildTaskFocusedPaneView({
    repositories,
    tasks,
    selectedRepositoryId: 'r-a',
    repositoryDropdownOpen: false,
    editorTarget: {
      kind: 'draft',
    },
    draftBuffer: createTaskComposerBuffer('x'),
    taskBufferById: new Map(),
    notice: null,
    cols: 70,
    rows: 20,
    scrollTop: 0,
  });
  const orderedTaskRows = view.taskIds.filter((taskId): taskId is string => taskId !== null);
  assert.deepEqual(orderedTaskRows, ['early', 'late']);
  assert.equal(
    view.rows.some((row) => row.includes('◔')),
    true,
  );
});

void test('focused pane truncates narrow notice rows to ellipsis', () => {
  const view = buildTaskFocusedPaneView({
    repositories: new Map(),
    tasks: new Map(),
    selectedRepositoryId: null,
    repositoryDropdownOpen: false,
    editorTarget: {
      kind: 'draft',
    },
    draftBuffer: createTaskComposerBuffer('x'),
    taskBufferById: new Map(),
    notice: 'abcdef',
    cols: 10,
    rows: 8,
    scrollTop: 0,
  });
  assert.equal(
    view.rows.some((row) => row.includes('notice: …')),
    true,
  );
});

void test('focused pane helper accessors handle empty view values', () => {
  const emptyView: TaskFocusedPaneView = {
    rows: [],
    taskIds: [],
    repositoryIds: [],
    actions: [],
    actionCells: [],
    top: 0,
    selectedRepositoryId: null,
  };
  assert.equal(taskFocusedPaneActionAtRow(emptyView, 0), null);
  assert.equal(taskFocusedPaneActionAtCell(emptyView, 0, 0), null);
  assert.equal(taskFocusedPaneTaskIdAtRow(emptyView, 0), null);
  assert.equal(taskFocusedPaneRepositoryIdAtRow(emptyView, 0), null);
});
