import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { computeDualPaneLayout } from '../src/mux/dual-pane-core.ts';
import type {
  TaskFocusedPaneRepositoryRecord,
  TaskFocusedPaneTaskRecord,
} from '../src/mux/task-focused-pane.ts';
import type { RuntimeLeftRailRender } from '../src/services/runtime-left-rail-render.ts';
import { RuntimeRenderPipeline } from '../src/services/runtime-render-pipeline.ts';
import type { RuntimeRightPaneRender } from '../src/services/runtime-right-pane-render.ts';

interface TestConversation {
  readonly conversationId: string;
}

interface TestDirectory {
  readonly directoryId: string;
}

interface TestRepositorySnapshot {
  readonly refreshedAt: string;
}

interface TestGitSummary {
  readonly branch: string;
}

interface TestProcessUsage {
  readonly cpuPercent: number;
}

type TestRailRows = readonly string[];
type TestStatusRow = { readonly eventLoopLagMs: number };

function createWorkspace(): WorkspaceModel {
  return new WorkspaceModel({
    activeDirectoryId: null,
    leftNavSelection: {
      kind: 'home',
    },
    latestTaskPaneView: {
      rows: [],
      taskIds: [],
      repositoryIds: [],
      actions: [],
      actionCells: [],
      top: 0,
      selectedRepositoryId: null,
    },
    taskDraftComposer: {
      text: '',
      cursor: 0,
    },
    repositoriesCollapsed: false,
  });
}

void test('runtime render pipeline composes underlying render services and delegates render calls', () => {
  const workspace = createWorkspace();
  let clearDirtyCalls = 0;
  const layout = computeDualPaneLayout(120, 40, {
    leftCols: 36,
  });
  type RepoRecord = TaskFocusedPaneRepositoryRecord;
  type TaskRecord = TaskFocusedPaneTaskRecord;
  type RightPaneOptions = ConstructorParameters<
    typeof RuntimeRightPaneRender<RepoRecord, TaskRecord>
  >[0];
  type LeftRailOptions = ConstructorParameters<
    typeof RuntimeLeftRailRender<
      TestDirectory,
      TestConversation,
      RepoRecord,
      TestRepositorySnapshot,
      TestGitSummary,
      TestProcessUsage,
      TestRailRows
    >
  >[0];

  const renderPipeline = new RuntimeRenderPipeline<
    TestConversation,
    RepoRecord,
    TaskRecord,
    TestDirectory,
    TestRepositorySnapshot,
    TestGitSummary,
    TestProcessUsage,
    TestRailRows,
    null,
    TestStatusRow
  >({
    renderFlush: {
      perfNowNs: () => 0n,
      statusFooterForConversation: () => '',
      currentStatusNotice: () => null,
      currentStatusRow: () => ({ eventLoopLagMs: 0 }),
      buildRenderRows: () => [],
      buildModalOverlay: () => null,
      applyModalOverlay: () => {},
      renderSelectionOverlay: () => '',
      flush: () => ({
        changedRowCount: 0,
        wroteOutput: false,
        shouldShowCursor: false,
      }),
      onFlushOutput: () => {},
      recordRenderSample: () => {},
    },
    rightPaneRender: {
      workspace,
      repositories: new Map<string, RepoRecord>(),
      taskManager: {
        readonlyTasks: () => new Map<string, TaskRecord>(),
        readonlyTaskComposers: () => new Map(),
      } as unknown as RightPaneOptions['taskManager'],
      conversationPane: {
        render: () => [],
      },
      homePane: {
        render: () => workspace.latestTaskPaneView,
      },
      projectPane: {
        render: () => ({
          rows: [],
          scrollTop: 0,
        }),
      },
      nimPane: {
        render: () => ({
          rows: [],
        }),
      },
      getNimViewModel: () => ({
        sessionId: null,
        status: 'idle',
        composerText: '',
        queuedCount: 0,
        transcriptLines: [],
        assistantDraftText: '',
      }),
      refreshProjectPaneSnapshot: () => null,
      emptyTaskPaneView: () => workspace.latestTaskPaneView,
    },
    leftRailRender: {
      leftRailPane: {
        render: () => ({
          ansiRows: [],
          viewRows: [],
        }),
      },
      sessionProjectionInstrumentation: {
        refreshSelectorSnapshot: () => {},
      },
      workspace,
      repositoryManager: {
        readonlyCollapsedRepositoryGroupIds: () => new Set<string>(),
      } as unknown as LeftRailOptions['repositoryManager'],
      repositories: new Map<string, RepoRecord>(),
      repositoryAssociationByDirectoryId: new Map<string, string>(),
      directoryRepositorySnapshotByDirectoryId: new Map<string, TestRepositorySnapshot>(),
      directories: new Map<string, TestDirectory>(),
      conversations: new Map<string, TestConversation>(),
      gitSummaryByDirectoryId: new Map<string, TestGitSummary>(),
      processUsageBySessionId: () => new Map<string, TestProcessUsage>(),
      loadingGitSummary: { branch: 'loading' },
      activeConversationId: () => null,
      orderedConversationIds: () => [],
    },
    renderState: {
      workspace,
      hasDirectory: () => false,
      activeConversationId: () => null,
      activeConversation: () => null,
      snapshotFrame: () => {
        throw new Error('snapshotFrame should not be called in this test');
      },
      selectionVisibleRows: () => [],
    },
    isScreenDirty: () => true,
    clearDirty: () => {
      clearDirtyCalls += 1;
    },
    setLatestRailViewRows: () => {},
    activeDirectoryId: () => workspace.activeDirectoryId,
  });

  renderPipeline.render({
    shuttingDown: false,
    layout,
    selection: null,
    selectionDrag: null,
  });

  assert.equal(clearDirtyCalls, 1);
});

