export class TaskManager<TTaskRecord extends { taskId: string }> {
  private readonly tasksById = new Map<string, TTaskRecord>();

  constructor() {}

  readonlyTasks(): ReadonlyMap<string, TTaskRecord> {
    return this.tasksById;
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
}
