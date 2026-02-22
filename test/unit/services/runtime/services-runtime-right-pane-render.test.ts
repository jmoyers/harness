import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../../../../src/domain/workspace.ts';
import { TaskManager } from '../../../../src/domain/tasks.ts';
import type { ProjectPaneSnapshot } from '../../../../src/mux/harness-core-ui.ts';
import type { TaskComposerBuffer } from '../../../../src/mux/task-composer.ts';
import { RuntimeRightPaneRender } from '../../../../src/services/runtime-right-pane-render.ts';

interface RepoRecord {
  readonly repositoryId: string;
  readonly name: string;
  readonly archivedAt: string | null;
}

interface TaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly body: string;
  readonly status: 'draft' | 'ready' | 'in-progress' | 'completed';
  readonly orderIndex: number;
  readonly createdAt: string;
}

const emptyTaskPaneView = () => ({
  rows: [],
  taskIds: [],
  repositoryIds: [],
  actions: [],
  actionCells: [],
  top: 0,
  selectedRepositoryId: null,
});

function createWorkspace(): WorkspaceModel {
  return new WorkspaceModel({
    activeDirectoryId: 'dir-1',
    leftNavSelection: {
      kind: 'home',
    },
    latestTaskPaneView: emptyTaskPaneView(),
    taskDraftComposer: {
      text: '',
      cursor: 0,
    },
    repositoriesCollapsed: false,
  });
}

void test('runtime right-pane renderer resets task view and renders conversation frame rows', () => {
  const workspace = createWorkspace();
  workspace.latestTaskPaneView = {
    ...emptyTaskPaneView(),
    rows: ['stale'],
  };
  const taskManager = new TaskManager<TaskRecord, TaskComposerBuffer, NodeJS.Timeout>();
  const render = new RuntimeRightPaneRender<RepoRecord, TaskRecord>({
    workspace,
    showTasks: true,
    repositories: new Map(),
    taskManager,
    conversationPane: {
      render: () => ['conversation-row'],
    },
    homePane: {
      render: () => {
        throw new Error('homePane.render should not run for frame render');
      },
    },
    projectPane: {
      render: () => {
        throw new Error('projectPane.render should not run for frame render');
      },
    },
    nimPane: {
      render: () => {
        throw new Error('nimPane.render should not run for frame render');
      },
    },
    getNimViewModel: () => ({
      sessionId: null,
      status: 'idle',
      uiMode: 'debug',
      composerText: '',
      queuedCount: 0,
      transcriptLines: [],
      assistantDraftText: '',
    }),
    refreshProjectPaneSnapshot: () => null,
    emptyTaskPaneView,
  });

  const rows = render.renderRightRows({
    layout: {
      rightCols: 20,
      paneRows: 4,
    },
    rightFrame: {} as Parameters<typeof render.renderRightRows>[0]['rightFrame'],
    homePaneActive: false,
    nimPaneActive: false,
    projectPaneActive: false,
    activeDirectoryId: null,
  });

  assert.deepEqual(rows, ['conversation-row']);
  assert.deepEqual(workspace.latestTaskPaneView, emptyTaskPaneView());
});

void test('runtime right-pane renderer delegates home-pane render and updates workspace selection + scroll', () => {
  const workspace = createWorkspace();
  workspace.taskPaneSelectedRepositoryId = 'repo-prev';
  workspace.taskPaneScrollTop = 2;
  const taskManager = new TaskManager<TaskRecord, TaskComposerBuffer, NodeJS.Timeout>();
  const repositories = new Map<string, RepoRecord>([
    ['repo-1', { repositoryId: 'repo-1', name: 'Repo 1', archivedAt: null }],
  ]);
  const expectedView = {
    rows: ['home-row'],
    taskIds: [null],
    repositoryIds: ['repo-1'],
    actions: [null],
    actionCells: [null],
    top: 7,
    selectedRepositoryId: 'repo-1',
  } as const;
  const showTaskPlanningUiCalls: boolean[] = [];
  const render = new RuntimeRightPaneRender<RepoRecord, TaskRecord>({
    workspace,
    showTasks: true,
    repositories,
    taskManager,
    conversationPane: {
      render: () => {
        throw new Error('conversationPane.render should not run for home render');
      },
    },
    homePane: {
      render: (input) => {
        showTaskPlanningUiCalls.push(input.showTaskPlanningUi === true);
        return expectedView;
      },
    },
    projectPane: {
      render: () => {
        throw new Error('projectPane.render should not run for home render');
      },
    },
    nimPane: {
      render: () => {
        throw new Error('nimPane.render should not run for home render');
      },
    },
    getNimViewModel: () => ({
      sessionId: null,
      status: 'idle',
      uiMode: 'debug',
      composerText: '',
      queuedCount: 0,
      transcriptLines: [],
      assistantDraftText: '',
    }),
    refreshProjectPaneSnapshot: () => null,
    emptyTaskPaneView,
  });

  const rows = render.renderRightRows({
    layout: {
      rightCols: 20,
      paneRows: 4,
    },
    rightFrame: null,
    homePaneActive: true,
    nimPaneActive: false,
    projectPaneActive: false,
    activeDirectoryId: 'dir-1',
  });

  assert.deepEqual(rows, ['home-row']);
  assert.deepEqual(showTaskPlanningUiCalls, [false]);
  assert.equal(workspace.taskPaneSelectedRepositoryId, 'repo-1');
  assert.equal(workspace.taskPaneScrollTop, 7);
  assert.deepEqual(workspace.latestTaskPaneView, expectedView);
});

