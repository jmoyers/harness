import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeTaskComposerPersistenceService } from '../../../../src/services/runtime-task-composer-persistence.ts';

interface TaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly body: string;
}

interface TaskComposerBuffer {
  readonly text: string;
  readonly cursor: number;
}

interface FakeTimer {
  readonly id: string;
  unref?: () => void;
}

void test('runtime task composer persistence service resolves composer lookup and normalization paths', () => {
  const tasks = new Map<string, TaskRecord>([
    [
      'task-a',
      {
        taskId: 'task-a',
        repositoryId: 'repo-a',
        title: 'Title A',
        body: '',
      },
    ],
    [
      'task-b',
      {
        taskId: 'task-b',
        repositoryId: 'repo-a',
        title: 'Title B',
        body: 'Description B',
      },
    ],
  ]);
  const composers = new Map<string, TaskComposerBuffer>([
    [
      'task-a',
      {
        text: 'existing',
        cursor: 3,
      },
    ],
  ]);
  const setCalls: Array<{ taskId: string; buffer: TaskComposerBuffer }> = [];
  const service = new RuntimeTaskComposerPersistenceService<
    TaskRecord,
    TaskComposerBuffer,
    FakeTimer
  >({
    getTask: (taskId) => tasks.get(taskId),
    getTaskComposer: (taskId) => composers.get(taskId),
    setTaskComposer: (taskId, buffer) => {
      setCalls.push({ taskId, buffer });
    },
    deleteTaskComposer: () => {},
    getTaskAutosaveTimer: () => undefined,
    setTaskAutosaveTimer: () => {},
    deleteTaskAutosaveTimer: () => {},
    buildComposerFromTask: (task) => ({
      text: task.body.length === 0 ? task.title : `${task.title}\n${task.body}`,
      cursor: 0,
    }),
    normalizeTaskComposerBuffer: (buffer) => ({
      text: buffer.text.trim(),
      cursor: buffer.cursor,
    }),
    taskFieldsFromComposerText: () => ({
      title: '',
      body: '',
    }),
    updateTask: async () => {
      throw new Error('not expected');
    },
    applyTaskRecord: () => {},
    queueControlPlaneOp: () => {},
    setTaskPaneNotice: () => {},
    markDirty: () => {},
    autosaveDebounceMs: 10,
  });

  const existing = service.taskComposerForTask('task-a');
  assert.deepEqual(existing, {
    text: 'existing',
    cursor: 3,
  });

  const built = service.taskComposerForTask('task-b');
  assert.deepEqual(built, {
    text: 'Title B\nDescription B',
    cursor: 0,
  });

  assert.equal(service.taskComposerForTask('missing-task'), null);

  service.setTaskComposerForTask('task-a', {
    text: ' next ',
    cursor: 2,
  });
  assert.deepEqual(setCalls, [
    {
      taskId: 'task-a',
      buffer: {
        text: 'next',
        cursor: 2,
      },
    },
  ]);
});

void test('runtime task composer persistence service clears autosave timers and handles empty-body debounce guard', () => {
  const task: TaskRecord = {
    taskId: 'task-a',
    repositoryId: 'repo-a',
    title: 'Title A',
    body: 'Title A\nDescription A',
  };
  const composers = new Map<string, TaskComposerBuffer>([
    [
      'task-a',
      {
        text: '   ',
        cursor: 0,
      },
    ],
  ]);
  const timers = new Map<string, FakeTimer>();
  const clearedTimers: string[] = [];
  const queuedLabels: string[] = [];
  const notices: Array<string | null> = [];
  let markDirtyCount = 0;
  let hasScheduledCallback = false;
  let scheduledCallback: () => void = () => {
    throw new Error('expected scheduled callback');
  };
  let scheduledDelay = 0;
  let unrefCount = 0;

  const service = new RuntimeTaskComposerPersistenceService<
    TaskRecord,
    TaskComposerBuffer,
    FakeTimer
  >({
    getTask: () => task,
    getTaskComposer: (taskId) => composers.get(taskId),
    setTaskComposer: () => {},
    deleteTaskComposer: () => {},
    getTaskAutosaveTimer: (taskId) => timers.get(taskId),
    setTaskAutosaveTimer: (taskId, timer) => {
      timers.set(taskId, timer);
    },
    deleteTaskAutosaveTimer: (taskId) => {
      timers.delete(taskId);
    },
    buildComposerFromTask: () => ({
      text: '',
      cursor: 0,
    }),
    normalizeTaskComposerBuffer: (buffer) => buffer,
    taskFieldsFromComposerText: (text) => ({
      title: text.trim(),
      body: '',
    }),
    updateTask: async () => task,
    applyTaskRecord: () => {},
    queueControlPlaneOp: (_task, label) => {
      queuedLabels.push(label);
    },
    setTaskPaneNotice: (text) => {
      notices.push(text);
    },
    markDirty: () => {
      markDirtyCount += 1;
    },
    autosaveDebounceMs: 250,
    setTimeoutFn: (callback, ms) => {
      hasScheduledCallback = true;
      scheduledCallback = callback;
      scheduledDelay = ms;
      return {
        id: 'timer-1',
        unref: () => {
          unrefCount += 1;
        },
      };
    },
    clearTimeoutFn: (timer) => {
      clearedTimers.push(timer.id);
    },
  });

  service.clearTaskAutosaveTimer('task-a');
  assert.deepEqual(clearedTimers, []);

  timers.set('task-a', {
    id: 'existing-timer',
  });
  service.clearTaskAutosaveTimer('task-a');
  assert.deepEqual(clearedTimers, ['existing-timer']);
  assert.equal(timers.has('task-a'), false);

  service.scheduleTaskComposerPersist('task-a');
  assert.equal(scheduledDelay, 250);
  assert.equal(unrefCount, 1);
  assert.equal(hasScheduledCallback, true);
  assert.equal(timers.has('task-a'), true);
  scheduledCallback();

  assert.equal(timers.has('task-a'), false);
  assert.deepEqual(queuedLabels, []);
  assert.deepEqual(notices, ['task body is required']);
  assert.equal(markDirtyCount, 1);
});

