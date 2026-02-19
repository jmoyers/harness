import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { runTaskPaneAction } from '../src/mux/live-mux/actions-task.ts';
import {
  applyObservedGitStatusEvent,
  deleteDirectoryGitState,
} from '../src/mux/live-mux/git-state.ts';
import { handleHomePaneEntityClick } from '../src/mux/live-mux/home-pane-entity-click.ts';
import { handleHomePanePointerClick } from '../src/mux/live-mux/home-pane-pointer.ts';
import {
  activateLeftNavTarget,
  cycleLeftNavSelection,
} from '../src/mux/live-mux/left-nav-activation.ts';
import { handleLeftRailActionClick } from '../src/mux/live-mux/left-rail-actions.ts';
import { handleLeftRailConversationClick } from '../src/mux/live-mux/left-rail-conversation-click.ts';
import {
  readObservedStreamCursorBaseline,
  subscribeObservedStream,
  unsubscribeObservedStream,
} from '../src/mux/live-mux/observed-stream.ts';
import {
  handleHomePaneDragMove,
  handleMainPaneWheelInput,
  handlePaneDividerDragInput,
  handleSeparatorPointerPress,
} from '../src/mux/live-mux/pointer-routing.ts';
import type { LeftNavSelection } from '../src/mux/live-mux/left-nav.ts';
import type { StreamCommand, StreamObservedEvent } from '../src/control-plane/stream-protocol.ts';

