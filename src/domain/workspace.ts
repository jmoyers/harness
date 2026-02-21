import type { ProjectPaneSnapshot } from '../mux/harness-core-ui.ts';
import type { CommandMenuState } from '../mux/live-mux/command-menu.ts';
import type { LeftNavSelection } from '../mux/live-mux/left-nav.ts';
import type { LinePromptInputState } from '../mux/live-mux/modal-input-reducers.ts';
import type { PaneSelection, PaneSelectionDrag } from '../mux/live-mux/selection.ts';
import type { createNewThreadPromptState } from '../mux/new-thread-prompt.ts';
import type { TaskComposerBuffer } from '../mux/task-composer.ts';
import type { TaskFocusedPaneView } from '../mux/task-focused-pane.ts';
import type { buildWorkspaceRailViewRows } from '../mux/workspace-rail-model.ts';

type MainPaneMode = 'conversation' | 'project' | 'home';

export interface ConversationTitleEditState {
  conversationId: string;
  value: string;
  lastSavedValue: string;
  error: string | null;
  persistInFlight: boolean;
  debounceTimer: NodeJS.Timeout | null;
}

export interface RepositoryPromptState {
  readonly mode: 'add' | 'edit';
  readonly repositoryId: string | null;
  readonly value: string;
  readonly error: string | null;
}

interface ApiKeyPromptState {
  readonly keyName: string;
  readonly displayName: string;
  readonly value: string;
  readonly error: string | null;
  readonly hasExistingValue: boolean;
  readonly lineInputState?: LinePromptInputState;
}

export interface TaskEditorPromptState {
  mode: 'create' | 'edit';
  taskId: string | null;
  title: string;
  body: string;
  repositoryIds: readonly string[];
  repositoryIndex: number;
  fieldIndex: 0 | 1 | 2;
  error: string | null;
}

interface HomePaneDragState {
  readonly kind: 'task' | 'repository';
  readonly itemId: string;
  readonly startedRowIndex: number;
  readonly latestRowIndex: number;
  readonly hasDragged: boolean;
}

type TaskEditorTarget = { kind: 'draft' } | { kind: 'task'; taskId: string };

interface WorkspaceModelInit {
  activeDirectoryId: string | null;
  leftNavSelection: LeftNavSelection;
  latestTaskPaneView: TaskFocusedPaneView;
  taskDraftComposer: TaskComposerBuffer;
  repositoriesCollapsed: boolean;
  shortcutsCollapsed?: boolean;
  showDebugBar?: boolean;
}

export class WorkspaceModel {
  activeDirectoryId: string | null;
  mainPaneMode: MainPaneMode = 'conversation';
  leftNavSelection: LeftNavSelection;
  activeRepositorySelectionId: string | null = null;
  repositoryToggleChordPrefixAtMs: number | null = null;
  projectPaneSnapshot: ProjectPaneSnapshot | null = null;
  projectPaneScrollTop = 0;
  taskPaneScrollTop = 0;
  latestTaskPaneView: TaskFocusedPaneView;
  taskPaneSelectedTaskId: string | null = null;
  taskPaneSelectedRepositoryId: string | null = null;
  taskRepositoryDropdownOpen = false;
  taskEditorTarget: TaskEditorTarget = { kind: 'draft' };
  taskDraftComposer: TaskComposerBuffer;
  taskPaneSelectionFocus: 'task' | 'repository' = 'task';
  taskPaneNotice: string | null = null;
  taskPaneTaskEditClickState: { entityId: string; atMs: number } | null = null;
  taskPaneRepositoryEditClickState: { entityId: string; atMs: number } | null = null;
  homePaneDragState: HomePaneDragState | null = null;

