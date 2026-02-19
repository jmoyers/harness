import {
  reduceTaskEditorPromptInput,
  type TaskEditorPromptInputState,
} from './modal-input-reducers.ts';

interface TaskEditorPromptState extends TaskEditorPromptInputState {
  mode: 'create' | 'edit';
  taskId: string | null;
  error: string | null;
}

interface TaskEditorSubmitPayload {
  mode: 'create' | 'edit';
  taskId: string | null;
  repositoryId: string | null;
  projectId?: string | null;
  title: string | null;
  body: string;
  commandLabel: string;
}

interface HandleTaskEditorPromptInputResult {
  handled: boolean;
  nextPrompt?: TaskEditorPromptState | null;
  markDirty: boolean;
  submitPayload?: TaskEditorSubmitPayload;
}

interface HandleTaskEditorPromptInputOptions {
  input: Buffer;
  prompt: TaskEditorPromptState | null;
  isQuitShortcut: (input: Buffer) => boolean;
  dismissOnOutsideClick: (input: Buffer, dismiss: () => void) => boolean;
}

export function handleTaskEditorPromptInput(
  options: HandleTaskEditorPromptInputOptions,
): HandleTaskEditorPromptInputResult {
  const { input, prompt, isQuitShortcut, dismissOnOutsideClick } = options;
  if (prompt === null) {
    return {
      handled: false,
      markDirty: false,
    };
  }
  if (input.length === 1 && input[0] === 0x03) {
    return {
      handled: false,
      markDirty: false,
    };
  }
  if (isQuitShortcut(input)) {
    return {
      handled: true,
      nextPrompt: null,
      markDirty: true,
    };
  }

  let dismissed = false;
  if (
    dismissOnOutsideClick(input, () => {
      dismissed = true;
    })
  ) {
    return {
      handled: true,
      ...(dismissed
        ? {
            nextPrompt: null,
            markDirty: true,
          }
        : {
            markDirty: false,
          }),
    };
  }

  const reduced = reduceTaskEditorPromptInput(prompt, input);
  const nextTitle = reduced.title;
  const nextBody = reduced.body;
  const nextFieldIndex = reduced.fieldIndex;
  const nextRepositoryIndex = reduced.repositoryIndex;
  const submit = reduced.submit;
  const changed =
    nextTitle !== prompt.title ||
    nextBody !== prompt.body ||
    nextFieldIndex !== prompt.fieldIndex ||
    nextRepositoryIndex !== prompt.repositoryIndex;

  const changedPrompt = changed
    ? {
        ...prompt,
        title: nextTitle,
        body: nextBody,
        fieldIndex: nextFieldIndex,
        repositoryIndex: nextRepositoryIndex,
        error: null,
      }
    : prompt;

  if (!submit) {
    return {
      handled: true,
      ...(changed
        ? {
            nextPrompt: changedPrompt,
            markDirty: true,
          }
        : {
            markDirty: false,
          }),
    };
  }

  const repositoryId = prompt.repositoryIds[nextRepositoryIndex] ?? null;
  if (nextBody.trim().length === 0) {
    return {
      handled: true,
      nextPrompt: {
        ...changedPrompt,
        error: 'task body required',
      },
      markDirty: true,
    };
  }
  if (repositoryId === null) {
    return {
      handled: true,
      nextPrompt: {
        ...changedPrompt,
        error: 'repository required',
      },
      markDirty: true,
    };
  }
  return {
    handled: true,
    ...(changed
      ? {
          nextPrompt: changedPrompt,
          markDirty: true,
        }
      : {
          markDirty: false,
        }),
    submitPayload: {
      mode: prompt.mode,
      taskId: prompt.taskId,
      repositoryId,
      projectId: null,
      title: nextTitle.trim().length === 0 ? null : nextTitle.trim(),
      body: nextBody,
      commandLabel: prompt.mode === 'create' ? 'tasks-create' : 'tasks-edit',
    },
  };
}
