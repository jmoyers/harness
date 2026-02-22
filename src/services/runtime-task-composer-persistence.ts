interface TaskComposerFields {
  readonly title: string | null;
  readonly body: string;
}

interface TaskRecordShape {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly body: string;
}

interface TaskComposerBufferShape {
  readonly text: string;
}

interface RuntimeTaskComposerPersistenceOptions<
  TTaskRecord extends TaskRecordShape,
  TTaskComposerBuffer extends TaskComposerBufferShape,
  TTaskAutosaveTimer extends { unref?: () => void },
> {
  readonly getTask: (taskId: string) => TTaskRecord | undefined;
  readonly getTaskComposer: (taskId: string) => TTaskComposerBuffer | undefined;
  readonly setTaskComposer: (taskId: string, buffer: TTaskComposerBuffer) => void;
  readonly deleteTaskComposer: (taskId: string) => void;
  readonly getTaskAutosaveTimer: (taskId: string) => TTaskAutosaveTimer | undefined;
  readonly setTaskAutosaveTimer: (taskId: string, timer: TTaskAutosaveTimer) => void;
  readonly deleteTaskAutosaveTimer: (taskId: string) => void;
  readonly buildComposerFromTask: (task: TTaskRecord) => TTaskComposerBuffer;
  readonly normalizeTaskComposerBuffer: (buffer: TTaskComposerBuffer) => TTaskComposerBuffer;
  readonly taskFieldsFromComposerText: (text: string) => TaskComposerFields;
  readonly updateTask: (input: {
    taskId: string;
    repositoryId: string | null;
    title: string;
    body: string;
  }) => Promise<TTaskRecord>;
  readonly applyTaskRecord: (task: TTaskRecord) => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly setTaskPaneNotice: (text: string | null) => void;
  readonly markDirty: () => void;
  readonly autosaveDebounceMs: number;
  readonly setTimeoutFn?: (callback: () => void, ms: number) => TTaskAutosaveTimer;
  readonly clearTimeoutFn?: (timer: TTaskAutosaveTimer) => void;
}

export interface RuntimeTaskComposerPersistenceService<
  TTaskComposerBuffer extends TaskComposerBufferShape,
> {
  taskComposerForTask(taskId: string): TTaskComposerBuffer | null;
  setTaskComposerForTask(taskId: string, buffer: TTaskComposerBuffer): void;
  clearTaskAutosaveTimer(taskId: string): void;
  scheduleTaskComposerPersist(taskId: string): void;
  flushTaskComposerPersist(taskId: string): void;
}

export function createRuntimeTaskComposerPersistenceService<
  TTaskRecord extends TaskRecordShape,
  TTaskComposerBuffer extends TaskComposerBufferShape,
  TTaskAutosaveTimer extends { unref?: () => void } = NodeJS.Timeout,
>(
  options: RuntimeTaskComposerPersistenceOptions<
    TTaskRecord,
    TTaskComposerBuffer,
    TTaskAutosaveTimer
  >,
): RuntimeTaskComposerPersistenceService<TTaskComposerBuffer> {
  const setTimeoutFn =
    options.setTimeoutFn ??
    ((callback, ms) => setTimeout(callback, ms) as unknown as TTaskAutosaveTimer);
  const clearTimeoutFn =
    options.clearTimeoutFn ?? ((timer) => clearTimeout(timer as unknown as NodeJS.Timeout));

  function taskComposerForTask(taskId: string): TTaskComposerBuffer | null {
    const existing = options.getTaskComposer(taskId);
    if (existing !== undefined) {
      return existing;
    }
    const task = options.getTask(taskId);
    if (task === undefined) {
      return null;
    }
    return options.buildComposerFromTask(task);
  }

  function setTaskComposerForTask(taskId: string, buffer: TTaskComposerBuffer): void {
    options.setTaskComposer(taskId, options.normalizeTaskComposerBuffer(buffer));
  }

  function clearTaskAutosaveTimer(taskId: string): void {
    const timer = options.getTaskAutosaveTimer(taskId);
    if (timer !== undefined) {
      clearTimeoutFn(timer);
      options.deleteTaskAutosaveTimer(taskId);
    }
  }

  function scheduleTaskComposerPersist(taskId: string): void {
    clearTaskAutosaveTimer(taskId);
    const timer = setTimeoutFn(() => {
      options.deleteTaskAutosaveTimer(taskId);
      queuePersistTaskComposer(taskId, 'debounced');
    }, options.autosaveDebounceMs);
    timer.unref?.();
    options.setTaskAutosaveTimer(taskId, timer);
  }

  function flushTaskComposerPersist(taskId: string): void {
    clearTaskAutosaveTimer(taskId);
    queuePersistTaskComposer(taskId, 'flush');
  }

  function queuePersistTaskComposer(taskId: string, reason: 'debounced' | 'flush'): void {
    const task = options.getTask(taskId);
    const buffer = options.getTaskComposer(taskId);
    if (task === undefined || buffer === undefined) {
      return;
    }
    const fields = options.taskFieldsFromComposerText(buffer.text);
    if (fields.body.trim().length === 0) {
      options.setTaskPaneNotice('task body is required');
      options.markDirty();
      return;
    }
    if (fields.title === task.title && fields.body === task.body) {
      return;
    }
    options.queueControlPlaneOp(async () => {
      const parsed = await options.updateTask({
        taskId,
        repositoryId: task.repositoryId,
        title: fields.title ?? '',
        body: fields.body,
      });
      options.applyTaskRecord(parsed);
      const persistedText = parsed.body.length === 0 ? parsed.title : parsed.body;
      const latestBuffer = options.getTaskComposer(taskId);
      if (latestBuffer !== undefined && latestBuffer.text === persistedText) {
        options.deleteTaskComposer(taskId);
      }
    }, `task-editor-save:${reason}:${taskId}`);
  }

  return {
    taskComposerForTask,
    setTaskComposerForTask,
    clearTaskAutosaveTimer,
    scheduleTaskComposerPersist,
    flushTaskComposerPersist,
  };
}