  selection: PaneSelection | null = null;
  selectionDrag: PaneSelectionDrag | null = null;
  selectionPinnedFollowOutput: boolean | null = null;
  repositoryPrompt: RepositoryPromptState | null = null;
  apiKeyPrompt: ApiKeyPromptState | null = null;
  commandMenu: CommandMenuState | null = null;
  newThreadPrompt: ReturnType<typeof createNewThreadPromptState> | null = null;
  addDirectoryPrompt: { value: string; error: string | null } | null = null;
  taskEditorPrompt: TaskEditorPromptState | null = null;
  conversationTitleEdit: ConversationTitleEditState | null = null;
  conversationTitleEditClickState: { conversationId: string; atMs: number } | null = null;
  paneDividerDragActive = false;
  previousSelectionRows: readonly number[] = [];
  latestRailViewRows: ReturnType<typeof buildWorkspaceRailViewRows> = [];

  repositoriesCollapsed: boolean;
  shortcutsCollapsed: boolean;
  showDebugBar: boolean;

  constructor(init: WorkspaceModelInit) {
    this.activeDirectoryId = init.activeDirectoryId;
    this.leftNavSelection = init.leftNavSelection;
    this.latestTaskPaneView = init.latestTaskPaneView;
    this.taskDraftComposer = init.taskDraftComposer;
    this.repositoriesCollapsed = init.repositoriesCollapsed;
    this.shortcutsCollapsed = init.shortcutsCollapsed ?? false;
    this.showDebugBar = init.showDebugBar ?? false;
  }

  selectLeftNavHome(): void {
    this.leftNavSelection = {
      kind: 'home',
    };
  }

  selectLeftNavTasks(): void {
    this.leftNavSelection = {
      kind: 'tasks',
    };
  }

  selectLeftNavRepository(repositoryGroupId: string): void {
    this.activeRepositorySelectionId = repositoryGroupId;
    this.leftNavSelection = {
      kind: 'repository',
      repositoryId: repositoryGroupId,
    };
  }

  selectLeftNavProject(directoryId: string, repositoryGroupId: string): void {
    this.activeRepositorySelectionId = repositoryGroupId;
    this.leftNavSelection = {
      kind: 'project',
      directoryId,
    };
  }

  selectLeftNavGitHub(directoryId: string, repositoryGroupId: string): void {
    this.activeRepositorySelectionId = repositoryGroupId;
    this.leftNavSelection = {
      kind: 'github',
      directoryId,
    };
  }

  selectLeftNavConversation(sessionId: string): void {
    this.leftNavSelection = {
      kind: 'conversation',
      sessionId,
    };
  }

  enterProjectPane(directoryId: string, repositoryGroupId: string): void {
    this.activeDirectoryId = directoryId;
    this.selectLeftNavProject(directoryId, repositoryGroupId);
    this.mainPaneMode = 'project';
    this.homePaneDragState = null;
    this.taskPaneTaskEditClickState = null;
    this.taskPaneRepositoryEditClickState = null;
    this.projectPaneScrollTop = 0;
  }

  enterGitHubPane(directoryId: string, repositoryGroupId: string): void {
    this.activeDirectoryId = directoryId;
    this.selectLeftNavGitHub(directoryId, repositoryGroupId);
    this.mainPaneMode = 'project';
    this.homePaneDragState = null;
    this.taskPaneTaskEditClickState = null;
    this.taskPaneRepositoryEditClickState = null;
    this.projectPaneScrollTop = 0;
  }

  enterHomePane(): void {
    this.mainPaneMode = 'home';
    this.selectLeftNavHome();
    this.projectPaneSnapshot = null;
    this.projectPaneScrollTop = 0;
    this.taskPaneScrollTop = 0;
    this.taskPaneNotice = null;
    this.taskRepositoryDropdownOpen = false;
    this.taskPaneTaskEditClickState = null;
    this.taskPaneRepositoryEditClickState = null;
    this.homePaneDragState = null;
  }

  enterTasksPane(): void {
    this.mainPaneMode = 'home';
    this.selectLeftNavTasks();
    this.projectPaneSnapshot = null;
    this.projectPaneScrollTop = 0;
    this.taskPaneScrollTop = 0;
    this.taskPaneNotice = null;
    this.taskRepositoryDropdownOpen = false;
    this.taskPaneTaskEditClickState = null;
    this.taskPaneRepositoryEditClickState = null;
    this.homePaneDragState = null;
  }
}
