interface TaskComposerFields {
  readonly title: string;
  readonly description: string;
}

interface TaskRecordShape {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly description: string;
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
    description: string;
  }) => Promise<TTaskRecord>;
  readonly applyTaskRecord: (task: TTaskRecord) => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly setTaskPaneNotice: (text: string | null) => void;
  readonly markDirty: () => void;
  readonly autosaveDebounceMs: number;
  readonly setTimeoutFn?: (callback: () => void, ms: number) => TTaskAutosaveTimer;
  readonly clearTimeoutFn?: (timer: TTaskAutosaveTimer) => void;
}

export class RuntimeTaskComposerPersistenceService<
  TTaskRecord extends TaskRecordShape,
  TTaskComposerBuffer extends TaskComposerBufferShape,
  TTaskAutosaveTimer extends { unref?: () => void } = NodeJS.Timeout,
> {
  private readonly setTimeoutFn: (callback: () => void, ms: number) => TTaskAutosaveTimer;
  private readonly clearTimeoutFn: (timer: TTaskAutosaveTimer) => void;

  constructor(
    private readonly options: RuntimeTaskComposerPersistenceOptions<
      TTaskRecord,
      TTaskComposerBuffer,
      TTaskAutosaveTimer
    >,
  ) {
    this.setTimeoutFn =
      options.setTimeoutFn ??
      ((callback, ms) => setTimeout(callback, ms) as unknown as TTaskAutosaveTimer);
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((timer) => clearTimeout(timer as unknown as NodeJS.Timeout));
  }

  taskComposerForTask(taskId: string): TTaskComposerBuffer | null {
    const existing = this.options.getTaskComposer(taskId);
    if (existing !== undefined) {
      return existing;
    }
    const task = this.options.getTask(taskId);
    if (task === undefined) {
      return null;
    }
    return this.options.buildComposerFromTask(task);
  }

  setTaskComposerForTask(taskId: string, buffer: TTaskComposerBuffer): void {
    this.options.setTaskComposer(taskId, this.options.normalizeTaskComposerBuffer(buffer));
  }

  clearTaskAutosaveTimer(taskId: string): void {
    const timer = this.options.getTaskAutosaveTimer(taskId);
    if (timer !== undefined) {
      this.clearTimeoutFn(timer);
      this.options.deleteTaskAutosaveTimer(taskId);
    }
  }

  scheduleTaskComposerPersist(taskId: string): void {
    this.clearTaskAutosaveTimer(taskId);
    const timer = this.setTimeoutFn(() => {
      this.options.deleteTaskAutosaveTimer(taskId);
      this.queuePersistTaskComposer(taskId, 'debounced');
    }, this.options.autosaveDebounceMs);
    timer.unref?.();
    this.options.setTaskAutosaveTimer(taskId, timer);
  }

  flushTaskComposerPersist(taskId: string): void {
    this.clearTaskAutosaveTimer(taskId);
    this.queuePersistTaskComposer(taskId, 'flush');
  }

  private queuePersistTaskComposer(taskId: string, reason: 'debounced' | 'flush'): void {
    const task = this.options.getTask(taskId);
    const buffer = this.options.getTaskComposer(taskId);
    if (task === undefined || buffer === undefined) {
      return;
    }
    const fields = this.options.taskFieldsFromComposerText(buffer.text);
    if (fields.title.length === 0) {
      this.options.setTaskPaneNotice('first line is required');
      this.options.markDirty();
      return;
    }
    if (fields.title === task.title && fields.description === task.description) {
      return;
    }
    this.options.queueControlPlaneOp(async () => {
      const parsed = await this.options.updateTask({
        taskId,
        repositoryId: task.repositoryId,
        title: fields.title,
        description: fields.description,
      });
      this.options.applyTaskRecord(parsed);
      const persistedText =
        parsed.description.length === 0 ? parsed.title : `${parsed.title}\n${parsed.description}`;
      const latestBuffer = this.options.getTaskComposer(taskId);
      if (latestBuffer !== undefined && latestBuffer.text === persistedText) {
        this.options.deleteTaskComposer(taskId);
      }
    }, `task-editor-save:${reason}:${taskId}`);
  }
}
