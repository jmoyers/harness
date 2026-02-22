import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { TuiRenderSnapshotAdapter } from '../src/clients/tui/render-snapshot-adapter.ts';
import type { TaskComposerBuffer } from '../src/mux/task-composer.ts';
import type {
  TaskFocusedPaneRepositoryRecord,
  TaskFocusedPaneTaskRecord,
} from '../src/mux/task-focused-pane.ts';

interface DirectoryRecord {
  readonly directoryId: string;
}

interface ConversationRecord {
  readonly sessionId: string;
}

interface ProcessUsageSample {
  readonly cpuPercent: number;
}

void test('tui render snapshot adapter reads current domain maps', () => {
  const directories = new Map<string, DirectoryRecord>([
    [
      'directory-a',
      {
        directoryId: 'directory-a',
      },
    ],
  ]);
  const conversations = new Map<string, ConversationRecord>([
    [
      'session-a',
      {
        sessionId: 'session-a',
      },
    ],
  ]);
  const repositories = new Map<string, TaskFocusedPaneRepositoryRecord>([
    [
      'repository-a',
      {
        repositoryId: 'repository-a',
        name: 'repo-a',
        archivedAt: null,
      },
    ],
  ]);
  const tasks = new Map<string, TaskFocusedPaneTaskRecord>([
    [
      'task-a',
      {
        taskId: 'task-a',
        repositoryId: 'repository-a',
        title: 'title',
        body: 'body',
        status: 'ready',
        orderIndex: 0,
        createdAt: '2026-02-21T00:00:00.000Z',
      },
    ],
  ]);
  const taskComposers = new Map<string, TaskComposerBuffer>([
    [
      'task-a',
      {
        text: 'edit',
        cursor: 2,
      },
    ],
  ]);
  const processUsage = new Map<string, ProcessUsageSample>([
    [
      'session-a',
      {
        cpuPercent: 7,
      },
    ],
  ]);
  const adapter = new TuiRenderSnapshotAdapter<
    DirectoryRecord,
    ConversationRecord,
    TaskFocusedPaneRepositoryRecord,
    TaskFocusedPaneTaskRecord,
    ProcessUsageSample
  >({
    directories: {
      readonlyDirectories: () => directories,
    },
    conversations: {
      readonlyConversations: () => conversations,
      orderedIds: () => ['session-a'],
      activeConversationId: 'session-a',
    },
    repositories: {
      readonlyRepositories: () => repositories,
    },
    tasks: {
      readonlyTasks: () => tasks,
      readonlyTaskComposers: () => taskComposers,
    },
    processUsage: {
      readonlyUsage: () => processUsage,
    },
  });

  const snapshot = adapter.readSnapshot();
  assert.equal(snapshot.leftRail.directories, directories);
  assert.equal(snapshot.leftRail.conversations, conversations);
  assert.equal(snapshot.leftRail.repositories, repositories);
  assert.deepEqual(snapshot.leftRail.orderedConversationIds, ['session-a']);
  assert.equal(snapshot.leftRail.activeConversationId, 'session-a');
  assert.equal(snapshot.leftRail.processUsageBySessionId, processUsage);
  assert.equal(snapshot.rightPane.repositories, repositories);
  assert.equal(snapshot.rightPane.tasks, tasks);
});

void test('tui render snapshot adapter snapshots task composer values by default', () => {
  const taskComposers = new Map<string, TaskComposerBuffer>([
    [
      'task-a',
      {
        text: 'draft',
        cursor: 3,
      },
    ],
  ]);
  const adapter = new TuiRenderSnapshotAdapter<
    DirectoryRecord,
    ConversationRecord,
    TaskFocusedPaneRepositoryRecord,
    TaskFocusedPaneTaskRecord,
    ProcessUsageSample
  >({
    directories: {
      readonlyDirectories: () => new Map(),
    },
    conversations: {
      readonlyConversations: () => new Map(),
      orderedIds: () => [],
      activeConversationId: null,
    },
    repositories: {
      readonlyRepositories: () => new Map(),
    },
    tasks: {
      readonlyTasks: () => new Map(),
      readonlyTaskComposers: () => taskComposers,
    },
    processUsage: {
      readonlyUsage: () => new Map(),
    },
  });

  const snapshot = adapter.readSnapshot();
  const snapshotComposer = snapshot.rightPane.taskComposers.get('task-a');
  assert.deepEqual(snapshotComposer, {
    text: 'draft',
    cursor: 3,
  });
  assert.equal(snapshot.rightPane.taskComposers === taskComposers, false);

  taskComposers.set('task-a', {
    text: 'changed',
    cursor: 1,
  });
  assert.deepEqual(snapshot.rightPane.taskComposers.get('task-a'), {
    text: 'draft',
    cursor: 3,
  });
});