void test('runtime task composer persistence service queues persist operations and handles unchanged guard', async () => {
  const task: TaskRecord = {
    taskId: 'task-a',
    repositoryId: 'repo-a',
    title: 'Title A',
    body: 'Title A\nDescription A',
  };
  const composers = new Map<string, TaskComposerBuffer>();
  const queued: Array<{ label: string; task: () => Promise<void> }> = [];
  const applied: TaskRecord[] = [];
  const deletedComposers: string[] = [];
  const updateCalls: Array<{
    taskId: string;
    repositoryId: string | null;
    title: string;
    body: string;
  }> = [];

  const service = new RuntimeTaskComposerPersistenceService<
    TaskRecord,
    TaskComposerBuffer,
    FakeTimer
  >({
    getTask: (taskId) => (taskId === task.taskId ? task : undefined),
    getTaskComposer: (taskId) => composers.get(taskId),
    setTaskComposer: (taskId, buffer) => {
      composers.set(taskId, buffer);
    },
    deleteTaskComposer: (taskId) => {
      deletedComposers.push(taskId);
      composers.delete(taskId);
    },
    getTaskAutosaveTimer: () => undefined,
    setTaskAutosaveTimer: () => {},
    deleteTaskAutosaveTimer: () => {},
    buildComposerFromTask: () => ({
      text: '',
      cursor: 0,
    }),
    normalizeTaskComposerBuffer: (buffer) => buffer,
    taskFieldsFromComposerText: (text) => {
      const [first] = text.split('\n');
      return {
        title: first?.trim().length ? first.trim() : null,
        body: text,
      };
    },
    updateTask: async (input) => {
      updateCalls.push(input);
      return {
        taskId: input.taskId,
        repositoryId: input.repositoryId,
        title: input.title,
        body: input.body,
      };
    },
    applyTaskRecord: (nextTask) => {
      applied.push(nextTask);
    },
    queueControlPlaneOp: (opTask, label) => {
      queued.push({ task: opTask, label });
    },
    setTaskPaneNotice: () => {},
    markDirty: () => {},
    autosaveDebounceMs: 10,
  });

  service.flushTaskComposerPersist('missing');
  assert.equal(queued.length, 0);

  composers.set('task-a', {
    text: 'Title A\nDescription A',
    cursor: 0,
  });
  service.flushTaskComposerPersist('task-a');
  assert.equal(queued.length, 0);

  composers.set('task-a', {
    text: 'Updated title\nUpdated body',
    cursor: 0,
  });
  service.flushTaskComposerPersist('task-a');
  const firstQueued = queued.at(0);
  if (firstQueued === undefined) {
    throw new Error('expected first queued task');
  }
  assert.equal(firstQueued.label, 'task-editor-save:flush:task-a');

  await firstQueued.task();
  assert.deepEqual(updateCalls, [
    {
      taskId: 'task-a',
      repositoryId: 'repo-a',
      title: 'Updated title',
      body: 'Updated title\nUpdated body',
    },
  ]);
  assert.equal(applied.length, 1);
  assert.deepEqual(deletedComposers, ['task-a']);

  composers.set('task-a', {
    text: 'non-matching-buffer',
    cursor: 0,
  });
  service.flushTaskComposerPersist('task-a');
  const secondQueued = queued.at(1);
  if (secondQueued === undefined) {
    throw new Error('expected second queued task');
  }
  await secondQueued.task();
  assert.deepEqual(deletedComposers, ['task-a', 'task-a']);
});

