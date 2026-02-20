import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { RepositoryManager } from '../src/domain/repositories.ts';
import { RuntimeLeftRailRender } from '../src/services/runtime-left-rail-render.ts';

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

interface ShortcutBindingsRecord {
  readonly byAction: ReadonlyMap<string, string>;
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
    shortcutsCollapsed: true,
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
  const shortcutBindings: ShortcutBindingsRecord = {
    byAction: new Map([['mux.app.quit', 'ctrl+c']]),
  };
  const orderedConversationIds = ['session-1'];

  const refreshCalls: Array<{
    source: 'render' | 'observed';
    orderedConversationIds: readonly string[];
  }> = [];
  let leftRailRenderInput:
    | Parameters<
        RuntimeLeftRailRender<
          DirectoryRecord,
          ConversationRecord,
          RepositoryRecord,
          RepositorySnapshot,
          GitSummaryRecord,
          ProcessUsageRecord,
          ShortcutBindingsRecord,
          readonly string[]
        >['render']
      >[0]
    | null = null;

  const service = new RuntimeLeftRailRender<
    DirectoryRecord,
    ConversationRecord,
    RepositoryRecord,
    RepositorySnapshot,
    GitSummaryRecord,
    ProcessUsageRecord,
    ShortcutBindingsRecord,
    readonly string[]
  >({
    leftRailPane: {
      render: (input) => {
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
    repositories,
    repositoryAssociationByDirectoryId,
    directoryRepositorySnapshotByDirectoryId,
    directories,
    conversations,
    gitSummaryByDirectoryId,
    processUsageBySessionId: () => processUsageBySessionId,
    shortcutBindings,
    loadingGitSummary: {
      branch: '(loading)',
    },
    showTasksEntry: true,
    activeConversationId: () => 'session-1',
    orderedConversationIds: () => orderedConversationIds,
  });

  const result = service.render({
    cols: 100,
    paneRows: 20,
    leftCols: 30,
    rightCols: 69,
    separatorCol: 31,
    rightStartCol: 32,
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