void test('runtime render pipeline renders right pane and flushes when render state is available', () => {
  const workspace = createWorkspace();
  workspace.enterHomePane();
  let flushCalls = 0;
  let rightPaneCalls = 0;
  const layout = computeDualPaneLayout(120, 40, {
    leftCols: 36,
  });
  type RepoRecord = TaskFocusedPaneRepositoryRecord;
  type TaskRecord = TaskFocusedPaneTaskRecord;
  type RightPaneOptions = ConstructorParameters<
    typeof RuntimeRightPaneRender<RepoRecord, TaskRecord>
  >[0];
  type LeftRailOptions = ConstructorParameters<
    typeof RuntimeLeftRailRender<
      TestDirectory,
      TestConversation,
      RepoRecord,
      TestRepositorySnapshot,
      TestGitSummary,
      TestProcessUsage,
      TestRailRows
    >
  >[0];

  const renderPipeline = new RuntimeRenderPipeline<
    TestConversation,
    RepoRecord,
    TaskRecord,
    TestDirectory,
    TestRepositorySnapshot,
    TestGitSummary,
    TestProcessUsage,
    TestRailRows,
    null,
    TestStatusRow
  >({
    renderFlush: {
      perfNowNs: () => 0n,
      statusFooterForConversation: () => '',
      currentStatusNotice: () => null,
      currentStatusRow: () => ({ eventLoopLagMs: 0 }),
      buildRenderRows: (_layout, _railRows, rightRows) => Array.from(rightRows),
      buildModalOverlay: () => null,
      applyModalOverlay: (_rows) => null,
      renderSelectionOverlay: () => '',
      flush: () => ({
        changedRowCount: 1,
        wroteOutput: true,
        shouldShowCursor: true,
      }),
      onFlushOutput: () => {
        flushCalls += 1;
      },
      recordRenderSample: () => {},
    },
    rightPaneRender: {
      workspace,
      repositories: new Map<string, RepoRecord>(),
      taskManager: {
        readonlyTasks: () => new Map<string, TaskRecord>(),
        readonlyTaskComposers: () => new Map(),
      } as unknown as RightPaneOptions['taskManager'],
      conversationPane: {
        render: () => {
          rightPaneCalls += 1;
          return ['conversation'];
        },
      },
      homePane: {
        render: () => {
          rightPaneCalls += 1;
          return {
            ...workspace.latestTaskPaneView,
            rows: ['home'],
          };
        },
      },
      projectPane: {
        render: () => ({
          rows: ['project'],
          scrollTop: 0,
        }),
      },
      nimPane: {
        render: () => ({
          rows: ['nim'],
        }),
      },
      getNimViewModel: () => ({
        sessionId: null,
        status: 'idle',
        composerText: '',
        queuedCount: 0,
        transcriptLines: [],
        assistantDraftText: '',
      }),
      refreshProjectPaneSnapshot: () => null,
      emptyTaskPaneView: () => workspace.latestTaskPaneView,
    },
    leftRailRender: {
      leftRailPane: {
        render: () => ({
          ansiRows: [],
          viewRows: [],
        }),
      },
      sessionProjectionInstrumentation: {
        refreshSelectorSnapshot: () => {},
      },
      workspace,
      repositoryManager: {
        readonlyCollapsedRepositoryGroupIds: () => new Set<string>(),
      } as unknown as LeftRailOptions['repositoryManager'],
      repositories: new Map<string, RepoRecord>(),
      repositoryAssociationByDirectoryId: new Map<string, string>(),
      directoryRepositorySnapshotByDirectoryId: new Map<string, TestRepositorySnapshot>(),
      directories: new Map<string, TestDirectory>(),
      conversations: new Map<string, TestConversation>(),
      gitSummaryByDirectoryId: new Map<string, TestGitSummary>(),
      processUsageBySessionId: () => new Map<string, TestProcessUsage>(),
      loadingGitSummary: { branch: 'loading' },
      activeConversationId: () => null,
      orderedConversationIds: () => [],
    },
    renderState: {
      workspace,
      hasDirectory: () => false,
      activeConversationId: () => null,
      activeConversation: () => null,
      snapshotFrame: () => {
        throw new Error('snapshotFrame should not be called in this test');
      },
      selectionVisibleRows: () => [],
    },
    isScreenDirty: () => true,
    clearDirty: () => {},
    setLatestRailViewRows: () => {},
    activeDirectoryId: () => workspace.activeDirectoryId,
  });

  renderPipeline.render({
    shuttingDown: false,
    layout,
    selection: null,
    selectionDrag: null,
  });

  assert.equal(rightPaneCalls, 1);
  assert.equal(flushCalls, 1);
});