void test('runTaskPaneAction covers repository/task action routing and reorder branches', () => {
  const calls: string[] = [];
  const base = {
    openTaskCreatePrompt: () => {
      calls.push('openTaskCreatePrompt');
    },
    openRepositoryPromptForCreate: () => {
      calls.push('openRepositoryPromptForCreate');
    },
    selectedRepositoryId: 'repo-a' as string | null,
    repositoryExists: (repositoryId: string) => repositoryId === 'repo-a',
    setTaskPaneNotice: (notice: string | null) => {
      calls.push(`setTaskPaneNotice:${String(notice)}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    setTaskPaneSelectionFocus: (focus: 'task' | 'repository') => {
      calls.push(`setTaskPaneSelectionFocus:${focus}`);
    },
    openRepositoryPromptForEdit: (repositoryId: string) => {
      calls.push(`openRepositoryPromptForEdit:${repositoryId}`);
    },
    queueArchiveRepository: (repositoryId: string) => {
      calls.push(`queueArchiveRepository:${repositoryId}`);
    },
    selectedTask: { taskId: 'task-a', status: 'ready' } as {
      taskId: string;
      status: string;
    } | null,
    openTaskEditPrompt: (taskId: string) => {
      calls.push(`openTaskEditPrompt:${taskId}`);
    },
    queueDeleteTask: (taskId: string) => {
      calls.push(`queueDeleteTask:${taskId}`);
    },
    queueTaskReady: (taskId: string) => {
      calls.push(`queueTaskReady:${taskId}`);
    },
    queueTaskDraft: (taskId: string) => {
      calls.push(`queueTaskDraft:${taskId}`);
    },
    queueTaskComplete: (taskId: string) => {
      calls.push(`queueTaskComplete:${taskId}`);
    },
    orderedTaskRecords: () =>
      [
        { taskId: 'task-a', status: 'ready' },
        { taskId: 'task-b', status: 'ready' },
        { taskId: 'task-c', status: 'completed' },
      ] as const,
    queueTaskReorderByIds: (orderedTaskIds: readonly string[], label: string) => {
      calls.push(`queueTaskReorderByIds:${label}:${orderedTaskIds.join(',')}`);
    },
  };

  runTaskPaneAction({ ...base, action: 'task.create' });
  runTaskPaneAction({ ...base, action: 'repository.create' });
  runTaskPaneAction({ ...base, action: 'repository.edit' });
  runTaskPaneAction({ ...base, action: 'repository.archive' });
  runTaskPaneAction({ ...base, action: 'task.edit' });
  runTaskPaneAction({ ...base, action: 'task.delete' });
  runTaskPaneAction({ ...base, action: 'task.ready' });
  runTaskPaneAction({ ...base, action: 'task.draft' });
  runTaskPaneAction({ ...base, action: 'task.complete' });
  runTaskPaneAction({ ...base, action: 'task.reorder-down' });

  assert.equal(calls.includes('openTaskCreatePrompt'), true);
  assert.equal(calls.includes('openRepositoryPromptForCreate'), true);
  assert.equal(calls.includes('openRepositoryPromptForEdit:repo-a'), true);
  assert.equal(calls.includes('queueArchiveRepository:repo-a'), true);
  assert.equal(calls.includes('openTaskEditPrompt:task-a'), true);
  assert.equal(calls.includes('queueDeleteTask:task-a'), true);
  assert.equal(calls.includes('queueTaskReady:task-a'), true);
  assert.equal(calls.includes('queueTaskDraft:task-a'), true);
  assert.equal(calls.includes('queueTaskComplete:task-a'), true);
  assert.equal(calls.includes('queueTaskReorderByIds:tasks-reorder-down:task-b,task-a'), true);

  calls.length = 0;
  runTaskPaneAction({
    ...base,
    action: 'repository.edit',
    selectedRepositoryId: 'missing',
    repositoryExists: () => false,
  });
  runTaskPaneAction({
    ...base,
    action: 'repository.archive',
    selectedRepositoryId: null,
  });
  runTaskPaneAction({
    ...base,
    action: 'task.edit',
    selectedTask: null,
  });
  runTaskPaneAction({
    ...base,
    action: 'task.reorder-up',
    selectedTask: { taskId: 'task-c', status: 'completed' },
  });
  runTaskPaneAction({
    ...base,
    action: 'task.reorder-up',
    selectedTask: { taskId: 'task-a', status: 'ready' },
  });
  assert.equal(calls.includes('setTaskPaneNotice:select a repository first'), true);
  assert.equal(calls.includes('setTaskPaneNotice:select a task first'), true);
  assert.equal(calls.includes('setTaskPaneNotice:cannot reorder completed tasks'), true);
  assert.equal(calls.includes('markDirty'), true);
});

void test('git-state helpers delete directory state and apply observed updates', () => {
  const summaryMap = new Map([
    [
      'dir-a',
      {
        branch: 'main',
        changedFiles: 1,
        additions: 2,
        deletions: 3,
      },
    ],
  ]);
  const snapshotMap = new Map([
    [
      'dir-a',
      {
        normalizedRemoteUrl: 'https://example.com/repo.git',
        commitCount: 4,
        lastCommitAt: '2026-02-18T00:00:00.000Z',
        shortCommitHash: 'abc1234',
        inferredName: 'repo',
        defaultBranch: 'main',
      },
    ],
  ]);
  const associationMap = new Map([['dir-a', 'repo-a']]);
  deleteDirectoryGitState('dir-a', summaryMap, snapshotMap, associationMap);
  assert.equal(summaryMap.has('dir-a'), false);
  assert.equal(snapshotMap.has('dir-a'), false);
  assert.equal(associationMap.has('dir-a'), false);

  const repositories = new Map<string, { repositoryId: string; name: string }>();
  const loadingSummary = {
    branch: '(loading...)',
    changedFiles: 0,
    additions: 0,
    deletions: 0,
  };
  const emptySnapshot = {
    normalizedRemoteUrl: null,
    commitCount: null,
    lastCommitAt: null,
    shortCommitHash: null,
    inferredName: null,
    defaultBranch: null,
  };

  const ignored = applyObservedGitStatusEvent({
    enabled: false,
    observed: {
      type: 'session-output',
    } as unknown as StreamObservedEvent,
    gitSummaryByDirectoryId: summaryMap,
    loadingSummary,
    directoryRepositorySnapshotByDirectoryId: snapshotMap,
    emptyRepositorySnapshot: emptySnapshot,
    repositoryAssociationByDirectoryId: associationMap,
    repositories,
    parseRepositoryRecord: () => null,
    repositoryRecordChanged: () => false,
  });
  assert.deepEqual(ignored, { handled: false, changed: false, repositoryRecordChanged: false });

  const changed = applyObservedGitStatusEvent({
    enabled: true,
    observed: {
      type: 'directory-git-updated',
      directoryId: 'dir-a',
      summary: {
        branch: 'main',
        changedFiles: 1,
        additions: 2,
        deletions: 3,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: 'https://example.com/repo.git',
        commitCount: 4,
        lastCommitAt: '2026-02-18T00:00:00.000Z',
        shortCommitHash: 'abc1234',
        inferredName: 'repo',
        defaultBranch: 'main',
      },
      repositoryId: 'repo-a',
      repository: {
        repositoryId: 'repo-a',
        name: 'Repo A',
      },
      observedAt: '2026-02-18T00:00:00.000Z',
    } as const satisfies StreamObservedEvent,
    gitSummaryByDirectoryId: summaryMap,
    loadingSummary,
    directoryRepositorySnapshotByDirectoryId: snapshotMap,
    emptyRepositorySnapshot: emptySnapshot,
    repositoryAssociationByDirectoryId: associationMap,
    repositories,
    parseRepositoryRecord: (input) => {
      const record = input as { repositoryId: string; name: string };
      return { repositoryId: record.repositoryId, name: record.name };
    },
    repositoryRecordChanged: (previous, next) => previous?.name !== next.name,
  });
  assert.deepEqual(changed, { handled: true, changed: true, repositoryRecordChanged: true });
  assert.equal(associationMap.get('dir-a'), 'repo-a');
  assert.equal(repositories.get('repo-a')?.name, 'Repo A');

  const unchanged = applyObservedGitStatusEvent({
    enabled: true,
    observed: {
      type: 'directory-git-updated',
      directoryId: 'dir-a',
      summary: {
        branch: 'main',
        changedFiles: 1,
        additions: 2,
        deletions: 3,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: 'https://example.com/repo.git',
        commitCount: 4,
        lastCommitAt: '2026-02-18T00:00:00.000Z',
        shortCommitHash: 'abc1234',
        inferredName: 'repo',
        defaultBranch: 'main',
      },
      repositoryId: null,
      repository: null,
      observedAt: '2026-02-18T00:00:00.000Z',
    } as const satisfies StreamObservedEvent,
    gitSummaryByDirectoryId: summaryMap,
    loadingSummary,
    directoryRepositorySnapshotByDirectoryId: snapshotMap,
    emptyRepositorySnapshot: emptySnapshot,
    repositoryAssociationByDirectoryId: associationMap,
    repositories,
    parseRepositoryRecord: () => null,
    repositoryRecordChanged: () => false,
  });
  assert.deepEqual(unchanged, { handled: true, changed: true, repositoryRecordChanged: false });
  assert.equal(associationMap.has('dir-a'), false);
});

void test('home pane entity click handles task/repository single+double click and no-entity branch', () => {
  const calls: string[] = [];
  const common = {
    rowIndex: 2,
    nowMs: 1000,
    homePaneEditDoubleClickWindowMs: 250,
    taskEditClickState: null as { entityId: string; atMs: number } | null,
    repositoryEditClickState: null as { entityId: string; atMs: number } | null,
    taskIdAtRow: () => 'task-a' as string | null,
    repositoryIdAtRow: () => null as string | null,
    selectTaskById: (taskId: string) => {
      calls.push(`selectTaskById:${taskId}`);
    },
    selectRepositoryById: (repositoryId: string) => {
      calls.push(`selectRepositoryById:${repositoryId}`);
    },
    clearTaskPaneNotice: () => {
      calls.push('clearTaskPaneNotice');
    },
    setTaskEditClickState: (next: { entityId: string; atMs: number } | null) => {
      calls.push(`setTaskEditClickState:${next?.entityId ?? 'null'}`);
    },
    setRepositoryEditClickState: (next: { entityId: string; atMs: number } | null) => {
      calls.push(`setRepositoryEditClickState:${next?.entityId ?? 'null'}`);
    },
    setHomePaneDragState: (next: { kind: 'task' | 'repository'; itemId: string } | null) => {
      calls.push(`setHomePaneDragState:${next?.kind ?? 'null'}`);
    },
    openTaskEditPrompt: (taskId: string) => {
      calls.push(`openTaskEditPrompt:${taskId}`);
    },
    openRepositoryPromptForEdit: (repositoryId: string) => {
      calls.push(`openRepositoryPromptForEdit:${repositoryId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  };
  assert.equal(handleHomePaneEntityClick(common), true);
  assert.equal(calls.includes('setHomePaneDragState:task'), true);
  calls.length = 0;

  assert.equal(
    handleHomePaneEntityClick({
      ...common,
      taskEditClickState: { entityId: 'task-a', atMs: 900 },
      nowMs: 1000,
    }),
    true,
  );
  assert.equal(calls.includes('setHomePaneDragState:null'), true);
  assert.equal(calls.includes('openTaskEditPrompt:task-a'), true);
  calls.length = 0;

  assert.equal(
    handleHomePaneEntityClick({
      ...common,
      taskIdAtRow: () => null,
      repositoryIdAtRow: () => 'repo-a',
      repositoryEditClickState: null,
    }),
    true,
  );
  assert.equal(calls.includes('setHomePaneDragState:repository'), true);
  calls.length = 0;

  assert.equal(
    handleHomePaneEntityClick({
      ...common,
      taskIdAtRow: () => null,
      repositoryIdAtRow: () => 'repo-a',
      repositoryEditClickState: { entityId: 'repo-a', atMs: 950 },
    }),
    true,
  );
  assert.equal(calls.includes('openRepositoryPromptForEdit:repo-a'), true);
  calls.length = 0;

  assert.equal(
    handleHomePaneEntityClick({
      ...common,
      taskIdAtRow: () => null,
      repositoryIdAtRow: () => null,
    }),
    false,
  );
  assert.deepEqual(calls, [
    'setTaskEditClickState:null',
    'setRepositoryEditClickState:null',
    'setHomePaneDragState:null',
  ]);
});

void test('home pane pointer click routes action-first then entity handlers', () => {
  const calls: string[] = [];
  const common = {
    clickEligible: true,
    paneRows: 10,
    rightCols: 20,
    rightStartCol: 5,
    pointerRow: 2,
    pointerCol: 7,
    actionAtCell: () => null as string | null,
    actionAtRow: () => null as string | null,
    clearTaskEditClickState: () => {
      calls.push('clearTaskEditClickState');
    },
    clearRepositoryEditClickState: () => {
      calls.push('clearRepositoryEditClickState');
    },
    clearHomePaneDragState: () => {
      calls.push('clearHomePaneDragState');
    },
    getTaskRepositoryDropdownOpen: () => false,
    setTaskRepositoryDropdownOpen: (open: boolean) => {
      calls.push(`setTaskRepositoryDropdownOpen:${String(open)}`);
    },
    taskIdAtRow: () => 'task-a' as string | null,
    repositoryIdAtRow: () => null as string | null,
    selectTaskById: (taskId: string) => {
      calls.push(`selectTaskById:${taskId}`);
    },
    selectRepositoryById: (repositoryId: string) => {
      calls.push(`selectRepositoryById:${repositoryId}`);
    },
    runTaskPaneAction: (action: 'task.ready' | 'task.draft' | 'task.complete') => {
      calls.push(`runTaskPaneAction:${action}`);
    },
    nowMs: 1000,
    homePaneEditDoubleClickWindowMs: 250,
    taskEditClickState: null as { entityId: string; atMs: number } | null,
    repositoryEditClickState: null as { entityId: string; atMs: number } | null,
    clearTaskPaneNotice: () => {
      calls.push('clearTaskPaneNotice');
    },
    setTaskEditClickState: () => {
      calls.push('setTaskEditClickState');
    },
    setRepositoryEditClickState: () => {
      calls.push('setRepositoryEditClickState');
    },
    setHomePaneDragState: () => {
      calls.push('setHomePaneDragState');
    },
    openTaskEditPrompt: () => {
      calls.push('openTaskEditPrompt');
    },
    openRepositoryPromptForEdit: () => {
      calls.push('openRepositoryPromptForEdit');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  };
  assert.equal(handleHomePanePointerClick({ ...common, clickEligible: false }), false);
  assert.equal(
    handleHomePanePointerClick({ ...common, actionAtCell: () => 'task.status.ready' }),
    true,
  );
  assert.equal(calls.includes('runTaskPaneAction:task.ready'), true);
  calls.length = 0;

  assert.equal(
    handleHomePanePointerClick({
      ...common,
      pointerRow: 999,
      pointerCol: 999,
    }),
    true,
  );
  assert.equal(calls.includes('selectTaskById:task-a'), true);
});

void test('left-nav activation routes targets and cycle helper handles empty/normal/unstable keys', async () => {
  const calls: string[] = [];
  const queued: Array<() => Promise<void>> = [];
  const common = {
    direction: 'next' as const,
    enterHomePane: () => {
      calls.push('enterHomePane');
    },
    firstDirectoryForRepositoryGroup: (repositoryGroupId: string) =>
      repositoryGroupId === 'repo-a' ? 'dir-a' : null,
    enterProjectPane: (directoryId: string) => {
      calls.push(`enterProjectPane:${directoryId}`);
    },
    setMainPaneProjectMode: () => {
      calls.push('setMainPaneProjectMode');
    },
    selectLeftNavRepository: (repositoryId: string) => {
      calls.push(`selectLeftNavRepository:${repositoryId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    directoriesHas: (directoryId: string) => directoryId === 'dir-a',
    visibleTargetsForState: () =>
      [
        { kind: 'conversation', sessionId: 'session-fallback' },
      ] as const satisfies readonly LeftNavSelection[],
    conversationDirectoryId: () => 'dir-missing',
    queueControlPlaneOp: (task: () => Promise<void>, label: string) => {
      calls.push(`queueControlPlaneOp:${label}`);
      queued.push(task);
    },
    activateConversation: async (sessionId: string) => {
      calls.push(`activateConversation:${sessionId}`);
    },
    conversationsHas: (sessionId: string) => sessionId === 'session-live',
  };

  activateLeftNavTarget({ ...common, target: { kind: 'home' } });
  activateLeftNavTarget({ ...common, target: { kind: 'repository', repositoryId: 'repo-a' } });
  activateLeftNavTarget({ ...common, target: { kind: 'repository', repositoryId: 'repo-empty' } });
  activateLeftNavTarget({ ...common, target: { kind: 'project', directoryId: 'dir-a' } });
  activateLeftNavTarget({ ...common, target: { kind: 'project', directoryId: 'dir-missing' } });
  activateLeftNavTarget({
    ...common,
    target: { kind: 'conversation', sessionId: 'session-missing' },
  });
  activateLeftNavTarget({ ...common, target: { kind: 'conversation', sessionId: 'session-live' } });

  while (queued.length > 0) {
    await queued.shift()?.();
  }
  assert.equal(calls.includes('enterHomePane'), true);
  assert.equal(calls.includes('enterProjectPane:dir-a'), true);
  assert.equal(calls.includes('setMainPaneProjectMode'), true);
  assert.equal(calls.includes('selectLeftNavRepository:repo-a'), true);
  assert.equal(
    calls.some((value) => value.startsWith('queueControlPlaneOp:shortcut-activate-next')),
    true,
  );
  assert.equal(calls.includes('activateConversation:session-live'), true);
  assert.equal(calls.includes('activateConversation:session-fallback'), true);

  const activated: string[] = [];
  assert.equal(
    cycleLeftNavSelection({
      visibleTargets: [],
      currentSelection: { kind: 'home' },
      direction: 'next',
      activateTarget: () => {
        activated.push('unexpected');
      },
    }),
    false,
  );
  assert.equal(
    cycleLeftNavSelection({
      visibleTargets: [{ kind: 'home' }, { kind: 'project', directoryId: 'dir-a' }],
      currentSelection: { kind: 'home' },
      direction: 'next',
      activateTarget: (target, direction) => {
        activated.push(`${target.kind}:${direction}`);
      },
    }),
    true,
  );
  assert.deepEqual(activated, ['project:next']);

  let flip = false;
  const unstable = {
    kind: 'repository' as const,
    get repositoryId(): string {
      flip = !flip;
      return flip ? 'flip-a' : 'flip-b';
    },
  } as unknown as LeftNavSelection;
  assert.equal(
    cycleLeftNavSelection({
      visibleTargets: [unstable],
      currentSelection: { kind: 'home' },
      direction: 'next',
      activateTarget: () => {
        activated.push('unstable');
      },
    }),
    false,
  );

  const fakeVisibleTargets = {
    length: 1,
    map: () => [] as string[],
    find: () => undefined,
  } as unknown as readonly LeftNavSelection[];
  assert.equal(
    cycleLeftNavSelection({
      visibleTargets: fakeVisibleTargets,
      currentSelection: { kind: 'home' },
      direction: 'next',
      activateTarget: () => {
        activated.push('fake');
      },
    }),
    false,
  );
});

void test('left-rail action click routes all supported actions and default false', () => {
  const calls: string[] = [];
  const base = {
    selectedProjectId: 'dir-a' as string | null,
    selectedRepositoryId: 'repo-a' as string | null,
    activeConversationId: 'session-a' as string | null,
    repositoriesCollapsed: false,
    clearConversationTitleEditClickState: () => {
      calls.push('clearConversationTitleEditClickState');
    },
    resolveDirectoryForAction: () => 'dir-resolved' as string | null,
    openNewThreadPrompt: (directoryId: string) => {
      calls.push(`openNewThreadPrompt:${directoryId}`);
    },
    queueArchiveConversation: (conversationId: string) => {
      calls.push(`queueArchiveConversation:${conversationId}`);
    },
    openAddDirectoryPrompt: () => {
      calls.push('openAddDirectoryPrompt');
    },
    openRepositoryPromptForCreate: () => {
      calls.push('openRepositoryPromptForCreate');
    },
    repositoryExists: (repositoryId: string) => repositoryId === 'repo-a',
    openRepositoryPromptForEdit: (repositoryId: string) => {
      calls.push(`openRepositoryPromptForEdit:${repositoryId}`);
    },
    queueArchiveRepository: (repositoryId: string) => {
      calls.push(`queueArchiveRepository:${repositoryId}`);
    },
    toggleRepositoryGroup: (repositoryId: string) => {
      calls.push(`toggleRepositoryGroup:${repositoryId}`);
    },
    selectLeftNavRepository: (repositoryId: string) => {
      calls.push(`selectLeftNavRepository:${repositoryId}`);
    },
    expandAllRepositoryGroups: () => {
      calls.push('expandAllRepositoryGroups');
    },
    collapseAllRepositoryGroups: () => {
      calls.push('collapseAllRepositoryGroups');
    },
    enterHomePane: () => {
      calls.push('enterHomePane');
    },
    queueCloseDirectory: (directoryId: string) => {
      calls.push(`queueCloseDirectory:${directoryId}`);
    },
    toggleShortcutsCollapsed: () => {
      calls.push('toggleShortcutsCollapsed');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  };

  const actions = [
    'conversation.new',
    'conversation.delete',
    'project.add',
    'repository.add',
    'repository.edit',
    'repository.archive',
    'repository.toggle',
    'repositories.toggle',
    'home.open',
    'project.close',
    'shortcuts.toggle',
  ] as const;
  for (const action of actions) {
    assert.equal(handleLeftRailActionClick({ ...base, action }), true);
  }
  assert.equal(handleLeftRailActionClick({ ...base, action: null }), false);

  assert.equal(calls.includes('openNewThreadPrompt:dir-a'), true);
  assert.equal(calls.includes('queueArchiveConversation:session-a'), true);
  assert.equal(calls.includes('openAddDirectoryPrompt'), true);
  assert.equal(calls.includes('openRepositoryPromptForCreate'), true);
  assert.equal(calls.includes('openRepositoryPromptForEdit:repo-a'), true);
  assert.equal(calls.includes('queueArchiveRepository:repo-a'), true);
  assert.equal(calls.includes('toggleRepositoryGroup:repo-a'), true);
  assert.equal(calls.includes('selectLeftNavRepository:repo-a'), true);
  assert.equal(calls.includes('collapseAllRepositoryGroups'), true);
  assert.equal(calls.includes('enterHomePane'), true);
  assert.equal(calls.includes('queueCloseDirectory:dir-a'), true);
  assert.equal(calls.includes('toggleShortcutsCollapsed'), true);

  calls.length = 0;
  assert.equal(
    handleLeftRailActionClick({
      ...base,
      action: 'repositories.toggle',
      repositoriesCollapsed: true,
    }),
    true,
  );
  assert.equal(calls.includes('expandAllRepositoryGroups'), true);
});

void test('left-rail conversation click handles active, inactive, project fallback, and default branches', () => {
  const calls: string[] = [];
  assert.equal(
    handleLeftRailConversationClick({
      selectedConversationId: 'session-a',
      selectedProjectId: null,
      supportsConversationTitleEditClick: true,
      previousClickState: { conversationId: 'session-a', atMs: 900 },
      nowMs: 1000,
      conversationTitleEditDoubleClickWindowMs: 200,
      activeConversationId: 'session-a',
      isConversationPaneActive: false,
      setConversationClickState: (next) => {
        calls.push(`setConversationClickState:${next?.conversationId ?? 'null'}`);
      },
      ensureConversationPaneActive: (conversationId) => {
        calls.push(`ensureConversationPaneActive:${conversationId}`);
      },
      beginConversationTitleEdit: (conversationId) => {
        calls.push(`beginConversationTitleEdit:${conversationId}`);
      },
      queueActivateConversation: (conversationId) => {
        calls.push(`queueActivateConversation:${conversationId}`);
      },
      queueActivateConversationAndEdit: (conversationId) => {
        calls.push(`queueActivateConversationAndEdit:${conversationId}`);
      },
      directoriesHas: () => true,
      enterProjectPane: (directoryId) => {
        calls.push(`enterProjectPane:${directoryId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(calls.includes('queueActivateConversationAndEdit:session-a'), true);
  assert.equal(calls.includes('ensureConversationPaneActive:session-a'), false);
  assert.equal(calls.includes('beginConversationTitleEdit:session-a'), false);
  calls.length = 0;

  assert.equal(
    handleLeftRailConversationClick({
      selectedConversationId: 'session-a',
      selectedProjectId: null,
      supportsConversationTitleEditClick: true,
      previousClickState: { conversationId: 'session-a', atMs: 980 },
      nowMs: 1000,
      conversationTitleEditDoubleClickWindowMs: 50,
      activeConversationId: 'session-a',
      isConversationPaneActive: true,
      setConversationClickState: () => {
        calls.push('setConversationClickState');
      },
      ensureConversationPaneActive: () => {
        calls.push('ensureConversationPaneActive');
      },
      beginConversationTitleEdit: () => {
        calls.push('beginConversationTitleEdit');
      },
      queueActivateConversation: () => {
        calls.push('queueActivateConversation');
      },
      queueActivateConversationAndEdit: () => {
        calls.push('queueActivateConversationAndEdit');
      },
      directoriesHas: () => true,
      enterProjectPane: () => {
        calls.push('enterProjectPane');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(calls.includes('beginConversationTitleEdit'), true);
  assert.equal(calls.includes('queueActivateConversationAndEdit'), false);
  calls.length = 0;

  assert.equal(
    handleLeftRailConversationClick({
      selectedConversationId: 'session-a',
      selectedProjectId: null,
      supportsConversationTitleEditClick: true,
      previousClickState: null,
      nowMs: 1000,
      conversationTitleEditDoubleClickWindowMs: 200,
      activeConversationId: 'session-a',
      isConversationPaneActive: false,
      setConversationClickState: () => {
        calls.push('setConversationClickState');
      },
      ensureConversationPaneActive: () => {
        calls.push('ensureConversationPaneActive');
      },
      beginConversationTitleEdit: () => {
        calls.push('beginConversationTitleEdit');
      },
      queueActivateConversation: () => {
        calls.push('queueActivateConversation');
      },
      queueActivateConversationAndEdit: () => {
        calls.push('queueActivateConversationAndEdit');
      },
      directoriesHas: () => true,
      enterProjectPane: () => {
        calls.push('enterProjectPane');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(calls.includes('queueActivateConversation'), true);
  assert.equal(calls.includes('ensureConversationPaneActive'), false);
  calls.length = 0;

  assert.equal(
    handleLeftRailConversationClick({
      selectedConversationId: 'session-b',
      selectedProjectId: null,
      supportsConversationTitleEditClick: true,
      previousClickState: { conversationId: 'session-b', atMs: 950 },
      nowMs: 1000,
      conversationTitleEditDoubleClickWindowMs: 100,
      activeConversationId: 'session-a',
      isConversationPaneActive: true,
      setConversationClickState: () => {
        calls.push('setConversationClickState');
      },
      ensureConversationPaneActive: () => {
        calls.push('ensureConversationPaneActive');
      },
      beginConversationTitleEdit: () => {
        calls.push('beginConversationTitleEdit');
      },
      queueActivateConversation: () => {
        calls.push('queueActivateConversation');
      },
      queueActivateConversationAndEdit: () => {
        calls.push('queueActivateConversationAndEdit');
      },
      directoriesHas: () => true,
      enterProjectPane: () => {
        calls.push('enterProjectPane');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(calls.includes('queueActivateConversationAndEdit'), true);
  calls.length = 0;

  assert.equal(
    handleLeftRailConversationClick({
      selectedConversationId: 'session-c',
      selectedProjectId: null,
      supportsConversationTitleEditClick: false,
      previousClickState: null,
      nowMs: 1000,
      conversationTitleEditDoubleClickWindowMs: 100,
      activeConversationId: null,
      isConversationPaneActive: true,
      setConversationClickState: () => {
        calls.push('setConversationClickState');
      },
      ensureConversationPaneActive: () => {
        calls.push('ensureConversationPaneActive');
      },
      beginConversationTitleEdit: () => {
        calls.push('beginConversationTitleEdit');
      },
      queueActivateConversation: () => {
        calls.push('queueActivateConversation');
      },
      queueActivateConversationAndEdit: () => {
        calls.push('queueActivateConversationAndEdit');
      },
      directoriesHas: () => true,
      enterProjectPane: () => {
        calls.push('enterProjectPane');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(calls.includes('queueActivateConversation'), true);
  calls.length = 0;

  assert.equal(
    handleLeftRailConversationClick({
      selectedConversationId: null,
      selectedProjectId: 'dir-a',
      supportsConversationTitleEditClick: false,
      previousClickState: null,
      nowMs: 1000,
      conversationTitleEditDoubleClickWindowMs: 100,
      activeConversationId: null,
      isConversationPaneActive: true,
      setConversationClickState: () => {
        calls.push('setConversationClickState');
      },
      ensureConversationPaneActive: () => {
        calls.push('ensureConversationPaneActive');
      },
      beginConversationTitleEdit: () => {
        calls.push('beginConversationTitleEdit');
      },
      queueActivateConversation: () => {
        calls.push('queueActivateConversation');
      },
      queueActivateConversationAndEdit: () => {
        calls.push('queueActivateConversationAndEdit');
      },
      directoriesHas: () => true,
      enterProjectPane: (directoryId) => {
        calls.push(`enterProjectPane:${directoryId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(calls.includes('enterProjectPane:dir-a'), true);
  calls.length = 0;

  assert.equal(
    handleLeftRailConversationClick({
      selectedConversationId: null,
      selectedProjectId: 'dir-missing',
      supportsConversationTitleEditClick: false,
      previousClickState: null,
      nowMs: 1000,
      conversationTitleEditDoubleClickWindowMs: 100,
      activeConversationId: null,
      isConversationPaneActive: true,
      setConversationClickState: () => {
        calls.push('setConversationClickState');
      },
      ensureConversationPaneActive: () => {
        calls.push('ensureConversationPaneActive');
      },
      beginConversationTitleEdit: () => {
        calls.push('beginConversationTitleEdit');
      },
      queueActivateConversation: () => {
        calls.push('queueActivateConversation');
      },
      queueActivateConversationAndEdit: () => {
        calls.push('queueActivateConversationAndEdit');
      },
      directoriesHas: () => false,
      enterProjectPane: () => {
        calls.push('enterProjectPane');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.deepEqual(calls, ['setConversationClickState', 'setConversationClickState', 'markDirty']);
});

void test('observed stream helpers handle baseline subscribe/unsubscribe and malformed responses', async () => {
  const commands: StreamCommand[] = [];
  const client: {
    sendCommand: (command: StreamCommand) => Promise<Record<string, unknown>>;
  } = {
    sendCommand: async (command: StreamCommand) => {
      commands.push(command);
      if (command.type === 'stream.subscribe' && command.conversationId !== undefined) {
        return {
          subscriptionId: 'sub-1',
          cursor: 12,
        };
      }
      return {};
    },
  };
  const baseline = await readObservedStreamCursorBaseline(client, {
    tenantId: 'tenant',
    userId: 'user',
    workspaceId: 'workspace',
  });
  assert.equal(baseline, 12);
  assert.equal(
    commands.some((command) => command.type === 'stream.unsubscribe'),
    true,
  );

  await assert.rejects(
    readObservedStreamCursorBaseline(
      {
        sendCommand: async () => ({
          subscriptionId: '',
        }),
      },
      {
        tenantId: 'tenant',
        userId: 'user',
        workspaceId: 'workspace',
      },
    ),
    /malformed subscription id/u,
  );

  const invalidCursor = await readObservedStreamCursorBaseline(
    {
      sendCommand: async (command) => {
        if (command.type === 'stream.subscribe') {
          return {
            subscriptionId: 'sub-2',
            cursor: 'bad',
          };
        }
        throw new Error('unsubscribe best effort');
      },
    },
    {
      tenantId: 'tenant',
      userId: 'user',
      workspaceId: 'workspace',
    },
  );
  assert.equal(invalidCursor, null);

  const subscriptionId = await subscribeObservedStream(
    {
      sendCommand: async (command) => {
        if (command.type === 'stream.subscribe') {
          return { subscriptionId: command.afterCursor === 5 ? 'sub-after' : 'sub-base' };
        }
        return {};
      },
    },
    {
      tenantId: 'tenant',
      userId: 'user',
      workspaceId: 'workspace',
    },
    null,
  );
  assert.equal(subscriptionId, 'sub-base');
  assert.equal(
    await subscribeObservedStream(
      {
        sendCommand: async () => ({ subscriptionId: 'sub-after' }),
      },
      {
        tenantId: 'tenant',
        userId: 'user',
        workspaceId: 'workspace',
      },
      5,
    ),
    'sub-after',
  );
  await assert.rejects(
    subscribeObservedStream(
      {
        sendCommand: async () => ({ subscriptionId: 7 }),
      },
      {
        tenantId: 'tenant',
        userId: 'user',
        workspaceId: 'workspace',
      },
      null,
    ),
    /malformed subscription id/u,
  );

  await unsubscribeObservedStream(
    {
      sendCommand: async () => {
        throw new Error('ignore');
      },
    },
    'sub-id',
  );
});

void test('pointer routing helpers cover drag, separator press, wheel routing, and home drag move', () => {
  const calls: string[] = [];
  assert.equal(
    handlePaneDividerDragInput({
      paneDividerDragActive: false,
      isMouseRelease: false,
      isWheelMouseCode: false,
      mouseCol: 10,
      setPaneDividerDragActive: () => {
        calls.push('setPaneDividerDragActive');
      },
      applyPaneDividerAtCol: () => {
        calls.push('applyPaneDividerAtCol');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    false,
  );
  assert.equal(
    handlePaneDividerDragInput({
      paneDividerDragActive: true,
      isMouseRelease: true,
      isWheelMouseCode: false,
      mouseCol: 10,
      setPaneDividerDragActive: () => {
        calls.push('setPaneDividerDragActive:false');
      },
      applyPaneDividerAtCol: () => {
        calls.push('applyPaneDividerAtCol');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(
    handlePaneDividerDragInput({
      paneDividerDragActive: true,
      isMouseRelease: false,
      isWheelMouseCode: false,
      mouseCol: 20,
      setPaneDividerDragActive: () => {
        calls.push('setPaneDividerDragActive');
      },
      applyPaneDividerAtCol: (col) => {
        calls.push(`applyPaneDividerAtCol:${String(col)}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(
    handlePaneDividerDragInput({
      paneDividerDragActive: true,
      isMouseRelease: false,
      isWheelMouseCode: true,
      mouseCol: 20,
      setPaneDividerDragActive: () => {
        calls.push('setPaneDividerDragActive');
      },
      applyPaneDividerAtCol: () => {
        calls.push('applyPaneDividerAtCol');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    false,
  );

  assert.equal(
    handleSeparatorPointerPress({
      target: 'right',
      isLeftButtonPress: true,
      hasAltModifier: false,
      mouseCol: 10,
      setPaneDividerDragActive: () => {
        calls.push('setPaneDividerDragActive:true');
      },
      applyPaneDividerAtCol: (col) => {
        calls.push(`applyPaneDividerAtCol:${String(col)}`);
      },
    }),
    false,
  );
  assert.equal(
    handleSeparatorPointerPress({
      target: 'separator',
      isLeftButtonPress: true,
      hasAltModifier: false,
      mouseCol: 11,
      setPaneDividerDragActive: () => {
        calls.push('setPaneDividerDragActive:true');
      },
      applyPaneDividerAtCol: (col) => {
        calls.push(`applyPaneDividerAtCol:${String(col)}`);
      },
    }),
    true,
  );

  assert.equal(
    handleMainPaneWheelInput({
      target: 'left',
      wheelDelta: 1,
      mainPaneMode: 'project',
      onProjectWheel: () => {
        calls.push('onProjectWheel');
      },
      onHomeWheel: () => {
        calls.push('onHomeWheel');
      },
      onConversationWheel: () => {
        calls.push('onConversationWheel');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    false,
  );
  assert.equal(
    handleMainPaneWheelInput({
      target: 'right',
      wheelDelta: 2,
      mainPaneMode: 'project',
      onProjectWheel: (delta) => {
        calls.push(`onProjectWheel:${String(delta)}`);
      },
      onHomeWheel: (delta) => {
        calls.push(`onHomeWheel:${String(delta)}`);
      },
      onConversationWheel: (delta) => {
        calls.push(`onConversationWheel:${String(delta)}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(
    handleMainPaneWheelInput({
      target: 'right',
      wheelDelta: 3,
      mainPaneMode: 'home',
      onProjectWheel: () => {
        calls.push('onProjectWheel');
      },
      onHomeWheel: (delta) => {
        calls.push(`onHomeWheel:${String(delta)}`);
      },
      onConversationWheel: () => {
        calls.push('onConversationWheel');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(
    handleMainPaneWheelInput({
      target: 'right',
      wheelDelta: 4,
      mainPaneMode: 'conversation',
      onProjectWheel: () => {
        calls.push('onProjectWheel');
      },
      onHomeWheel: () => {
        calls.push('onHomeWheel');
      },
      onConversationWheel: (delta) => {
        calls.push(`onConversationWheel:${String(delta)}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );

  assert.equal(
    handleHomePaneDragMove({
      homePaneDragState: null,
      mainPaneMode: 'home',
      target: 'right',
      isSelectionDrag: true,
      hasAltModifier: false,
      rowIndex: 5,
      setHomePaneDragState: () => {
        calls.push('setHomePaneDragState');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    false,
  );
  assert.equal(
    handleHomePaneDragMove({
      homePaneDragState: {
        kind: 'task',
        itemId: 'task-a',
        startedRowIndex: 2,
        latestRowIndex: 2,
        hasDragged: false,
      },
      mainPaneMode: 'home',
      target: 'right',
      isSelectionDrag: true,
      hasAltModifier: false,
      rowIndex: 5,
      setHomePaneDragState: (next) => {
        calls.push(
          `setHomePaneDragState:${String(next.latestRowIndex)}:${String(next.hasDragged)}`,
        );
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(calls.includes('setHomePaneDragState:5:true'), true);
});
