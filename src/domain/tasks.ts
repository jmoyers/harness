export class TaskManager<TTaskRecord extends { taskId: string }, TTaskComposerBuffer> {
  private readonly tasksById = new Map<string, TTaskRecord>();
  private readonly taskComposerByTaskId = new Map<string, TTaskComposerBuffer>();

  constructor() {}

  readonlyTasks(): ReadonlyMap<string, TTaskRecord> {
    return this.tasksById;
  }

  readonlyTaskComposers(): ReadonlyMap<string, TTaskComposerBuffer> {
    return this.taskComposerByTaskId;
  }

  values(): IterableIterator<TTaskRecord> {
    return this.tasksById.values();
  }

  getTask(taskId: string): TTaskRecord | undefined {
    return this.tasksById.get(taskId);
  }

  hasTask(taskId: string): boolean {
    return this.tasksById.has(taskId);
  }

  setTask(task: TTaskRecord): void {
    this.tasksById.set(task.taskId, task);
  }

  deleteTask(taskId: string): boolean {
    return this.tasksById.delete(taskId);
  }

  clearTasks(): void {
    this.tasksById.clear();
  }

  getTaskComposer(taskId: string): TTaskComposerBuffer | undefined {
    return this.taskComposerByTaskId.get(taskId);
  }

  setTaskComposer(taskId: string, buffer: TTaskComposerBuffer): void {
    this.taskComposerByTaskId.set(taskId, buffer);
  }

  deleteTaskComposer(taskId: string): boolean {
    return this.taskComposerByTaskId.delete(taskId);
  }

  clearTaskComposers(): void {
    this.taskComposerByTaskId.clear();
  }
}
