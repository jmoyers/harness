import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../../../../src/domain/workspace.ts';
import { RepositoryManager } from '../../../../src/domain/repositories.ts';
import {
  renderRuntimeLeftRail,
  type RuntimeLeftRailRenderLayout,
  type RuntimeLeftRailRenderOptions,
} from '../../../../src/services/runtime-left-rail-render.ts';

interface DirectoryRecord {
  readonly directoryId: string;
}

interface ConversationRecord {
  readonly sessionId: string;
}

interface RepositoryRecord {
  readonly repositoryId: string;
}

interface RepositorySnapshot {
  readonly kind: string;
}

interface GitSummaryRecord {
  readonly branch: string;
}

interface ProcessUsageRecord {
  readonly pid: number;
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

void test('runtime left-rail renderer refreshes selector snapshot and delegates left-rail render with workspace state', () => {
  const workspace = new WorkspaceModel({
    activeDirectoryId: 'dir-1',
    leftNavSelection: {
      kind: 'project',
      directoryId: 'dir-1',
    },
    latestTaskPaneView: emptyTaskPaneView(),
    taskDraftComposer: {
      text: '',
      cursor: 0,
    },
    repositoriesCollapsed: false,
  });
  workspace.activeRepositorySelectionId = 'repo-1';

  const repositoryManager = new RepositoryManager<RepositoryRecord, RepositorySnapshot>();
  repositoryManager.collapseRepositoryGroup('repo-1', false);

  const directories = new Map<string, DirectoryRecord>([['dir-1', { directoryId: 'dir-1' }]]);
  const conversations = new Map<string, ConversationRecord>([
    ['session-1', { sessionId: 'session-1' }],
  ]);
  const repositories = new Map<string, RepositoryRecord>([['repo-1', { repositoryId: 'repo-1' }]]);
  const repositoryAssociationByDirectoryId = new Map<string, string>([['dir-1', 'repo-1']]);
  const directoryRepositorySnapshotByDirectoryId = new Map<string, RepositorySnapshot>([
    ['dir-1', { kind: 'git' }],
  ]);
  const gitSummaryByDirectoryId = new Map<string, GitSummaryRecord>([
    ['dir-1', { branch: 'main' }],
  ]);
  const processUsageBySessionId = new Map<string, ProcessUsageRecord>([
    ['session-1', { pid: 123 }],
  ]);
  const orderedConversationIds = ['session-1'];

  const refreshCalls: Array<{
    source: 'render' | 'observed';
    orderedConversationIds: readonly string[];
  }> = [];
  let leftRailRenderInput: RuntimeLeftRailRenderLayout | null = null;

  const options: RuntimeLeftRailRenderOptions<
    DirectoryRecord,
    ConversationRecord,
    RepositoryRecord,
    RepositorySnapshot,
    GitSummaryRecord,
    ProcessUsageRecord,
    readonly string[]
  > = {
    leftRailPane: {
      render: (input: { layout: RuntimeLeftRailRenderLayout }) => {
        leftRailRenderInput = input.layout;
        return {
          ansiRows: ['ansi-row'],
          viewRows: ['view-row'],
        };
      },
    },
    sessionProjectionInstrumentation: {
      refreshSelectorSnapshot: (source, _dirs, _convos, orderedIds) => {
        refreshCalls.push({
          source,
          orderedConversationIds: orderedIds,
        });
      },
    },
    workspace,
    repositoryManager,
    repositoryAssociationByDirectoryId,
    directoryRepositorySnapshotByDirectoryId,
    gitSummaryByDirectoryId,
    loadingGitSummary: {
      branch: '(loading)',
    },
    showTasksEntry: true,
  };

  const result = renderRuntimeLeftRail(options, {
    layout: {
      cols: 100,
      paneRows: 20,
      leftCols: 30,
      rightCols: 69,
      separatorCol: 31,
      rightStartCol: 32,
    },
    snapshot: {
      repositories,
      directories,
      conversations,
      orderedConversationIds,
      processUsageBySessionId,
      activeConversationId: 'session-1',
    },
  });

  assert.deepEqual(result, {
    ansiRows: ['ansi-row'],
    viewRows: ['view-row'],
  });
  assert.deepEqual(refreshCalls, [
    {
      source: 'render',
      orderedConversationIds: ['session-1'],
    },
  ]);
  assert.deepEqual(leftRailRenderInput, {
    cols: 100,
    paneRows: 20,
    leftCols: 30,
    rightCols: 69,
    separatorCol: 31,
    rightStartCol: 32,
  });
});

void test('runtime left-rail renderer forwards optional github visibility sets when configured', () => {
  const workspace = new WorkspaceModel({
    activeDirectoryId: 'dir-1',
    leftNavSelection: {
      kind: 'github',
      directoryId: 'dir-1',
    },
    latestTaskPaneView: emptyTaskPaneView(),
    taskDraftComposer: {
      text: '',
      cursor: 0,
    },
    repositoriesCollapsed: false,
  });

  const repositoryManager = new RepositoryManager<RepositoryRecord, RepositorySnapshot>();
  const visibleGitHubDirectoryIds = new Set<string>(['dir-1']);
  const expandedGitHubDirectoryIds = new Set<string>(['dir-1']);

  let capturedInput: {
    visibleGitHubDirectoryIds: ReadonlySet<string> | undefined;
    expandedGitHubDirectoryIds: ReadonlySet<string> | undefined;
    githubSelectionEnabled: boolean;
    activeGitHubProjectId: string | null;
  } | null = null;

  const result = renderRuntimeLeftRail(
    {
      leftRailPane: {
        render: (input) => {
          capturedInput = {
            visibleGitHubDirectoryIds: input.visibleGitHubDirectoryIds,
            expandedGitHubDirectoryIds: input.expandedGitHubDirectoryIds,
            githubSelectionEnabled: input.githubSelectionEnabled,
            activeGitHubProjectId: input.activeGitHubProjectId,
          };
          return {
            ansiRows: [],
            viewRows: [],
          };
        },
      },
      sessionProjectionInstrumentation: {
        refreshSelectorSnapshot: () => {},
      },
      workspace,
      repositoryManager,
      repositoryAssociationByDirectoryId: new Map([['dir-1', 'repo-1']]),
      directoryRepositorySnapshotByDirectoryId: new Map([['dir-1', { kind: 'git' }]]),
      gitSummaryByDirectoryId: new Map([['dir-1', { branch: 'main' }]]),
      loadingGitSummary: { branch: '(loading)' },
      visibleGitHubDirectoryIds,
      expandedGitHubDirectoryIds,
    },
    {
      layout: {
        cols: 80,
        paneRows: 20,
        leftCols: 24,
        rightCols: 55,
        separatorCol: 24,
        rightStartCol: 25,
      },
      snapshot: {
        repositories: new Map([['repo-1', { repositoryId: 'repo-1' }]]),
        directories: new Map([['dir-1', { directoryId: 'dir-1' }]]),
        conversations: new Map([['session-1', { sessionId: 'session-1' }]]),
        orderedConversationIds: ['session-1'],
        processUsageBySessionId: new Map([['session-1', { pid: 1 }]]),
        activeConversationId: 'session-1',
      },
    },
  );

  assert.deepEqual(result, {
    ansiRows: [],
    viewRows: [],
  });
  assert.deepEqual(capturedInput, {
    visibleGitHubDirectoryIds,
    expandedGitHubDirectoryIds,
    githubSelectionEnabled: true,
    activeGitHubProjectId: 'dir-1',
  });
});