void test('runtime right-pane renderer enables task-planning view only when tasks is selected', () => {
  const workspace = createWorkspace();
  workspace.leftNavSelection = {
    kind: 'tasks',
  };
  const taskManager = new TaskManager<TaskRecord, TaskComposerBuffer, NodeJS.Timeout>();
  const showTaskPlanningUiCalls: boolean[] = [];
  const render = new RuntimeRightPaneRender<RepoRecord, TaskRecord>({
    workspace,
    showTasks: true,
    repositories: new Map(),
    taskManager,
    conversationPane: {
      render: () => {
        throw new Error('conversationPane.render should not run for home render');
      },
    },
    homePane: {
      render: (input) => {
        showTaskPlanningUiCalls.push(input.showTaskPlanningUi === true);
        return {
          rows: ['tasks-row'],
          taskIds: [null],
          repositoryIds: [null],
          actions: [null],
          actionCells: [null],
          top: 0,
          selectedRepositoryId: null,
        };
      },
    },
    projectPane: {
      render: () => {
        throw new Error('projectPane.render should not run for home render');
      },
    },
    nimPane: {
      render: () => {
        throw new Error('nimPane.render should not run for home render');
      },
    },
    getNimViewModel: () => ({
      sessionId: null,
      status: 'idle',
      uiMode: 'debug',
      composerText: '',
      queuedCount: 0,
      transcriptLines: [],
      assistantDraftText: '',
    }),
    refreshProjectPaneSnapshot: () => null,
    emptyTaskPaneView,
  });

  const rows = render.renderRightRows({
    layout: {
      rightCols: 20,
      paneRows: 4,
    },
    rightFrame: null,
    homePaneActive: true,
    nimPaneActive: false,
    projectPaneActive: false,
    activeDirectoryId: null,
  });

  assert.deepEqual(rows, ['tasks-row']);
  assert.deepEqual(showTaskPlanningUiCalls, [true]);
});

void test('runtime right-pane renderer keeps task-planning hidden when tasks are disabled in config', () => {
  const workspace = createWorkspace();
  workspace.leftNavSelection = {
    kind: 'tasks',
  };
  const taskManager = new TaskManager<TaskRecord, TaskComposerBuffer, NodeJS.Timeout>();
  const showTaskPlanningUiCalls: boolean[] = [];
  const render = new RuntimeRightPaneRender<RepoRecord, TaskRecord>({
    workspace,
    showTasks: false,
    repositories: new Map(),
    taskManager,
    conversationPane: {
      render: () => {
        throw new Error('conversationPane.render should not run for home render');
      },
    },
    homePane: {
      render: (input) => {
        showTaskPlanningUiCalls.push(input.showTaskPlanningUi === true);
        return {
          rows: ['tasks-row'],
          taskIds: [null],
          repositoryIds: [null],
          actions: [null],
          actionCells: [null],
          top: 0,
          selectedRepositoryId: null,
        };
      },
    },
    projectPane: {
      render: () => {
        throw new Error('projectPane.render should not run for home render');
      },
    },
    nimPane: {
      render: () => {
        throw new Error('nimPane.render should not run for home render');
      },
    },
    getNimViewModel: () => ({
      sessionId: null,
      status: 'idle',
      uiMode: 'debug',
      composerText: '',
      queuedCount: 0,
      transcriptLines: [],
      assistantDraftText: '',
    }),
    refreshProjectPaneSnapshot: () => null,
    emptyTaskPaneView,
  });

  const rows = render.renderRightRows({
    layout: {
      rightCols: 20,
      paneRows: 4,
    },
    rightFrame: null,
    homePaneActive: true,
    nimPaneActive: false,
    projectPaneActive: false,
    activeDirectoryId: null,
  });

  assert.deepEqual(rows, ['tasks-row']);
  assert.deepEqual(showTaskPlanningUiCalls, [false]);
});

