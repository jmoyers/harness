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
  metadata?: Record<string, unknown>,
): TaskFocusedPaneRepositoryRecord {
  return {
    repositoryId,
    name,
    ...(metadata === undefined ? {} : { metadata }),
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
    view.rows.some(
      (row) =>
        row.includes('[ r ready ]') ||
        row.includes('[ d draft ]') ||
        row.includes('[ c complete ]'),
    ),
    false,
  );
  assert.equal(
    view.rows.some((row) => row.includes('tab draft')),
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

void test('focused pane repository dropdown preserves left-rail repository insertion order', () => {
  const repositories = new Map<string, TaskFocusedPaneRepositoryRecord>([
    ['repo-ash', repository('repo-ash', 'ash', null, { homePriority: 1 })],
    ['repo-harness', repository('repo-harness', 'harness', null, { homePriority: 0 })],
  ]);
  const view = buildTaskFocusedPaneView({
    repositories,
    tasks: new Map(),
    selectedRepositoryId: 'repo-harness',
    repositoryDropdownOpen: true,
    editorTarget: {
      kind: 'draft',
    },
    draftBuffer: createTaskComposerBuffer(''),
    taskBufferById: new Map(),
    notice: null,
    cols: 60,
    rows: 12,
    scrollTop: 0,
  });
  const dropdownRows = view.rows.filter((row) => row.includes('●') || row.includes('○'));
  assert.equal(dropdownRows[0]?.includes('ash') ?? false, true);
  assert.equal(dropdownRows[1]?.includes('harness') ?? false, true);
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

  const repoRowIndex = view.rows.findIndex((value) => value.includes('repo: '));
  assert.equal(repoRowIndex >= 0, true);
  const repoRow = view.rows[repoRowIndex]!;
  const repoButtonCol = repoRow.indexOf('[');
  assert.equal(repoButtonCol >= 0, true);
  assert.equal(
    taskFocusedPaneActionAtCell(view, repoRowIndex, repoButtonCol + 1),
    'repository.dropdown.toggle',
  );
  assert.equal(taskFocusedPaneActionAtCell(view, repoRowIndex, 0), 'repository.dropdown.toggle');

  const row = view.rows[taskRowIndex]!;
  assert.equal(taskFocusedPaneActionAtCell(view, taskRowIndex, 5), 'task.focus');
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
  assert.deepEqual(orderedTaskRows, ['late', 'early']);
  assert.equal(
    view.rows.some((row) => row.includes('◔')),
    true,
  );
});

void test('focused pane groups tasks by status and replaces focused row content with editor', () => {
  const repositories = new Map<string, TaskFocusedPaneRepositoryRecord>([
    ['r-a', repository('r-a', 'alpha')],
  ]);
  const tasks = new Map<string, TaskFocusedPaneTaskRecord>([
    ['ready', task('ready', 'r-a', 'ready', 2, 'ready title', 'ready body')],
    ['in-progress', task('in-progress', 'r-a', 'in-progress', 9, 'ip title', 'ip body')],
    ['draft', task('draft', 'r-a', 'draft', 1, 'draft title', 'duplicate text')],
    ['complete', task('complete', 'r-a', 'completed', 0, 'done title', 'done body')],
  ]);
  const view = buildTaskFocusedPaneView({
    repositories,
    tasks,
    selectedRepositoryId: 'r-a',
    repositoryDropdownOpen: false,
    editorTarget: {
      kind: 'task',
      taskId: 'draft',
    },
    draftBuffer: createTaskComposerBuffer(''),
    taskBufferById: new Map([
      [
        'draft',
        {
          text: 'duplicate text\nmore',
          cursor: 1,
        },
      ],
    ]),
    notice: null,
    cols: 80,
    rows: 24,
    scrollTop: 0,
  });

  const inProgHeaderIndex = view.rows.findIndex((row) => row.includes('◔ in prog'));
  const readyHeaderIndex = view.rows.findIndex((row) => row.includes('○ ready'));
  const draftHeaderIndex = view.rows.findIndex((row) => row.includes('◇ draft'));
  const completeHeaderIndex = view.rows.findIndex((row) => row.includes('✓ complete'));
  assert.equal(inProgHeaderIndex >= 0, true);
  assert.equal(readyHeaderIndex > inProgHeaderIndex, true);
  assert.equal(draftHeaderIndex > readyHeaderIndex, true);
  assert.equal(completeHeaderIndex > draftHeaderIndex, true);
  assert.equal(
    view.rows.some((row) => row.includes('editing')),
    false,
  );

  const editorOnlyRowCount = view.rows.filter((row) => row.includes('more')).length;
  assert.equal(editorOnlyRowCount, 1);
});

void test('focused pane task editor renders a fixed status glyph prefix for focused rows', () => {
  const repositories = new Map<string, TaskFocusedPaneRepositoryRecord>([
    ['r-a', repository('r-a', 'alpha')],
  ]);
  const tasks = new Map<string, TaskFocusedPaneTaskRecord>([
    ['ready-task', task('ready-task', 'r-a', 'ready', 0, 'ready title', 'ready body')],
  ]);
  const view = buildTaskFocusedPaneView({
    repositories,
    tasks,
    selectedRepositoryId: 'r-a',
    repositoryDropdownOpen: false,
    editorTarget: {
      kind: 'task',
      taskId: 'ready-task',
    },
    draftBuffer: createTaskComposerBuffer(''),
    taskBufferById: new Map([
      [
        'ready-task',
        {
          text: 'edited',
          cursor: 6,
        },
      ],
    ]),
    notice: null,
    cols: 60,
    rows: 16,
    scrollTop: 0,
  });

  const editorRowIndex = view.taskIds.findIndex((taskId) => taskId === 'ready-task');
  assert.equal(editorRowIndex >= 0, true);
  const editorRow = view.rows[editorRowIndex] ?? '';
  assert.equal(editorRow.includes('│○ edited'), true);
});

void test('focused pane wraps focused draft input content and grows by wrapped rows', () => {
  const view = buildTaskFocusedPaneView({
    repositories: new Map<string, TaskFocusedPaneRepositoryRecord>([
      ['repo-1', repository('repo-1', 'alpha')],
    ]),
    tasks: new Map(),
    selectedRepositoryId: 'repo-1',
    repositoryDropdownOpen: false,
    editorTarget: {
      kind: 'draft',
    },
    draftBuffer: createTaskComposerBuffer('this is a wrapped draft line'),
    taskBufferById: new Map(),
    notice: null,
    cols: 24,
    rows: 24,
    scrollTop: 0,
  });

  const wrappedRows = view.rows.filter((row) => row.includes('│this is a wrapped dr'));
  const continuationRows = view.rows.filter((row) => row.includes('│aft line'));
  assert.equal(wrappedRows.length > 0, true);
  assert.equal(continuationRows.length > 0, true);
});

void test('focused pane status-order sorter handles same-status orderIndex and createdAt tiebreaks', () => {
  const repositories = new Map<string, TaskFocusedPaneRepositoryRecord>([
    ['r-a', repository('r-a', 'alpha')],
  ]);
  const tasks = new Map<string, TaskFocusedPaneTaskRecord>([
    ['ready-high-order', task('ready-high-order', 'r-a', 'ready', 3, 'ready high', 'ready high')],
    ['ready-low-order', task('ready-low-order', 'r-a', 'ready', 0, 'ready low', 'ready low')],
    [
      'draft-late',
      {
        ...task('draft-late', 'r-a', 'draft', 7, 'draft late', 'draft late'),
        createdAt: '2026-01-05T00:00:00.000Z',
      },
    ],
    [
      'draft-early',
      {
        ...task('draft-early', 'r-a', 'draft', 7, 'draft early', 'draft early'),
        createdAt: '2026-01-02T00:00:00.000Z',
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
    draftBuffer: createTaskComposerBuffer(''),
    taskBufferById: new Map(),
    notice: null,
    cols: 80,
    rows: 24,
    scrollTop: 0,
  });
  const orderedTaskRows = view.taskIds.filter((taskId): taskId is string => taskId !== null);
  assert.deepEqual(orderedTaskRows, [
    'ready-low-order',
    'ready-high-order',
    'draft-early',
    'draft-late',
  ]);
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
