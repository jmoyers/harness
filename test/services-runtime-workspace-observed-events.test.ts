import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeWorkspaceObservedEvents } from '../src/services/runtime-workspace-observed-events.ts';

interface ObservedEvent {
  readonly id: string;
}

interface Reduction {
  readonly changed: boolean;
  readonly removedConversationIds: readonly string[];
  readonly removedDirectoryIds: readonly string[];
}

const createHarness = (input?: {
  reduction?: Reduction;
  activeConversationId?: string | null;
  orderedConversationIds?: string[];
  conversationDirectoryById?: Record<string, string | null>;
  existingConversations?: Set<string>;
  existingDirectories?: Set<string>;
  leftNavSelection?:
    | {
        kind: 'project';
        directoryId: string;
      }
    | {
        kind: 'github';
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
  orderedConversationIdsAfterApply?: string[];
}): {
  readonly service: RuntimeWorkspaceObservedEvents<ObservedEvent>;
  readonly calls: string[];
  readonly workspace: {
    leftNavSelection:
      | {
          kind: 'project';
          directoryId: string;
        }
      | {
          kind: 'github';
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
  readonly setReduction: (reduction: Reduction) => void;
  readonly setResolvedActiveDirectoryId: (directoryId: string | null) => void;
  readonly setOrderedConversationIds: (ids: string[]) => void;
  readonly setExistingConversations: (ids: readonly string[]) => void;
  readonly setExistingDirectories: (ids: readonly string[]) => void;
  readonly getActiveConversationId: () => string | null;
} => {
  const calls: string[] = [];
  let reduction: Reduction = input?.reduction ?? {
    changed: false,
    removedConversationIds: [],
    removedDirectoryIds: [],
  };
  let activeConversationId = input?.activeConversationId ?? null;
  let orderedConversationIds = input?.orderedConversationIds ?? [];
  const conversationDirectoryById = new Map<string, string | null>(
    Object.entries(input?.conversationDirectoryById ?? {}),
  );
  let existingConversations = input?.existingConversations ?? new Set<string>();
  let existingDirectories = input?.existingDirectories ?? new Set<string>();
  let resolvedActiveDirectoryId = input?.resolvedActiveDirectoryId ?? null;
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

  const service = new RuntimeWorkspaceObservedEvents<ObservedEvent>({
    reducer: {
      apply: () => {
        if (input?.orderedConversationIdsAfterApply !== undefined) {
          orderedConversationIds = input.orderedConversationIdsAfterApply;
        }
        return reduction;
      },
    },
    workspace,
    orderedConversationIds: () => orderedConversationIds,
    conversationDirectoryId: (sessionId) => conversationDirectoryById.get(sessionId) ?? null,
    hasConversation: (sessionId) => existingConversations.has(sessionId),
    getActiveConversationId: () => activeConversationId,
    setActiveConversationId: (sessionId) => {
      activeConversationId = sessionId;
      calls.push(`setActiveConversationId:${sessionId}`);
    },
    hasDirectory: (directoryId) => existingDirectories.has(directoryId),
    resolveActiveDirectoryId: () => resolvedActiveDirectoryId,
    unsubscribeConversationEvents: async (sessionId) => {
      calls.push(`unsubscribeConversationEvents:${sessionId}`);
    },
    stopConversationTitleEdit: (persistPending) => {
      calls.push(`stopConversationTitleEdit:${persistPending ? 'true' : 'false'}`);
    },
    enterProjectPane: (directoryId) => {
      calls.push(`enterProjectPane:${directoryId}`);
    },
    enterHomePane: () => {
      calls.push('enterHomePane');
    },
    queueControlPlaneOp: (task, label) => {
      calls.push(`queueControlPlaneOp:${label}`);
      void task();
    },
    activateConversation: async (sessionId) => {
      calls.push(`activateConversation:${sessionId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  return {
    service,
    calls,
    workspace,
    setReduction: (nextReduction) => {
      reduction = nextReduction;
    },
    setResolvedActiveDirectoryId: (directoryId) => {
      resolvedActiveDirectoryId = directoryId;
    },
    setOrderedConversationIds: (ids) => {
      orderedConversationIds = ids;
    },
    setExistingConversations: (ids) => {
      existingConversations = new Set(ids);
    },
    setExistingDirectories: (ids) => {
      existingDirectories = new Set(ids);
    },
    getActiveConversationId: () => activeConversationId,
  };
};

void test('runtime workspace observed events returns early when reducer reports no change', () => {
  const harness = createHarness();
  harness.service.apply({
    id: 'event-1',
  });
  assert.deepEqual(harness.calls, []);
});

void test('runtime workspace observed events handles active-conversation removal with fallback activation', () => {
  const harness = createHarness({
    reduction: {
      changed: true,
      removedConversationIds: ['session-1'],
      removedDirectoryIds: ['directory-removed'],
    },
    activeConversationId: 'session-1',
    orderedConversationIds: ['session-1', 'session-2'],
    conversationDirectoryById: {
      'session-1': 'directory-x',
      'session-2': 'directory-x',
    },
    existingDirectories: new Set(['directory-live']),
    activeDirectoryId: 'directory-missing',
    resolvedActiveDirectoryId: 'directory-live',
    conversationTitleEditId: 'session-1',
    projectPaneSnapshotDirectoryId: 'directory-removed',
    orderedConversationIdsAfterApply: ['session-2'],
  });

  harness.service.apply({
    id: 'event-2',
  });

  assert.equal(harness.workspace.projectPaneSnapshot, null);
  assert.equal(harness.workspace.projectPaneScrollTop, 0);
  assert.equal(harness.workspace.activeDirectoryId, 'directory-live');
  assert.equal(harness.getActiveConversationId(), null);
  assert.deepEqual(harness.calls, [
    'unsubscribeConversationEvents:session-1',
    'stopConversationTitleEdit:false',
    'setActiveConversationId:null',
    'queueControlPlaneOp:observed-active-conversation-removed',
    'activateConversation:session-2',
    'markDirty',
  ]);
});

void test('runtime workspace observed events keeps active-conversation archive fallback scoped to the same project', () => {
  const harness = createHarness({
    reduction: {
      changed: true,
      removedConversationIds: ['session-1'],
      removedDirectoryIds: [],
    },
    activeConversationId: 'session-1',
    orderedConversationIds: ['session-1', 'session-2'],
    conversationDirectoryById: {
      'session-1': 'directory-a',
      'session-2': 'directory-b',
    },
    existingDirectories: new Set(['directory-a', 'directory-b']),
    activeDirectoryId: 'directory-a',
    resolvedActiveDirectoryId: 'directory-a',
    orderedConversationIdsAfterApply: ['session-2'],
  });

  harness.service.apply({
    id: 'event-2b',
  });

  assert.deepEqual(harness.calls, [
    'unsubscribeConversationEvents:session-1',
    'setActiveConversationId:null',
    'enterProjectPane:directory-a',
    'markDirty',
  ]);
});

void test('runtime workspace observed events falls back to home when active conversation is removed with no replacement', () => {
  const harness = createHarness({
    reduction: {
      changed: true,
      removedConversationIds: ['session-1'],
      removedDirectoryIds: [],
    },
    activeConversationId: 'session-1',
    orderedConversationIds: ['session-1'],
    conversationDirectoryById: {
      'session-1': 'directory-x',
    },
    existingDirectories: new Set(),
    activeDirectoryId: null,
    resolvedActiveDirectoryId: null,
  });
  harness.setOrderedConversationIds([]);

  harness.service.apply({
    id: 'event-3',
  });

  assert.deepEqual(harness.calls, [
    'unsubscribeConversationEvents:session-1',
    'setActiveConversationId:null',
    'enterHomePane',
    'markDirty',
  ]);
});

void test('runtime workspace observed events keeps left-nav selection on current active conversation when previous selection is removed', () => {
  const harness = createHarness({
    reduction: {
      changed: true,
      removedConversationIds: ['session-1'],
      removedDirectoryIds: [],
    },
    activeConversationId: 'session-2',
    orderedConversationIds: ['session-1', 'session-2'],
    conversationDirectoryById: {
      'session-1': 'directory-a',
      'session-2': 'directory-b',
    },
    existingConversations: new Set(['session-2']),
    leftNavSelection: {
      kind: 'conversation',
      sessionId: 'session-1',
    },
  });

  harness.service.apply({
    id: 'event-4',
  });

  assert.deepEqual(harness.calls, [
    'unsubscribeConversationEvents:session-1',
    'selectLeftNavConversation:session-2',
    'markDirty',
  ]);
});

void test('runtime workspace observed events handles removed left-nav conversation with queued fallback activation', () => {
  const harness = createHarness({
    reduction: {
      changed: true,
      removedConversationIds: ['session-1'],
      removedDirectoryIds: [],
    },
    activeConversationId: null,
    orderedConversationIds: ['session-1', 'session-3'],
    conversationDirectoryById: {
      'session-1': 'directory-a',
      'session-3': 'directory-a',
    },
    existingConversations: new Set(),
    leftNavSelection: {
      kind: 'conversation',
      sessionId: 'session-1',
    },
    orderedConversationIdsAfterApply: ['session-3'],
  });

  harness.service.apply({
    id: 'event-5',
  });

  assert.deepEqual(harness.calls, [
    'unsubscribeConversationEvents:session-1',
    'queueControlPlaneOp:observed-selected-conversation-removed',
    'activateConversation:session-3',
    'markDirty',
  ]);
});

void test('runtime workspace observed events keeps selected-conversation archive fallback scoped to the same project', () => {
  const harness = createHarness({
    reduction: {
      changed: true,
      removedConversationIds: ['session-1'],
      removedDirectoryIds: [],
    },
    activeConversationId: null,
    orderedConversationIds: ['session-1', 'session-2'],
    conversationDirectoryById: {
      'session-1': 'directory-a',
      'session-2': 'directory-b',
    },
    existingConversations: new Set(),
    leftNavSelection: {
      kind: 'conversation',
      sessionId: 'session-1',
    },
    resolvedActiveDirectoryId: 'directory-a',
    orderedConversationIdsAfterApply: ['session-2'],
  });

  harness.service.apply({
    id: 'event-5b',
  });

  assert.deepEqual(harness.calls, [
    'unsubscribeConversationEvents:session-1',
    'enterProjectPane:directory-a',
    'markDirty',
  ]);
});

void test('runtime workspace observed events repairs invalid project selection and supports project/home fallback branches', () => {
  const harness = createHarness({
    reduction: {
      changed: true,
      removedConversationIds: [],
      removedDirectoryIds: [],
    },
    leftNavSelection: {
      kind: 'project',
      directoryId: 'directory-missing',
    },
    existingDirectories: new Set(),
    resolvedActiveDirectoryId: 'directory-fallback',
  });

  harness.service.apply({
    id: 'event-6',
  });

  harness.setReduction({
    changed: true,
    removedConversationIds: [],
    removedDirectoryIds: [],
  });
  harness.setResolvedActiveDirectoryId(null);
  harness.setExistingDirectories([]);
  harness.service.apply({
    id: 'event-7',
  });

  assert.deepEqual(harness.calls, [
    'enterProjectPane:directory-fallback',
    'markDirty',
    'enterHomePane',
    'markDirty',
  ]);
});

void test('runtime workspace observed events repairs invalid github selection with project fallback', () => {
  const harness = createHarness({
    reduction: {
      changed: true,
      removedConversationIds: [],
      removedDirectoryIds: [],
    },
    leftNavSelection: {
      kind: 'github',
      directoryId: 'directory-missing',
    },
    existingDirectories: new Set(['directory-fallback']),
    resolvedActiveDirectoryId: 'directory-fallback',
  });

  harness.service.apply({
    id: 'event-8',
  });

  assert.deepEqual(harness.calls, ['enterProjectPane:directory-fallback', 'markDirty']);
});
