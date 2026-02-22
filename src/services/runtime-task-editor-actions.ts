import type { WorkspaceModel } from '../domain/workspace.ts';

interface TaskRecordShape {
  readonly taskId: string;
}

interface RuntimeTaskEditorActionService<TTaskRecord extends TaskRecordShape> {
  createTask(input: {
    repositoryId?: string;
    projectId?: string;
    title?: string | null;
    body: string;
  }): Promise<TTaskRecord>;
  updateTask(input: {
    taskId: string;
    repositoryId?: string | null;
    projectId?: string | null;
    title?: string | null;
    body?: string;
  }): Promise<TTaskRecord>;
}

export interface RuntimeTaskEditorSubmitPayload {
  readonly mode: 'create' | 'edit';
  readonly taskId: string | null;
  readonly repositoryId: string | null;
  readonly projectId?: string | null;
  readonly title: string | null;
  readonly body: string;
  readonly commandLabel: string;
}

export interface RuntimeTaskEditorActionsOptions<TTaskRecord extends TaskRecordShape> {
  readonly workspace: WorkspaceModel;
  readonly controlPlaneService: RuntimeTaskEditorActionService<TTaskRecord>;
  readonly applyTaskRecord: (task: TTaskRecord) => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly markDirty: () => void;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface RuntimeTaskEditorActions {
  submitTaskEditorPayload(payload: RuntimeTaskEditorSubmitPayload): void;
}

export function createRuntimeTaskEditorActions<TTaskRecord extends TaskRecordShape>(
  options: RuntimeTaskEditorActionsOptions<TTaskRecord>,
): RuntimeTaskEditorActions {
  const submitTaskEditorPayload = (payload: RuntimeTaskEditorSubmitPayload): void => {
    options.queueControlPlaneOp(async () => {
      try {
        if (payload.mode === 'create') {
          options.applyTaskRecord(
            await options.controlPlaneService.createTask({
              ...(payload.repositoryId === null ? {} : { repositoryId: payload.repositoryId }),
              ...(payload.projectId === undefined || payload.projectId === null
                ? {}
                : { projectId: payload.projectId }),
              title: payload.title,
              body: payload.body,
            }),
          );
        } else {
          if (payload.taskId === null) {
            throw new Error('task edit state missing task id');
          }
          options.applyTaskRecord(
            await options.controlPlaneService.updateTask({
              taskId: payload.taskId,
              ...(payload.repositoryId === null ? {} : { repositoryId: payload.repositoryId }),
              ...(payload.projectId === undefined || payload.projectId === null
                ? {}
                : { projectId: payload.projectId }),
              title: payload.title,
              body: payload.body,
            }),
          );
        }
        options.workspace.taskEditorPrompt = null;
        options.workspace.taskPaneNotice = null;
      } catch (error: unknown) {
        const message = formatErrorMessage(error);
        if (options.workspace.taskEditorPrompt !== null) {
          options.workspace.taskEditorPrompt.error = message;
        } else {
          options.workspace.taskPaneNotice = message;
        }
      } finally {
        options.markDirty();
      }
    }, payload.commandLabel);
  };

  return {
    submitTaskEditorPayload,
  };
}
