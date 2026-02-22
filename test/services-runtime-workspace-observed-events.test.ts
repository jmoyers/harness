import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createHarnessSyncedStore } from '../src/core/store/harness-synced-store.ts';
import type { HarnessSyncedState } from '../src/core/state/synced-observed-state.ts';
import { RuntimeWorkspaceObservedEvents } from '../src/services/runtime-workspace-observed-events.ts';
import { RuntimeWorkspaceObservedEffectQueue } from '../src/services/runtime-workspace-observed-effect-queue.ts';
import { RuntimeWorkspaceObservedTransitionPolicy } from '../src/services/runtime-workspace-observed-transition-policy.ts';

function createSyncedState(input: {
  readonly directoryIds?: readonly string[];
  readonly conversationDirectoryById?: Readonly<Record<string, string | null>>;
}): HarnessSyncedState {
  const directoriesById: Record<string, HarnessSyncedState['directoriesById'][string]> = {};
  for (const directoryId of input.directoryIds ?? []) {
    directoriesById[directoryId] = {
      directoryId,
      tenantId: 'tenant',
      userId: 'user',
      workspaceId: 'workspace',
      path: `/tmp/${directoryId}`,
      createdAt: null,
      archivedAt: null,
    };
  }

  const conversationsById: Record<string, HarnessSyncedState['conversationsById'][string]> = {};
  for (const [conversationId, directoryId] of Object.entries(
    input.conversationDirectoryById ?? {},
  )) {
    if (directoryId === null) {
      continue;
    }
    conversationsById[conversationId] = {
      conversationId,
      directoryId,
      tenantId: 'tenant',
      userId: 'user',
      workspaceId: 'workspace',
      title: conversationId,
      agentType: 'codex',
      adapterState: {},
      runtimeStatus: 'running',
      runtimeStatusModel: null,
      runtimeLive: true,
    };
  }

  return {
    directoriesById,
    conversationsById,
    repositoriesById: {},
    tasksById: {},
  };
}

