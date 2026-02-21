import {
  CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL,
  NEW_THREAD_MODAL_CLAUDE_BUTTON,
  NEW_THREAD_MODAL_CODEX_BUTTON,
  NEW_THREAD_MODAL_CRITIQUE_BUTTON,
  NEW_THREAD_MODAL_CURSOR_BUTTON,
  NEW_THREAD_MODAL_TERMINAL_BUTTON,
  resolveGoldenModalSize,
} from '../harness-core-ui.ts';
import {
  resolveCommandMenuPage,
  type CommandMenuActionDescriptor,
  type CommandMenuState,
} from './command-menu.ts';
import type { createNewThreadPromptState } from '../new-thread-prompt.ts';
import { newThreadPromptBodyLines } from '../new-thread-prompt.ts';
import {
  UiKit,
  type UiModalOverlay,
  type UiModalTheme,
} from '../../../packages/harness-ui/src/kit.ts';

type NewThreadPromptState = ReturnType<typeof createNewThreadPromptState>;
type UiModalThemeInput = Partial<UiModalTheme>;

const UI_KIT = new UiKit();

interface TaskEditorPromptOverlayState {
  mode: 'create' | 'edit';
  title: string;
  body: string;
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

interface ApiKeyPromptOverlayState {
  readonly keyName: string;
  readonly displayName: string;
  readonly value: string;
  readonly error: string | null;
  readonly hasExistingValue: boolean;
}

interface ConversationTitleOverlayState {
  value: string;
  lastSavedValue: string;
  error: string | null;
  persistInFlight: boolean;
}

interface ReleaseNotesOverlayState {
  readonly currentVersion: string;
  readonly latestTag: string;
  readonly releasesPageUrl: string;
  readonly releases: readonly {
    tag: string;
    name: string;
    url: string;
    previewLines: readonly string[];
    previewTruncated: boolean;
  }[];
}

const RELEASE_NOTES_UPDATE_ACTION_BODY_LINE_INDEX = 2;
const RELEASE_NOTES_BODY_START_ROW_OFFSET = 2;
export const RELEASE_NOTES_UPDATE_ACTION_ROW_OFFSET =
  RELEASE_NOTES_BODY_START_ROW_OFFSET + RELEASE_NOTES_UPDATE_ACTION_BODY_LINE_INDEX;
export const RELEASE_NOTES_UPDATE_ACTION_LABEL = '[ click to update now ]';

export function buildNewThreadModalOverlay(
  layoutCols: number,
  viewportRows: number,
  prompt: NewThreadPromptState | null,
  theme: UiModalThemeInput,
): UiModalOverlay | null {
  if (prompt === null) {
    return null;
  }
  const modalSize = resolveGoldenModalSize(layoutCols, viewportRows, {
    preferredHeight: 15,
    minWidth: 22,
    maxWidth: 36,
  });
  return UI_KIT.buildModalOverlay({
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
      cursorButtonLabel: NEW_THREAD_MODAL_CURSOR_BUTTON,
      terminalButtonLabel: NEW_THREAD_MODAL_TERMINAL_BUTTON,
      critiqueButtonLabel: NEW_THREAD_MODAL_CRITIQUE_BUTTON,
    }),
    footer: 'enter create  esc',
    theme,
  });
}

export function buildCommandMenuModalOverlay(
  layoutCols: number,
  viewportRows: number,
  menu: CommandMenuState | null,
  actions: readonly CommandMenuActionDescriptor[],
  theme: UiModalThemeInput,
): UiModalOverlay | null {
  if (menu === null) {
    return null;
  }
  const isThemePicker = menu.scope === 'theme-select';
  const modalSize = resolveGoldenModalSize(layoutCols, viewportRows, {
    preferredHeight: 18,
    minWidth: 48,
    maxWidth: 96,
  });
  const page = resolveCommandMenuPage(actions, menu);
  const bodyLines: string[] = [`${isThemePicker ? 'theme' : 'search'}: ${menu.query}_`, ''];
  if (page.matches.length === 0) {
    bodyLines.push('no actions match');
  } else {
    for (const entry of page.displayEntries) {
      const prefix = entry.absoluteIndex === page.selectedIndex ? '>' : ' ';
      const detail = entry.action.detail?.trim() ?? '';
      bodyLines.push(
        detail.length > 0
          ? `${prefix} ${entry.action.title} - ${detail}`
          : `${prefix} ${entry.action.title}`,
      );
    }
  }
  bodyLines.push('', isThemePicker ? 'type to filter themes' : 'type to filter');
  const title = isThemePicker ? 'Choose Theme' : 'Command Menu';
  return UI_KIT.buildModalOverlay({
    viewportCols: layoutCols,
    viewportRows,
    width: modalSize.width,
    height: modalSize.height,
    anchor: 'center',
    marginRows: 1,
    title,
    bodyLines,
    footer: isThemePicker ? 'enter apply  esc cancel' : 'enter run  esc',
    theme,
  });
}

