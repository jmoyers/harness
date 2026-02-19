import type { TaskPaneAction } from '../mux/harness-core-ui.ts';
import { RuntimeTaskPaneActions } from './runtime-task-pane-actions.ts';
import { RuntimeTaskPaneShortcuts } from './runtime-task-pane-shortcuts.ts';

interface TaskRecordShape {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly status: string;
  readonly title: string;
  readonly body: string;
}

type RuntimeTaskPaneActionsOptions<TTaskRecord extends TaskRecordShape> = ConstructorParameters<
  typeof RuntimeTaskPaneActions<TTaskRecord>
>[0];
type RuntimeTaskPaneShortcutsOptions<TTaskRecord extends TaskRecordShape> = Omit<
  ConstructorParameters<typeof RuntimeTaskPaneShortcuts<TTaskRecord>>[0],
  'runTaskPaneAction' | 'applyTaskRecord'
>;

interface RuntimeTaskPaneOptions<TTaskRecord extends TaskRecordShape> {
  readonly actions: RuntimeTaskPaneActionsOptions<TTaskRecord>;
  readonly shortcuts: RuntimeTaskPaneShortcutsOptions<TTaskRecord>;
}

export class RuntimeTaskPane<TTaskRecord extends TaskRecordShape> {
  private readonly actions: RuntimeTaskPaneActions<TTaskRecord>;
  private readonly shortcuts: RuntimeTaskPaneShortcuts<TTaskRecord>;

  constructor(options: RuntimeTaskPaneOptions<TTaskRecord>) {
    this.actions = new RuntimeTaskPaneActions<TTaskRecord>(options.actions);
    this.shortcuts = new RuntimeTaskPaneShortcuts<TTaskRecord>({
      ...options.shortcuts,
      runTaskPaneAction: (action) => {
        this.runTaskPaneAction(action);
      },
      applyTaskRecord: (task) => {
        this.applyTaskRecord(task);
      },
    });
  }

  applyTaskRecord(task: TTaskRecord): TTaskRecord {
    return this.actions.applyTaskRecord(task);
  }

  runTaskPaneAction(action: TaskPaneAction): void {
    this.actions.runTaskPaneAction(action);
  }

  openTaskEditPrompt(taskId: string): void {
    this.actions.openTaskEditPrompt(taskId);
  }

  reorderTaskByDrop(draggedTaskId: string, targetTaskId: string): void {
    this.actions.reorderTaskByDrop(draggedTaskId, targetTaskId);
  }

  handleInput(input: Buffer): boolean {
    return this.shortcuts.handleInput(input);
  }
}