const createHarness = (input?: {
  initialSynced?: HarnessSyncedState;
  activeConversationId?: string | null;
  orderedConversationIds?: string[];
  leftNavSelection?:
    | {
        kind: 'project';
        directoryId: string;
      }
    | {
        kind: 'conversation';
        sessionId: string;
      };
  activeDirectoryId?: string | null;
  resolvedActiveDirectoryId?: string | null;
  conversationTitleEditId?: string | null;
  projectPaneSnapshotDirectoryId?: string | null;
}): {
  readonly service: RuntimeWorkspaceObservedEvents;
  readonly calls: string[];
  readonly workspace: {
    leftNavSelection:
      | {
          kind: 'project';
          directoryId: string;
        }
      | {
          kind: 'conversation';
          sessionId: string;
        };
    conversationTitleEdit: {
      conversationId: string;
    } | null;
    projectPaneSnapshot: {
      directoryId: string;
    } | null;
    projectPaneScrollTop: number;
    activeDirectoryId: string | null;
    selectLeftNavConversation: (sessionId: string) => void;
  };
  readonly setResolvedActiveDirectoryId: (directoryId: string | null) => void;
  readonly getActiveConversationId: () => string | null;
  readonly apply: (next: {
    readonly synced: HarnessSyncedState;
    readonly orderedConversationIds?: readonly string[];
  }) => void;
  readonly drainQueuedReactions: () => Promise<void>;
} => {
  const calls: string[] = [];
  let activeConversationId = input?.activeConversationId ?? null;
  let orderedConversationIds = input?.orderedConversationIds ?? [];
  let resolvedActiveDirectoryId = input?.resolvedActiveDirectoryId ?? null;
  const queuedReactions: Array<() => Promise<void>> = [];

  const workspace = {
    leftNavSelection: input?.leftNavSelection ?? {
      kind: 'project' as const,
      directoryId: 'directory-a',
    },
    conversationTitleEdit:
      input?.conversationTitleEditId === null || input?.conversationTitleEditId === undefined
        ? null
        : {
            conversationId: input.conversationTitleEditId,
          },
    projectPaneSnapshot:
      input?.projectPaneSnapshotDirectoryId === null ||
      input?.projectPaneSnapshotDirectoryId === undefined
        ? null
        : {
            directoryId: input.projectPaneSnapshotDirectoryId,
          },
    projectPaneScrollTop: 7,
    activeDirectoryId: input?.activeDirectoryId ?? null,
    selectLeftNavConversation: (sessionId: string): void => {
      workspace.leftNavSelection = {
        kind: 'conversation',
        sessionId,
      };
      calls.push(`selectLeftNavConversation:${sessionId}`);
    },
  };

  const store = createHarnessSyncedStore({
    synced: input?.initialSynced ?? createSyncedState({}),
  });

  const transitionPolicy = new RuntimeWorkspaceObservedTransitionPolicy({
    workspace,
    getActiveConversationId: () => activeConversationId,
    setActiveConversationId: (sessionId) => {
      activeConversationId = sessionId;
      calls.push(`setActiveConversationId:${sessionId}`);
    },
    resolveActiveDirectoryId: () => resolvedActiveDirectoryId,
    stopConversationTitleEdit: (persistPending) => {
      calls.push(`stopConversationTitleEdit:${persistPending ? 'true' : 'false'}`);
    },
    enterProjectPane: (directoryId) => {
      calls.push(`enterProjectPane:${directoryId}`);
    },
    enterHomePane: () => {
      calls.push('enterHomePane');
    },
  });
  const effectQueue = new RuntimeWorkspaceObservedEffectQueue({
    enqueueQueuedReaction: (task, label) => {
      calls.push(`enqueueQueuedReaction:${label}`);
      queuedReactions.push(task);
    },
    unsubscribeConversationEvents: async (sessionId) => {
      calls.push(`unsubscribeConversationEvents:${sessionId}`);
    },
    activateConversation: async (sessionId) => {
      calls.push(`activateConversation:${sessionId}`);
    },
  });
  const service = new RuntimeWorkspaceObservedEvents({
    store,
    orderedConversationIds: () => orderedConversationIds,
    transitionPolicy,
    effectQueue,
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  service.start();

  return {
    service,
    calls,
    workspace,
    setResolvedActiveDirectoryId: (directoryId) => {
      resolvedActiveDirectoryId = directoryId;
    },
    getActiveConversationId: () => activeConversationId,
    apply: (next) => {
      if (next.orderedConversationIds !== undefined) {
        orderedConversationIds = [...next.orderedConversationIds];
      }
      store.setState({
        ...store.getState(),
        synced: next.synced,
      });
    },
    drainQueuedReactions: async () => {
      while (queuedReactions.length > 0) {
        const next = queuedReactions.shift();
        await next?.();
      }
    },
  };
};

void test('runtime workspace observed events returns early when synced state is unchanged', () => {
  const initial = createSyncedState({});
  const harness = createHarness({
    initialSynced: initial,
  });

  harness.apply({
    synced: initial,
  });

  assert.deepEqual(harness.calls, []);
  harness.service.stop();
});

void test(
  'runtime workspace observed events handles active-conversation removal with fallback activation',
  async () => {
  const harness = createHarness({
    initialSynced: createSyncedState({
      directoryIds: ['directory-live', 'directory-removed'],
      conversationDirectoryById: {
        'session-1': 'directory-x',
        'session-2': 'directory-x',
      },
    }),
    activeConversationId: 'session-1',
    orderedConversationIds: ['session-1', 'session-2'],
    activeDirectoryId: 'directory-missing',
    resolvedActiveDirectoryId: 'directory-live',
    conversationTitleEditId: 'session-1',
    projectPaneSnapshotDirectoryId: 'directory-removed',
  });

  harness.apply({
    synced: createSyncedState({
      directoryIds: ['directory-live'],
      conversationDirectoryById: {
        'session-2': 'directory-x',
      },
    }),
    orderedConversationIds: ['session-2'],
  });
  await harness.drainQueuedReactions();

  assert.equal(harness.workspace.projectPaneSnapshot, null);
  assert.equal(harness.workspace.projectPaneScrollTop, 0);
  assert.equal(harness.workspace.activeDirectoryId, 'directory-live');
  assert.equal(harness.getActiveConversationId(), null);
  assert.deepEqual(harness.calls, [
    'stopConversationTitleEdit:false',
    'setActiveConversationId:null',
    'enqueueQueuedReaction:observed-unsubscribe-conversation:session-1',
    'enqueueQueuedReaction:observed-active-conversation-removed',
    'markDirty',
    'unsubscribeConversationEvents:session-1',
    'activateConversation:session-2',
  ]);
  harness.service.stop();
  },
);

void test(
  'runtime workspace observed events keeps active-conversation archive fallback scoped to the same project',
  async () => {
  const harness = createHarness({
    initialSynced: createSyncedState({
      directoryIds: ['directory-a', 'directory-b'],
      conversationDirectoryById: {
        'session-1': 'directory-a',
        'session-2': 'directory-b',
      },
    }),
    activeConversationId: 'session-1',
    orderedConversationIds: ['session-1', 'session-2'],
    activeDirectoryId: 'directory-a',
    resolvedActiveDirectoryId: 'directory-a',
  });

  harness.apply({
    synced: createSyncedState({
      directoryIds: ['directory-a', 'directory-b'],
      conversationDirectoryById: {
        'session-2': 'directory-b',
      },
    }),
    orderedConversationIds: ['session-2'],
  });
  await harness.drainQueuedReactions();

  assert.deepEqual(harness.calls, [
    'setActiveConversationId:null',
    'enterProjectPane:directory-a',
    'enqueueQueuedReaction:observed-unsubscribe-conversation:session-1',
    'markDirty',
    'unsubscribeConversationEvents:session-1',
  ]);
  harness.service.stop();
  },
);

void test(
  'runtime workspace observed events falls back to home when active conversation is removed with no replacement',
  async () => {
  const harness = createHarness({
    initialSynced: createSyncedState({
      conversationDirectoryById: {
        'session-1': 'directory-x',
      },
    }),
    activeConversationId: 'session-1',
    orderedConversationIds: ['session-1'],
    activeDirectoryId: null,
    resolvedActiveDirectoryId: null,
  });

  harness.apply({
    synced: createSyncedState({}),
    orderedConversationIds: [],
  });
  await harness.drainQueuedReactions();

  assert.deepEqual(harness.calls, [
    'setActiveConversationId:null',
    'enterHomePane',
    'enqueueQueuedReaction:observed-unsubscribe-conversation:session-1',
    'markDirty',
    'unsubscribeConversationEvents:session-1',
  ]);
  harness.service.stop();
  },
);

void test(
  'runtime workspace observed events keeps left-nav selection on current active conversation when previous selection is removed',
  async () => {
  const harness = createHarness({
    initialSynced: createSyncedState({
      conversationDirectoryById: {
        'session-1': 'directory-a',
        'session-2': 'directory-b',
      },
    }),
    activeConversationId: 'session-2',
    orderedConversationIds: ['session-1', 'session-2'],
    leftNavSelection: {
      kind: 'conversation',
      sessionId: 'session-1',
    },
  });

  harness.apply({
    synced: createSyncedState({
      conversationDirectoryById: {
        'session-2': 'directory-b',
      },
    }),
    orderedConversationIds: ['session-2'],
  });
  await harness.drainQueuedReactions();

  assert.deepEqual(harness.calls, [
    'selectLeftNavConversation:session-2',
    'enqueueQueuedReaction:observed-unsubscribe-conversation:session-1',
    'markDirty',
    'unsubscribeConversationEvents:session-1',
  ]);
  harness.service.stop();
  },
);

void test(
  'runtime workspace observed events handles removed left-nav conversation with queued fallback activation',
  async () => {
  const harness = createHarness({
    initialSynced: createSyncedState({
      conversationDirectoryById: {
        'session-1': 'directory-a',
        'session-3': 'directory-a',
      },
    }),
    activeConversationId: null,
    orderedConversationIds: ['session-1', 'session-3'],
    leftNavSelection: {
      kind: 'conversation',
      sessionId: 'session-1',
    },
  });

  harness.apply({
    synced: createSyncedState({
      conversationDirectoryById: {
        'session-3': 'directory-a',
      },
    }),
    orderedConversationIds: ['session-3'],
  });
  await harness.drainQueuedReactions();

  assert.deepEqual(harness.calls, [
    'enqueueQueuedReaction:observed-unsubscribe-conversation:session-1',
    'enqueueQueuedReaction:observed-selected-conversation-removed',
    'markDirty',
    'unsubscribeConversationEvents:session-1',
    'activateConversation:session-3',
  ]);
  harness.service.stop();
  },
);

void test(
  'runtime workspace observed events keeps selected-conversation archive fallback scoped to the same project',
  async () => {
  const harness = createHarness({
    initialSynced: createSyncedState({
      conversationDirectoryById: {
        'session-1': 'directory-a',
        'session-2': 'directory-b',
      },
    }),
    activeConversationId: null,
    orderedConversationIds: ['session-1', 'session-2'],
    leftNavSelection: {
      kind: 'conversation',
      sessionId: 'session-1',
    },
    resolvedActiveDirectoryId: 'directory-a',
  });

  harness.apply({
    synced: createSyncedState({
      conversationDirectoryById: {
        'session-2': 'directory-b',
      },
    }),
    orderedConversationIds: ['session-2'],
  });
  await harness.drainQueuedReactions();

  assert.deepEqual(harness.calls, [
    'enterProjectPane:directory-a',
    'enqueueQueuedReaction:observed-unsubscribe-conversation:session-1',
    'markDirty',
    'unsubscribeConversationEvents:session-1',
  ]);
  harness.service.stop();
  },
);

void test('runtime workspace observed events repairs invalid project selection and supports project/home fallback branches', () => {
  const harness = createHarness({
    initialSynced: createSyncedState({
      directoryIds: ['directory-fallback'],
    }),
    leftNavSelection: {
      kind: 'project',
      directoryId: 'directory-missing',
    },
    resolvedActiveDirectoryId: 'directory-fallback',
  });

  harness.apply({
    synced: createSyncedState({}),
    orderedConversationIds: [],
  });

  harness.setResolvedActiveDirectoryId(null);
  harness.apply({
    synced: createSyncedState({}),
    orderedConversationIds: [],
  });

  assert.deepEqual(harness.calls, [
    'enterProjectPane:directory-fallback',
    'markDirty',
    'enterHomePane',
    'markDirty',
  ]);
  harness.service.stop();
});

void test('runtime workspace observed events keeps store subscriber path non-reentrant when reactions are queued', async () => {
  const harness = createHarness({
    initialSynced: createSyncedState({
      conversationDirectoryById: {
        'session-1': 'directory-a',
      },
    }),
    activeConversationId: 'session-1',
    orderedConversationIds: ['session-1'],
  });

  harness.apply({
    synced: createSyncedState({}),
    orderedConversationIds: [],
  });

  assert.deepEqual(harness.calls, [
    'setActiveConversationId:null',
    'enterHomePane',
    'enqueueQueuedReaction:observed-unsubscribe-conversation:session-1',
    'markDirty',
  ]);

  await harness.drainQueuedReactions();

  assert.deepEqual(harness.calls, [
    'setActiveConversationId:null',
    'enterHomePane',
    'enqueueQueuedReaction:observed-unsubscribe-conversation:session-1',
    'markDirty',
    'unsubscribeConversationEvents:session-1',
  ]);
  harness.service.stop();
});