export function buildAddDirectoryModalOverlay(
  layoutCols: number,
  viewportRows: number,
  prompt: { value: string; error: string | null } | null,
  theme: UiModalThemeInput,
): UiModalOverlay | null {
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
  return UI_KIT.buildModalOverlay({
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
): UiModalOverlay | null {
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
    selectedRepositoryId === null
      ? '(none)'
      : (resolveRepositoryName(selectedRepositoryId) ?? '(missing)');
  const taskBody = [
    `${prompt.fieldIndex === 0 ? '>' : ' '} title: ${prompt.title}${prompt.fieldIndex === 0 ? '_' : ''}`,
    `${prompt.fieldIndex === 1 ? '>' : ' '} repository: ${selectedRepositoryName}`,
    `${prompt.fieldIndex === 2 ? '>' : ' '} body: ${prompt.body}${
      prompt.fieldIndex === 2 ? '_' : ''
    }`,
    '',
    'tab next field',
    'left/right change repository',
  ];
  if (prompt.error !== null && prompt.error.length > 0) {
    taskBody.push(`error: ${prompt.error}`);
  }
  return UI_KIT.buildModalOverlay({
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
): UiModalOverlay | null {
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
  return UI_KIT.buildModalOverlay({
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

export function buildApiKeyModalOverlay(
  layoutCols: number,
  viewportRows: number,
  prompt: ApiKeyPromptOverlayState | null,
  theme: UiModalThemeInput,
): UiModalOverlay | null {
  if (prompt === null) {
    return null;
  }
  const modalSize = resolveGoldenModalSize(layoutCols, viewportRows, {
    preferredHeight: 16,
    minWidth: 34,
    maxWidth: 64,
  });
  const promptValue = prompt.value.length > 0 ? prompt.value : '(enter value)';
  const bodyLines = [`${prompt.keyName}: ${promptValue}_`];
  if (prompt.error !== null && prompt.error.length > 0) {
    bodyLines.push(`error: ${prompt.error}`);
  } else if (prompt.hasExistingValue) {
    bodyLines.push('warning: existing value detected (submit will overwrite)');
  } else {
    bodyLines.push('value is saved to user-global secrets.env');
  }
  return UI_KIT.buildModalOverlay({
    viewportCols: layoutCols,
    viewportRows,
    width: modalSize.width,
    height: modalSize.height,
    anchor: 'center',
    marginRows: 1,
    title: `Set ${prompt.displayName}`,
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
): UiModalOverlay | null {
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
  const editBody = [
    `title: ${edit.value}_`,
    `state: ${editState}`,
    '',
    CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL,
  ];
  if (edit.error !== null && edit.error.length > 0) {
    editBody.push(`error: ${edit.error}`);
  }
  return UI_KIT.buildModalOverlay({
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

export function buildReleaseNotesModalOverlay(
  layoutCols: number,
  viewportRows: number,
  prompt: ReleaseNotesOverlayState | null,
  theme: UiModalThemeInput,
): UiModalOverlay | null {
  if (prompt === null) {
    return null;
  }
  const modalSize = resolveGoldenModalSize(layoutCols, viewportRows, {
    preferredHeight: 24,
    minWidth: 48,
    maxWidth: 110,
  });
  const bodyLines: string[] = [
    `installed: v${prompt.currentVersion}`,
    `latest: ${prompt.latestTag}`,
    RELEASE_NOTES_UPDATE_ACTION_LABEL,
    '',
  ];
  const hasPreviewContent = prompt.releases.some(
    (release) => release.previewLines.length > 0 || release.previewTruncated,
  );
  if (!hasPreviewContent) {
    bodyLines.push(`version available: ${prompt.latestTag}`);
    bodyLines.push('release notes not published yet');
    bodyLines.push(`cmd+click: ${prompt.releases[0]?.url ?? prompt.releasesPageUrl}`, '');
  } else {
    for (const release of prompt.releases) {
      const heading =
        release.name.trim().length > 0 ? `${release.tag} - ${release.name}` : release.tag;
      bodyLines.push(heading);
      for (const line of release.previewLines) {
        bodyLines.push(`  ${line}`);
      }
      if (release.previewTruncated) {
        bodyLines.push('  ...');
      }
      bodyLines.push(`  cmd+click: ${release.url}`, '');
    }
  }
  bodyLines.push(`all releases: ${prompt.releasesPageUrl}`);
  return UI_KIT.buildModalOverlay({
    viewportCols: layoutCols,
    viewportRows,
    width: modalSize.width,
    height: modalSize.height,
    anchor: 'center',
    marginRows: 1,
    title: "What's New",
    bodyLines,
    footer: 'click update  enter dismiss  u update  n never  o open latest',
    theme,
  });
}
