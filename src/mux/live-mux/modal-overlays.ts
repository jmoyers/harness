import {
  CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL,
  NEW_THREAD_MODAL_CLAUDE_BUTTON,
  NEW_THREAD_MODAL_CODEX_BUTTON,
  NEW_THREAD_MODAL_CRITIQUE_BUTTON,
  NEW_THREAD_MODAL_TERMINAL_BUTTON,
  resolveGoldenModalSize,
} from '../harness-core-ui.ts';
import type { createNewThreadPromptState } from '../new-thread-prompt.ts';
import { newThreadPromptBodyLines } from '../new-thread-prompt.ts';
import { buildUiModalOverlay } from '../../ui/kit.ts';

type NewThreadPromptState = ReturnType<typeof createNewThreadPromptState>;
type UiModalThemeInput = NonNullable<Parameters<typeof buildUiModalOverlay>[0]['theme']>;

interface TaskEditorPromptOverlayState {
  mode: 'create' | 'edit';
  title: string;
  description: string;
  repositoryIds: readonly string[];
  repositoryIndex: number;
  fieldIndex: 0 | 1 | 2;
  error: string | null;
}

interface RepositoryPromptOverlayState {
  readonly mode: 'add' | 'edit';
  readonly value: string;
  readonly error: string | null;
}

interface ConversationTitleOverlayState {
  value: string;
  lastSavedValue: string;
  error: string | null;
  persistInFlight: boolean;
}

export function buildNewThreadModalOverlay(
  layoutCols: number,
  viewportRows: number,
  prompt: NewThreadPromptState | null,
  theme: UiModalThemeInput,
): ReturnType<typeof buildUiModalOverlay> | null {
  if (prompt === null) {
    return null;
  }
  const modalSize = resolveGoldenModalSize(layoutCols, viewportRows, {
    preferredHeight: 14,
    minWidth: 22,
    maxWidth: 36,
  });
  return buildUiModalOverlay({
    viewportCols: layoutCols,
    viewportRows,
    width: modalSize.width,
    height: modalSize.height,
    anchor: 'center',
    marginRows: 1,
    title: 'New Thread',
    bodyLines: newThreadPromptBodyLines(prompt, {
      codexButtonLabel: NEW_THREAD_MODAL_CODEX_BUTTON,
      claudeButtonLabel: NEW_THREAD_MODAL_CLAUDE_BUTTON,
      terminalButtonLabel: NEW_THREAD_MODAL_TERMINAL_BUTTON,
      critiqueButtonLabel: NEW_THREAD_MODAL_CRITIQUE_BUTTON,
    }),
    footer: 'enter create  esc',
    theme,
  });
}

export function buildAddDirectoryModalOverlay(
  layoutCols: number,
  viewportRows: number,
  prompt: { value: string; error: string | null } | null,
  theme: UiModalThemeInput,
): ReturnType<typeof buildUiModalOverlay> | null {
  if (prompt === null) {
    return null;
  }
  const modalSize = resolveGoldenModalSize(layoutCols, viewportRows, {
    preferredHeight: 15,
    minWidth: 24,
    maxWidth: 40,
  });
  const promptValue = prompt.value.length > 0 ? prompt.value : '.';
  const addDirectoryBody = [`path: ${promptValue}_`];
  if (prompt.error !== null && prompt.error.length > 0) {
    addDirectoryBody.push(`error: ${prompt.error}`);
  } else {
    addDirectoryBody.push('add a workspace project for new threads');
  }
  return buildUiModalOverlay({
    viewportCols: layoutCols,
    viewportRows,
    width: modalSize.width,
    height: modalSize.height,
    anchor: 'center',
    marginRows: 1,
    title: 'Add Project',
    bodyLines: addDirectoryBody,
    footer: 'enter save  esc',
    theme,
  });
}

