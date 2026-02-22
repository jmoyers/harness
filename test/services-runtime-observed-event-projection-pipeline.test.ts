import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createHarnessSyncedStore } from '../src/core/store/harness-synced-store.ts';
import { createRuntimeObservedEventProjectionPipeline } from '../src/services/runtime-observed-event-projection-pipeline.ts';

void test('runtime observed event projection pipeline short-circuits when cursor is duplicate/regressed', () => {
  const store = createHarnessSyncedStore();
  const calls: string[] = [];
  const pipeline = createRuntimeObservedEventProjectionPipeline({
    syncedStore: store,
    applyWorkspaceProjection: () => {
      calls.push('workspace');
    },
    applyDirectoryGitProjection: () => {
      calls.push('git');
    },
    applyTaskPlanningProjection: () => {
      calls.push('task');
    },
  });

  const event = {
    type: 'directory-archived',
    directoryId: 'directory-1',
    ts: new Date(0).toISOString(),
  } as const;

  const first = pipeline.apply({
    subscriptionId: 'subscription-1',
    cursor: 5,
    event,
  });
  const second = pipeline.apply({
    subscriptionId: 'subscription-1',
    cursor: 5,
    event,
  });

  assert.equal(first.cursorAccepted, true);
  assert.equal(first.previousCursor, null);
  assert.equal(second.cursorAccepted, false);
  assert.equal(second.previousCursor, 5);
  assert.deepEqual(calls, ['workspace', 'git', 'task']);
});

void test('runtime observed event projection pipeline applies projections in canonical order', () => {
  const store = createHarnessSyncedStore();
  const calls: string[] = [];
  let workspaceChanged = false;
  let taskChanged = false;
  let sawGitEventType: string | null = null;

  const pipeline = createRuntimeObservedEventProjectionPipeline({
    syncedStore: store,
    applyWorkspaceProjection: (reduction) => {
      workspaceChanged = reduction.changed;
      calls.push('workspace');
    },
    applyDirectoryGitProjection: (event) => {
      sawGitEventType = event.type;
      calls.push('git');
    },
    applyTaskPlanningProjection: (reduction) => {
      taskChanged = reduction.changed;
      calls.push('task');
    },
  });

  const result = pipeline.apply({
    subscriptionId: 'subscription-2',
    cursor: 10,
    event: {
      type: 'conversation-created',
      conversation: {
        conversationId: 'conversation-1',
        directoryId: 'directory-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        title: 'Conversation',
        agentType: 'codex',
        adapterState: {},
        runtimeStatus: 'running',
        runtimeStatusModel: null,
        runtimeLive: true,
      },
    },
  });

  assert.equal(result.cursorAccepted, true);
  assert.equal(result.previousCursor, null);
  assert.equal(workspaceChanged, true);
  assert.equal(taskChanged, true);
  assert.equal(sawGitEventType, 'conversation-created');
  assert.deepEqual(calls, ['workspace', 'git', 'task']);
});