void test('runtime right-pane renderer refreshes project snapshot once and reuses it for subsequent project renders', () => {
  const workspace = createWorkspace();
  const taskManager = new TaskManager<TaskRecord, TaskComposerBuffer, NodeJS.Timeout>();
  const refreshCalls: string[] = [];
  const projectRenderSnapshots: Array<ProjectPaneSnapshot | null> = [];
  const snapshot: ProjectPaneSnapshot = {
    directoryId: 'dir-1',
    path: '/repo/dir-1',
    lines: [],
    actionBySourceLineIndex: {},
    actionLineIndexByKind: {
      conversationNew: 0,
      projectClose: 1,
    },
  };
  const render = new RuntimeRightPaneRender<RepoRecord, TaskRecord>({
    workspace,
    showTasks: true,
    repositories: new Map(),
    taskManager,
    conversationPane: {
      render: () => {
        throw new Error('conversationPane.render should not run for project render');
      },
    },
    homePane: {
      render: () => {
        throw new Error('homePane.render should not run for project render');
      },
    },
    projectPane: {
      render: (input) => {
        projectRenderSnapshots.push(input.snapshot);
        return {
          rows: ['project-row'],
          scrollTop: input.scrollTop + 1,
        };
      },
    },
    nimPane: {
      render: () => {
        throw new Error('nimPane.render should not run for project render');
      },
    },
    getNimViewModel: () => ({
      sessionId: null,
      status: 'idle',
      uiMode: 'debug',
      composerText: '',
      queuedCount: 0,
      transcriptLines: [],
      assistantDraftText: '',
    }),
    refreshProjectPaneSnapshot: (directoryId) => {
      refreshCalls.push(directoryId);
      return snapshot;
    },
    emptyTaskPaneView,
  });

  const firstRows = render.renderRightRows({
    layout: {
      rightCols: 20,
      paneRows: 4,
    },
    rightFrame: null,
    homePaneActive: false,
    nimPaneActive: false,
    projectPaneActive: true,
    activeDirectoryId: 'dir-1',
  });
  const secondRows = render.renderRightRows({
    layout: {
      rightCols: 20,
      paneRows: 4,
    },
    rightFrame: null,
    homePaneActive: false,
    nimPaneActive: false,
    projectPaneActive: true,
    activeDirectoryId: 'dir-1',
  });

  assert.deepEqual(firstRows, ['project-row']);
  assert.deepEqual(secondRows, ['project-row']);
  assert.deepEqual(refreshCalls, ['dir-1']);
  assert.deepEqual(projectRenderSnapshots, [snapshot, snapshot]);
  assert.equal(workspace.projectPaneScrollTop, 2);
  assert.equal(workspace.projectPaneSnapshot, snapshot);
});

void test('runtime right-pane renderer falls back to blank rows when no pane branch applies', () => {
  const workspace = createWorkspace();
  const taskManager = new TaskManager<TaskRecord, TaskComposerBuffer, NodeJS.Timeout>();
  const render = new RuntimeRightPaneRender<RepoRecord, TaskRecord>({
    workspace,
    showTasks: true,
    repositories: new Map(),
    taskManager,
    conversationPane: {
      render: () => ['unexpected'],
    },
    homePane: {
      render: () => ({
        rows: ['unexpected'],
        taskIds: [null],
        repositoryIds: [null],
        actions: [null],
        actionCells: [null],
        top: 0,
        selectedRepositoryId: null,
      }),
    },
    projectPane: {
      render: () => ({
        rows: ['unexpected'],
        scrollTop: 0,
      }),
    },
    nimPane: {
      render: () => ({
        rows: ['unexpected'],
      }),
    },
    getNimViewModel: () => ({
      sessionId: null,
      status: 'idle',
      uiMode: 'debug',
      composerText: '',
      queuedCount: 0,
      transcriptLines: [],
      assistantDraftText: '',
    }),
    refreshProjectPaneSnapshot: () => null,
    emptyTaskPaneView,
  });

  const rows = render.renderRightRows({
    layout: {
      rightCols: 3,
      paneRows: 2,
    },
    rightFrame: null,
    homePaneActive: false,
    nimPaneActive: false,
    projectPaneActive: true,
    activeDirectoryId: null,
  });

  assert.deepEqual(rows, ['   ', '   ']);
});

void test('runtime right-pane renderer delegates nim-pane render when nim pane is active', () => {
  const workspace = createWorkspace();
  const taskManager = new TaskManager<TaskRecord, TaskComposerBuffer, NodeJS.Timeout>();
  const render = new RuntimeRightPaneRender<RepoRecord, TaskRecord>({
    workspace,
    showTasks: true,
    repositories: new Map(),
    taskManager,
    conversationPane: {
      render: () => {
        throw new Error('conversationPane.render should not run for nim render');
      },
    },
    homePane: {
      render: () => {
        throw new Error('homePane.render should not run for nim render');
      },
    },
    projectPane: {
      render: () => {
        throw new Error('projectPane.render should not run for nim render');
      },
    },
    nimPane: {
      render: () => ({
        rows: ['nim-row'],
      }),
    },
    getNimViewModel: () => ({
      sessionId: 'session-nim',
      status: 'responding',
      uiMode: 'debug',
      composerText: 'draft',
      queuedCount: 1,
      transcriptLines: ['nim> hi'],
      assistantDraftText: 'working',
    }),
    refreshProjectPaneSnapshot: () => null,
    emptyTaskPaneView,
  });

  const rows = render.renderRightRows({
    layout: {
      rightCols: 20,
      paneRows: 4,
    },
    rightFrame: null,
    homePaneActive: false,
    nimPaneActive: true,
    projectPaneActive: false,
    activeDirectoryId: null,
  });

  assert.deepEqual(rows, ['nim-row']);
});