void test('runtime task composer persistence service clears timer before flush persist', () => {
  const task: TaskRecord = {
    taskId: 'task-a',
    repositoryId: 'repo-a',
    title: 'Title A',
    body: '',
  };
  const timers = new Map<string, FakeTimer>([
    [
      'task-a',
      {
        id: 'timer-a',
      },
    ],
  ]);
  const cleared: string[] = [];
  const queued: string[] = [];

  const service = new RuntimeTaskComposerPersistenceService<
    TaskRecord,
    TaskComposerBuffer,
    FakeTimer
  >({
    getTask: () => task,
    getTaskComposer: () => ({
      text: 'Title B',
      cursor: 0,
    }),
    setTaskComposer: () => {},
    deleteTaskComposer: () => {},
    getTaskAutosaveTimer: (taskId) => timers.get(taskId),
    setTaskAutosaveTimer: () => {},
    deleteTaskAutosaveTimer: (taskId) => {
      timers.delete(taskId);
    },
    buildComposerFromTask: () => ({
      text: '',
      cursor: 0,
    }),
    normalizeTaskComposerBuffer: (buffer) => buffer,
    taskFieldsFromComposerText: (text) => ({
      title: text.trim().length > 0 ? text.trim() : null,
      body: text,
    }),
    updateTask: async (input) => ({
      taskId: input.taskId,
      repositoryId: input.repositoryId,
      title: input.title,
      body: input.body,
    }),
    applyTaskRecord: () => {},
    queueControlPlaneOp: (_task, label) => {
      queued.push(label);
    },
    setTaskPaneNotice: () => {},
    markDirty: () => {},
    autosaveDebounceMs: 10,
    clearTimeoutFn: (timer) => {
      cleared.push(timer.id);
    },
  });

  service.flushTaskComposerPersist('task-a');

  assert.deepEqual(cleared, ['timer-a']);
  assert.deepEqual(queued, ['task-editor-save:flush:task-a']);
});

void test('runtime task composer persistence service default timer fallbacks schedule and clear timers', () => {
  const task: TaskRecord = {
    taskId: 'task-a',
    repositoryId: 'repo-a',
    title: 'Title A',
    body: '',
  };
  const timers = new Map<string, NodeJS.Timeout>();
  const composers = new Map<string, TaskComposerBuffer>([
    [
      'task-a',
      {
        text: 'Title B',
        cursor: 0,
      },
    ],
  ]);
  const queued: string[] = [];

  const service = new RuntimeTaskComposerPersistenceService<TaskRecord, TaskComposerBuffer>({
    getTask: (taskId) => (taskId === task.taskId ? task : undefined),
    getTaskComposer: (taskId) => composers.get(taskId),
    setTaskComposer: () => {},
    deleteTaskComposer: () => {},
    getTaskAutosaveTimer: (taskId) => timers.get(taskId),
    setTaskAutosaveTimer: (taskId, timer) => {
      timers.set(taskId, timer);
    },
    deleteTaskAutosaveTimer: (taskId) => {
      timers.delete(taskId);
    },
    buildComposerFromTask: () => ({
      text: '',
      cursor: 0,
    }),
    normalizeTaskComposerBuffer: (buffer) => buffer,
    taskFieldsFromComposerText: (text) => ({
      title: text.trim().length > 0 ? text.trim() : null,
      body: text,
    }),
    updateTask: async (input) => ({
      taskId: input.taskId,
      repositoryId: input.repositoryId,
      title: input.title,
      body: input.body,
    }),
    applyTaskRecord: () => {},
    queueControlPlaneOp: (_task, label) => {
      queued.push(label);
    },
    setTaskPaneNotice: () => {},
    markDirty: () => {},
    autosaveDebounceMs: 60_000,
  });

  service.scheduleTaskComposerPersist('task-a');
  assert.equal(timers.has('task-a'), true);
  service.clearTaskAutosaveTimer('task-a');
  assert.equal(timers.has('task-a'), false);

  service.flushTaskComposerPersist('task-a');
  assert.deepEqual(queued, ['task-editor-save:flush:task-a']);
});