export function buildTaskEditorModalOverlay(
  layoutCols: number,
  viewportRows: number,
  prompt: TaskEditorPromptOverlayState | null,
  resolveRepositoryName: (repositoryId: string) => string | null,
  theme: UiModalThemeInput,
): ReturnType<typeof buildUiModalOverlay> | null {
  if (prompt === null) {
    return null;
  }
  const modalSize = resolveGoldenModalSize(layoutCols, viewportRows, {
    preferredHeight: 18,
    minWidth: 30,
    maxWidth: 56,
  });
  const selectedRepositoryId = prompt.repositoryIds[prompt.repositoryIndex] ?? null;
  const selectedRepositoryName =
    selectedRepositoryId === null ? '(none)' : (resolveRepositoryName(selectedRepositoryId) ?? '(missing)');
  const taskBody = [
    `${prompt.fieldIndex === 0 ? '>' : ' '} title: ${prompt.title}${prompt.fieldIndex === 0 ? '_' : ''}`,
    `${prompt.fieldIndex === 1 ? '>' : ' '} repository: ${selectedRepositoryName}`,
    `${prompt.fieldIndex === 2 ? '>' : ' '} description: ${prompt.description}${
      prompt.fieldIndex === 2 ? '_' : ''
    }`,
    '',
    'tab next field',
    'left/right change repository',
  ];
  if (prompt.error !== null && prompt.error.length > 0) {
    taskBody.push(`error: ${prompt.error}`);
  }
  return buildUiModalOverlay({
    viewportCols: layoutCols,
    viewportRows,
    width: modalSize.width,
    height: modalSize.height,
    anchor: 'center',
    marginRows: 1,
    title: prompt.mode === 'create' ? 'New Task' : 'Edit Task',
    bodyLines: taskBody,
    footer: 'enter save  esc',
    theme,
  });
}

export function buildRepositoryModalOverlay(
  layoutCols: number,
  viewportRows: number,
  prompt: RepositoryPromptOverlayState | null,
  theme: UiModalThemeInput,
): ReturnType<typeof buildUiModalOverlay> | null {
  if (prompt === null) {
    return null;
  }
  const modalSize = resolveGoldenModalSize(layoutCols, viewportRows, {
    preferredHeight: 15,
    minWidth: 28,
    maxWidth: 56,
  });
  const promptValue = prompt.value.length > 0 ? prompt.value : 'https://github.com/org/repo';
  const bodyLines = [`github url: ${promptValue}_`];
  if (prompt.error !== null && prompt.error.length > 0) {
    bodyLines.push(`error: ${prompt.error}`);
  } else if (prompt.mode === 'add') {
    bodyLines.push('add a repository and link matching projects');
  } else {
    bodyLines.push('update repository github url');
  }
  return buildUiModalOverlay({
    viewportCols: layoutCols,
    viewportRows,
    width: modalSize.width,
    height: modalSize.height,
    anchor: 'center',
    marginRows: 1,
    title: prompt.mode === 'add' ? 'Add Repository' : 'Edit Repository',
    bodyLines,
    footer: 'enter save  esc',
    theme,
  });
}

export function buildConversationTitleModalOverlay(
  layoutCols: number,
  viewportRows: number,
  edit: ConversationTitleOverlayState | null,
  theme: UiModalThemeInput,
): ReturnType<typeof buildUiModalOverlay> | null {
  if (edit === null) {
    return null;
  }
  const modalSize = resolveGoldenModalSize(layoutCols, viewportRows, {
    preferredHeight: 18,
    minWidth: 26,
    maxWidth: 44,
  });
  const editState = edit.persistInFlight
    ? 'saving'
    : edit.value === edit.lastSavedValue
      ? 'saved'
      : 'pending';
  const editBody = [`title: ${edit.value}_`, `state: ${editState}`, '', CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL];
  if (edit.error !== null && edit.error.length > 0) {
    editBody.push(`error: ${edit.error}`);
  }
  return buildUiModalOverlay({
    viewportCols: layoutCols,
    viewportRows,
    width: modalSize.width,
    height: modalSize.height,
    anchor: 'center',
    marginRows: 1,
    title: 'Edit Thread Title',
    bodyLines: editBody,
    footer: 'type to save  enter done',
    theme,
  });
}
